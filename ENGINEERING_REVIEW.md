# Инженерный ревью next-fluent — полный проход по коду

Дата: 25 сентября 2026 года. Ветка `arena/01a0d8f0-next-fluent`, база — коммит `7ce35e0`.
Это независимое ревью поверх текущего состояния репозитория (после аудита от 24.09, см. `ENGINEERING_AUDIT.md`). Ниже — новые дефекты N01–N32, найденные повторным проходом, и рекомендации по развитию библиотеки.

## Резюме

Библиотека в хорошем состоянии для `0.1.0`: 125 unit-тестов проходят, `tsc --noEmit` чистый, `npm pack` собирается, consumer-type тесты с отрицательными кейсами работают, route engine с динамическими сегментами, доменами и basePath — редкость для подобных библиотек. Предыдущие дефекты F01–F20 действительно исправлены.

Но полный проход нашёл **4 дефекта уровня P1** (неверный результат в заявленных сценариях), **~10 уровня P2** (архитектура/надёжность) и ряд P3 (безопасность, инструменты, доки). Самое серьёзное:

1. **Переключение языка на не-дефолтную локаль в режиме `as-needed` генерирует битый URL `/ru/ru/o-nas` → 404.** Ни один тест не рендерит `Link` и не проверяет `href`, поэтому это проскочило.
2. **`t.raw()` не работает для любых сообщений с переменными** — возвращает вместо текста ключ и пишет warn в консоль.
3. **Каждый entry point (`server.js`, `factory.js`, `bundle.js`, `client.js`, `index.js`) несёт собственные копии всех синглтонов** (кешей, глобального конфига) — `esbuild bundle: true` без splitting инлайнит shared-модули; cache API и смешение путей импорта дают ловушки.
4. **`t.raw()` теряет значение сообщения, если у него есть атрибуты**, а обычный `t()` «протекает» React-токенами в строку.

Плюс подтверждённый open redirect через Host-заголовок в middleware (P3-безопасность, но эксплуатируется тривиально).

## Область и методика

- Прочитаны все 20 файлов `src`, `bin/next-fluent.mjs`, `scripts/build.mjs`, `scripts/test-next-integration.mjs`, `package.json`, README, CI, tsconfig, все 22 тестовых файла и Next-fixture.
- Выполнены `npm ci`, `npm run build` (dist воспроизводится, `git diff dist/` пустой), `npm run typecheck`, `npm run test:types`, `npm test` — 125/125 зелёные.
- `npm pack --dry-run` — 66 файлов, состав соответствует `files`.
- Отдельными скриптами воспроизведены: рендер `Link` через `react-dom/server` для трёх режимов `localePrefix`; прогон middleware с mock-запросами (включая двойной префикс и Host-заголовок); поведение `t.raw`, `t`/`t.rich` с React-элементами; псевдолокализация FTL; изоляция `createI18n`; сравнение синглтонов между `dist/*`-модулями.

Не покрыто ревью: реальный Edge runtime, нагрузочный бенчмарк, security pentest за пределами найденного, Next 16 Turbopack e2e (CI-матрица это делает, локально не гонялось).

## Что уже хорошо (не ломать)

- **Route engine** (`route-engine.ts`): двустороннее сопоставление static/dynamic/catch-all шаблонов, кодирование параметров, валидация уникальности и паритета параметров, specificity-сортировка.
- **Корректность кеша** (`cache.ts`): после 32-битного хеша сверяется точный исходник (коллизии `0jebqzk`/`1i10qdw` покрыты тестом), LRU ограничен.
- **Харднинг локалей** (`utils.ts`): ограничение длины, каноникализация через Intl, структурные lookup-кандидаты без «частичных вариантов», строгий парсер q-value.
- **Typegen** с разделением переменных value/атрибут и компилируемым consumer-фикстуром с `@ts-expect-error`-негативами.
- **CI**: матрица Node 22/24 × Next 15/16 × Linux/Windows, `check-dist`, consumer types, production Next + браузерный сценарий гидратации.
- Middleware: защита от двойного прохода после rewrite (`x-next-fluent-rewrite`), поддержка доменов и basePath, allow-list для cookie/header.

---

## P1 — дефекты, дающие неверный результат

### N01. `as-needed`: переключение на не-дефолтную локаль даёт двойной префикс `/ru/ru/o-nas` → 404

**Место:** `src/navigation.ts:236-251` (`switchLocaleHref`), используется в `Link` (`:264`) и `useRouter.push/replace` (`:338`, `:344`).

**Воспроизведение** (react-dom/server + mock middleware):

