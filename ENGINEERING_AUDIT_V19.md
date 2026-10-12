# Инженерный аудит next-fluent — проход 19 (V19)

**Дата:** 12.10.2026
**Базовый коммит:** `ba8b788` (проход V18, ветка `arena/a72dce15-next-fluent`)
**Задача прохода:** §7 отчёта V18 — `server.js` как самый непокрытый модуль
`src/`, `navigation.js`, хвосты `usage.js`. Плюс поиск пробелов в функционале.

---

## Резюме

| | |
| --- | --- |
| Находок | **3**: `V19-01` — **P1**, `V19-02` — не дефект (ошибочная находка прохода, закрыта тестом), `V19-03` — пробел в функционале |
| Правок в `src/` | **2** поведенческие (`server.ts`, `utils.ts`) + 1 комментарий-предохранитель (`navigation.ts`) + экспорт |
| Новых тестов | **+12** в `test/audit-v19.test.mjs`, гейт `dir` в интеграционном скрипте |
| Тесты | 626 → **638**, все зелёные |
| Покрытие | 96.73 / 93.73 → **96.74 / 93.81**; `server.js` 84.04 → **84.73** строк, 84.55 → **85.27** ветвей |
| Цена в клиентском бандле | потолок «всех экспортов» **+135 B** minified (40894 → 41029); бюджет поднят по замеру 40.0 → 40.25 kB. Фикстура приложения не изменилась вовсе |
| Открытых дефектов | **0** |

---

## 1. V19-01 (P1). Единственная точка конфигурации без валидации решала, на каком языке рендерится сервер

V18 §7 отправил проход в `server.js` — самый непокрытый модуль. Чтение дало не
покрытие, а дефект: `configureServerI18n` принимала что угодно.

```ts
export function configureServerI18n(config) {
  if (config.locales && config.locales.length > 0) { globalLocales = config.locales; ... }
  if (config.defaultLocale) { globalDefaultLocale = config.defaultLocale; }
}
```

Ни одной проверки — тогда как **все** остальные точки конфигурации пакета
прогоняют `validateI18nConfig`: `defineRouting`, `createNavigation`,
`createI18nMiddleware`. И это та точка, которая решает, какую локаль сервер
согласует для запроса.

Замер до правки:

```
validateI18nConfig({locales:['ru','de'], defaultLocale:'en'})
  THROWS: [next-fluent] "defaultLocale" ("en") must be included in "locales" [ru, de].

configureServerI18n({ locales: ['ru', 'de'] })   → принято молча
getLocale()                                      → "en"
'['ru','de'].includes("en")'                     → false
```

`configureServerI18n({ locales: ['ru', 'de'] })` — естественный вызов:
`defaultLocale` в типе необязательный. Он оставлял дефолт равным `'en'`, и каждый
запрос, чья локаль не зафиксирована `setRequestLocale`, заголовком или cookie,
разрешался в локаль, **которой приложение не везёт**. `loadMessages('en')` не
находил ничего, и страница рендерила собственные ключи вместо текста. Без
предупреждения где бы то ни было.

Второй замер — неверный тег:

```
configureServerI18n({ locales: ['ru'], defaultLocale: 'not a tag!' })  → принято
getTranslations()  →  Error: [next-fluent] Request config returned an invalid locale.
```

Ошибка обвиняла **request config** — то есть функцию пользователя, — хотя
значение пришло из `configureServerI18n`. Диагностика указывала не туда: ровно
тот класс, который эта серия аудитов ловит регулярно.

Проверены и остальные формы мусора — все принимались молча:

| вызов | до | после |
| --- | --- | --- |
| `{ locales: ['ru','de'] }` | принято, дефолт `en` | `"defaultLocale" ("en") must be included in "locales" [ru, de].` |
| `{ locales: ['ru'], defaultLocale: 'not a tag!' }` | принято | `Invalid "defaultLocale": "not a tag!"` |
| `{ locales: ['!!!'], defaultLocale: 'ru' }` | принято | `Invalid locale tag in "locales": "!!!"` |
| `{ locales: ['en','EN'], defaultLocale: 'en' }` | принято | `Duplicate locale identity in "locales": "en"` |
| `{ locales: ['ru','de'], defaultLocale: 'de' }` | принято | принято |
| `{ locales: ['en-US','ru'], defaultLocale: 'en-us' }` | принято | принято |

**Правка.** Та же `validateI18nConfig`, что и у остальных, — одна реализация
правила, а не вторая копия. Проверяется та пара, которая будет действовать
**после** вызова, поэтому случай «список без дефолта» ловится именно им. Обе
ошибки — ошибки конфигурации, поэтому обе падают на месте вызова, то есть в
областях module scope и на первом же запуске, а не в продакшене.

