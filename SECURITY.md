# Security policy

## Supported versions

Security fixes are released for the latest minor version only. Because the
package is pre-1.0, minor versions may contain breaking changes; the changelog
states them explicitly.

| Version | Supported |
| --- | --- |
| Latest minor | Yes |
| Earlier minors | No |

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability
reporting on this repository (the "Report a vulnerability" button under the
*Security* tab), or email the maintainer listed in the repository profile.

Include:

- the affected version and, if known, the commit that introduced the problem;
- a minimal reproduction — a route, a catalog entry, or a request is usually
  enough;
- whether the issue needs a malicious catalog, a crafted request, or both.

We aim to acknowledge reports within five business days.

## Scope

The following are in scope and have been hardened explicitly:

- **Open redirects and host-header injection.** Redirect targets come only from
  the trusted `domains` config or the request's own origin; `trustedHosts`
  rejects a foreign `Host` with `421 Misdirected Request` before any redirect.
- **`javascript:` and friends in hrefs.** `assertSafeHref` normalizes the way a
  browser does, so tab- and NUL-obfuscated schemes are rejected too.
- **Path traversal and prototype pollution** in catalog loading, including
  `__proto__.ftl` and prefixes such as `{ ru: '/../evil' }`.
- **Unbounded work from request-controlled input.** Locale canonicalization is
  memoized in a bounded map, so varying a cookie cannot grow it or force repeated
  parsing; FTL nesting depth is capped before the parser can exhaust the stack.

## What this library does not do

It performs no network I/O, executes no user-supplied code, and collects no
telemetry. Message catalogs are treated as trusted input: they are authored by
the project, not by end users.
