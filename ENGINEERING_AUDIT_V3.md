# Инженерный аудит next-fluent — проход 3 (V3)

Дата: 26 сентября 2026 года. Ветка `arena/01a0df06-next-fluent`, база — коммит `cb571b1` (`main`).
Это независимый аудит поверх двух предыдущих (`ENGINEERING_AUDIT.md` от 24.09 — F01–F20, `ENGINEERING_REVIEW.md` от 25.09 — N01–N36). Ниже — новые дефекты **V3-01…V3-18**, их исправления и план развития против `next-intl`.

## Резюме

Библиотека после двух прошлых проходов в рабочем состоянии: `npm run build`, `tsc --noEmit`, `test:types` и 136 unit-тестов были зелёными до правок. Полный проход по коду, сборке, middleware и реальному production-приложению Next.js 15.5.26 нашёл:

* **2 дефекта уровня P1** (неверный результат в заявленном сценарии; один из них эксплуатируется заголовком запроса и приводит к кешируемому 404);
* **7 дефектов уровня P2** (архитектура, производительность, семантика API);
* **9 пробелов паритета с next-intl** — из них 7 закрыты в этом проходе.

После исправлений: **157 unit-тестов**, ESLint (раньше отсутствовал) — 0 замечаний, `tsc` чистый, production-сборка фикстуры проходит, **локализованные маршруты реально пререндерятся** (раньше это никем не проверялось, а документированная настройка не позволяла этого достичь).

## Методика

Выполнено и зафиксировано:

| Шаг | Команда | Результат до правок |
| --- | --- | --- |
| Установка | `npm ci` | ok, TypeScript 6.0.3, Next 15.5.26, React 19.3.0, esbuild 0.28.2, `@fluent/bundle` 0.19.1 |
| Сборка | `npm run build` | ok, `git diff dist/` пустой |
| Типы | `npm run typecheck` | ok |
| Тесты | `npm test` | 136/136 |
| Типогенерация | `npm run test:types` | ok |
| Интеграция | `node scripts/test-next-integration.mjs` | ok (production `next build` + рантайм-проверки) |

Дополнительно, вне стандартного набора:

1. Репро-скрипты на `dist/*`: аргументы `t()`, `t.raw()`, middleware с mock-запросами (заголовки `Host`, `x-forwarded-host`, `x-next-fluent-rewrite`, `sec-fetch-dest`, cookie), `createI18n`, `defineRouting`, `createFormatter`.
2. Измерение клиентского бандла через esbuild (`metafile`): корневой и клиентский entry дают **идентичные 27 345 B min / 9 633 B gzip**, `@fluent/bundle` = 11 174 B min, **`@fluent/syntax` в клиентский бандл не попадает** (проверено, а не предполагается).
3. Реальное production-приложение: подсчёт вызовов middleware на запрос, анализ `prerender-manifest.json`, заголовки `Cache-Control`, `Set-Cookie`, `Link`.
4. Сравнение с конкурентом по установленному пакету **`next-intl@4.14.7`** (чтение `dist/esm/production/middleware/*.js`, `dist/types/routing/config.d.ts`, `navigation/react-client/createNavigation.d.ts`), а не по памяти.

Не покрыто этим аудитом: Edge runtime, нагрузочный бенчмарк, Next 16/Turbopack e2e локально (это делает матрица CI), внешний security pentest, браузерный сценарий (требует Playwright, выполняется в CI).

---

## P1 — дефекты с неверным результатом

### V3-01. Булевы аргументы молча выбрасывались → вместо текста ключ

**Место:** `src/bundle.ts` (`buildFluentArgs`).

`buildFluentArgs` пропускал только `string | number | Date | {'type' in v}`. `boolean` не входил в список, переменная не попадала в `FluentArgs`, `@fluent/bundle` фиксировал `ReferenceError: Unknown variable`, а `formatCandidate` трактовал это как `FORMAT_ERROR` и возвращал ключ.

Воспроизведение (до правки):

```
ftl: bool-msg = Admin: { $isAdmin }
t('bool-msg', { isAdmin: true }) → "bool-msg"          // вместо "Admin: true"
t.raw('bool-msg', { isAdmin: false }) → "Admin: {$isAdmin}"
console: ReferenceError: Unknown variable: $isAdmin
```