Отдельный гейт сверяет не сообщения, а **симметрию**: одна и та же пара локалей
должна получать один вердикт от `configureServerI18n` и от `defineRouting`.
Дефект был в асимметрии, поэтому и гейт — про асимметрию.

---

## 2. V19-02. Находка, которая оказалась неверной, — и зачем она теперь закреплена

Проход решил, что нашёл дефект: `push`, `replace` и `LocalizedLink` строят цель
через `switchLocaleHref`, а `prefetch` — нет. Замер подтверждал расхождение:

```
locale=en (as-needed, default locale)
  prefetch() просит у роутера : /about-us
  push()     уходит на        : /en/about-us
```

Правка была написана и собрана. Её остановил существующий тест
`V16-03: a locale switch prefetches its own URL on a single-domain site`.

Тест прав, правка — нет. `switchLocaleHref` возвращает **сигнальный** URL: он
существует только затем, чтобы middleware отличил явное переключение от обычного
визита, и канонизируется он, по собственной документации функции, **редиректом**.
Значит URL, который действительно несёт payload страницы, — канонический, и
именно его `prefetch` и грел. Греть сигнальный значило бы прогреть 307 и
оставить настоящий адрес холодным.

```
signal  = /en/about-us          ← push
warmed  = /about-us             ← prefetch
signal.slice('/en'.length) === warmed            ✓
switchLocaleHref(warmed, 'en', config) === signal ✓
```

Расхождение намеренное, но выглядит как пропущенный вызов — оно обмануло этот
проход и обманет следующий. Поэтому оно (а) объяснено комментарием в
`prefetch`, и (б) закреплено двумя тестами, которые сверяют пару URL и то, что
сигнал редиректит ровно на прогретый адрес. Код не изменён.

Это единственный пункт прохода, где результатом стала не правка, а запрет
повторять ошибку.

---

## 3. V19-03. Пробел в функционале: направление письма

В библиотеке не было ничего про направление письма: ни `dir`, ни списка RTL-локалей
(проверено поиском по `src/` и README). Для i18n-библиотеки, которая позиционирует
себя как замена `next-intl`, это означало, что каждый потребитель ведет свой
список — и список ломается молча в тот день, когда кто-то добавляет `fa`.

**Добавлено.** `getLocaleDirection(locale): 'ltr' | 'rtl'` в `next-fluent/utils`,
реэкспорт из корня пакета:

```tsx
const locale = await getLocale();
<html lang={locale} dir={getLocaleDirection(locale)}>
```

Ответ берётся из `Intl.Locale(...).textInfo.direction`, то есть из тех же данных
CLDR, которые уже используют форматтеры пакета, — поэтому он не может с ними
разъехаться. Замер:

| локаль | направление |
| --- | --- |
| `ar`, `he`, `fa`, `ur`, `ps`, `yi`, `dv`, `ar-EG`, `he-IL` | `rtl` |
| `en`, `ru`, `de`, `pt-BR`, `zh-Hans`, `ja`, `th` | `ltr` |
| `zz`, `''`, `not a tag!` | `ltr` |

Неизвестный тег даёт `ltr` — это и есть ответ CLDR про неопределённый язык, и
это та сторона ошибки, которая деградирует читаемо, а не зеркалит вёрстку
случайно. Тег, который `Intl` вовсе отвергает, тоже даёт `ltr`, а не исключение:
рендер layout — не то место, где стоит падать из-за плохого тега, а каждая точка
конфигурации уже про него сообщает.

**Две технические оговорки, обе замерены.**

* TypeScript 6.0.3 не объявляет `textInfo` ни в одном `lib`
  (`grep -rl textInfo node_modules/typescript/lib/*.d.ts` не находит ничего),
  поэтому свойство читается через узкий каст, а не расширением `lib` на весь
  пакет. Опциональная цепочка заодно означает, что рантайм без `textInfo`
  деградирует в `ltr`, а не бросает во время рендера.
* Функция живёт в `utils.ts`, из которого `index-browser.ts` реэкспортирует всё,
  — поэтому она доступна и в серверной, и в клиентской точках входа без
  отдельной правки фасадов.

**Проверка на живом запросе.** Фикстура Next теперь рендерит
`dir={getLocaleDirection(locale)}`, и `scripts/test-next-integration.mjs` требует
`dir="ltr"` в HTML. Обе локали фикстуры — LTR, так что RTL-сторона покрыта
юнит-тестами; связка «хелпер достижим из серверного компонента и доезжает до
HTML» покрыта фикстурой на Next 15 и Next 16.

