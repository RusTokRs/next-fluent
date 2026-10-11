import type { ReactNode } from 'react';

// Registers the locale list the helpers validate against (see the module's
// comment). Imported here — a server module that renders before anything asks
// for a locale — so `/probe` can negotiate `Accept-Language` at all.
import '../../i18n/server-config';

// A root layout of its own, deliberately *without* `setRequestLocale` and
// without `FluentServerProvider`. That combination is what the rest of the
// fixture never exercises: every other route pins the locale in `[locale]`,
// so `getLocale()` returns the stored one and the detection path —
// `x-next-locale`, then the cookie, then `accept-language`, then the default —
// stays untested in the one place where it actually runs.
export default function ProbeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}