# تابلوی مسیرها (board)

**revision:** 2 | **به‌روزرسانی:** ۲۰۲۶-۱۰-۲۷، مسیر `product` | **قواعد:** [parallel-tracks.md](parallel-tracks.md)، skill `phoenix-track-session`

نسخهٔ معتبر تابلو همان است که روی `origin/main` است. هر session فقط ردیف خودش و موردهای خودش را عوض می‌کند و `revision` را یکی بالا می‌برد. در speed mode روزی یک بار به‌روز می‌شود.

## فاز و `main`
| مورد | وضعیت |
|---|---|
| فاز جاری | ۱ — هسته؛ **تأیید نهایی صاحب پروژه ۲۰۲۶-۱۰-۲۷** (شروع با دستور همان روز؛ [مرور فاز ۱](../phases/phase-1-review.md)، همهٔ کارت‌های P1 تا P7 قطعی، ADR-0022) |
| فاز ۲ | فرم، BPM و objects؛ دستور شروع صاحب پروژه ۲۰۲۶-۱۰-۲۷؛ بستهٔ مرور [`phase-2-review.md`](../phases/phase-2-review.md)؛ **تأیید نهایی صاحب پروژه ۲۰۲۶-۱۰-۲۷**؛ ساخت هم‌زمان با فاز ۱ (D1)، اول 2.1، 2.2 و 2.4 |
| فاز ۰ | پایه‌گذاری؛ تأیید ۲۰۲۶-۱۰-۲۶ ([مرور فاز ۰](../phases/phase-0-review.md)). هر چهار PoC انجام و گزارش شد (PR #4)؛ PRهای #1، #2 و #4 ادغام شد؛ **بستن فاز منتظر صاحب پروژه** (۲۰۲۶-۱۰-۲۷: «هنوز نه»؛ خودشان اعلام می‌کنند) |
| `main` | `75fc6d4` commit اولیه |
| مدل push | Claude شاخه را push می‌کند و PR می‌سازد؛ رشتهٔ صاحب PR با هماهنگی هماهنگ‌کننده merge می‌کند (ADR-0021) |

## مسیرها
| مسیر | worktree | شاخه | PR | کار فعلی | منتظرِ |
|---|---|---|---|---|---|
| `product` | `phoenix-axp-product` | `chore/team-kit` | #1 | برش 0.1 و 0.2، ADR-0018 تا 0020، مرور فاز ۱ (برش 0.10)؛ اصلاحات بازبینی QA+QC | merge |
| `product` | `phoenix-axp-reports` | `docs/phase-0-poc-reports` | #4 | گزارش چهار PoC (برش 0.6 تا 0.9)، **انجام‌شده** | merge |
| `backend` | `phoenix-axp-backend` | `chore/skeleton` | #2 | برش 0.3 تا 0.5 (اسکلت، پایهٔ platform، Docker Compose) | اصلاح دروازهٔ مجوزها (ADR-0009) و بازبینی امنیتی، سپس merge |
| `backend` | `phoenix-axp-phase1` | `feat/phase-1-platform` (روی `chore/skeleton`) | #5 | برش 1.1 تا 1.3 (authz، events، audit) | بازبینی امنیتی؛ پس از merge #2 هدف PR به `main` |
| `backend` | — | `claude/project-thread-s01c02` (روی `chore/skeleton`) | #3 | برش 1.7 (storage)، ترد دیگر فاز ۱ | ادغام `main` در شاخه (merge، بدون rebase) پس از merge #5 |
| `process` | `phoenix-axp-poc-flowable` | `spike/poc-3-flowable-bridge` | — (merge نمی‌شود، D5) | PoC 3 (برش 0.8)، **انجام‌شده** @ `03c8fc8` | کار اصلی در فاز ۲ |
| `frontend` | `phoenix-axp-poc-rtl` | `spike/poc-4-rtl-portal` | — (merge نمی‌شود، D5) | PoC 4 (برش 0.9)، **انجام‌شده** @ `1fa15c0` | برش 1.9 (P7 قطعی: Vazirmatn، ADR-0022) |

## فایل‌های مشترک در دست
| فایل | مسیر | PR | از تاریخ |
|---|---|---|---|
| `CLAUDE.md`، `.claude/`، `TEAM-PLAYBOOK-fa.md`، `PLAYBOOK-fa.md`، `docs/process/`، `docs/phases/`، `docs/modules/README.md`، `docs/modules/_template/`، `docs/adr/` (0001 تا 0015، 0018 تا 0020) | `product` | `chore/team-kit` (#1) | ۲۰۲۶-۱۰-۲۶ |
| ابزار ریشه، lockfile، CI، `docker-compose.yml`، `.env.example`، `docs/platform-deferred.md` | `backend` | `chore/skeleton` (#2) | ۲۰۲۶-۱۰-۲۶ (ثبت با مسیر backend) |

## شماره‌های ADR
| شماره | موضوع | مسیر | وضعیت |
|---|---|---|---|
| 0001–0015 | ADRهای پایهٔ فاز ۰ | `product` | نوشته‌شده در `chore/team-kit` (#1) |
| 0016 | پایهٔ UI پنل‌ها: اجزای اختصاصی روی Base UI، Metronic فقط مرجع ظاهر (صفحه‌ساز در مرور فاز ۳) | `frontend` | نوشته‌شده در `claude/project-thread-fasq04` |
| 0017 | Objects و APIهای تولیدی (مرور فاز ۲) | `product` | رزرو |
| 0018 | درخت سایت، اشتراک محتوا و دامنهٔ نقش زیردرخت | `product` | نوشته‌شده در `chore/team-kit` |
| 0019 | اپراتور = کارمند با نقش، یک حساب برای هر کارمند | `product` | نوشته‌شده در `chore/team-kit` |
| 0020 | نتیجهٔ PoCهای فاز ۰ و اصلاحات بازبینی (اصلاح 0002، 0004، 0005، 0006، 0010) | `product` | نوشته‌شده در `chore/team-kit` |
| 0021 | مدل merge: رشتهٔ صاحب PR | `product` | نوشته‌شده |
| 0022 | پاسخ‌های P1 تا P7 فاز ۱ | `product` | قطعی ۲۰۲۶-۱۰-۲۷ |
| 0023 | پوستهٔ پنل، رنگ پنل و کتابخانهٔ نمودار (اصلاح 0016) | `frontend` | قطعی ۲۰۲۶-۱۰-۲۷ |
| 0024 | دسترسی سطح فیلد و مجوز عملیات برای هر تعریف (D8 مرور فاز ۲) | `product` | قطعی ۲۰۲۶-۱۰-۲۷ (معمار و CTO) |
| 0025 | آزاد بعدی | — | — |

## درخواست‌های بین مسیرها
| از | به | درخواست | تاریخ |
|---|---|---|---|
| `product` | `backend` | ~~اسکریپت‌های `pnpm verify` و `pnpm boundaries` را بسازد و اگر نام‌ها فرق کرد `CLAUDE.md` را به‌روز کند~~ انجام شد: اسکریپت‌ها در #2؛ بخش Commands در `CLAUDE.md` در #1 با آن‌ها هم‌نام شد | ۲۰۲۶-۱۰-۲۶ |
| `product` | `backend` | ردیف `check-panel-boundaries` (با اولین پنل، مسیر frontend) را به `docs/platform-deferred.md` اضافه کند | ۲۰۲۶-۱۰-۲۷ |
| `product` | `backend` | کارهای ADR-0020 در کد: FORCE RLS در migration تازه، بررسی «`tenant_id` اول هر کلید» و `@@index` در `check-prisma-boundaries`، منع `set_config(..., false)` | ۲۰۲۶-۱۰-۲۷ |
| `product` | `cto` (علی) | مخزن عمومی است (پاسخ D1): سیاست محصول اختصاصی ADR-0009 روی کد قابل‌خواندن برای همه؛ اعلان مجوز، و هیچ رمز یا دادهٔ مشتری در issue و PR | ۲۰۲۶-۱۰-۲۷ |

## صف اقدام صاحب پروژه
| # | اقدام | مسیر | بازشده |
|---|---|---|---|
| 1 | مرور و merge PR #1 (`chore/team-kit`)، سپس #2، #4 و #5 به همین ترتیب با merge commit | `product` | ۲۰۲۶-۱۰-۲۶ |
| ~~2~~ | ~~پاسخ D1 مرور فاز ۰~~ بسته شد: `Mondapac/phoenix-axp`، عمومی (۲۰۲۶-۱۰-۲۷) | `product` | ۲۰۲۶-۱۰-۲۶ |
| 3 | ~~کارت‌های مرور فاز ۱: P1 تا P7~~ **پاسخ گرفت ۲۰۲۶-۱۰-۲۷ (ADR-0022)** | `product` | ۲۰۲۶-۱۰-۲۷ |
