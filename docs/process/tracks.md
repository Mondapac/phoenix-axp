# تابلوی مسیرها (board)

**revision:** 1 | **به‌روزرسانی:** ۲۰۲۶-۱۰-۲۶، مسیر `product` | **قواعد:** [parallel-tracks.md](parallel-tracks.md)، skill `phoenix-track-session`

نسخهٔ معتبر تابلو همان است که روی `origin/main` است. هر session فقط ردیف خودش و موردهای خودش را عوض می‌کند و `revision` را یکی بالا می‌برد. در speed mode روزی یک بار به‌روز می‌شود.

## فاز و `main`
| مورد | وضعیت |
|---|---|
| فاز جاری | ۰ — پایه‌گذاری؛ تصمیم نهایی صاحب پروژه: تأیید ۲۰۲۶-۱۰-۲۶ ([مرور فاز ۰](../phases/phase-0-review.md)) |
| `main` | `75fc6d4` commit اولیه |
| مدل push | Claude شاخه را push می‌کند و PR می‌سازد؛ فقط صاحب پروژه merge می‌کند |

## مسیرها
| مسیر | worktree | شاخه | PR | کار فعلی | منتظرِ |
|---|---|---|---|---|---|
| `product` | `phoenix-axp-product` | `chore/team-kit` | هنوز push نشده | برش 0.1 (کیت تیم و اسناد) و 0.2 (ADRهای پایه) | push و PR، سپس merge صاحب پروژه |
| `backend` | `phoenix-axp-backend` | `chore/skeleton` | — | برش 0.3 (اسکلت و ابزار) | ردیف را session همین مسیر به‌روز می‌کند |
| `process` | — | — | — | شروع بعد از 0.4 و 0.5 (PoC 3، برش 0.8) | برش 0.4 و 0.5 |
| `frontend` | — | — | — | شروع بعد از 0.4 و 0.5 (PoC 4، برش 0.9) | برش 0.4 و 0.5 |

## فایل‌های مشترک در دست
| فایل | مسیر | PR | از تاریخ |
|---|---|---|---|
| `CLAUDE.md`، `.claude/`، `TEAM-PLAYBOOK-fa.md`، `PLAYBOOK-fa.md`، `docs/process/`، `docs/modules/README.md`، `docs/modules/_template/`، `docs/adr/` (0001 تا 0015) | `product` | `chore/team-kit` | ۲۰۲۶-۱۰-۲۶ |
| ابزار ریشه، lockfile، CI، `docker-compose.yml`، `.env.example` | `backend` | `chore/skeleton` | ۲۰۲۶-۱۰-۲۶ (ثبت با مسیر backend) |

## شماره‌های ADR
| شماره | موضوع | مسیر | وضعیت |
|---|---|---|---|
| 0001–0015 | ADRهای پایهٔ فاز ۰ | `product` | نوشته‌شده در `chore/team-kit` |
| 0016 | پایهٔ UI پنل‌ها و صفحه‌ساز (بعد از PoC 4) | `frontend` | رزرو |
| 0017 | Objects و APIهای تولیدی (مرور فاز ۲) | `product` | رزرو |
| 0018 | آزاد بعدی | — | — |

## درخواست‌های بین مسیرها
| از | به | درخواست | تاریخ |
|---|---|---|---|
| `product` | `backend` | اسکریپت‌های `pnpm verify` و `pnpm boundaries` که در بخش Commands در `CLAUDE.md` آمده‌اند (به‌همراه بررسی مجوز وابستگی‌ها، ADR-0009) را بسازد؛ اگر نام‌ها فرق کرد، `CLAUDE.md` را در PR جدا به‌روز کند | ۲۰۲۶-۱۰-۲۶ |

## صف اقدام صاحب پروژه
| # | اقدام | مسیر | بازشده |
|---|---|---|---|
| 1 | مرور و merge PR شاخهٔ `chore/team-kit` (برش 0.1 و 0.2) | `product` | ۲۰۲۶-۱۰-۲۶ |
| 2 | پاسخ D1 مرور فاز ۰: محل و نام مخزن (پیشنهاد: `phoenix-axp`، خصوصی) | `product` | ۲۰۲۶-۱۰-۲۶ |
