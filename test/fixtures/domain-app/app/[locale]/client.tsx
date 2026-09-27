'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-fluent';
import { createNavigation } from 'next-fluent/navigation';
import { routing } from '../../i18n/routing';

const { Link, useRouter, usePathname } = createNavigation(routing);
export default function ClientMessage() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  return <section data-client-locale={locale} data-pathname={pathname} data-hydrated={hydrated}>
    {routing.locales.map((target) => <div key={target}>
      <Link href="/about" locale={target} data-testid={`link-${target}`}>About: {target}</Link>
      <Link href="/shared" locale={target} data-testid={`shared-${target}`}>Shared: {target}</Link>
      <Link href={{ pathname: '/docs/[id]', query: { id: '42' } }} locale={target} data-testid={`single-${target}`}>Single: {target}</Link>
      <Link href={{ pathname: '/docs/[...slug]', query: { slug: ['a', 'b'] } }} locale={target} data-testid={`many-${target}`}>Many: {target}</Link>
      <Link href="/docs/new" locale={target} data-testid={`static-${target}`}>Static: {target}</Link>
      <button data-testid={`push-${target}`} onClick={() => router.push('/about', { locale: target })}>Push: {target}</button>
      <button data-testid={`replace-${target}`} onClick={() => router.replace('/about', { locale: target })}>Replace: {target}</button>
    </div>)}
  </section>;
}
