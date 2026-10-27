# نقشهٔ استفاده از skillها

**مبنا:** Mondapac `docs/process/skills-map.md` (تصمیم صاحب پروژهٔ آن پروژه ۲۰۲۶-۱۰-۰۱)، تطبیق‌یافته برای Phoenix AXP، ۲۰۲۶-۱۰-۲۶.

**قاعده:** پیش از هر کار، session (یا عامل نقش) در این جدول نگاه می‌کند و skill مرتبط را **پیش از** نوشتن خروجی بارگذاری می‌کند. قوانین پروژه (`CLAUDE.md`، ADRها، مرور فاز و دروازه‌ها) همیشه مقدم‌اند؛ تعارض به علی (cto) گزارش می‌شود. اگر برای روالی تکراری skill نبود، پیشنهاد skill تازه به صاحب پروژه داده می‌شود.

**شروع و پایان هر session:** skill پروژه `phoenix-track-session`.

> skillهای اکانت (engineering، product-management، design، data، operations و…) فقط جایی حاضرند که نصب شده باشند؛ skillهای پروژه در `.claude/skills/` همیشه با مخزن می‌آیند. skillها ابزار **ساختن** پلتفرم‌اند، نه بخشی از محصول.

## ۰. skillهای پروژه (`.claude/skills/`)
| skill | کاربرد |
|---|---|
| `phoenix-phase-review` | بستهٔ مرور فاز، خلاصهٔ فارسی، کارت‌های تصمیم یکی‌یکی، ثبت پاسخ‌ها، شروع ساخت فقط بعد از تصمیم نهایی |
| `phoenix-module-gate` | برگهٔ ماژول، G1 و G2 طبق ADR-0013 |
| `phoenix-role-review` | بازبینی موازی یک پیشنهاد با نقش‌های تیم و جمع‌بندی برای صاحب پروژه |
| `phoenix-track-session` | شروع و پایان هر session، تابلو `docs/process/tracks.md`، فایل‌های مشترک، رزرو شمارهٔ ADR |
| `phoenix-repo-doc-change` | تغییر امن هر فایل مخزن: شاخه، commit، push، PR |

## ۱. تصمیم‌گیری، مرور فاز و معماری
| کار | skill | نقش |
|---|---|---|
| بستهٔ مرور فاز | `phoenix-phase-review`، `product-management:roadmap-update` | هادی، علی، جواد |
| نوشتن یا بازبینی ADR | `engineering:architecture` | علی، محمد |
| طراحی ماژول در G2 (مرز، API، داده) | `engineering:system-design` | محمد |
| برگهٔ ماژول در G1 | `product-management:write-spec` | هادی |
| بررسی ایدهٔ تازهٔ صاحب پروژه | `product-management:product-brainstorming` | هادی، محمد |
| تحلیل رقبا (Liferay، Sitecore، Adobe AEM، پورتال‌های دولتی) | `product-management:competitive-brief` | هادی |
| تغییر دامنه در وسط فاز (مرور کوچک) | `operations:change-request` | هادی، علی |
| انتخاب محصول بیرونی (Keycloak، Flowable، SeaweedFS، OpenSearch، Medusa) | `operations:vendor-review` | علی، محمد |
| نمودار برای مرور با صاحب پروژه | `artifact-diagramming`، `artifact-design` | محمد، جعفر |

## ۲. کنترل پروژه (جواد)
| کار | skill |
|---|---|
| برنامهٔ اسپرینت | `product-management:sprint-planning` |
| وضعیت روزانه | `engineering:standup` |
| گزارش به صاحب پروژه | `operations:status-report`، `product-management:stakeholder-update` |
| ارزیابی و بهبود فرایند | `operations:process-optimization` |
| ثبت ریسک | `operations:risk-assessment` (با علی) |
| RACI و SOP | `operations:process-doc` |
| بدهی فنی پایان فاز | `engineering:tech-debt` (با علی) |

## ۳. طراحی محصول و تجربهٔ کاربری
| کار | skill | نقش |
|---|---|---|
| پژوهش کاربر (کارمند سازمان، شهروند) | `design:user-research` | جعفر |
| جمع‌بندی پژوهش | `design:research-synthesis`، `product-management:synthesize-research` | جعفر، هادی |
| نقد طرح | `design:design-critique` | رضا، جعفر |
| توکن‌ها و کامپوننت‌ها (Figma-first متوقف است) | `design:design-system` | رضا |
| تحویل طرح به توسعه | `design:design-handoff` | رضا ← مهدی |
| دسترس‌پذیری WCAG 2.1 AA و RTL | `design:accessibility-review` | رضا، ساجد |
| متن رابط و پیام خطا (فارسی) | `design:ux-copy` | رضا، جعفر |

## ۴. مهندسی، کیفیت و امنیت
| کار | skill | نقش |
|---|---|---|
| استراتژی تست ماژول | `engineering:testing-strategy` | ساجد |
| مرور کد | `engineering:code-review` | علی، باقر |
| بازبینی امنیتی مسیرهای حساس | `security-review`، `engineering:code-review` | حسن |
| رفع باگ | `engineering:debug` | حسین، مهدی |
| مستندات فنی و API | `engineering:documentation` | حسین، کاظم |
| چک‌لیست انتشار | `engineering:deploy-checklist` | کاظم، باقر |
| Runbook و نصب‌کنندهٔ offline | `operations:runbook` | کاظم |
| رخداد | `engineering:incident-response` | کاظم، علی |
| انطباق (افتا، ISO 27001، حریم خصوصی) | `operations:compliance-tracking` | حسن، علی |

## ۵. داده و پایگاه داده
| کار | skill | نقش |
|---|---|---|
| کوئری، گزارش، بهینه‌سازی، RLS | `data:sql-queries`، `data:write-query` | مجتبی |
| دادهٔ نمونه و کیفیت داده | `data:explore-data`، `data:validate-data` | مجتبی، ساجد |
| شاخص‌ها و داشبورد | `product-management:metrics-review`، `data:build-dashboard`، `dataviz` | هادی، جواد |

## ۶. خروجی فایل برای صاحب پروژه
| درخواست | skill |
|---|---|
| Word، PDF، Excel، ارائه | `anthropic-skills:docx`، `anthropic-skills:pdf`، `anthropic-skills:xlsx`، `anthropic-skills:pptx` |
| ساخت یا بهبود skill پروژه | `anthropic-skills:skill-creator` |