`@fluent/bundle` 0.19 действительно не поддерживает `boolean` (`resolver.js`: `switch (typeof arg)` → `string | number | object` → иначе `TypeError`), поэтому «пропуск» выглядел защитой, но цена — потеря целого сообщения.

**Исправление.** `boolean` → `String(v)`, `bigint` → `Number(v)`; `null`/`undefined` и не-Fluent объекты собираются в список `rejected` и сообщаются как `INVALID_ARGUMENT` **только если сообщение реально не отформатировалось** (иначе лишний шум на неиспользуемых аргументах).

После: `t('bool-msg', { isAdmin: true })` → `Admin: true`; `t('big', { total: 10n })` → `Total: 10`.
Тесты: `test/audit-v3.test.mjs` («V3-01»).

### V3-02. Заголовок `x-next-fluent-rewrite` подделывался клиентом → 404 на валидном URL

**Место:** `src/middleware.ts` (ранний выход по сигнальному заголовку).

Middleware проверял `request.headers.get('x-next-fluent-rewrite') === rawPathname` и в этом случае **полностью пропускал** канонизацию и внутренний rewrite. Заголовок приходит из запроса, то есть управляется клиентом.

Воспроизведение (до правки), `as-needed`, `pathnames: { '/about': { en: '/about-us', ru: '/o-nas' } }`:

```
GET /ru/o-nas                                   → 200, x-middleware-rewrite: /ru/about   (ок)
GET /ru/o-nas + x-next-fluent-rewrite: /ru/o-nas → 200, x-middleware-next: 1, БЕЗ rewrite
   ⇒ приложение получает /ru/o-nas, маршрута app/[locale]/o-nas нет ⇒ 404
GET /ru/o-nas (localePrefix: 'always') + тот же заголовок → тоже без rewrite ⇒ 404
```

Это не только «сам себе 404»: ответ 404 на валидном локализованном URL может быть закеширован общим кешем/CDN и отдан всем пользователям.

**Почему заголовок вообще существует (проверено, а не по документации).** В Next.js 15.5.26 middleware вызывается **дважды** на запрос: после `NextResponse.rewrite()` он повторно отрабатывает по внутреннему пути. Счётчик в фикстуре: `x-mw-calls: 2` для `GET /`, `x-mw-path: /en`; 5 → `/ru/about`. Без сигнала второй проход канонизирует собственный rewrite-таргет обратно (в `as-needed` для дефолтной локали и в `never` — бесконечный редирект).

**Исправление.** Сигнал учитывается **только в тех двух ветках, где возможен цикл** (`localePrefix: 'never'` и `as-needed` + префикс дефолтной локали). В `always` и в `as-needed` для недефолтной локали второй проход идемпотентен, поэтому заголовок там игнорируется полностью. Дополнительно клиентский заголовок вычищается из проксируемых заголовков (`requestHeaders.delete(...)`), а при rewrite заменяется нашим значением.

После: оба кейса выше дают `x-middleware-rewrite: /ru/about`; защита от цикла сохранена (тест «V3-02: the signal still prevents the as-needed default-locale redirect loop»).
Тесты: `test/audit-v3.test.mjs` (3 теста «V3-02»).

---

## P2 — архитектура, производительность, семантика

### V3-03. `localePrefix` / `cookieName` / `headerName` не валидировались

`validateI18nConfig` принимал любые значения. Опечатка `localePrefix: 'as-neede'` (или `'AS-NEEDED'`) молча давала поведение `'always'` — и в middleware, и в генерации href; `cookieName` с CRLF принимался и падал позже на `Headers.set`.

```
defineRouting({ locales:['en','ru'], defaultLocale:'en', localePrefix:'as-neede' }) → принято
defineRouting({ ..., cookieName: 'bad\r\nname' })                                   → принято
```

**Исправление:** whitelist режимов и проверка имён cookie/заголовка по RFC 6265/9110 token-грамматике; ошибка на этапе конфигурации. Тест «V3-03».

### V3-04. `Set-Cookie` на каждый ответ middleware → статические страницы нельзя кешировать

