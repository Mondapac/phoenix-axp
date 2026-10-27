# PoC 4 (slice 0.9): RTL portal page, Jalali form and Puck editor

**Track:** frontend · **Branch:** `spike/poc-4-rtl-portal` (from `chore/skeleton`) · **Date:** 2026-10-27
**Mode:** report-only spike (owner decision D5). The code stays on the branch and is not merged.
**Criterion:** WCAG 2.1 AA (design doc section 5, ADR-0008 consequences).

## خلاصه برای صاحب پروژه

صاحب پروژه، نتیجهٔ PoC ۴ مثبت است. صفحهٔ فارسی و راست‌به‌چپ پورتال را سمت سرور از درخت JSON صفحه‌ساز (Puck) و از راه رجیستری کامپوننت ساختیم. همان کد، بدون هیچ مقدار ثابتی در کد، صفحهٔ انگلیسی و چپ‌به‌راست مستأجر دوم را هم ساخت. سایت فرزند (فارس) قالب سایت والد (وزارتخانه) را به ارث برد. رنگ لوگوی قفل‌شده هم در سایت فرزند عوض نشد.

فرم از JSON Schema و UI Schema ساخته شد و این‌ها را دارد:
- تقویم جلالی که با صفحه‌کلید کار می‌کند؛
- ارقام فارسی در نمایش؛
- یکسان‌سازی «ي/ك» و ارقام عربی و فارسی در ورودی؛
- پیام‌های خطای فارسی.

**نتیجهٔ axe-core (معیار WCAG 2.1 AA):**
- در ۱۰ اجرا روی صفحه‌ها و فرم، در هر دو زبان، هیچ خطایی پیدا نشد.
- ۶۳ بررسی خودکار دیگر هم همه قبول شدند. این بررسی‌ها ترتیب Tab، دیده‌شدن فوکوس، بزرگ‌نمایی ۲۰۰٪، برچسب‌ها و خطاها، و lang و dir را می‌سنجیدند.
- یک ایراد واقعی پیدا و رفع شد: حلقهٔ فوکوس روی سرصفحهٔ تیره کنتراست کافی نداشت (۱٫۸ به ۱).

**یافته‌های مهم که باید در طراحی فاز ۱ و ۲ اعمال شوند:**
- **صفحه‌ساز Puck در RTL خوب کار می‌کند،** ولی این چهار ایراد را دارد:
  - نشانی‌های اینترنتی (URL) در فیلدها به‌هم‌ریخته نمایش داده می‌شوند.
  - افزودن بلوک با صفحه‌کلید ممکن نیست.
  - به‌طور پیش‌فرض فونتی از سرور خارجی بارگذاری می‌کند.
  - در ابزار axe سه خطای دسترس‌پذیری دارد.

  برای همهٔ آن‌ها راه‌حل مشخص پیشنهاد کرده‌ایم.
- **کتابخانهٔ JSON Forms یک باگ از دست رفتن حروف داشت.** اگر داده به شکل معمول به فرم برگردانده شود، حروفی که سریع تایپ می‌شوند گم می‌شوند. الگوی درست را پیدا و پیاده کردیم.
- **بستهٔ sharp که Next.js همراه می‌آورد مجوز LGPL دارد.** این مجوز طبق ADR-0009 ممنوع است. آن را حذف کردیم.
- **مجوز داده‌ای caniuse-lite (CC-BY-4.0) نیاز به تصمیم شما دارد.** این همان سؤال باز ADR-0009 است.

**تصمیم دربارهٔ کتابخانهٔ فرم با شماست (مرور فاز ۲).** پیشنهاد تیم JSON Forms است، به‌جای RJSF. دلیلش این است که چیدمان فرم در آن سند جداگانه است و رجیستری رندرکننده‌اش با رجیستری صفحه‌ها یکی است.

آنچه آزموده نشد: صفحه‌خوان واقعی (NVDA، VoiceOver)، مرورگرهای Firefox و Safari، و موبایل.

## 1. Setup

