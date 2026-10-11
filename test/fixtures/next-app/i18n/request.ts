import { setRequestConfig } from 'next-fluent/server';

export default setRequestConfig(({ locale }) => ({
  locale: locale ?? 'en',
  messages: locale === 'ru' ? 'hello = Привет { $appName }' : 'hello = Hello { $appName }',
  defaultTranslationValues: { appName: 'Next Fluent' },
  timeZone: 'UTC',
  now: new Date('2024-01-01T00:00:00.000Z'),
  // A preset, so `/probe` can prove that `getFormats()` and `getFormatter()`
  // read the request config rather than falling back to `Intl` defaults.
  formats: { number: { price: { style: 'currency', currency: 'EUR' } } },
}));