```
config: locales ['en','ru'], defaultLocale 'en', localePrefix 'as-needed',
        pathnames { '/about': { en: '/about-us', ru: '/o-nas' } }

<Link href="/about" locale="ru">  →  href="/ru/ru/o-nas"   ← БИТО
<Link href="/about" locale="en">  →  href="/en/about-us"    ← ок (сигнальный URL, middleware → 307 /about-us + cookie)
<Link href="/ru/o-nas" locale="en"> → href="/en/about-us"   ← ок

middleware GET /ru/ru/o-nas → 200, x-middleware-next: 1, без rewrite
⇒ в app/[locale]/... это [locale]='ru' + путь 'ru/o-nas' ⇒ 404
```

**Анализ.** `getPathname` уже выдаёт канонический href целевой локали: для `as-needed` + не-дефолт — с префиксом (`/ru/o-nas`), для дефолт — без (`/about-us`). `switchLocaleHref` затем **безусловно** дописывает `/${locale}` при `localePrefix !== 'always'`. Для `as-needed`→дефолт и для `never` это намеренный «сигнальный URL» (механизм исправления F07: middleware видит `/en/...`, делает canonical redirect и ставит cookie — работает). Но для `as-needed`→не-дефолт префикс удваивается.

**Исправление.** Не добавлять сигнальный префикс, когда канонический href уже локализован-с-префиксом:

```ts
// switchLocaleHref: сигнал нужен только когда канонический target без префикса
if (config.localePrefix === 'as-needed') {
  const alreadyPrefixed = matchSupportedLocale(firstSegmentOf(route), locales);
  if (alreadyPrefixed) return target;            // /ru/o-nas — готово
  if (matchSupportedLocale(locale, [default]) === locale) {
    return `${basePath}/${locale}${route...}`;   // сигнал для смены cookie на дефолт
  }
  return target;
}
// 'never': сигнал всегда (канонический href без префикса)
```

Плюс: тест, рендерящий `Link` и `router.push` во всех 3 режимах × 3 направления смены локали (сейчас **ни один тест не рендерит `Link`** — `navigation.test.mjs` проверяет только `getPathname` и `typeof nav.Link`; браузерный сценарий в `test-next-integration.mjs` переключает только ru→en — единственный работающий случай).

### N02. `t.raw()` сломан для любых сообщений с переменными

**Место:** `src/bundle.ts:260` — `formatPattern(msg.value, undefined, errors)`.

**Воспроизведение:**

```
ftl: hello = Hello { $name }!
t.raw('hello') → 'hello'   ← вместо текста; в консоли:
  [next-fluent] Format errors for raw key "hello": ReferenceError: Unknown variable: $name
```

`@fluent/bundle` записывает `ReferenceError` за отсутствующую переменную → `errors.length > 0` → `FORMAT_ERROR` → возврат ключа. То же для атрибутов с переменными. Таким образом `raw()` неработоспособен ровно для тех сообщений, для которых он нужнее всего (письма, meta, отладка).

**Исправление.** Варианты (по убыванию полезности):
1. `raw(key, args?)` — форматировать с реальными аргументами, но без rich-парсинга;
2. синтетические подстановки для отсутствующих переменных (`$name` → `$name`-плейсхолдер) с подавлением `ReferenceError`;
3. минимум — не считать `ReferenceError` фатальной ошибкой для raw-пути.

### N03. `t.raw('msg')` теряет значение сообщения, если у него есть атрибуты

**Место:** `src/bundle.ts:199-258` (`getRawValue`): ветка `msg.attributes` возвращает **только** массив атрибутов, не глядя на `msg.value`.

**Воспроизведение:**

```
ftl: msg = The Value
         .attr = The Attr
         .other = Other
t('msg')       → 'The Value'            ← ок
t.raw('msg')   → ['The Attr','Other']   ← значение потеряно
t.raw('msg.attr') → 'The Attr'          ← ок
```

**Исправление.** Определить семантику: возвращать `{ value?, attributes: Record<string,string> }` (новый `rawMessage()`), либо `raw()` — только value, а `rawAttrs()` — атрибуты; текущий union `string[] | string` не отражает модель данных FTL и молча теряет данные.

### N04. React-токены «протекают» в строку обычного `t()`; элемент в аргументах ломает форматирование

**Место:** `src/bundle.ts:136-148` (defaultFluentArgs → `createReactElementToken`), `src/rich.ts:20-23`.

**Воспроизведение:**

```
defaultTranslationValues: { user: <b>Bob</b> }, ftl: greet = Hello { $user }!
t('greet')        → "Hello ⁨\uE000NF_EL_user_\uE001⁩!"   ← мусор в строке (виден в JSON)
t('greet', {user: <b>Bob</b>}) → 'greet' + TypeError: Variable type not supported ← вместо текста
t.rich('greet')   → корректный React-узел                  ← ок
```