---

## 4. Изменения прохода

| Файл | Изменение |
| --- | --- |
| `src/server.ts` | `configureServerI18n` прогоняет ту же `validateI18nConfig`, что и остальные точки конфигурации |
| `src/utils.ts` | `getLocaleDirection` + тип `LocaleDirection` |
| `src/index.ts` | реэкспорт из корня пакета |
| `src/navigation.ts` | **только комментарий**: почему `prefetch` намеренно не зовёт `switchLocaleHref` |
| `test/audit-v19.test.mjs` | **новый**, 12 тестов |
| `test/fixtures/next-app/app/[locale]/layout.tsx` | рендерит `dir` |
| `scripts/test-next-integration.mjs` | гейт направления письма |
| `scripts/size-budget.mjs` | потолок «всех экспортов» поднят по замеру, 40.0 → 40.25 kB |
| `README.md`, `CHANGELOG.md`, `docs/AUDITS.md` | записи прохода |

### Отрицательный контроль

`dist/` пересобран с откаченным `src/server.ts` (`utils.ts` оставлен, чтобы файл
тестов загружался):

```
not ok 1 - V19-01: locales without a usable default are rejected, not silently defaulted to "en"
not ok 2 - V19-01: an unusable locale list or default is rejected at the call site
not ok 3 - V19-01: a valid configuration is still accepted, canonical spellings included
not ok 4 - V19-01: a default set before any locale list is checked as a tag
not ok 5 - V19-01: the server entry point validates the way every other entry point does
ok    6 - V19-01: getLocale() can no longer resolve to a locale the app does not ship
ok    7–8 - V19-02 (характеризация намеренной асимметрии)
ok    9–12 - V19-03
```

Тест 6 зелёный в обоих состояниях сознательно: он настраивает **корректную**
пару и проверяет симптом, а не дефект, — это страховка от регрессии.

Отдельно — мутационный контроль для V19-03: тело `getLocaleDirection` заменено на
`return 'ltr'`, и тесты это ловят:

```
not ok 9  - V19-03: right-to-left locales are reported as rtl
not ok 11 - V19-03: direction is spelled the same way as the tag is matched elsewhere
not ok 12 - V19-03: direction is reachable from the package root
```

После восстановления — 12/12.

### Проверки

`npm test` (638/638) · `npm run lint` · `npm run typecheck` · `npm run size` ·
`npm run test:next` (Next 15) · `npm run test:next:16` (Next 16) — в обоих
`Document direction rendered from the locale` и `redirect() follows the request
locale` · покрытие.

Одна оговорка: во время прохода `npm run lint` показал 19 ошибок
`'console' is not defined` — все из временных каталогов `.probe*`, которыми
проход зондировал поведение. Они в `.gitignore` и удалены; к коду библиотеки
претензий нет.

---

## 5. Приоритеты следующего прохода

1. **`server.js` — 84.73 % строк, по-прежнему самый непокрытый модуль `src/`.**
   Проход поднял его с 84.04, но остаток — строки 84–122 (`getLocale`: заголовок,
   cookie, `Accept-Language`) и 134–142 (`resolveConfigFn`). Первые достижимы
   только внутри request scope, то есть только в Next-фикстуре; вторые — только
   когда виртуальный алиас `next-fluent/config` отсутствует или падает, и их
   можно покрыть обычным Node-тестом через `setRequestConfig(null)`-подобный
   путь. Стоит разделить эти два хвоста явно, а не считать их одним.
2. **`navigation.js` — 71.11 % ветвей, не изменилось.** Хвост —
   `back`/`forward`/`refresh` и ветви доменного `prefetch`. Проход подтвердил,
   что часть из них достижима только в App Router, но **не назвал какие** —
   это и стоит сделать следующим шагом, прежде чем писать тесты.
3. **`usage.js` — 93.25 % ветвей.** Проход до него не дошёл. Идея V18 остаётся
   в силе: дифференциальный фаззинг «маскер сохраняет длину и номера строк»
   вместо чтения по ветвям.
4. **Псевдолокали из имён каталогов** (`messages/shared/en.ftl` → локаль
   `shared` в `check`). Второй проход подряд откладывается как вопрос к
   владельцу; он дешевле, чем выглядит: достаточно предупреждения, когда имя
   каталога-директории не канонический тег.
5. **`client.js` — строки 27–28, 155–159, 181–190.** Решение V15 §4 в силе.