До правки `createSuccessResponse` и `createRedirect` **безусловно** ставили `NEXT_LOCALE` (`git show HEAD:src/middleware.ts`, строки 148–154 и 167–173). Следствия: перезапись выбора пользователя на каждом запросе, включая подгрузки RSC/изображения, и `Set-Cookie` в ответе на пререндеренную страницу (общий кеш такой ответ не переиспользует).

Для сравнения прочитан `next-intl@4.14.7` (`middleware/syncCookie.js`): cookie пишется только для `sec-fetch-dest === 'document'`, только если значение отличается, и не пишется, если cookie нет, а `Accept-Language` и так даёт эту локаль.

**Исправление:** та же логика + опция `localeCookie`. Измерено на production-приложении после правки:

```
GET /ru/o-nas (cookie NEXT_LOCALE=ru, document) → 200, Set-Cookie: <нет>, cache-control: s-maxage=31536000
GET /ru/o-nas (без cookie)                      → 200, Set-Cookie: NEXT_LOCALE=ru
GET /ru/o-nas (sec-fetch-dest: image)           → 200, Set-Cookie: <нет>
```

Тесты «V3-04» + проверка в `scripts/test-next-integration.mjs`.

### V3-05. Cookie не настраивалась и не имела `Secure`

Не было ни имени, ни атрибутов. **Исправление:** `localeCookie: false | { name, maxAge, sameSite, secure, domain, path, httpOnly, partitioned, priority }`, дефолт совместим с предыдущим поведением (`NEXT_LOCALE`, `maxAge=31536000`, `sameSite=lax`, `path=/`). `Secure` намеренно **не** включается автоматически (как в next-intl): молча потерянная cookie на HTTP-деплое хуже явной опции — она документирована в README. Тест «V3-05».

### V3-06. Слаг другой локали давал 404 вместо внутреннего маршрута

`internalPath()` в middleware сопоставлял только шаблоны текущей локали, тогда как навигация (`localizePath`) перебирает все. Асимметрия:

```
GET /ru/about-us → 200 без rewrite ⇒ 404 (app/[locale]/about ожидает /ru/about)
```

**Исправление:** middleware резолвит внешний слаг по всем локалям (как `usePathname`). После: `GET /ru/about-us` → `x-middleware-rewrite: /ru/about`. Тест «V3-06».

### V3-07. `createI18n().getFormatter()` игнорировал `timeZone` из request config

`factory.getFormatter` создавал форматтер напрямую, минуя снапшот запроса, — даты рендерились в часовой зоне сервера, тогда как `next-fluent/server.getFormatter` её учитывал.

```
requestConfig: { timeZone: 'UTC' } → runtime.getFormatter({locale:'en'}).timeZone === undefined
```

**Исправление:** фабрика делегирует в серверный `getFormatter` (и в `getMessages` — раньше при отсутствии `loadMessages` возвращался `''`, игнорируя `setRequestConfig`). Тест «V3-07» (`Asia/Tokyo` → `'09'` для полуночи UTC).

### V3-08. `t.raw()` сортировал атрибуты по алфавиту

Для сообщения только с атрибутами значения возвращались отсортированными, то есть отвязанными от имён атрибутов:

```
login-button =
    .label = Sign in { $name }
    .aria  = Sign in as { $name }
t.raw('login-button') → ["Sign in as {$name}", "Sign in {$name}"]   // aria раньше label
```

**Исправление:** порядок объявления из каталога. Существующий тест, закреплявший алфавитный порядок, обновлён с комментарием (N03 в `review-regressions.test.mjs`).

### V3-09. Биди-изоляторы протекали в `<title>`, meta и JSON; `useIsolating` был недоступен

Fluent по умолчанию вставляет U+2068/U+2069 вокруг плейсхолдеров. `t()` их сохранял, `t.raw()` — вырезал (несогласованно), а отключить через публичный API было нельзя: `createFluentBundle` опцию принимал, но `getTranslations`/request config/`FluentProvider` её не прокидывали.

```
t('title', { count: 3 }) → "Dashboard ⁨3⁩"   // невидимые символы в <title>/JSON
t.raw('title', { count: 3 }) → "Dashboard 3"
```

