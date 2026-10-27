# بریف طراحی پنل‌های admin و studio بر پایهٔ Metronic 9.5.0

**تاریخ:** ۲۰۲۶-۱۰-۲۷ | **وضعیت:** تأییدشده توسط صاحب پروژه، ۲۰۲۶-۱۰-۲۷ (U1: فقط ظاهر، پایه Base UI؛ هیچ چیز از Metronic استفاده نمی‌شود). تصمیم فنی: ADR-0016.
**منبع:** پوشهٔ `Metronic - Responsive Admin Dashboard Template 9.5.0` روی لپ‌تاپ صاحب پروژه، سند پروژه «معماری پنل مدیریت و نمایش سایت»، `docs/reviews/poc-4-rtl-portal.md`، ADR-0008 و ADR-0009 و مرور فاز ۱ (برش 1.10).

## ۱. خلاصه برای صاحب پروژه

- Metronic 9.5 چند نسخه دارد. نسخهٔ مناسب ما **`metronic-tailwind-react-starter-kit/typescript/nextjs`** است، با Next.js 16، React 19 و Tailwind 4. این با پشتهٔ ما یکی است.
- اجزای آن همان مجموعهٔ **ReUI** است: shadcn روی **Radix UI**، با ۷۴ جزء. این‌ها شامل DataGrid (TanStack Table)، Tree، Stepper، Kanban، Sortable، Sheet، Dialog و Command هستند. ۳۹ چیدمان (layout) آماده هم دارد.
- **دو تصمیم مهم پیش از ساخت لازم است:**
  1. **مجوز Metronic.** مجوز Metronic تجاری است و جزو MIT یا Apache نیست. طبق یادداشت مجوز خود Metronic، هر پروژه یک مجوز می‌خواهد. برای SaaS که از کاربر نهایی پول می‌گیرد، **مجوز Extended** لازم است. Phoenix هم SaaS است و هم on-prem برای چند وزارتخانه. پس باید مجوز Extended خریده یا تأیید شود، و از نظر حقوقی روشن شود که فروش on-prem به چند مشتری را هم پوشش می‌دهد. این خارج از فهرست ADR-0009 است و یک ADR می‌خواهد.
  2. **پایهٔ UI.** در PoC ۴ پایه را **Base UI** گذاشتیم، ولی Metronic روی **Radix** ساخته شده. اگر بخواهیم «دقیقاً مثل Metronic» باشد، ساده‌ترین راه این است که اجزای ReUI را بیاوریم و پایهٔ پنل‌ها Radix شود. این در ADR-0016 (که رزرو شده) ثبت می‌شود.
- **کار RTL واقعی است ولی محدود.** در اجزای پایه ۲۴۶ کلاس فیزیکی (چپ/راست) در ۴۴ فایل هست که باید به کلاس منطقی تبدیل شوند. چیدمان‌ها از قبل تقریباً منطقی‌اند (layout-1 فقط ۳ مورد دارد). Metronic جهت صفحه را بعد از بارگذاری در مرورگر عوض می‌کند. ما باید جهت را سمت سرور، از زبان سایت، روی `<html>` بگذاریم.
- **پیشنهاد تیم:** چیدمان **layout-1** (منوی کناری و سرصفحه، همان demo1) برای هر دو پنل. درخت سایت از الگوی `sidebar-tree` در layout-34 گرفته شود، و صندوق کارها (Task Inbox) از الگوی ایمیل layout-37.

## ۲. آنچه در قالب خوانده شد