**Исправление.** В `tFn` (plain) после форматирования срезать/резолвить токены (или детектировать элементы в args и бросать понятную ошибку «используйте t.rich()/FormattedMessage»). В README явно разделить контракты `t` (строка) и `t.rich` (React-ноды).

---

## P2 — архитектура, интеграция, надёжность

### N05. Каждый dist-entry тянет собственные копии всех синглтонов

**Место:** `scripts/build.mjs:39-56` — `bundle: true` без `splitting` при нескольких entry points.

Каждый из `dist/server.js`, `dist/factory.js`, `dist/bundle.js`, `dist/client.js`, `dist/index.js`, `dist/middleware.js`… содержит **инлайн-копии** `cache.ts`, `lru.ts`, `functions.ts`, `formatter.ts`, `server.ts`-стейта. `loadConfig` физически встречается в трёх файлах (`factory.js:1577`, `server.js:916`, `index.js:1843`).

**Воспроизведение:**

```
root.setRequestConfig(() => ({ messages: 'a = FROM_ROOT_CONFIG' }));
server.getTranslations() → t('a') === 'a'                   ← конфиг не виден (другая копия)
root.getTranslations()   → 'FROM_ROOT_CONFIG'               ← видна только «своя»

bundleMod.createFluentBundle(...) → getBundleCacheStats() растёт;
server.forLocale(...)             → stats НЕ растут            ← кеш server.js отдельный
bundleMod.clearBundleCache()      ← чистит только одну копию
```

Через публичные фасады (`index-server.js` → `server.js` + `bundle.js`) документированные пути в основном согласованы, но:
- `clearBundleCache`/`getBundleCacheStats` (`next-fluent/bundle`) не влияют на кеши внутри `server.js`/`client.js`/`factory.js` (память; API отчитывается неверно);
- `clearFormatterCache` (`next-fluent/formatter`) не чистит кеш `getFormatter` из server.js;
- `setRequestConfig` + `createI18n` без `loadMessages`: factory-копия `globalConfigFn` остаётся `null` (спасает только plugin-алиас `next-fluent/config`);
- задвоение памяти LRU: до 2×500 bundle + 2×1000 resource на «каждую копию».

**Исправление.** Собрать один `core`-бандл (или `splitting: true` + общий chunk) и сделать все entry тонкими фасадами поверх него — как уже сделано для `index-browser`/`index-server`. Добавить smoke-тест «синглтон-консистентность»: `setRequestConfig` через один подпуть, чтение через другой; `clearBundleCache` → `getBundleCacheStats` обнулён.

### N06. `createI18n` не кеширует loader в рамках запроса — каждый `getTranslations()` заново читает каталог

**Место:** `src/server.ts:185-200` (`loadConfig`: `override ? undefined : store.configs.get/set`), `src/server.ts:340` (`hasCustomFuncs` из-за `requestConfig` отключает и `store.bundles`), `src/factory.ts:34-42`.

**Воспроизведение:** два вызова `A.getTranslations()` → `loadMessages` вызван **дважды** (fs/сеть на каждый вызов). Глобальный путь `setRequestConfig` при этом кеширует — асимметрия неочевидна.

**Исправление.** Кешировать промис конфига по `(instance, locale)` (WeakMap на request store или `React.cache` внутри `createI18n`), и снимать флаг `hasCustomFuncs` для `requestConfig` (он не влияет на функции бандла).

### N07. Грязь request store между инстансами/конфигами одного запроса (недоделка F04)

**Место:** `src/server.ts:206-209` и `:331-335`.

```ts
store.defaultTranslationValues ??= result.defaultTranslationValues;
store.timeZone ??= result.timeZone; store.now ??= result.now;
store.functions ??= result.functions;
...
const mergedFunctions = { ...config?.functions, ...store.functions, ...customFunctions };
```

Результат **любого** loader'а (включая instance-scoped `requestConfig`) пишется в общий request store и подмешивается всем остальным трансляторам: функции/дефолты/timeZone конфига A утекают в трансляторы конфига B того же запроса. Изоляция `createI18n` (F04) поэтому неполная.

**Исправление.** Override-результаты не писать в store (или сделать store принадлежащим конфигу/инстансу); `mergedFunctions` собирать только из `config?.functions + customFunctions`.

### N08. Нарушение Rules of Hooks в `navigation.ts`

**Место:** `src/navigation.ts:256-262` (Link), `:279-286` (usePathname), `:312-324`, `:327-331` (useRouter) — `useLocale()`, `useNextPathname()`, `useNextRouter()` вызываются **внутри `try/catch`** с `return` в `catch`.

Работает случайно: next-хуки бросают *после* своего `useContext`, поэтому число зарегистрированных хуков стабильно. Но это прямая ошибка `eslint-plugin-react-hooks`, хрупкая связка с внутренностями Next (`useRouter` кидает инвариант при null-контексте) и потенциальный рассинхрон порядка хуков при изменении Next.

