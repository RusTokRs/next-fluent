# Инженерный аудит next-fluent — проход 18 (V18)

**Дата:** 12.10.2026
**Базовый коммит:** `485d95f` (ветка `arena/a72dce15-next-fluent`)
**Задача прохода:** §7 отчёта V17 — `catalog-io`/`collectSourceFiles`, `jsonToFluent`,
хвосты `usage.ts` и `errors.ts`. Отдельно — поиск пробелов в функционале, а не
только дефектов.

---

## Резюме

| | |
| --- | --- |
| Находок | **4**: `V18-01` — P2, `V18-02` — **P1**, `V18-03` — P2, `V18-04` — P2 (пробел в функционале) |
| Правок в `src/` | **4** (`catalog-io.ts`, `catalog.ts`, `navigation.ts`, `server.ts`) + новый модуль `request-store.ts` |
| Новых тестов | **+12** в `test/audit-v18.test.mjs` + маршрут в Next-фикстуре и гейт в интеграционном скрипте |
| Тесты | 614 → **626**, все зелёные |
| Покрытие | 96.90 / 93.89 → **96.73 / 93.73**; `catalog.js` 96.7 → **97.92** ветвей, `navigation.js` 65.9 → **71.11**, `catalog-io.js` 86.4 → **86.21** |
| Цена в клиентском бандле | **+365 B** minified / **+113 B** gzip; бюджет поднят по замеру 49.0 → 49.5 kB |
| Открытых дефектов | **0** |

Все четыре находки — **тихие**: ни одна не бросает исключение и ни одна не
превращается в красный тест без намеренной проверки. Три из четырёх лежат ровно
там, куда указал V17 §7.

---

## 1. V18-02 (P1). `check` терял каталог-симлинк и отвечал за неверным эталоном

`readCatalogsByLocale` — единственный читатель каталогов, которым пользуется
`next-fluent check`. Он обходил директорию **сам**, отдельно от
`collectCatalogFiles`, которым пользуются рантайм и `typegen`.

`Dirent` для символической ссылки не отвечает `true` ни на `isFile()`, ни на
`isDirectory()`. Запись просто выпадала из обеих ветвей. При этом в том же самом
файле, в `collectCatalogFiles`, уже стоял комментарий про ровно эту ловушку
(«A symlink is neither isFile() nor isDirectory(), so linked catalogs were
silently dropped») и уже стояла правка — до соседней функции она не доехала.

Симлинк `messages/en.ftl → shared/en.ftl` — обычная схема монорепозитория, где
один каталог разделён между несколькими приложениями; V11 ради такого же случая
научил следовать ссылкам `collectSourceFiles`.

Замер на одном и том же дереве, отличающемся одним `ln -s`:

```
симлинк:  Checked 2 catalog(s) against "ru" (1 keys).
            shared:
              [extra] "only_in_shared" does not exist in ru.
          1 issue(s) found.

файл:     Checked 3 catalog(s) against "en" (2 keys).
            ru:
              [missing] "only_in_shared" is missing.
          1 issue(s) found.
```

Три отдельных последствия, а не одно:

1. **Отсутствующий перевод не сообщён.** `ru: [missing] "only_in_shared"` —
   единственная настоящая проблема дерева — в отчёте отсутствует.
2. **Эталонная локаль выбрана неверно.** `en` не стало локалью вовсе, и
   `referenceLocale` опустился на `ru` с одним ключом вместо двух.
3. **Сообщена выдуманная проблема.** `shared/` — каталог-пространство имён, а не
   локаль, — попало в отчёт как локаль и получило `extra` относительно `ru`.

И рядом, в том же CLI, `typegen` читал то же дерево безупречно — он видел и
`hello`, и `only_in_shared`. То есть расхождение было внутренним: один пакет,
одна команда, два разных представления о том, какие каталоги везёт проект.

**Правка.** `readCatalogsByLocale` больше не обходит директорию сам. Он берёт
список файлов у `collectCatalogFiles` и группирует его: локаль файла решает
первый сегмент пути относительно корня — сегмент-директория именует локаль
(`en/app.ftl`), сегмент-файл есть плоский каталог с пространством имён
(`en-app.ftl`). Согласие с рантаймом стало структурным, а не обязанностью двух
реализаций помнить друг о друге.

Проверено, что множества файлов до правки совпадали везде, кроме симлинка, —
то есть изменение действительно сводится к порядку и ссылкам, а не к набору.

**Граница, оставленная сознательно.** Симлинки на *директории* не следуются ни
там, ни там: рекурсивный обход ссылки делает цикл `messages/en → ..`
бесконечным. Это поведение `collectCatalogFiles`, и оно теперь общее.