| بخش | در Metronic | یادداشت |
|---|---|---|
| ساختار پروژه | `app/` (App Router)، `components/ui` (ReUI)، `components/layouts/layout-N`، `config/layout-N.config.tsx` (منو به‌صورت داده)، `styles/globals.css` و `config.metronic.css` | منو از پیکربندی است. با «منو از کلیدهای مجوز» ما جور است. |
| چیدمان | ۳۹ layout. layout-1: منوی کناری ۲۸۰px (جمع‌شده ۸۰px)، سرصفحهٔ ۷۰px (۶۰px در موبایل)، breadcrumb، toolbar، mega-menu و footer | فاصله‌ها با `padding-inline-start` و `inset-inline-start` نوشته شده‌اند، پس منطقی و سازگار با RTL هستند. |
| منوی کناری | `AccordionMenu` با گروه و زیرمنو، نسخهٔ تیره (dark-sidebar) | |
| سرصفحه | جست‌وجو، اعلان‌ها، منوی کاربر، تغییر زبان، تغییر تم | انتخابگر سایت را اینجا اضافه می‌کنیم. |
| کارت | `Card`، `CardHeader`، `CardToolbar`، `CardContent`، `CardFooter` | |
| جدول | `DataGrid` روی TanStack Table: مرتب‌سازی، فیلتر ستون، نمایش/پنهان ستون، صفحه‌بندی، کشیدن سطر و ستون، و حالت بارگذاری با Skeleton | `text-left rtl:text-right` از قبل هست؛ باید به `text-start` تبدیل شود. |
| فرم | `Form` با react-hook-form و zod، `Input`، `Select`، `Checkbox`، `RadioGroup`، `Switch`، `Textarea`، `InputOTP`، `FileUpload`، `Calendar` (react-day-picker)، `DateField` (react-aria) | تقویم جلالی خودمان (`CalendarDateField` در PoC ۴) جای Calendar و DateField را می‌گیرد. |
| tokenها | متغیرهای shadcn: `--background`، `--foreground`، `--primary` (blue-500، در تم تیره blue-600)، `--muted`، `--accent`، `--destructive`، `--border`، `--input`، `--ring`، `--radius: 0.5rem`، `--chart-1..5`، و اندازه‌های `text-2sm` و `text-2xs` | این‌ها به tokenهای `--px-*` ما نگاشت می‌شوند (بخش ۵). |
| حالت تاریک | کلاس `.dark` با next-themes (light، dark، system) | |
| RTL | زبان عربی با `direction: 'rtl'`، `DirectionProvider` از Radix، و `rtl:` روی آیکن‌های جهت‌دار، Sheet و Switch | `dir` را i18next در مرورگر و بعد از بارگذاری عوض می‌کند. این باعث پرش صفحه می‌شود و باید سمت سرور باشد. |
| آیکن | lucide-react (ISC)، Remix Icon (Apache-2.0)، Keenicons (جزو مجوز Metronic) | پیشنهاد: فقط lucide. |
| فونت | Inter از `next/font/google` | با قاعدهٔ «بدون سرویس خارجی، نصب آفلاین» نمی‌خواند. Vazirmatn با میزبانی خودمان (P7). |
| صفحه‌های نمونه (HTML demo1) | account (پروفایل، اعضا، نقش‌ها، جدول مجوز، امنیت، نشست‌ها، لاگ امنیتی، اعلان‌ها، ظاهر، یکپارچه‌سازی)، authentication (ورود، 2FA، خطای 404 و 500)، network/user-table، public-profile/empty | این‌ها الگوی صفحه‌های ما هستند (بخش ۳). |
| Figma | `Metronic_v9.5.0.fig` (۱۴۷ مگابایت) | Figma-first فعلاً متوقف است. فقط برای مرجع. |

## ۳. نگاشت صفحه‌ها به اجزای Metronic

### ۳.۱ پوستهٔ مشترک (هر دو پنل)
| بخش پنل | الگوی Metronic | تغییر لازم |
|---|---|---|
| پوسته | layout-1: `sidebar`، `header`، `toolbar`، `breadcrumb`، `footer` | منو از کلیدهای مجوز ساخته شود. mega-menu حذف شود. |
| انتخابگر سایت (فقط studio) | `Popover` و `Command` در سرصفحه، با `Tree` (headless-tree) | فقط زیردرخت‌هایی که کاربر به آن‌ها دسترسی دارد (ADR-0018). |
| ورود | صفحهٔ `authentication/classic/sign-in` فقط به‌صورت صفحهٔ «ورود با حساب سازمانی» | فرم رمز در Keycloak است. صفحهٔ ما فقط دکمه، خطا و انتخاب روش ورود را نشان می‌دهد. |
| MFA | `authentication/classic/2fa` با `InputOTP` | فقط اگر MFA در Keycloak نباشد. |
| خطا و خالی | `error-404`، `error-500`، `public-profile/empty` | |
| اعلان‌ها | `account/notifications` و `sonner` (toast) | |
| پروفایل من و نشست‌ها | `account/home/user-profile`، `account/security/current-sessions` | |

