# Инженерный аудит next-fluent

Дата: 24 сентября 2026 года. Проверена версия пакета `0.1.0`; затем внесены исправления по результатам аудита.

## Вывод

Исходное состояние библиотеки не достигало заявленного уровня `next-intl` для рабочего приложения с App Router. Все 20 обнаруженных дефектов и пробелов F01–F20 получили исправления. Ниже сохранены первоначальные воспроизведения, чтобы было видно, почему изменения понадобились. Дополнительная проверка Edge runtime и приложений потребителей остаётся релизной задачей.

## Состояние после исправлений

| Область | Исправление | Проверка |
| --- | --- | --- |
| F01, F06, F07, F10, F11, F17: маршруты | Общий route matcher для middleware и navigation; static, dynamic, catch-all, обратное сопоставление, locale switch, domain и basePath. Повторный проход middleware после внутреннего rewrite больше не вызывает redirect loop. | Регрессионные тесты; HTTP-запросы к production Next 15 и Next 16. |
| F02: кеш | После хеша сверяется точный исходный FTL-текст. | Тест на реальную коллизию `0jebqzk`/`1i10qdw`. |
| F03, F15, F16: типы | Общий механизм `FluentMessages`, вывод аргументов по значению/атрибуту, типы namespace и параметров маршрутов. | Компилируемый consumer fixture с положительными и отрицательными случаями. |
| F04, F05, F12, F13, F14: сервер | Изолированные loaders экземпляров, полный request config, fallback, проверка локали, явные ошибки интеграции, request snapshot и серверный provider. | Unit tests и production RSC/client fixture. |
| F08: URL | Проверка объектного pathname перед локализацией. | Регрессия для protocol-relative URL. |
| F09: entry points | Условные server/browser exports и отдельная клиентская граница; современный alias Turbopack. | Production build на Next 15 Webpack и Next 16 Turbopack. |
| F18, F19: CLI | Проверка output для directory input; псевдолокализация Fluent AST. | CLI и parser round-trip tests. |
| F20: CI | Матрица Node 18/20/22, Next 15/16, Windows/Linux, типовые consumer fixtures, production Next integration и browser hydration/navigation в выделенном job. | Локально: 125 тестов, `npm run verify`, `npm run test:next` с браузерным сценарием на Next 15/16. Запуск матрицы GitHub Actions ожидается после публикации изменений. |
| Зависимости | Dev-зависимость Next 15 больше не оставляет уязвимый PostCSS в дереве через npm override. | `npm audit`: 0 уязвимостей. |

`FluentServerProvider` передаёт сообщения, fallback, `now`, time zone и сериализуемые default values. Пользовательские Fluent-функции и callback-значения должны задаваться в клиентском компоненте: функции нельзя передать через границу React Server Components. Синхронные `getNow`/`getTimeZone` сохраняют прежний API и до загрузки конфигурации возвращают значения среды; для согласованного server/client рендера используйте request snapshot/provider. Браузерный сценарий проверяет гидратацию без ошибок, одинаковый перевод в RSC и клиенте, переход по `Link` и смену cookie. Edge runtime отдельно не проверялся.

## Первоначальный аудит

## Охват и методика

- Прочитаны все 19 файлов `src`, сборщик, CLI, `package.json`, README, CI и существующие тесты.
- Выполнены `npm run verify`: сборка, проверка типов и 113 тестов прошли.
- Выполнен `npm pack --dry-run --json`: пакет собирается и включает заявленные файлы.
- Отдельно воспроизведены ошибки маршрутизации, переключения языка, кеша, фабрики и TypeScript API.
- Собрано минимальное Next.js 15.5.26 приложение, импортирующее корневой entry point. Production build упал на `node:path`. С импортом `dist/client.js` компиляция прошла, после чего Next.js отклонил TypeScript 7.0.2 из dev-зависимостей этого репозитория. Временное приложение удалено.
- Сравнение функций сделано по официальной документации `next-intl`, а не по названию теста `next-intl-parity`.

Аудит не включает полноценный end-to-end прогон на Next.js 16, Edge runtime, реальные browser hydration тесты, нагрузочный benchmark или внешний security pentest. Эти проверки нужны перед релизом, но отсутствие их результатов не уменьшает доказательность воспроизведённых дефектов.

## Подтверждённые дефекты

### P1 — блокируют обещанный сценарий или дают неверный результат