**Исправление:** `useIsolating` в `RequestConfigResult`, `GetTranslationsOptions`/`ForLocaleOptions` и `FluentProviderProps`; режим входит в ключ кеша бандлов (и глобального, и request-scoped), иначе один кеш отдавал бы бандлы с разным форматом. Тест «V3-09».

### V3-12. `setRequestLocale` тихо не работал вне request scope, а документированная настройка не давала статического рендеринга

`getRequestStore` — это `React.cache()`. Без активного async-диспетчера React не кеширует ничего, поэтому вне рендера каждый вызов создаёт новый store:

```
setRequestLocale('ru', ['en','ru']); await getLocale() → 'en'
getNow() === getNow()                                  → false
```

Хуже другое. В production-сборке фикстуры все локализованные маршруты были `ƒ (Dynamic)`, а `prerender-manifest.json` содержал только `/_not-found`. Причина (измерено пробной страницей):

```
[probe] store stable: true  store.locale: undefined   // setRequestLocale из layout не дошёл до page
[probe] getLocale(): en                               // обе локали пререндерились бы как en
```

Next.js рендерит layout и page независимо, поэтому `setRequestLocale` обязателен **в каждой странице и каждом layout** — то же требование documented у next-intl, но в README next-fluent был показан только layout.

**Исправление.** Фикстура переведена на корректную схему (`generateStaticParams` + `setRequestLocale` в layout и в обеих страницах), а `scripts/test-next-integration.mjs` теперь читает `prerender-manifest.json` и падает, если `/en`, `/ru`, `/en/about`, `/ru/about` не пререндерены (таблица маршрутов в выводе `next build` при этом врёт: `/[locale]/live` с `headers()` показан как `●`, но в манифесте отсутствует — поэтому проверяется именно манифест). README дополнен разделом «Static rendering».

```
[next-fluent] Static rendering verified for: /en, /ru, /en/about, /ru/about
```

---

## Закрытые пробелы паритета с next-intl

| ID | Что добавлено | Зачем |
| --- | --- | --- |
| V3-10 | `onError` / `getMessageFallback` / `FluentErrorCode` (`MISSING_MESSAGE`, `FORMATTING_ERROR`, `INVALID_ARGUMENT`, `UNSUPPORTED_VALUE`, `ENVIRONMENT_FALLBACK`) в request config, `getTranslations`/`forLocale`, `FluentProvider`; класс `FluentError` с `code/key/namespace/locale/path/cause` | Раньше был зашитый `console.warn` и неизменяемый фолбэк `namespace.key`. Падающий обработчик не ломает рендер. `debug: true` сохраняет `[MISSING: key]` |
| V3-11 | `strictNamespace` в `FluentProvider`/`useTranslations` | Серверная опция существовала, клиентская — нет (расхождение server/client) |
| V3-13 | `hasLocale(locales, locale)` | Используется в каждом приложении на next-intl в корневом layout; каноническое, регистронезависимое сравнение |
| V3-14 | `useMessages()` | Паритет с `next-intl`: доступ к каталогу из контекста провайдера |
| V3-16 | ESLint 9 + `typescript-eslint` + `eslint-plugin-react-hooks`, `npm run lint` в `ci`/`verify` и шаг в CI | Линта не было вовсе. Первый же прогон дал `react-hooks/rules-of-hooks` **error** в `navigation.ts:107` (N08 из прошлого ревью так и не был закрыт) |
| V3-17 | `formats` (именованные пресеты `Intl`) в request config/провайдере и во всех методах форматтера | Паритет с `formats` у next-intl |
| V3-18 | `alternateLinks` — заголовок `Link: <url>; rel="alternate"; hreflang="…"` + `x-default`, с поддержкой доменов, динамических параметров и `basePath` | SEO без ручной разметки; у next-intl включено по умолчанию, у next-fluent не было вовсе |

Отдельно по V3-16: хук `useNextRouter()` вызывался внутри `try/catch` с заглушкой-роутером. Теперь вызов безусловный (порядок хуков не зависит от потока управления), а вне App Router ошибка пробрасывается — молчаливый no-op `push()` маскировал реальные ошибки подключения.