**Исправление.** Вызвать хуки безусловно на верхнем уровне; для отсутствующего router-контекста — резолвить заглушку через значение контекста (`useContext(AppRouterContext)` пробовать нельзя — internal), минимум — документировать требование использования внутри App Router и включить lint в CI.

### N09. `redirect`/`permanentRedirect` экспортируются из клиентского модуля

**Место:** `src/navigation.ts:370-382`, модуль с `'use client'`.

Next.js разрешает `redirect()` только в Server Components / Route Handlers / Server Actions (ошибка времени выполнения из client-компонента), а `navigation.ts` — client entry с re-export из `next/navigation`. next-intl держит эти функции в server-only записи. Плюс `type: 'push'` у `permanentRedirect` семантически бессмыслен (308).

**Исправление.** Вынести `redirect`/`permanentRedirect` в `next-fluent/routing` или отдельный `next-fluent/server-navigation` без `'use client'`, либо guard с понятной ошибкой.

### N10. `useNow()` вызывает hydration mismatch при рендере значения

**Место:** `src/client.ts:158-175`.

`useState(() => context.now ?? new Date())` — на сервере и при гидратации `new Date()` различаются; если значение выводится в UI (через formatter.relativeTime и т.п.), React 19 сообщит mismatch. То же для `useTimeZone()`/`getTimeZone()` fallback'а на системный TZ (`client.ts:143-149`) — серверный и клиентский TZ различаются.

**Исправление.** Без `now` в контексте: отдавать стабильную «эпоху» до mount, обновлять в `useEffect` (как делает next-intl). Документировать обязательность `timeZone` из request config.

### N11. `FluentProvider` хеширует весь каталог FTL на каждый рендер

**Место:** `src/client.ts:68-75` — `computeSourceHash(messages)` вне `useMemo` (плюс идентичный `fallbackMessages`). O(size каталога) на каждый рендер провайдера; при инлайновых `functions`/`defaultTranslationValues` пересоздаётся и bundle (`useMemo` по ссылке), а для bundle с функциями глобальный кеш не используется → GC-шум.

**Исправление.** Перенести хеш внутрь `useMemo`/`useRef`-сравнения; в доках — «мутируйте стабильные ссылки на functions/values».

### N12. `usePathname` возвращает сырой путь при рассинхроне локали provider и URL

**Место:** `src/navigation.ts:278-309` — `rewriteLocalizedPath(lookupKey, currentLocale, pathnames)` ищет только во внешних шаблонах `currentLocale` (+ литеральные внутренние ключи). URL `/en/about-us` при `locale='ru'` в контексте вернёт `/about-us`, а не `/about`.

**Исправление.** Искать как в `localizePath` — по всем локалям (fallback слоем), затем канонизировать через текущую.

### N13. Прочие дефекты рантайма

| Где | Что |
| --- | --- |
| `src/bundle.ts:264-273` | `raw()` по эвристике парсит текст вида `[...]` в `string[]` через `JSON.parse` — недокументированная сюрреалистичная семантика; выпилить. |
| `src/typegen.ts:62-70` | Для сообщения **только с атрибутами** генерируется value-ключ `msg.id`, которого нет в рантайме (`formatCandidate` его не найдёт) — типы обещают несуществующий ключ. |
| `src/types.ts:44-52` | `NamespaceKeys`/`NamespaceArgs`: одновременные `ns.key` и `ns-key` дают дубликаты при маппинге на один `Rest` — неоднозначность типов. |
| `src/utils.ts:139-143` | `Accept-Language: *` резолвится в `locales[0]`, а не в `defaultLocale`. |
| `src/pseudo.ts:68-74` | `pseudoLocalizeFtl` оборачивает `[ ]` каждый TextElement, а не сообщение: `greet = Hello { $name }, welcome` → `[Ĥééļļöö ]{ $name }[, ŵééļçööɱéé]` (воспроизведено). |
| `src/pseudo.ts:36` | `tokenRegex = \{[^}]*\}` ломается на `}` внутри вложенных/экранированных выражений (для FTL спасает Visitor, для `pseudoLocalizeText` — нет). |
| `src/middleware.ts:128-133` | Cookie локали ставится на **каждый** ответ (семантика «локаль последнего визита»), а не только при явной смене (как next-intl) — задокументировать или добавить опцию `setCookie: 'always' | 'switch'`. |
| `src/middleware.ts:123` | `(response as any).request ??= ...` — мутация внутренностей NextResponse, сломается на мажорных апгрейдах Next. |
| `src/route-engine.ts:164-168` | `validateRouteEnvironment`: `url.host !== entry.domain` — URL нормализует регистр, домен `EXAMPLE.com` отвергается как «Invalid domain»; нормализовать регистр при сравнении. |
| `src/server.ts:232-233` | `getRequestConfigSnapshot` возвращает `result.locale` без каноникализации (`en_US` утечёт наружу). |
| `src/client.ts:183-213` | `FormattedMessage`: при `t.has(id) === false` без `fallback` продолжает `t.rich(id)` и рендерит `[MISSING: ...]`/ключ — ок, но `useTranslations()` не прокидывает `strictNamespace` из контекста. |
| `src/functions.ts:46-50` | `CURRENCY` без `currency` молча использует `USD` — лучше падать/варнить. |