| ID | Место | Дефект и доказательство | Исправление |
| --- | --- | --- | --- |
| F01 | [`src/middleware.ts`](src/middleware.ts#L85-L195), [`src/routing.ts`](src/routing.ts#L15-L23) | `pathnames` передаётся в конфигурации, но middleware его вообще не читает. Запрос `/ru/o-nas` при правиле `/about → /o-nas` получает `200` и `x-middleware-next: 1`, без rewrite к `/ru/about`. Для структуры `app/[locale]/about` это 404. | Создать единый двусторонний route matcher для middleware и navigation; переписывать внешний slug во внутренний маршрут. Проверить обычные, динамические и catch-all сегменты. |
| F02 | [`src/cache.ts`](src/cache.ts#L19-L25), [`src/cache.ts`](src/cache.ts#L59-L83) | Идентичность ресурса и bundle определяется только длиной и 32-битным FNV-1a. Найдена реальная коллизия: `key = 0jebqzk` и `key = 1i10qdw`, обе с хешем `ebe0a398`. После создания первого bundle второй возвращает `0jebqzk` вместо `1i10qdw`. Это неверный перевод, потенциально между разными запросами или арендаторами процесса. | Использовать точный исходник как вторичную проверку равенства или криптографический digest плюс проверку; сохранить ограничение размера кеша. Добавить тест на эту пару. |
| F03 | [`src/types.ts`](src/types.ts#L17-L49), [`src/typegen.ts`](src/typegen.ts#L118-L145), [`src/server.ts`](src/server.ts#L322-L330) | Сгенерированный `declare global { interface FluentMessages ... }` не расширяет **экспортируемый модульный** `FluentMessages` из `types.ts`. Аргументы по умолчанию остаются `Record<string, any>`, а server API по умолчанию принимает любой `string`. Компилятор сообщил `Unused '@ts-expect-error'` и для неизвестного ключа, и для вызова `t('hello')` без обязательного `name`. Обещанная полная типобезопасность отсутствует. | Определить один механизм augmentation, через который все client/server методы выводят ключи и аргументы; покрыть это компилируемыми consumer fixture с положительными и отрицательными случаями. |
| F04 | [`src/factory.ts`](src/factory.ts#L29-L43), [`src/server.ts`](src/server.ts#L14-L16) | `createI18n` изменяет глобальный `globalConfigFn`. После создания runtime A с `msg = A` и runtime B с `msg = B`, вызов `a.forLocale('en')('msg')` возвращает `B`. Экземпляры фабрики не изолированы. | Хранить loader внутри экземпляра и передавать его в server API; глобальный singleton оставить только для явно одиночной конфигурации, если он нужен. |
| F05 | [`src/server.ts`](src/server.ts#L153-L177), [`src/server.ts`](src/server.ts#L252-L319) | `RequestConfigResult` объявляет `locale`, `fallbackLocale`, `fallbackMessages`, но `getMessages` возвращает только `messages`. `forLocale('ru')` с конфигом `fallbackMessages: 'only = Only'` выдаёт `only` вместо `Only`. Возвращённый `locale` игнорируется, и каталог может форматироваться по правилам неверной локали. | Кешировать и применять полный нормализованный request config как единое целое; формировать fallback chain и bundle по фактически разрешённой локали. |
| F06 | [`src/navigation.ts`](src/navigation.ts#L133-L165) | При переключении языка уже локализованный slug не переводится обратно во внутренний путь. `resolveLocalizedPathname({href:'/ru/o-nas', locale:'en'})` возвращает `/en/o-nas` вместо `/en/about-us`. | Сначала распознавать локаль и внешний route, затем преобразовывать через внутренний route в целевой внешний route. |
| F07 | [`src/navigation.ts`](src/navigation.ts#L208-L225), [`src/middleware.ts`](src/middleware.ts#L167-L186) | В `as-needed` явный переход на язык по умолчанию не работает при cookie другого языка. С `NEXT_LOCALE=ru` Link для `locale='en'` создаёт `/about`, middleware возвращает `307 → /ru/about`. | Для явной смены языка передавать сигнал middleware, например временный `/en/about` с последующим canonical redirect и обновлением cookie, или контролируемый механизм смены cookie. |
| F08 | [`src/navigation.ts`](src/navigation.ts#L25-L48), [`src/navigation.ts`](src/navigation.ts#L113-L130) | `UrlObject.pathname='//evil.example/path'` не проходит проверку внешнего URL, которая есть только для строк и `href.href`. При `localePrefix='as-needed'` или `'never'` результат — `//evil.example/path`, то есть protocol-relative внешний URL. Это опасно, если pathname берётся из входных данных. | Нормализовать и валидировать объектный pathname до формирования URL; запрещать `//`, обратные слеши, управляющие символы и внешние схемы для внутреннего маршрута. |
| F09 | [`src/index.ts`](src/index.ts#L1-L80), [`scripts/build.mjs`](scripts/build.mjs#L28-L55) | Корневой `dist/index.js` одновременно содержит client hooks, server API и `node:path` из плагина, без директивы `use client`. Минимальный client component с импортом `FluentProvider/useTranslations` из корня не проходит `next build`: `UnhandledSchemeError: Reading from "node:path"`. Дополнительно bundler предупреждает о `next-fluent/config`, отсутствующем в `exports`. | Разделить публичные entry points по средам; корень сделать безопасным для выбранного контекста либо убрать из него server/client/plugin runtime exports. Проверить реальными Next build fixture. |

### P2 — существенные архитектурные и функциональные пробелы

| ID | Место | Проблема | Исправление |
| --- | --- | --- | --- |
| F10 | [`src/navigation.ts`](src/navigation.ts#L155-L165), [`src/types.ts`](src/types.ts#L100-L145) | Сопоставление pathname строгое и не поддерживает динамические параметры. `/products/123 → /ru/products/123`, хотя задан `/products/[id] → /tovary/[id]`; объект `{pathname:'/products/[id]', query:{id:123}}` даёт `/ru/tovary/[id]?id=123`. | Компилировать шаблоны маршрутов, кодировать параметры, поддержать catch-all и обратное сопоставление. |
| F11 | [`src/routing.ts`](src/routing.ts#L4-L23), [`src/factory.ts`](src/factory.ts#L46-L58) | `domains` и `basePath` присутствуют в `RoutingConfig`, но не используются middleware и navigation. README обещает domain routing, хотя работающей реализации нет. | Реализовать оба режима end-to-end либо удалить опции и обещания до реализации. |
| F12 | [`src/server.ts`](src/server.ts#L179-L201), [`src/client.ts`](src/client.ts#L53-L65), [`src/client.ts`](src/client.ts#L156-L175) | `getNow`/`getTimeZone` и formatter не инициализируют request config. Если их вызвать до `getMessages`, берётся время или часовой пояс машины. `FluentProvider` не наследует `now/timeZone` автоматически, а README в quick start передаёт только `messages`; поэтому обещание отсутствия hydration mismatch не обеспечено этим примером. | Сделать единый асинхронный request config, передавать его целиком в provider; задать стабильные серверные `now` и time zone в документации и интеграционных тестах. |
| F13 | [`src/server.ts`](src/server.ts#L60-L68), [`README.md`](README.md#L105-L145) | `setRequestLocale` без проверки помещает произвольное значение выше allow-list логики `getLocale`. Quick start напрямую использует `[locale]` из URL; этот же параметр в примере request config участвует в построении пути к `.ftl`. | Валидировать route locale по `routing.locales` и вызывать `notFound()` для неподдерживаемого; не строить файловые пути из непроверенного значения. |
| F14 | [`src/server.ts`](src/server.ts#L134-L151), [`src/middleware.ts`](src/middleware.ts#L38-L83) | Любая ошибка импорта request config скрывается как «конфигурация не задана», после чего сервер тихо возвращает пустой каталог. Middleware при ошибке импорта NextResponse подменяет его объектом Mock в production code. Это маскирует реальные поломки интеграции. | Отличать отсутствие опционального модуля от ошибки исполнения; mock вынести в тесты, а runtime ошибку пробрасывать с контекстом. |
| F15 | [`src/typegen.ts`](src/typegen.ts#L29-L56), [`src/typegen.ts`](src/typegen.ts#L85-L115) | Переменные извлекаются из всего Message вместе с attributes. Для `profile = { $name }` и `.title = { $count }` типы обоих ключей ошибочно требуют и `name`, и `count`. | Извлекать переменные отдельно для value и каждого attribute; учесть ссылки на terms/messages и аргументы функций. |
| F16 | [`src/types.ts`](src/types.ts#L88-L98), [`src/types.ts`](src/types.ts#L121-L145) | `Href` допускает любую строку, `locale` допускает любой string, `Pathnames` допускает любые ключи. Обещание type-safe navigation не выполняется: опечатка в маршруте и локали компилируется. | Выводить union внутренних маршрутов и локалей из `defineRouting`, типизировать параметры динамических шаблонов. |
| F17 | [`src/navigation.ts`](src/navigation.ts#L255-L265) | `usePathname` ищет slug среди всех локалей, а не только текущей, и возвращает первый подходящий canonical route. При совпадающих внешних slug для разных внутренних маршрутов результат зависит от порядка свойств. | Валидировать уникальность внешних маршрутов в рамках локали и искать только в текущей локали. |

### P3 — качество инструментария и документации

| ID | Место | Проблема | Исправление |
| --- | --- | --- | --- |
| F18 | [`bin/next-fluent.mjs`](bin/next-fluent.mjs#L94-L106) | Для `pseudo --input <directory> --output result.ftl` каждый входной файл записывается в один и тот же `result.ftl`; сохраняется только последний. | Запретить файл как output для directory input или явно объединять каталоги с разрешением дубликатов. |
| F19 | [`src/pseudo.ts`](src/pseudo.ts#L38-L148) | Псевдолокализация основана на построчных regex, а не на Fluent AST. Сложные multiline expressions, escaped literals и новые синтаксические формы могут обрабатываться неверно. Текущие тесты проверяют лишь несколько шаблонов. | Трансформировать только текстовые AST-узлы и round-trip проверять результат парсером Fluent. |
| F20 | [`package.json`](package.json#L76-L84), [`.github/workflows/ci.yml`](.github/workflows/ci.yml#L8-L35) | Peer range заявляет Next 15 и 16, но CI запускает только unit-тесты библиотеки. В репозитории dev TypeScript 7; Next 15.5.26 отказался завершить fixture build из-за несовместимости TS API, даже после исправления entry point. | Добавить consumer fixture matrix для Next 15/16 с поддерживаемой версией TypeScript на каждой ветке, Webpack/Turbopack, RSC/client, rewrite и hydration. |

## Сравнение с next-intl

| Область | next-intl по официальным docs | next-fluent сейчас |
| --- | --- | --- |
| Локализованные статические пути | Middleware переписывает внешний путь во внутренний | URL генерируется, но rewrite отсутствует (F01) |
| Динамические и catch-all пути | Поддержаны параметры и обратное сопоставление | Нет поддержки (F10) |
| Домены, prefix, basePath | Документированы и включены в routing | `domains/basePath` объявлены, но не работают (F11) |
| Типы переводов и маршрутов | Augmentation для сообщений; routing API выводит путь/локаль | Typegen не соединён с API; route типы слишком широки (F03, F16) |
| Server/client config | Request config используется сервером и provider | Значимая часть config теряется; provider заполняется вручную (F05, F12) |
| Fluent syntax | `next-intl` использует ICU, `next-fluent` — официальный Fluent | Сильная сторона next-fluent; прямого синтаксического паритета быть не должно |

Источники сравнения: [routing configuration](https://next-intl.dev/docs/routing/configuration), [navigation](https://next-intl.dev/docs/routing/navigation), [request configuration](https://next-intl.dev/docs/usage/configuration), [TypeScript augmentation](https://next-intl.dev/docs/workflows/typescript), [Server/Client Components](https://next-intl.dev/docs/environments/server-client-components).

## Последовательность исправлений

1. **До следующего релиза:** исправить F01–F09 и добавить по одному настоящему consumer regression test на каждую область. Начать с route engine, типовой модели и точной идентичности кеша.
2. **После восстановления базовой корректности:** реализовать F10–F17, привести README к реально работающему API и покрыть пользовательский путь `request → middleware → RSC → provider → client navigation`.
3. **Релизный шлюз:** `next build` и browser E2E на Next 15/16, Webpack/Turbopack; проверка `as-needed/never`, локализованных и динамических маршрутов, смены языка, cookies, hydration, fallback, time zone; TS consumer compile tests и benchmark после исправления кеша.

До выполнения этих пунктов формулировки «полная типобезопасность», «domain routing», «zero hydration mismatch» и «паритет с next-intl» в README вводят пользователя в заблуждение.