| Item | Version / note |
|---|---|
| Node.js | **24.22.1** (official tarball, SHA-256 checked, in the session scratchpad; the machine's Node 22 was not used) |
| pnpm | 10.28.0 (corepack) |
| Next.js / React | 16.4.2 (Turbopack, App Router) / 19.3.0. These pin the same versions as MondaPac ADR-0033 |
| Tailwind CSS | 4.3.3, `@theme inline` on `--px-*` variables; default palette and radius scale switched off |
| Base UI | `@base-ui/react` 1.9.0 (Field, Popover, DirectionProvider) |
| next-intl | 4.14.9, no locale routing: the locale is a property of the site (host) |
| Puck | `@puckeditor/core` 0.23.0 (the `@measured/puck` package was renamed) |
| Forms | `@jsonforms/core` + `@jsonforms/react` 3.8.0, ajv 8.20.0 |
| Browser / a11y engine | Pre-installed Playwright 1.56.1, HeadlessChrome 141.0.7390.37; axe-core 4.14.0 (dev only) |
| Data | Fixture JSON in place of the API (`apps/portal/fixtures/`); tenant defaults read from the repo's `config/tenants/*.json` |

**Layout of the spike:**
- `packages/ui/src/`:
  - `theme/`: tokens, inheritance and contrast;
  - `text/persian.ts`: input normalisation and locale digits;
  - `calendar/`: Intl-based Jalali and Gregorian helpers;
  - `blocks/`: registry, five blocks and `renderPage`;
  - `form/`: JSON Forms renderers, `CalendarDateField` and `SchemaForm`.
- `packages/ui/lint/`: `portal-rules.mjs` with its spec, and `check-css.mjs`.
- `apps/portal/`:
  - `proxy.ts`: host to site;
  - `app/s/[site]/`: layout, home page (ISR), `theme.css`, `forms/[form]` and its BFF `submit` route, and `edit` (Puck);
  - `src/server/`: fixture readers and the clock;
  - `e2e/run.mjs`: the browser checks.

**How to reproduce:**
1. Run `pnpm install`, then `pnpm --filter @phoenix/shared-kernel build`.
2. In `apps/portal`, run `pnpm build && pnpm start` (port 3100).
3. Run `node e2e/run.mjs`. It writes `docs/reviews/poc-4-assets/results.json` and the screenshots.

Hosts:
- `demo-fa.localhost:3100`: tenant demo-fa, site moe (root).
- `fars.demo-fa.localhost:3100`: tenant demo-fa, site fars (child of moe).
- `demo-en.localhost:3100`: tenant demo-en, site main.

Unit tests: `pnpm --filter @phoenix/ui test` (45 tests).

## 2. Method

**1. Portal page.** The published home page of each site is a Puck `Data` tree in an immutable version file (`home@3.json`), selected by a `published.json` pointer.
- `PageView` walks `content[]`. Each node goes through `blockRegistry[type]`, whose `read()` turns untrusted props into strings and arrays only. The node is placed in the header, main or footer region, and the landmarks are built from that.
- An unregistered type renders nothing and is logged (fail closed). Link targets pass `safeHref` (same-site path, fragment, https, mailto).
- The page is a server component with `revalidate = 300`. The build lists the three sites as SSG with a 300 s revalidate in the prerender manifest.
- The hostile fixture puts the following into the moe news list, to prove the registry blocks raw HTML:
  - `<img onerror>` in a title;
  - `<script>` in a summary;
  - a `javascript:` link;
  - an unknown `RawHtml` block.

**2. Second tenant.** demo-en/main uses the same code and different fixtures:
- locale `en-CA`, the Gregorian calendar and the America/Toronto zone come from `config/tenants/demo-en.json`;
- `dir` comes from `Intl.Locale#getTextInfo()`;
- the week start comes from `Intl.Locale#getWeekInfo()`.

There is no language table and no tenant literal in code.

**3. Theme inheritance.** The chain is platform default, then moe, then fars:
- moe sets brand and accent tokens and **locks `color.brand`**;
- fars overrides the accent and tries to override the brand, which is refused and reported.

Token values are validated by kind (`#rrggbb`, a px or rem length), so a token cannot inject CSS. The theme is served as a per-site stylesheet (`/theme.css`), not an inline style, so a nonce CSP needs no `unsafe-inline` for it.

**4. Form.** `appointment.json` holds a JSON Schema, a UI Schema (`VerticalLayout` of two `Group`s) and per-locale messages. The form is defined on moe and used unchanged on its child fars (ADR-0018 decision 5).
- Six tester-ranked renderers on Base UI `Field` handle text, identifier, textarea, enum, date and the two layouts.
- The date control is our own `CalendarDateField`. Its text box takes Y/M/D in the viewer's calendar and any digit script. The grid is in a Base UI Popover and follows the WAI-ARIA date-picker keys. The arrow keys are mirrored in RTL.
- The BFF route checks `Sec-Fetch-Site`/`Origin`, normalises the strings with the same code and validates with the same schema (`createAjv` of JSON Forms core). It answers 422 with the ajv errors or 201 with the normalised data.

**5. Puck editor.** `/edit` opens `<Puck>` on the same tree. The Puck config is built from the same registry. The editor gets a Persian `dictionary`, field labels from the app catalogue and an LTR custom field for URLs, ISO dates and anchors.

**6. Checks.**
- `e2e/run.mjs` runs axe-core with the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` tags on 11 page states, and 63 scripted checks.
- ESLint runs with the portal rules on `apps/portal` and `packages/ui`, and `check-css.mjs` checks the stylesheets.
- The licence gate is `pnpm licences`.

## 3. axe-core results (WCAG 2.0/2.1 A + AA rules)

| Page state | Violations (rules / nodes) | Needs review | Rules passed |
|---|---|---|---|
| fa-IR home, demo-fa/moe | **0 / 0** | 0 | 19 |
| fa-IR home, child site demo-fa/fars | **0 / 0** | 0 | 19 |
| en-CA home, demo-en/main | **0 / 0** | 0 | 19 |
| fa-IR home at 200% zoom (640 CSS px) | **0 / 0** | 0 | 19 |
| fa-IR form, initial | **0 / 0** | 0 | 26 |
| fa-IR form, errors shown | **0 / 0** | 0 | 26 |
| fa-IR form, calendar open | **0 / 0** | 3 | 33 |
| en-CA form, initial | **0 / 0** | 0 | 26 |
| en-CA form, errors shown | **0 / 0** | 0 | 26 |
| en-CA form, calendar open | **0 / 0** | 3 | 33 |
| Puck editor fa-IR (outer document; staff-facing, studio) | **3 / 3** | 2 | 26 |

**"Needs review" on the open calendar** (checked by hand, none is a defect):
- `aria-hidden-focus` hits Base UI's focus-guard spans. They are `aria-hidden` sentinels that move focus at once.
- `aria-valid-attr-value`: axe cannot resolve the trigger's `aria-controls` while the popup is in a portal. The popup does exist.
- `label-content-name-mismatch` flags day buttons whose visible text is "۱" and whose name is "۱ خرداد ۱۳۶۹". The visible text is the start of the name, so 2.5.3 holds.
- `color-contrast` (en) could not compute over the overlapping popup.

**Puck editor violations** (upstream, in Puck 0.23):
- `frame-title`: the preview `<iframe>` has no title.
- `select-name`: the zoom `<select>` has no label.
- `aria-prohibited-attr`: `aria-label` on the loader `<span>`.

Needs review: the deprecated `aria-grabbed` on drawer items (from dnd-kit), and contrast on the drawer.

The full results are in `poc-4-assets/results.json`.

## 4. Manual checklist

| Item | Result | How it was checked |
|---|---|---|
| **Keyboard order** | Pass | Tab walk on both homes: skip link first, then the header, hero CTA, news, cards and footer. Within a row the order runs right to left in fa-IR and left to right in en-CA (x positions in `results.json`). The skip link moves the next Tab into `<main>`. The form order is name, national code, mobile, date, calendar button, type, details, submit. The whole form, calendar included, was filled and sent with the keyboard only. |
| **Focus visibility** | Pass after fix | Every Tab stop has a 3 px outline. **Finding:** the single-colour ring was 1.83:1 on the brand header and footer, which fails 1.4.11. **Fix:** a two-tone ring (focus outline plus a 2 px surface-colour halo), and `contrastFailures()` now checks the ring on page, surface, subtle, brand and accent for every theme. All three fixture themes pass. |
| **Contrast** | Pass | axe `color-contrast` passes on all portal pages. `contrastFailures()` checks 13 text and non-text pairs plus the focus ring; moe, fars and main have 0 failures. A theme that fails is reported, and studio should refuse to publish it. |
| **Form labels and errors** | Pass | Every control has a `<label>`, `aria-required` and, after submit, `aria-invalid`, with the error text in `aria-describedby`. An empty submit shows an error summary (`role="alert"`) that takes focus and links to each field; the link moves focus to the field. The messages are Persian, and the field-specific ones come from the form revision (for example «کد ملی باید ۱۰ رقم باشد.»). Success is announced in `role="status"`. |
| **lang and dir** | Pass | `<html lang="fa-IR" dir="rtl">` on moe and fars, `lang="en-CA" dir="ltr"` on main; the calendar popup carries `dir` and `lang`. Puck copies them into its preview iframe. **Open point:** short Latin runs in Persian copy (for example "Page Up" in the calendar hint) carry no `lang`; see 3.1.2 under not tested. |
| **Zoom 200% and reflow** | Pass | Viewport 640 CSS px (200% of 1280) and 320 px (1.4.10): no horizontal scroll on either home or the form; axe stays at 0 at 640 px. |
| **Normalisation** | Pass | Each case was typed with the keyboard: `علي كريمي` becomes `علی کریمی`; `۰۰۱۲٣٤٥۶۷۸` (mixed scripts) is shown as `۰۰۱۲۳۴۵۶۷۸` and stored as `0012345678`; `٠٩١٢1234567` is stored as `09121234567`; `1369/2/11` is shown as `۱۳۶۹/۰۲/۱۱` and stored as `1990-05-01`. The caret does not jump (mappings are one code unit for one). The BFF normalises a direct request the same way. |
| **No raw HTML** | Pass | The hostile `<img onerror>` and `<script>` show as text; there is no injected element and no dialog. The `javascript:` link is rendered as plain text. The `RawHtml` block renders nothing. The data also travels JSON-escaped in React's flight payload scripts, as usual for RSC. |
| **Lint** | Pass | `eslint apps/portal packages/ui`: 0 problems. `check-css.mjs`: 0 problems. `portal-rules.spec.mjs`: 27 cases, covering physical utilities with variants, physical keys in `style={{}}`, `textAlign: 'left'`, raw colours, `dangerouslySetInnerHTML` and `innerHTML` (refused), and logical utilities, `rtl:` variants and prose that says "right" (allowed). |

## 5. What was not tested

- **Screen readers.** No NVDA, JAWS, VoiceOver or TalkBack in the container. In particular, it was not heard how a Persian voice announces Jalali dates, digits, the grid and the error summary. This is the biggest gap and needs a manual session before the Phase 3 pilot.
- **Other browsers.** Chromium only.
  - Firefox does not implement `Intl.Locale#getWeekInfo` and `getTextInfo` (to be confirmed per version). The calendar would fall back to a Monday week start there.
  - Safari, mobile, touch and forced-colours mode were not run.
- **Real browser zoom and text-only zoom** (1.4.4). Text spacing (1.4.12), orientation and the language of parts (3.1.2) were not tested.
- **Fonts.** No webfont was loaded; the system fallback was used. A Persian webfont (for example Vazirmatn) is OFL-1.1, outside the ADR-0009 list, so the font choice is open.
- **ISR in production.** The build shows `revalidate: 300` per site. On-demand revalidation on publish (`revalidatePath`) and the cache behaviour across instances were not exercised.
- **CSP with nonce.** Not configured. Note that React's server-rendered `style` attributes, from Base UI and Puck, need `style-src-attr` thought.
- **Server errors in the UI.** The BFF's 422 was tested directly, not as server errors rendered back in the form through `additionalErrors`.
- **Puck.**
  - Pointer drag-and-drop in RTL, array-item editing, slots and nesting, and undo/redo were not exercised.
  - axe ran on the editor's outer document only, not inside the preview frame (whose content is the same blocks as the portal).
- **RJSF.** It was not built in this spike. The comparison in section 6 is from its API and documentation.
- **Real API, session, auth and relay allowlist.** Out of scope; fixtures replace the API.

## 6. JSON Forms vs RJSF

The spike uses **JSON Forms 3.8 (MIT)**.

| | JSON Forms 3.8 (MIT) | RJSF 6.11 (Apache-2.0) |
|---|---|---|
| Layout | A separate UI Schema document (Vertical/Horizontal layout, Group, Categorization) that the form builder can edit apart from the data schema | `uiSchema` mirrors the data shape (`ui:widget`, `ui:order`); sections and columns need custom templates. v6 adds a layout-grid field (not evaluated) |
| Conditional UI | UI Schema `rule` (SHOW, HIDE, ENABLE, DISABLE on a schema condition) | JSON Schema `dependencies` and `if`/`then`/`else` (standard, validation and visibility in one place) |
| Custom renderers | Tester-ranked registry (`rankWith`): the same pattern as our page block registry | Widgets, fields and templates per theme; easy to swap one widget |
| i18n | `translate(key)` for labels, descriptions and enum values; `translateError(error)` with per-field and per-keyword keys. Persian messages needed no ajv-i18n | `transformErrors` plus `translateString` for UI strings; labels come from the schema `title` or the `uiSchema` |
| Server reuse | `@jsonforms/core` + ajv run in the BFF and API unchanged (done here) | `@rjsf/validator-ajv8` also runs server-side |
| Ecosystem | Smaller community; the stock sets are vanilla (minimal) and Material (MUI, which conflicts with our tokens) | Larger community; many themes, all of which would conflict with our tokens |
| Pitfall found | **Controlled-data race:** passing the debounced `onChange` data back as the `data` prop resets the form to a 10 ms old state and **drops characters typed meanwhile** (reproduced: "علیکریمی", a missing digit, a lost select value). The fix is to pass the initial data only and read the live data and errors through a `middleware`, encapsulated in `SchemaForm`. | Not evaluated |

**Recommendation (not a decision; the owner left this for the Phase 2 review): JSON Forms**, for these reasons:
1. The separate layout document and rules fit a form builder that versions the UI Schema with each form revision (CLAUDE.md "Forms").
2. One registry pattern serves both pages and forms.
3. The i18n keys gave Persian messages per field with no extra library.

It comes with two conditions:
1. Phoenix owns the renderer set in `packages/ui`. That cost the spike about 210 lines of renderers plus the 300-line date picker.
2. The middleware pattern above is the only way the form is wired.

Re-open the choice if the form builder needs JSON-Schema-only conditionals (RJSF is stronger there) or if RJSF's layout grid proves enough.

## 7. Licences (ADR-0009)

| Dependency (new) | Licence | Note |
|---|---|---|
| next, react, react-dom, next-intl, @base-ui/react, @puckeditor/core, @jsonforms/*, ajv, tailwindcss, server-only | MIT | Allowed |
| Puck's transitive deps: @dnd-kit/*, @tiptap/*, @radix-ui/react-popover, **happy-dom**, zustand | MIT | Allowed. Note that Puck ships a DOM implementation (happy-dom) as a production dependency. The editor page sends 302 kB compressed JS; it lives only in studio |
| next-intl → **@swc/core** | Apache-2.0 | Allowed. It is a heavy native production dependency (the message extractor) whose install script is blocked by policy; it still built and ran |
| next → **sharp → @img/sharp-libvips-*** | **LGPL-3.0-or-later** | **Forbidden.** Excluded with `ignoredOptionalDependencies: [sharp]` in `pnpm-workspace.yaml` and `images.unoptimized` in `next.config.ts`. The licence gate then no longer lists it |
| next → browserslist → **caniuse-lite** | **CC-BY-4.0** (data) | Fails the gate. This is the open owner question of ADR-0009; `cto` approves explicitly until the Phase 1 review |
| next-intl → tslib | 0BSD | On the gate's allowed list; outside ADR-0009's closed list (same open question) |
| axe-core (dev only, test tooling) | MPL-2.0 | Dev-only; the same open question (dev-only permissive and weak-copyleft). Not shipped |

`pnpm licences` after the change fails only on `caniuse-lite`.

## 8. Puck editor: RTL findings

1. **Works:** the editor chrome mirrors (blocks on the right, fields on the left), the preview iframe gets `lang="fa-IR" dir="rtl"` without help, Persian text fields are RTL, and editing a field updates the preview at once.
2. **URLs, ISO dates and anchors display garbled.** In the default text field, `/forms/appointment` shows as `forms/appointment/` (bidi). Fixed in the spike with an LTR custom field.
3. **No keyboard way to add a block.** Drawer items are `role="button"` draggables, but Enter or Space with arrows inserts nothing. Tab also walks through every link inside the preview iframe.
4. **External font.** `puck.css` `@import`s Inter from `rsms.me`, a foreign host, which breaks offline installs and the no-foreign-SaaS rule. The fix is `@puckeditor/core/no-external.css` (used).
5. **UI strings.** The `dictionary` prop covers the chrome (Persian dictionary written for the spike). Field labels default to the prop key and the default root has an unlabelled `title` field; both are set from the catalogue. The viewport names ("Small", "Medium", "Full-width") come from the `viewports` prop and stay English unless passed.
6. **No normalisation.** `ي`/`ك` typed in the editor are stored as typed.
7. **axe:** three upstream violations (section 3).
8. **Rich text.** Puck's `richtext` field returns HTML, which the portal must never render, so it was not used.
9. **Unknown block types.** Puck shows "No configuration for X" (now translated) and keeps the node; the portal drops it.

## 9. Verdicts

| # | Risk | Verdict | Detail |
|---|---|---|---|
| R1 | RTL layout with logical CSS only | **Accepted** | Header, cards, footer, form and calendar mirror correctly; physical utilities are banned by lint (0 hits on the spike). |
| R2 | Page from a JSON tree through a registry, no raw HTML | **Design change** | Every registry entry must read props through typed readers and `safeHref`: React escapes text but not `href`, so `javascript:` would pass otherwise. Lint cannot catch this. Unknown block types fail closed. Mixed-direction data text (Latin inside Persian) reorders punctuation: give data text blocks `unicode-bidi: plaintext` (or `dir="auto"` per item) in `packages/ui`. |
| R3 | Theme inheritance down the site tree with locked tokens | **Design change** | The mechanism works (inherit, override, lock, refuse). Required: token values validated by kind; a contrast check, focus ring included, run by studio at save that blocks publish; refusals reported in studio, not as comments in the public `theme.css` as the spike does. |
| R4 | Nothing hard-coded across tenants (locale, calendar, zone, dir) | **Design change** | Proven with two tenants from `config/tenants`. Compute `dir` and the week start **on the server** (Node has full ICU) and pass them to the client, because Firefox lacks `Intl.Locale` week and text info. Allow a tenant or site override of the week start with the working calendar (ADR-0008 decision 2). |
| R5 | Jalali date input and picker | **Accepted** | In-house (`calendar.ts` on Intl, about 180 lines, plus a 300-line picker; no dependency). Tested day by day against the kernel's Temporal for 1390 to 1430 AP. Esfand 30 in common years is refused. The keyboard pattern is mirrored for RTL. |
| R6 | Persian normalisation at input | **Design change** | Works in the browser and the BFF. Move the normaliser into `packages/shared-kernel`, so the API, search and the Puck save path use the same function; normalise page content on publish, which Puck does not do. |
| R7 | Form library (JSON Forms vs RJSF) | **Accepted** as a recommendation only | Recommend JSON Forms (section 6); owner decides at the Phase 2 review. Mandatory pattern: initial-data prop plus middleware, never the debounced `onChange` fed back. |
| R8 | WCAG 2.1 AA on the portal page and form | **Accepted** | 0 axe violations in 10 states and both locales; manual checklist passes after the focus-ring fix (which is in `packages/ui`). Screen-reader testing is still owed (section 5). |
| R9 | Puck as the page-builder accelerator in RTL | **Design change** | Keep Puck in `apps/studio` only; the portal never imports it (public pages render through the registry, 132 kB JS against 302 kB with Puck). Required: an LTR field type for URLs, dates and ids; an "Add block" menu (Base UI Menu dispatching Puck's `insert` action) for keyboard users; `no-external.css`; dictionary, field labels and viewports from the catalogue; normalise on save; patch or report upstream the iframe title, the zoom select label and the loader `aria-label`. |
| R10 | Licences of the new dependencies | **Design change** | Exclude `sharp` (LGPL libvips) and run without `next/image` optimisation, or use a self-hosted image service decided later. `caniuse-lite` (CC-BY-4.0), `tslib` (0BSD) and dev-only `axe-core` (MPL-2.0) wait on the ADR-0009 owner question. |
| R11 | SSR with ISR for public pages, immutable versions | **Accepted** | Static per site with `revalidate: 300`; the version file is immutable and a pointer moves on publish. On-demand revalidation on publish is not yet proven (Phase 4). |

No risk was **rejected**.

## 10. Assets

- `poc-4-assets/01-portal-fa-rtl.png`: the fa-IR portal page (demo-fa/moe), with the hostile fixture shown as text.
- `poc-4-assets/02-portal-en-ltr.png`: the same code, en-CA and LTR, for the second tenant (demo-en/main).
- `poc-4-assets/03-form-fa-calendar.png`: the Jalali calendar opened with the keyboard, with the normalised fields and a field error.
- `poc-4-assets/04-puck-editor-rtl.png`: the Puck editor in RTL, with a Persian title just edited, the LTR URL field, and `ي ك` kept as typed.
- `poc-4-assets/results.json`: the raw output of `e2e/run.mjs` (axe results, 63 checks, Tab stops, editor probes, JS sizes).
