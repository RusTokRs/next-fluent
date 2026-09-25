import { createNavigation } from 'next-fluent/navigation';
import { routing } from './routing';

// Shared module (no 'use client'): createNavigation must be callable from
// Server Components as well as Client Components.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