---

## 2. V18-03 (P2). Валидатор и рантайм расходились в том, какой дубль «последний»

Fluent разрешает повторяющийся id по правилу «побеждает последнее определение» —
именно так работает `addResource({ allowOverrides: true })`. Значит, порядок
чтения каталогов **решает**, какой из двух переводов поедет в продакшен.

Две функции в одном файле сортировали по-разному:

| | чем сортирует | порядок для `EN.ftl` + `en.ftl` |
| --- | --- | --- |
| `collectCatalogFiles` (рантайм, `typegen`) | `Array.prototype.sort()`, кодовые единицы | `EN.ftl`, `en.ftl` |
| `readCatalogsByLocale` (`check`) | `localeCompare`, коллация ICU | `en.ftl`, `EN.ftl` |

Замер:

```
collectCatalogFiles order (runtime/typegen): [ 'EN.ftl', 'en.ftl', 'ru.ftl' ]
readCatalogsByLocale "en" sources order  : [ 'k = FROM_LOWER', 'k = FROM_UPPER' ]
runtime  keeps k = FROM_LOWER
check    keeps k = FROM_UPPER
```

Вред конкретный: сообщение `check` о дубле говорит *«Fluent keeps the last
definition»* и тем отправляет разработчика удалять **не ту** запись — ровно тот
вред, который один из прошлых проходов чинил в самом тексте этого сообщения.
Плюс валидатор сравнивал локали с каталогом, который мог отличаться от
отгружаемого.

Отдельно: `localeCompare` без явной локали берёт коллацию ICU из окружения.
Проверено — `new Intl.Collator().resolvedOptions().locale` отвечает `en-US` по
умолчанию и `tr-TR` при `LC_ALL=tr_TR.UTF-8`. Выход инструмента сборки зависел от
машины, на которой его запустили, тогда как doc-комментарий
`collectCatalogFiles` обещал «sorted for deterministic output».

**Правка.** Одна точка сортировки. `readCatalogsByLocale` больше не сортирует
вовсе — он потребляет уже отсортированный список (§1). Единственная сортировка
осталась в `collectCatalogFiles` и осталась plain `sort()`, с комментарием о том,
почему `localeCompare` здесь недопустим. Новый тест читает одно и то же дерево в
двух дочерних процессах с разными `LC_ALL` и требует одинаковый результат.

---

## 3. V18-01 (P2). `jsonToFluent` печатал один атрибут дважды

`declareId` защищает id **сообщений**: два JSON-ключа, сворачивающиеся в один
Fluent id, отклоняются с сообщением, называющим оба пути. Комментарий к нему
прямо объясняет, зачем: «Emitting both produced a resource with a duplicate id,
which the runtime resolves last-wins (with a console warning) while `typegen`
silently dropped one of them».

Та же самая коллизия существовала уровнем ниже и не защищалась. `normalizeId`
сворачивает `.` в `-`, а ведущая `.` принята как маркер атрибута, — поэтому на
один FTL-атрибут ложатся и `"label"` с `".label"`, и `"a.b"` с `"a-b"`:

```
до:   card = v
          .label = PLAIN
          .label = DOTTED
      → runtime: { label: 'DOTTED' }   (перевод PLAIN потерян молча)
      → typegen: один .label           (второй потерян молча)

после: [next-fluent] JSON catalog keys "card.label" and "card..label" both map
       to the attribute ".label" of the message "card". Rename one of them: a
       message cannot define the same attribute twice.
```

Достижимость не экзотическая: ведущую точку инструмент принимает **специально**,
чтобы перенос FTL в JSON был копипастой, — и именно этот перенос создаёт пару
`label` / `.label`.

**Правка.** Атрибуты сообщения учитываются так же, как id сообщений: карта
выданных имён, ошибка с обоими JSON-путями, тот же код `INVALID_ARGUMENT` и тот
же оборот «Rename one of them». Тест сверяет, что коллизия id и коллизия
атрибута теперь дают один класс ошибки — это и было расхождением.

---

## 4. V18-04 (P2). `redirect()` всегда означал локаль по умолчанию

Один и тот же объект, возвращённый `createNavigation`, разрешал href двумя
разными способами:

| вызов | локаль |
| --- | --- |
| `useRouter().push('/about')` | `options?.locale ?? currentLocale ?? defaultLocale` |
| `redirect('/about')` | `opts.locale ?? defaultLocale` |

Замер:

```
redirect("/about")                 -> /en/about-us
redirect("/about", {locale:"ru"})  -> /ru/o-nas
getPathname({href:"/about"})       -> /en/about-us
```