Проверено, что корневой entry не утяжеляет клиент: `import { useTranslations } from 'next-fluent'` и `from 'next-fluent/client'` собираются в **байт-в-байт одинаковый** бандл, `@fluent/syntax` остаётся в typegen/pseudo.

---

## Дорожная карта: реализовано после аудита

Пункты ниже были рекомендациями в первой версии отчёта. Сейчас это код с тестами.

| # | Пункт | Статус | Где смотреть |
| --- | --- | --- | --- |
| 1 | `localePrefix: { mode, prefixes }` — карта префиксов по локалям | ✅ реализовано | `src/locale-prefix.ts`, `src/utils.ts` (валидация), `src/middleware.ts`, `src/nav-url.ts`, `src/navigation.ts`, `src/alternate-links.ts`; тесты `test/locale-prefixes.test.mjs` (5) |
| 2 | Явный контракт для атрибутов вместо массивной формы `raw()` | ✅ реализовано | `t.attrs(key) → Record<string,string>` в порядке объявления (`src/bundle.ts`), `test/translator-extras.test.mjs` |
| 3 | JSON-каталоги в рантайме | ✅ реализовано | `src/catalog.ts` (`jsonToFluent`, `toFluentSource`), подключено в `createFluentBundle`, `FluentProvider`, `loadConfig`, `getTranslations`, `forLocale`; CLI читает `.json` рядом с `.ftl` |
| 4 | `pickMessages(catalog, namespace)` | ✅ реализовано | `src/pick-messages.ts` (`next-fluent/messages`), сохраняет используемые термы (`-brand`) |
| 5 | Edge runtime | ✅ реализовано | `npm run test:edge` → `scripts/check-edge-runtime.mjs`: бандл middleware под нейтральную платформу, запрет `node:*`/`require`/`next/headers`/`react`, выполнение на реальном `Request` |
| 6 | `typegen --watch` + хук в плагине | ✅ реализовано | `next-fluent typegen --watch`, `createNextFluentPlugin(path, { typegen })`, автодетект `--input` |
| 7 | Бюджет бандла | ✅ реализовано | `npm run size` → `scripts/size-budget.mjs` (min + gzip, шаг в CI) |
| 8 | `t.plain()` для не-HTML sink'ов | ✅ реализовано | `src/bundle.ts` + `stripRichText` в `src/rich.ts` |
| 9 | `next-fluent check` | ✅ реализовано | `src/check.ts` (`checkCatalogs`, `formatCheckReport`) + команда `check` в CLI, ненулевой код возврата |
| 10 | Документация | ✅ реализовано | `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/MIGRATING_FROM_NEXT_INTL.md`, обновлённый README |
| — | `setRequestLocale` вне request scope | ✅ исправлено | Явная ошибка в dev (`src/server.ts`), вместо тихой потери локали |
| — | `pseudoLocalizeText` на вложенных `{}` | ✅ исправлено | Токенайзер с учётом глубины скобок и строковых литералов (`splitPreservedTokens`) |
| — | `LRUCache` при `maxSize <= 0` | ✅ исправлено | Конструктор отклоняет неположительные и нецелые значения |
| — | `@fluent/syntax` в клиентском entry | ✅ исправлено | `pseudo`/`typegen`/`pick-messages`/`check` вынесены из `index-browser`: клиентский entry 68.2 kB → **44.2 kB** min |

Открытым остаётся только извлечение сообщений из исходников (аналог
`next-intl extract`): у next-fluent источник истины — каталог, из которого типы
генерируются, а не наоборот.

### Изменение публичного API

Инструменты сборки убраны из точек входа приложения и доступны по отдельным
путям: `next-fluent/pseudo`, `next-fluent/typegen`, `next-fluent/catalog-io`,
`next-fluent/messages`, `next-fluent/check`. `pseudoLocalizeFtl` и
`generateTypeDeclarations` больше не экспортируются из корневого entry — они
тянут за собой полный FTL-парсер, который браузеру не нужен.

---

## Второй проход: adversarial-проверка

