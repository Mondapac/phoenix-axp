# Tenant configuration

One `<tenant-id>.json` per tenant. The API loads the file of every tenant in `HOSTED_TENANTS`
at start-up and refuses to start when one is missing or invalid (`apps/api/src/platform/tenant-config/`).

| Field              | Meaning                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `code`             | The tenant id; must equal the file name (`^[a-z][a-z0-9-]{1,31}$`).          |
| `displayName`      | A human name, for operators.                                                 |
| `defaultLocale`    | BCP 47 locale, canonical form (`fa-IR`).                                     |
| `supportedLocales` | Every locale the tenant serves; includes `defaultLocale`.                    |
| `timeZone`         | IANA zone (`Asia/Tehran`). Local dates and times are computed in this zone.  |
| `calendar`         | Unicode calendar id (`persian`, `gregory`), as `Intl` supports it.           |
| `direction`        | Text direction of the default locale: `rtl` or `ltr`.                        |

The two fixtures cover the dimensions every tenant-scoped test must exercise (ADR-0002):

- `demo-fa`: Persian, Jalali (`persian`) calendar, `Asia/Tehran`, right to left.
- `demo-en`: a synthetic English tenant, Gregorian calendar, `America/Toronto` (daylight saving), left to right.

Tenant ids, locales and zones are configuration: ESLint refuses them as string literals in
`apps/api/src` and `packages/shared-kernel/src`.
