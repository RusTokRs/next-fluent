'use client';

import { useTranslations } from 'next-fluent';
import { createNavigation } from 'next-fluent/navigation';
import { routing } from '../../i18n/routing';

const { Link } = createNavigation(routing);

export default function ClientMessage() {
  const t = useTranslations();
  return <><p>{t('hello')}</p><Link href="/about" locale="en">Switch to English</Link></>;
}