### ۳.۲ پنل platform operator (`apps/admin`)
| صفحه | الگوی Metronic | اجزا |
|---|---|---|
| داشبورد سلامت | layout-1 dashboard (کارت‌های آماری، نمودار) | `Card`، `Badge`، نمودار Recharts |
| فهرست مستأجرها | `network/user-table/saas-users` | `DataGrid` با فیلتر و جست‌وجو |
| جزئیات مستأجر | `account/home/settings-sidebar` (تب و scrollspy) | `Tabs` یا `Scrollspy`: مشخصات، دامنه‌ها، زبان و تقویم و منطقهٔ زمانی، روش ورود (AD یا محلی)، تنظیم AI (پیش‌فرض: هیچ) |
| ساخت مستأجر | `Stepper` و `Dialog` | گام‌ها: مشخصات، دامنه، مدیر اول |
| اپراتورهای پلتفرم | `account/members/team-members-datatable` | `DataGrid` و `Dialog` |
| audit پلتفرم | `account/security/security-log` | `DataGrid` فقط‌خواندنی، و دکمهٔ «بررسی زنجیره» (audit-verify) |
| jobها و outbox | `DataGrid` با `Badge` وضعیت | فاز بعد |

### ۳.۳ پنل مستأجر (`apps/studio`)
| صفحه | فاز | الگوی Metronic | اجزا و نکته |
|---|---|---|---|
| داشبورد | ۱ | layout-1 dashboard | کارت‌های «تازه‌ترین‌ها» در زیردرخت |
| کاربران | ۱ | `user-management/users` و `team-members-datatable` | `DataGrid`، `user-add-dialog`. منبع کاربر (AD یا محلی) با `Badge` نشان داده شود. |
| جزئیات کاربر و نقش‌های او | ۱ | `user-management/users/[id]` و `account/members/roles` | `Tabs`. «اعطای نقش» در `Dialog` با انتخاب دامنه: tenant، یا سایت و سازمان با `thisSite` یا `includeDescendants` |
| نقش‌ها | ۱ | `user-management/roles` (role-list، edit، delete، default) | نقش‌های system و default قفل باشند. پیام خطای LastHolderPolicy در خود Dialog نشان داده شود. |
| ماتریس مجوز | ۱ | `account/members/permissions-toggle` و `permissions-check` | جدول نقش × کلید مجوز با `Switch` یا `Checkbox` |
| درخت سایت | ۱ | layout-34 `sidebar-tree` و `ui/tree` | دو ستون: درخت و جزئیات. ساخت زیرسایت در `Sheet`. |
| درخت سازمانی | ۱ | همان الگوی درخت | |
| همگام‌سازی AD | ۱ | `account/integrations` | کارت وضعیت و دکمهٔ «همگام‌سازی الان» (P6) |
| گزارش audit | ۱ | `account/security/security-log` و `account/activity` | `DataGrid` با فیلتر تاریخ جلالی |
| قالب سایت | ۲ تا ۴ | `account/appearance` | `ColorPicker`، پیش‌نمایش، بررسی کنتراست هنگام ذخیره (PoC ۴، R3) |
| صفحه‌ها و صفحه‌ساز | ۳ | فهرست با `DataGrid`. ویرایشگر Puck در چیدمان تمام‌صفحه بدون منوی کناری (مثل layout-24) | Puck رابط خودش را دارد. فقط قاب و نوار ابزار از Metronic می‌آید. |
| رسانه | ۳ | `FileUpload` و کارت‌های شبکه‌ای (`network/user-cards/mini-cards`) | |
| منوهای سایت | ۴ | `Sortable` و `Tree` | کشیدن و رها کردن، و جایگزین صفحه‌کلیدی |
| خبر و صف تأیید | ۴ | `DataGrid` و `Kanban` | |
| فرم‌ساز | ۲ | `Stepper`، `Tabs`، `Resizable` (سه ستون) | رندرکننده‌های JSON Forms روی اجزای ReUI |
| طراح BPMN | ۲ | چیدمان تمام‌صفحه | bpmn-js با نشان‌واره‌اش (ADR-0009) |
| صندوق کارها (Task Inbox) | ۲ | layout-37 (فهرست ایمیل و نمایش آن) | فهرست کارها و فرم کار در ستون دوم |
| تنظیمات مستأجر | ۱ | `account/home/settings-sidebar` | |