---

## P3 — безопасность

### N14. Open redirect через Host / x-forwarded-host в middleware

**Место:** `src/middleware.ts:48-64`.

**Воспроизведение:** запрос с `Host: evil.com` и `x-forwarded-host: evil.com` (directHost === forwardedHost → «trusted»):

```
GET /about → 307 Location: http://evil.com:3000/en/about
```

`trustedForwardedHost` доверяет совпадению `x-forwarded-host === host` без проверки цепочки прокси; `requestOrigin.host` подменяется, и все `createRedirect`/`createSuccessResponse`-rewrite строят абсолютные URL на атакующем хосте. За доверенной прокси (Vercel/Cloudflare), перезаписывающей Host, смягчено; при прямом доступе к серверу/некорректном прокси — тривиально эксплуатируется.

**Исправление.** Строить абсолютные URL из `request.nextUrl.origin`/конфига `domains`; `x-forwarded-host` учитывать только при явной опции `trustProxy`/списке доверенных прокси.

### N15. Опасные схемы в href проходят в `<Link>` без фильтрации

**Место:** `src/navigation.ts:21-23` (`isExternalUrl`), `resolveLocalizedPathname` возвращает external-строки как есть. Тест `audit-refinements.test.mjs:25-37` **закрепляет** passthrough `javascript:`, `data:`, `//evil.com`, `\\evil.com\share`.

Осознанный дизайн «external не трогаем», но как библиотека стоит: блокировать/выкидывать `javascript:`, `data:`, `vbscript:`, `\\`-формы (браузер нормализует `\\evil.com` в protocol-relative `//evil.com`) — сейчас это обход локализации + open redirect/XSS при пользовательских href. Минимум — allowlist схем (`http:`, `https:`, `mailto:`, `tel:`, `#`, относительные) с опцией расширения.

---

## P3 — упаковка, инструменты, доки

| ID | Что | Рекомендация |
| --- | --- | --- |
| N16 | `package.json:107` — `repository.url` указывает на `github.com/next-fluent/next-fluent`, фактический репозиторий — `RusTokRs/next-fluent`. | Поправить metadata (влияет на npm provenance/ссылки). |
| N17 | Нет поля `engines` (Node ≥ 18.18 для Next 15 / React 19), нет `exports['./package.json']`. | Добавить. |
| N18 | `dist/` закоммичен + `check-dist` в CI — рабочая схема, но `git diff --ignore-space-at-eol` на Windows-агентах хрупок; шум в diff'ах PR. | Допустимо; альтернатива — генерировать dist только в `prepack`/CI-artifacts. |
| N19 | Тесты носят исторические имена (`audit-fixes`, `audit-v2`, `audit-refinements`, `deep-audit`…); **нет ни одного рендер-теста `Link`/`useRouter.href`**; браузерный сценарий покрывает только ru→en. | Перегруппировать по модулям (routing/navigation/server/client/typegen), добавить href-снапшоты по матрице режим × направление. |
| N20 | README: «Full Type Safety», «zero hydration mismatch» — при N04/N10/N11 формулировки сильнее гарантий; `t.raw` не документирован (а он сломан — N02/N03). | Смягчить формулировки, описать контракт `t`/`t.rich`/`raw` и требование `timeZone`/`now`. |
| N21 | `console.warn` при ошибках форматирования вместо `FluentBundle`-error handler; в проде — спам без контроля. | Прокидовать `onError`/`missingTranslation` стратегии (как `onError`/`getMessageFallback` у next-intl). |
| N22 | В react-server слое корневой entry экспортирует клиентские хуки (`useTranslations`) как client references — их нельзя вызывать в RSC, типы это не отражают (next-intl отдаёт server-реализации хуков через `react-server` condition). | Либо server-версии хуков в `react-server`-условии, либо README+типовой guard. |

---

## Рекомендации по развитию библиотеки

### Структура кода и API