На русской странице `redirect('/about')` уводил посетителя на **английский**
путь, тогда как кнопка рядом, вызывавшая `push('/about')`, оставляла его на
русском. Тип `locale` при этом необязательный, так что вызов без локали
компилируется и не предупреждает. Документация показывает только вызовы с
локалью — то есть путь без неё не был ни описан, ни проверен.

Пропущенное слагаемое — не отсутствующее: в серверном компоненте текущая локаль
уже лежит в request store, куда её кладёт `setRequestLocale`, а README и так
требует этого вызова на каждой prerender-странице.

**Правка.** `redirectLocale(explicit) = explicit ?? requestLocale() ?? defaultLocale`.
Request store вынесен из `server.ts` в новый `src/request-store.ts`: `navigation.ts`
импортируется клиентскими компонентами, и тянуть туда `server.ts` значило бы
положить в браузерный бандл `@fluent/bundle`, форматтер и всю воронку каталогов
ради чтения одного поля. Рантайм-импорт нового модуля — одна функция `cache` из
`react`; в клиентском бандле он стоит **99 B**.

Сборка транспилирует каждый модуль отдельно (`bundle: false`), поэтому
`request-store.js` существует в реалме ровно один раз и `server.js` с
`navigation.js` читают один и тот же объект. Это закреплено тестом, а не
предположением.

Вне request scope `cache()` ничего не мемоизирует, `requestLocale()` возвращает
`undefined`, и поведение совпадает с прежним — это тоже закреплено тестом.

### Почему это проверено фикстурой, а не `node --test`

Request scope React существует только внутри настоящего рендера. Измерено, а не
предположено: `renderToStaticMarkup`, `renderToPipeableStream` и запуск с
`--conditions=react-server` — во всех трёх `isRequestScopeActive()` отвечает
`false`, и записанная локаль исчезает. Это то же измеренное ограничение, которое
V17 §5 зафиксировал для `getLocale`; закрывать его фиктивным Node-тестом было бы
самообманом, за который V15 исправлял V12 и V14.

Поэтому проверка живёт в `test/fixtures/next-app/app/[locale]/go-about/page.tsx`
и в `scripts/test-next-integration.mjs`, на настоящих запросах, в CI на Next 15
и Next 16:

| запрос | ожидание |
| --- | --- |
| `/go-about` | `/about-us` |
| `/ru/go-about` | `/ru/o-nas` |

Оба маршрута вызывают один и тот же `redirect('/about')`; различает их только
`setRequestLocale`. Отрицательный контроль на живом Next: с откаченным
`navigation.ts` гейт падает с
`redirect() from /ru/go-about ignored the request locale: expected /ru/o-nas, got /about-us.`

---

## 5. Проверено и оказалось верным

Отрицательные результаты прохода — они закрыты тестами, чтобы следующий проход
не перечитывал то же самое.

| что проверяли | результат |
| --- | --- |
| **`jsonToFluent`: значения** | 12 350 входов — каждый кодпойнт до U+3000 плюс формы, которые Fluent разбирает как синтаксис (`{ "lit" }`, `#c`, `.attr`, `*d`, `[s]`, `-term`, ведущие/хвостовые пробелы, U+2028/U+2029/U+0085, NUL, 3000 символов). Расхождений нет, кроме документированной нормализации CR → LF. Стало постоянным гейтом. |
| **`validateLocalePrefix`** | Повторяющиеся и затеняющие префиксы уже отклоняются, включая неочевидное `ru: '/en'`, конфликтующее с неявным префиксом `en`, и пары вида `/a` против `/a/b`. |
| **`t.has`** | Сообщение только с атрибутами и без значения отвечает `false` — согласованно с тем, что `t('no-value')` не форматируется. `t.attrs('no-value')` при этом работает. |
| **`collectSourceFiles`** | Дедупликация по `realpath` для директорий и файлов корректна: цикл не зацикливается, файл за двумя ссылками не считается дважды. |
| **`errors.ts`** | Все четыре публичных кода достижимы; `default`-ветвь `describe` недостижима по построению и оставлена как защита от кода из чистого JavaScript. |

---

## 6. Изменения прохода

| Файл | Изменение |
| --- | --- |
| `src/catalog-io.ts` | `readCatalogsByLocale` выводится из `collectCatalogFiles`: симлинки больше не теряются, порядок один на всех |
| `src/catalog.ts` | `jsonToFluent` отклоняет два JSON-ключа, ложащиеся на один атрибут |
| `src/request-store.ts` | **новый**: request store, общий для серверного рантайма и навигации |
| `src/server.ts` | store берётся из нового модуля, `getRequestStore` остаётся в публичной поверхности |
| `src/navigation.ts` | `redirect`/`permanentRedirect` разрешают локаль запроса |
| `test/audit-v18.test.mjs` | **новый**, 12 тестов |
| `test/fixtures/next-app/app/[locale]/go-about/page.tsx` | **новый** маршрут фикстуры |
| `scripts/test-next-integration.mjs` | гейт «`redirect()` следует за локалью запроса» |
| `scripts/size-budget.mjs` | бюджет minified поднят по замеру, 49.0 → 49.5 kB |
| `CHANGELOG.md`, `docs/AUDITS.md` | записи прохода |