## ۴. تغییرهای لازم برای فارسی و RTL
1. **جهت سمت سرور.** `lang` و `dir` روی `<html>` از زبان سایت یا مستأجر (BFF از روی host) گذاشته شوند، نه با i18next در مرورگر. `DirectionProvider` Radix همان مقدار را بگیرد. i18next و `next-i18next` حذف شوند و به‌جایشان next-intl (همان PoC ۴) بیاید.
2. **کلاس‌های منطقی.** ۲۴۶ کلاس فیزیکی در ۴۴ فایل `components/ui` باید عوض شوند: `ml/mr` به `ms/me`، `pl/pr` به `ps/pe`، `left/right` به `start/end`، `text-left` به `text-start`، `border-l/r` به `border-s/e`، `rounded-l/r` به `rounded-s/e`. موارد مرکزگذاری (`left-1/2` با `translate-x`) جدا بررسی شوند. پس از آن lint خودمان (`check-css.mjs`) باید روی همهٔ کد بدون استثنا سبز باشد.
3. **آیکن‌های جهت‌دار.** فلش، chevron و صفحه‌بندی با `rtl:rotate-180` قرینه شوند. آیکن‌هایی که معنای جهت ندارند (مثل تیک، جست‌وجو و پخش) قرینه نشوند.
4. **فونت و تایپوگرافی.** Vazirmatn از سرور خودمان (منتظر P7). line-height متن فارسی بیشتر شود (حدود ۱٫۷). `tracking` منفی روی متن فارسی نباشد. اندازه‌های `text-2xs` (۱۱px) برای فارسی کوچک است؛ کمینه ۱۲px.
5. **ارقام و تاریخ.** ارقام فارسی با `Intl.NumberFormat` در جدول، صفحه‌بندی، `Badge` و `CountingNumber`. تاریخ‌ها با helperهای جلالی خودمان (Clock و منطقهٔ زمانی مستأجر). `Calendar` و `DateField` Metronic با `CalendarDateField` خودمان جایگزین شوند.
6. **متن دوجهته.** شناسه، ایمیل، URL، شماره تلفن و کد در `dir="ltr"` با `unicode-bidi: isolate` (یافتهٔ PoC ۴).
7. **نمودار.** Recharts در RTL محور X را برعکس کند (`reversed`) و راهنما (legend) سمت راست قرار گیرد. ApexCharts حذف شود تا فقط یک کتابخانهٔ نمودار بماند.
8. **Sheet و Drawer.** جهت باز شدن با `side="end"` و `side="start"`، نه `left` و `right`.
9. **جست‌وجو.** ورودی جست‌وجو و فیلتر DataGrid یکسان‌سازی «ي/ك»، ZWNJ و ارقام را انجام دهند (helper `text/persian.ts`).

## ۵. tokenها و حالت تاریک
- tokenهای shadcn Metronic (`--primary`، `--muted` و بقیه) با `@theme inline` به tokenهای `--px-*` ما نگاشت شوند. هیچ رنگ خام Tailwind (`blue-500`، `zinc-*`) در کد اجزا نماند.
- هر token یک مقدار روشن و یک مقدار تیره دارد. کلاس `.dark` با next-themes (پیش‌فرض: system). کنتراست هر دو تم و حلقهٔ فوکوس با axe و معیار WCAG 2.1 AA سنجیده شود.
- **پیش‌فرض پیشنهادی:** پنل‌ها رنگ ثابت محصول را دارند و فقط لوگو و نام مستأجر عوض می‌شود. tokenهای برند مستأجر فقط برای portal است.
- `--radius: 0.5rem`، ارتفاع سرصفحه، عرض منوی کناری و اندازه‌های فونت Metronic همان‌طور حفظ شوند تا ظاهر به قالب نزدیک بماند.