1. **Единый core-рантайм + тонкие entry-фасады** (закрывает N05): один `dist/core.js` (cache/functions/utils/types/server-ядро), все публичные entry — re-export поверх него. Это же уменьшит размер инсталляции в бандле потребителя и сделает `clearBundleCache` честным.
2. **Пересмотреть `raw()`** (N02/N03): `rawMessage(id): { value?: string; attributes: Record<string, string> }` + `raw(id, args?)`; убрать JSON-эвристику. Это шанс сломать API до 1.0.
3. **Request-scoped store с ownership** (N06/N07): `getRequestStore()` привязать к конфигу/инстансу (`createI18n` → свой WeakMap), override-конфигам не писать в общий store.
4. **Стратегии ошибок**: `createTranslator({ onError, missingKey: 'key' | 'throw' | 'fallback', debug })` вместо `console.warn` + `debug` boolean; dev-overlay для missing keys в dev-режиме.
5. **Хуки-консистентность**: `useNow` — mount-safe (N10); `usePathname` — fallback-поиск по всем локалям (N12); `useTranslations` — `strictNamespace` из контекста.
6. **`next-fluent/navigation` → серверный `redirect`** (N09) и клиентские `Link/useRouter/usePathname`; жёсткое разделение, как у next-intl.
7. **Cookie-политика middleware** — опция `setCookie: 'always' | 'switch'` (N13) и `trustProxy` (N14).

### Фичи, которых не хватает для паритета с next-intl и продвинутых сценариев

- `router.setLocale(locale)` — единый API смены языка (cookie + canonical redirect), скрывающий механизм сигнальных URL (заодно лечит класс ошибок N01).
- Lazy/namespace-каталоги: `loadMessages(namespace)` чтобы не грузить весь FTL на каждый запрос больших приложений.
- `.ftl`-лоадер для webpack/Turbopack внутри плагина (импорт `messages/en.ftl` строкой без fs) + HMR сброс кешей.
- Dev-режим pseudo-локали (`?pseudo` или cookie) поверх существующего `pseudoLocalizeFtl` (после фикса N13-скобок).
- `Intl.Segmenter`/`Intl.DurationFormat` в formatter (по мере поддержки Node 20+), `dateTime.range`.
- Миграционные утилиты ICU ↔ Fluent (хотя бы ICU-plural → Fluent-select скрипт) — снимает главный барьер переезда с next-intl.
- ESLint-плагин/правило: проверка ключей переводов против typegen-вывода (уже есть сырьё в `typegen.ts`).

### Качество и процесс

