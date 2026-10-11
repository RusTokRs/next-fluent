import { headers } from 'next/headers';
import {
  getFormatter,
  getFormats,
  getLocale,
  getMessages,
  getNow,
  getTimeZone,
  getTranslations,
} from 'next-fluent/server';

// Nothing here pins the locale, so `getLocale()` has to resolve it the way an
// app that does not call `setRequestLocale` does. The route is excluded from
// the middleware matcher (see `middleware.ts`) so that the decision is the
// server helper's own and not the middleware's forwarded header — otherwise the
// first branch would always win and the rest would stay unreachable.
//
// The instant is asserted too: `getNow()` and `getTimeZone()` are synchronous,
// so they can only return the request config's values if the config has already
// been loaded into the request store. Outside a request scope this file cannot
// exist at all, which is why the assertion belongs here.
export const dynamic = 'force-dynamic';

export default async function Probe() {
  const requestHeaders = await headers();
  const locale = await getLocale();
  const t = await getTranslations();
  const now = getNow();
  const timeZone = getTimeZone();
  const formatter = await getFormatter();
  const formats = await getFormats();
  const messages = await getMessages();

  return (
    <main
      data-probe-locale={locale}
      data-probe-header={requestHeaders.get('x-next-locale') ?? ''}
      data-probe-cookie={requestHeaders.get('cookie') ?? ''}
      data-probe-accept-language={requestHeaders.get('accept-language') ?? ''}
      data-probe-now={now.toISOString()}
      data-probe-timezone={timeZone}
      data-probe-formatted-date={formatter.dateTime(now)}
      data-probe-formats={formats ? Object.keys(formats).sort().join(',') : ''}
      data-probe-price={formatter.number(1234.5, 'price')}
      data-probe-messages={typeof messages === 'string' ? String(messages.length) : 'json'}
      data-probe-hello={t('hello')}
    >
      probe
    </main>
  );
}