## ۶. مجوز وابستگی‌ها (بررسی `package-lock.json` نسخهٔ starter)
| بسته | مجوز | پیشنهاد |
|---|---|---|
| radix-ui، cmdk، sonner، vaul، motion، recharts، @tanstack/*، @dnd-kit/*، @headless-tree/*، react-hook-form، zod | MIT | مجاز |
| lucide-react | ISC | مجاز |
| react-aria-components، @remixicon/react | Apache-2.0 | مجاز. ولی پیشنهاد این است که فقط lucide بماند. |
| apexcharts 4.7.0 | MIT | حذف شود (Recharts کافی است). |
| **react-leaflet** | **Hippocratic-2.1** | **ممنوع.** نقشه نیاز نداریم؛ حذف شود. |
| sharp (libvips) از Next.js | LGPL-3.0 | مثل PoC ۴ حذف شود. |
| caniuse-lite، axe-core، lightningcss، minimatch | CC-BY-4.0، MPL-2.0، BlueOak | همان سؤال باز ADR-0009 (ابزار ساخت). |
| **کد Metronic** (layoutها، Keenicons، CSS دموها) | **مجوز تجاری Envato** | تصمیم ۱. اجزای `components/ui` از ReUI هستند که احتمالاً MIT است. این باید روی مخزن ReUI تأیید شود. |

## ۷. ترتیب کار پیشنهادی (بعد از تأیید)
1. ADR-0016: پایهٔ UI پنل‌ها (ReUI روی Radix یا Base UI)، و مجوز Metronic.
2. یک PR وابستگی: Radix و ReUI در `packages/ui`، با ذکر مجوز (قاعدهٔ ۱۲).
3. برش 1.10: پوستهٔ studio (layout-1، انتخابگر سایت، کاربران، نقش‌ها، درخت سایت و سازمان) با تبدیل کامل RTL. بررسی در ۳۷۵، ۷۶۸ و ۱۲۸۰ پیکسل، در تم روشن و تیره، با تصویر قبل و بعد.
4. پوستهٔ admin با همان اجزا.

## ۸. تصمیم‌های باز
| # | پرسش | پیشنهاد تیم |
|---|---|---|
| U1 | **روش استفاده از Metronic و مجوز آن** | **تصمیم صاحب پروژه، ۲۰۲۶-۱۰-۲۷: «فقط ظاهر، پایه Base UI».** Metronic فقط مرجع ظاهر است. هیچ کد، CSS، آیکن یا تصویر Metronic وارد مخزن نمی‌شود. ظاهر (چیدمان layout-1، فاصله‌ها، اندازه‌ها، tokenها و الگوی صفحه‌ها) روی اجزای Base UI در `packages/ui` بازسازی می‌شود. موضوع مجوز Metronic با این تصمیم منتفی است. |
| U2 | چیدمان پنل‌ها | layout-1 برای هر دو پنل، با منوی کناری روشن (تیره به‌عنوان گزینهٔ کاربر) |
| U3 | رنگ پنل‌ها | رنگ ثابت محصول، فقط لوگوی مستأجر |
| U4 | فونت (همان P7) | Vazirmatn با مجوز OFL-1.1، میزبانی روی سرور خودمان |
| U5 | آیکن و نمودار | فقط lucide و Recharts. حذف Keenicons، Remix Icon، ApexCharts و Leaflet |

U2 تا U5 پیش‌فرض‌اند و کار روی آن‌ها جلو می‌رود مگر صاحب پروژه چیز دیگری بگوید.

## ۹. پیامد تصمیم U1
- **قاعدهٔ قطعی صاحب پروژه (۲۰۲۶-۱۰-۲۷):** «هیچ چیزی از Metronic استفاده نشود و فقط ظاهر و ساختار صفحات الگو برداشته شود و عملاً همهٔ ساختار UI به‌صورت اختصاصی بازنویسی شود.» یعنی هیچ کد، CSS، فایل token، آیکن، تصویر، فونت، فایل Figma یا متن Metronic وارد مخزن یا محصول نمی‌شود. حتی کپی و ویرایش هم مجاز نیست. Metronic فقط برای نگاه کردن است: چیدمان، سلسله‌مراتب، تراکم و رفتار صفحه‌ها. کد، نام‌گذاری، tokenها و اجزا همه از خود Phoenix هستند.
- اندازه‌های بخش ۲ و ۵ (مثل عرض منوی کناری، ارتفاع سرصفحه و شعاع گوشه‌ها) فقط مرجع‌اند. مقدار نهایی در tokenهای `--px-*` خودمان تعیین می‌شود.
- بررسی هر PR پنل شامل این است که هیچ فایلی از پوشهٔ Metronic کپی نشده باشد.
- نگاشت بخش ۳ همچنان معتبر است. «الگوی Metronic» در آن یعنی مرجع ظاهر، نه کدی که کپی شود. هر جزء (DataGrid، Tree، Stepper، Sheet، Command و بقیه) روی Base UI و TanStack Table و headless-tree (MIT) خودمان ساخته می‌شود.
- Radix، ReUI، Keenicons، Remix Icon، ApexCharts و react-leaflet وارد نمی‌شوند.
- تبدیل ۲۴۶ کلاس فیزیکی بخش ۴ دیگر لازم نیست، چون کد از اول با CSS منطقی نوشته می‌شود. بقیهٔ قواعد بخش ۴ (جهت سمت سرور، فونت، ارقام، تاریخ جلالی، متن دوجهته و جست‌وجو) برقرار است.
- ADR-0016 این‌ها را ثبت می‌کند: پایهٔ UI پنل‌ها Base UI است، و Metronic فقط مرجع بصری است.
- ترتیب کار: (۱) ADR-0016؛ (۲) tokenهای ظاهری Metronic (رنگ، شعاع، اندازهٔ فونت، ارتفاع سرصفحه، عرض منوی کناری) در `packages/ui/theme`؛ (۳) پوستهٔ layout-1 و اجزای پایه روی Base UI؛ (۴) برش 1.10 در studio؛ (۵) پوستهٔ admin.
