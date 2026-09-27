'use client';

import { useTranslations } from 'next-fluent';
import { Link } from '../../i18n/navigation';

export default function ClientMessage() {
  const t = useTranslations();
  return <><p>{t('hello')}</p><Link href="/about" locale="en">Switch to English</Link></>;
}