Повторная проверка «не доверяй своему же отчёту»: каждый публичный вход
(middleware, JSON-каталоги, CLI, конфигурация роутинга) прогнан через набор
враждебных входов — протокол-относительные пути, инъекция `Host`/cookie,
`__proto__`, управляющие символы, мусорный `Accept-Language`. Найдено и закрыто
пять дефектов, каждый закреплён тестом в `test/hardening.test.mjs`.

| # | Дефект | Воспроизведение | Исправление |
| --- | --- | --- | --- |
| 1 | **Открытый редирект** | `localePrefix: 'never'` + `GET /ru//evil.example/x` → `307 Location: http://evil.example/x`. То же для `\` вместо `/` и для `as-needed` с префиксом дефолтной локали | `normalizeLeadingSlashes()` схлопывает ведущий набор `/` и `\` в каждом пути, производном от запроса; `requestUrl()` дополнительно сверяет `origin` цели и отказывается уходить на чужой |
| 2 | **Traversal в префиксах** | `localePrefix: { prefixes: { ru: '/../evil' } }` принимался конфигурацией | `validateLocalePrefix` отклоняет сегменты `.` и `..` |
| 3 | **Падение CLI** | файл `__proto__.ftl` → `TypeError: catalogs[locale].push is not a function` | карты локалей создаются с `Object.create(null)` |
| 4 | **Потеря сообщения из JSON-каталога** | `{"e": "value\r\nmore"}` → у `e` внутри литерала оставался «сырой» CR, рантайм-парсер отбрасывал запись целиком (Fluent не поддерживает `\u{…}`) | `renderFluentPattern` нормализует CRLF/CR в LF — значение становится валидным многострочным паттерном |
| 5 | **`next build` зависал** | плагин с `typegen` открывал рекурсивный `fs.watch`, который держит event loop даже после `unref()` (Linux, Node 22) | в production watcher не стартует, в dev — поллинг по unref-таймеру |

Проверено и признано безопасным (тесты добавлены как постоянная защита):
инъекция сообщений через значения JSON-каталога (`\n`, `    .attr =`, `#`,
`-term` остаются текстом), `__proto__` в JSON/`checkCatalogs`/`pickMessages`
(`Object.prototype` не трогается), недоверенный `x-forwarded-host` игнорируется,
чужой `Host` при `trustedHosts` даёт 421, CRLF в значении cookie не приводит к
инъекции заголовка, враждебный `setRequestLocale` отклоняется, `Accept-Language`
из 20 000 записей разбирается без деградации.

---

## Верификация

| Проверка | Команда | Результат |
| --- | --- | --- |
| Сборка | `npm run build` | ok |
| Детерминизм dist | `npm run check-dist` | ok после коммита пересобранного `dist/` |
| Линт | `npm run lint` (ESLint 9 + react-hooks) | 0 ошибок, 0 предупреждений |
| Типы | `npm run typecheck` (TS 6.0.3) | ok |
| Типы потребителя | `npm run test:types` (позитивные + `@ts-expect-error` негативы, включая новые API) | ok |
| Unit-тесты | `npm test` | **191/191** (157 после аудита → 178 после дорожной карты → +13 hardening) |
| Edge-совместимость | `npm run test:edge` | ok |
| Бюджет размера | `npm run size` | ok (middleware 28.3 kB, edge-таргет) |
| Полный прогон | `npm run check` | ok (ci + типы потребителя + production Next) |
| Production Next | `node scripts/test-next-integration.mjs` | сборка, пререндер 9 страниц, роутинг, RSC/client-паритет, hreflang, cookie, смена локали — ok |

Новые регрессионные тесты: `test/audit-v3.test.mjs` (21 тест: V3-01…V3-18), обновлены `review-regressions` (порядок атрибутов), `test/types/consumer.ts` (новые API), фикстура `test/fixtures/next-app` и `scripts/test-next-integration.mjs` (статический рендеринг, hreflang, cookie).

Каждое исправление привязано к тесту, который падает без него: булевы аргументы, подделка `x-next-fluent-rewrite`, кросс-локальный слаг, валидация конфигурации, условия записи cookie, `localeDetection`, `alternateLinks`, `useIsolating`, `onError`/`getMessageFallback`, `hasLocale`, `useMessages`, `formats`, `timeZone` фабрики.