### Отрицательный контроль

`dist/` пересобран без поведенческих правок (`request-store.ts` оставлен, чтобы
файл тестов загружался — это чистая выноска кода):

```
not ok 1 - V18-01: two JSON keys that name one attribute are rejected, not merged
ok    2 - V18-01: the collision guard does not reject attributes that merely look alike
not ok 3 - V18-01: attribute and message id collisions report the same class of error
not ok 4 - V18-02: a symlinked catalog file becomes a locale
not ok 5 - V18-02: check reports the same issues for a symlinked and a real catalog
not ok 6 - V18-02: check and typegen read the same files from the same tree
not ok 7 - V18-03: check and the runtime keep the same duplicate definition
not ok 8 - V18-03: catalog order does not depend on the process locale
ok    9 - V18-04: an explicit locale still wins over everything else
ok   10 - V18-04: outside a request scope the default locale is still the fallback
not ok 11 - V18-04: the request store is one module shared by server and navigation
```

8 из 11 падают до правок. Три зелёных в обоих состояниях — это гейты «не
сломали»: атрибуты, которые лишь похожи, явная локаль и фолбэк вне request
scope. Двенадцатый тест (round-trip значений) добавлен после контрольного
прогона и зелёный в обоих состояниях по построению — он фиксирует поведение,
которое правки не должны были менять.

### Проверки

`npm test` (626/626) · `npm run lint` · `npm run typecheck` · `npm run test:edge`
(41.6 kB) · `npm run size` · `npm run test:consumer` · `npm run test:types` ·
`npm run test:next` (Next 15) · `npm run test:next:16` (Next 16) — в обоих
`redirect() follows the request locale` · покрытие.

Две оговорки, чтобы не выдавать желаемое за действительное:

* `npm run check-dist` сравнивает `dist/` с **закоммиченным**, поэтому до
  коммита прохода он показывает диф — это ожидаемо, а не поломка.
* `npm run test:consumer` во время прохода дважды показал падения с `TS7016`.
  Причина — не библиотека: скрипт запускался параллельно с `npm run size`,
  который делает `rm -rf dist`. Три последовательных прогона после этого зелёные.

---

## 7. Приоритеты следующего прохода

1. **`server.js` — 84.04 % строк, единственный крупный непокрытый кусок `src/`.**
   Строки 69–107 (`createServerBundle`, `setRequestLocale`, `getLocale`) — это
   ровно тот request scope, которого нет в `node --test`. V17 §5 уже зафиксировал
   это как измеренное ограничение; V18 подтвердил его тем же замером для
   `navigation`. Полезный следующий шаг — не тест, а **расширение Next-фикстуры**:
   маршрут, который покрывает отказ `setRequestLocale` и цепочку fallback-локалей
   на живых запросах.
2. **`navigation.js` — 71.11 % ветвей.** Вырос с 65.9 %, но остаётся самым
   непокрытым модулем `dist/`. Хвост — `back`/`forward`/`refresh` (три строки
   делегирования) и `prefetch`-ветви доменного роутинга. Часть из них достижима
   только в App Router; стоит сначала назвать, какие именно, прежде чем писать.
3. **`usage.js` — 93.25 % ветвей, строки 156–169 и 502–504.** Маскер разбора
   исходников проверен V13 на девятнадцати входах; остаток — обработка мусора.
   Дефектов проход не нашёл, но и не искал их прицельно: это кандидат на
   дифференциальный фаззинг «маскер сохраняет длину и номера строк», а не на
   чтение по ветвям.
4. **Псевдолокали из имён каталогов.** `messages/shared/en.ftl` даёт в `check`
   локаль `shared`. Поведение документировано и намеренно (иначе каталог
   терялся бы молча), но оно же породило выдуманную `extra` в замере V18-02.
   Стоит решить, предупреждать ли о каталоге-директории, имя которой не
   канонический тег, — это вопрос к владельцу, а не дефект.
5. **`client.js` — строки 27–28, 155–159, 181–190.** Решение V15 §4 в силе: без
   решения владельца по `jsdom` или браузерному гейту это ограничение, а не
   находка.
