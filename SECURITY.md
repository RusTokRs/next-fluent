# Security policy

## Supported versions

Security fixes are released for the latest minor version only.

The versioning rule is explicit so that "pre-1.0" is not a blank cheque:

- **patch** (`0.1.0` → `0.1.1`) — fixes only; no observable behavior changes, no
  removal of documented behavior;
- **minor** (`0.1.0` → `0.2.0`) — features, and breaking changes while the major
  version is 0. Every breaking change is listed under a dedicated heading in
  `CHANGELOG.md`, with the migration step;
- **major** (`0.x` → `1.0.0`) — the switch to strict SemVer: breaking changes
  only in a major release from then on;
- deprecations are announced in the changelog at least one minor release before
  a removal.

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
  The same check gates every other public URL the middleware emits — the
  alternate `Link` header included — and `next dev` warns once when such a URL
  is built without `trustedHosts`. In the allow-list, `*.example.org` covers
  subdomains only: the apex has to be listed as `example.org` too. A
  client-supplied `x-forwarded-host` is honoured only when it matches `Host`, a
  configured domain, or when both it and the connection are loopback.
- **Canonical-URL pinning through the internal rewrite signal.** The headers the
  middleware attaches to its own rewrites (`x-next-fluent-rewrite` and its
  per-process token) cannot be forged from outside: guessing the pathname is not
  enough to make a non-canonical URL such as `/en/about` render instead of
  redirecting to `/about-us`, and neither header is forwarded to the app.
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
