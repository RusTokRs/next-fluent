import { setRequestConfig } from 'next-fluent/server';

export default setRequestConfig(({ locale }) => ({
  locale: locale ?? 'en',
  messages: locale === 'ru' ? 'hello = Привет { $appName }' : 'hello = Hello { $appName }',
  defaultTranslationValues: { appName: 'Next Fluent' },
  timeZone: 'UTC',
  now: new Date('2024-01-01T00:00:00.000Z'),
}));