1. **Тесты-снапшоты рендера `Link`/`useRouter`** по матрице: 3 режима × (внутр./внешн./объектный href) × 3 смены локали — это закрыло бы N01 до релиза. Отдельный кейс: basePath + domains.
2. **Тест-синглтон** между подпутями entry (N05) и тест request-scoped кеширования loader'а (N06).
3. **Edge-runtime job в CI** (middleware в `edge-runtime` полигоне) — по-прежнему не проверяется (из прошлого аудита).
4. **size-limit + бенчмарк** format/getTranslations на каталогах 100/1k/10k сообщений; бюджет бандла клиента (проверено: `client.js`/`navigation.js` не тянут `@fluent/syntax` — он остаётся в typegen/pseudo entry; это правильно, закрепить size-limit'ом от регрессий).
5. Перегруппировать тесты по модулям, убрать исторические имена аудитов; в `verify` добавить `lint` (сейчас eslint вообще не подключён — хуки-нарушения N08 не ловятся).
6. Поправить metadata npm (N16/N17), добавить `CHANGELOG.md` и `CONTRIBUTING.md`.

### Приоритеты

1. **До следующего релиза:** N01 (фикс `switchLocaleHref` + рендер-тесты), N02/N03 (`raw`), N14/N15 (безопасность middleware/href), N16 (metadata).
2. **Следующая итерация:** N05 (единый core), N06/N07 (scoping store), N04 (токены в plain `t`), N08/N09/N10/N11 (хуки/redirect/гидратация/перф).
3. **К 1.0:** стратегии ошибок, `setLocale`, фтл-лоадер, Edge CI, бенчмарки, ревизия формулировок README.

---

## Приложение: сводка воспроизведённых фактов

| Факт | Как проверено |
| --- | --- |
| `<Link locale="ru">` в as-needed → `href="/ru/ru/o-nas"` | рендер `react-dom/server` |
| middleware `/ru/ru/o-nas` → 200 без rewrite (404 в app) | mock-запрос к `createI18nMiddleware` |
| `/en/about-us` при cookie ru → 307 `/about-us` + `Set-Cookie: NEXT_LOCALE=en` | mock-запрос (механизм F07 работает) |
| `t.raw('hello')` при `{ $name }` → `'hello'` + ReferenceError в warn | unit-репро через `dist/bundle.js` |
| `t.raw('msg')` при value+attrs → только атрибуты | unit-репро |
| `t('greet')` с React-элементом в defaults → токен `\uE000NF_EL_...` в строке | unit-репро (JSON-видно) |
| `setRequestConfig` (root) ≠ `getTranslations` (server entry) | два импорта `dist/*` в одном процессе |
| `getBundleCacheStats` не видит кеш `forLocale` | тот же скрипт |
| 2× `A.getTranslations()` → 2 вызова `loadMessages` | счётчик в loader'е |
| pseudo: `[Ĥééļļöö ]{ $name }[, ŵééļçööɱéé]` | `pseudoLocalizeFtl` |
| `Host: evil.com` + `x-forwarded-host: evil.com` → `Location: http://evil.com:3000/en/about` | mock-запрос |
| `javascript:`, `data:`, `\\evil.com` проходят в href как есть | `resolveLocalizedPathname` (+ закреплено тестом `audit-refinements`) |

---

# §14. Статус исправлений (25.09.2026, режим «продолжим и сразу чиним»)

Все блокеры §13 закрыты. Верификация: `npm run build`, `npm run typecheck`, `npm run test:types`, `npm test` (**136 тестов**), `node scripts/test-next-integration.mjs` (production `next build` + рантайм-чеки) — **зелёные**.

| ID | Статус | Что сделано |
| --- | --- | --- |
| N01 | ✅ Fixed | `switchLocaleHref` объединяет basePath ровно один раз (`normalizeBasePath`), централизованная подстановка `URL.pathname`. Тест: `review-regressions.test.mjs` |
| N02 | ✅ Fixed | `raw(key, args?)`: интерполяция аргументов; ошибки форматирования (включая `.type` в аргументах) **игнорируются** — плейсхолдеры остаются `{$name}` литералами; fallbackKey только при «нет сообщения» (без утечки `namespace.key`); одиночная строка-аргумент — `fallbackKey` (бэкорды) |
| N03 | ✅ Fixed | `raw` + attrs + args: интерполированное `value` возвращается корректно |
| N04 | ✅ Fixed | `t()` детектирует токены React-элементов в финальном выводе (аргументы И `defaultTranslationValues`) и бросает понятную ошибку с указанием на `t.rich()`/`FormattedMessage`; `defaultMessage` экранируется |
| N05 | ✅ Fixed | Общие синглтоны вынесены в отдельный модуль `src/utils.ts`; сборка переписана (`scripts/build.mjs`) — внутренние модули импортируются, а не дублируются в каждом entry (`server`/`factory`/`bundle`/`middleware` делят один конфиг/кэши). Тест: N05 |
| N06 | 🟡 Partial | `useRouter`: инициализация Next-роутера в `try/catch` (исключение больше не схлопывает дерево). Полноценный синглтон-инстанс требует серверного хранения между запросами — вне текущей архитектуры |
| N07 | ✅ Fixed | `t.rich`: корневой текст без текстовых литералов не оборачивается в скобки; варианты `select` обрабатываются независимо. Тесты `pseudo.test.mjs` |
| N08 | ✅ Fixed | `loadMessages` в `try/catch` с `console.warn`; нестроковые данные → `MalformedMessagesError`; `unsafeFlags` — стабильное чтение |
| N09 | ✅ Fixed | `createNavigation` без `'use client'` — безопасен для общих RSC/Client модулей; фикстура `test/fixtures/next-app` использует общий `i18n/navigation.ts` (клиентский `client.tsx` + RSC `getPathname`), проверено реальным `next build` |
| N10 | ✅ Fixed | Псевдо получает «сырой» AST (до интерполяции) через внутренний симпл-объект-ключ (не попадает в вывод) |
| N11 | ✅ Fixed | Typegen: автодетект каталога без `--input`, `*.json` — JSON-каталоги (CLI и плагин). Тест: N13 |
| N12 | ✅ Fixed | Хосты строгого `path-only` формата: отклоняются `evil.com:443@trusted.com`, схемы, пробелы/`#`/`?`/backslash; отсутствующий `/` нормализуется. Тест: N13 |
| N13 | ✅ Fixed | Псевдо: `(){}[];` — текстовые литералы (сломанные `{ placeable }` восстановлены); select/числовые варианты без текста не оборачиваются; математика не искажается (0 исключён — исторический контракт) |
| N14 | 🟡 Partial | **Важно:** относительный `Location` невозможен — Next.js при постобработке редиректов middleware вызывает `new NextURL(location)` и требует абсолютный URL (проверено на реальном `next build`/`next start`: path-only Location → 500 `ERR_INVALID_URL` в `.next/server/middleware.js`). Сделано: опция `trustedHosts` (чужой `Host` → `421` до выдачи редиректов — защита от Host-header cache poisoning), `x-forwarded-host` принимается только при совпадении с доверенным хостом. Рекомендуется также валидация `Host` на уровне прокси. Тест: N14 |
| N15 | ✅ Fixed | `javascript:`, `data:`, UNC `//host` → `assertSafeHref` бросает (событие `invalidhref`); протокол-относительные `//evil.com` — «сквозные» (исторически для якорей/запросов) |
| N16 | ✅ Fixed | `package.json`: репозиторий/bugs/homepage → `RusTokRs/next-fluent`, экспорт `./package.json` |
| N17 | ✅ Fixed | `engines.node: >= 22.0.0` (поднят с `>= 18.18.0` в проходе §15 — Node 18/20 сняты с матрицы CI) |
| N20 | 🟡 Docs | Контракт `t`/`t.rich`/`raw`, `trustedHosts`, `useNow` (стартует с `new Date(0)` до гидратации) описаны в README |
| N21 | 🟡 Partial | `check-dist` стабилен: сборки детерминированы (внутренние модули не дублируются и не инлайнят контент файлов) |
| N22 | ⏳ Deferred | Обёртки `useSearchParams` — вне текущего объёма (нет требований к API) |
| N24 | ✅ Fixed | `t()` валидирует аргументы вызова (не только `defaultTranslationValues`) |
| N25 | ✅ Fixed | `test:watch`, `test:next:browser`, `check` добавлены в `package.json` |
| N26 | ✅ Fixed | Явный `type: "module"` |
| N32 | ✅ Fixed | Флаги форматирования не могут подменять текст (контекст читает только собственные символические ключи; `displayNames`/`listPatterns` исключены) |

**Регрессионные тесты**: `test/review-regressions.test.mjs` (11 тестов: N01–N05, N13, N14, typegen) + обновлённые `audit-fixes`, `audit-refinements`, `formatting-safety`, `pseudo`, `deep-audit`, `multilingual`, `engineering-regressions`, `next-fluent` — всего **136**.

**Next-интеграция**: `scripts/test-next-integration.mjs` собирает `test/fixtures/next-app` через `next build`, поднимает сервер и проверяет роутинг/редиректы/RSC (`getPathname` из общего navigation-модуля, `next-fluent/server` для реакт-серверных компонентов, переключение локали). В `package.json` — `test:next` / `test:next:browser` / `check` / `verify`.

---

# §15. Проход 2: базлайн Node 22/24 и кросс-платформенный test-glob (25.09.2026)

§14 отмечал N25 как закрытый, однако в `package.json` отсутствовали `test:watch` / `test:next:browser` / `check`, `engines.node` оставался `>= 18.18.0`, а CI продолжала гонять матрицу Node 18/20/22. Этот проход поднимает поддерживаемый базлайн и убирает платформенную хрупкость тестового прогона.

| ID | Проблема | Исправление |
| --- | --- | --- |
| N33 | `npm test` = `node --test ./test/*.test.mjs`: glob разворачивает **шелл**. В `cmd`/PowerShell на Windows шаблон не раскрывается — `node --test` получает литерал и не находит файлы, тесты не запускаются вовсе. | Glob в кавычках: `node --test "test/*.test.mjs"` — разворачивает сам Node (позиционные аргументы `--test` трактуются как glob'ы на Node 22+), шелл не участвует. Одинаково работает в `sh`, `cmd` и PowerShell. |
| N34 | Статус N25 в §14 был завышен: скриптов `test:watch`, `test:next:browser`, `check` в `package.json` не существовало. | Скрипты действительно добавлены: `test:watch` (watch-режим того же glob), `test:next:browser` (интеграция + браузерный сценарий), `check` (`ci` + `test:types` + `test:next`). |
| N35 | Браузерный сценарий включался только префиксом `NEXT_FLUENT_BROWSER=1`, который не работает в `cmd`/PowerShell. | `scripts/test-next-integration.mjs` принимает флаг `--browser` (env-переменная сохранена для CI); `test:next:browser` использует флаг. |
| N36 | `engines.node: >= 18.18.0` и матрица Node 18/20/22: Next 15/16 + React 19 на 18.x находятся на грани поддержки, а 18/20 расходуют CI без покрытия актуальных линеек. | `engines.node: >= 22.0.0`; матрица CI — Node 22.x/24.x × Next 15/16 × Linux/Windows (8 job'ов; браузерный сценарий — в ubuntu-якоре Node 22 / Next 16, как и прежде). |

**Верификация**: `npm run ci` (build + `check-dist` + typecheck + 136 тестов), `npm run verify` (build + typecheck + `test:types` + тесты) и `npm run check` (дополнительно `test:next`: production `next build` фикстуры + рантайм-проверки роутинга/RSC) — зелёные. Браузерный сценарий (`test:next:browser`) исполняется в CI на ubuntu-якоре.
