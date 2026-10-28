// The portal's texts. The tenant's locale (its configuration, GET /tenancy/presentation) picks
// the language; a language without its own texts falls back to English. No text is written
// in a component.

const fa = {
  'app.name': 'پورتال',
  'signIn.title': 'ورود یا ثبت‌نام',
  'signIn.description':
    'کدی یک‌بارمصرف برایتان می‌فرستیم. اگر حساب ندارید، با همین کد ساخته می‌شود.',
  'signIn.closed.title': 'ورود به پورتال فعلاً باز نیست',
  'signIn.closed.description': 'این سازمان هنوز روش ورودی برای پورتال باز نکرده است.',
  'signIn.method': 'روش دریافت کد',
  'signIn.method.email': 'ایمیل',
  'signIn.method.mobile': 'تلفن همراه',
  'signIn.address.email': 'نشانی ایمیل',
  'signIn.address.mobile': 'شمارهٔ تلفن همراه',
  'signIn.address.mobileHint': 'شماره را با صفر اول یا با پیش‌شمارهٔ کشور بنویسید.',
  'signIn.send': 'فرستادن کد',
  'signIn.sending': 'در حال فرستادن کد…',
  'code.title': 'کد را وارد کنید',
  'code.sentTo': 'کد شش‌رقمی را به این نشانی فرستادیم:',
  'code.label': 'کد ورود',
  'code.submit': 'ورود',
  'code.checking': 'در حال بررسی…',
  'code.resend': 'فرستادن دوبارهٔ کد',
  'code.resendIn': 'فرستادن دوباره تا {seconds} ثانیهٔ دیگر',
  'code.change': 'تغییر نشانی',
  'code.resent': 'کد تازه فرستاده شد.',
  'account.title': 'حساب من',
  'account.description': 'راه‌های ورود شما به این پورتال.',
  'account.contact.email': 'ایمیل',
  'account.contact.mobile': 'تلفن همراه',
  'account.contact.unreadable': 'در دسترس نیست',
  'account.signOut': 'خروج',
  'account.signOutFailed': 'خروج انجام نشد. دوباره تلاش کنید.',
  'error.invalidAddress': 'این نشانی درست نیست. آن را بررسی کنید.',
  'error.invalidCode': 'کد درست نیست یا منقضی شده است. دوباره تلاش کنید یا کد تازه بگیرید.',
  'error.tooMany': 'تلاش‌ها زیاد بود. کمی بعد دوباره تلاش کنید.',
  'error.unavailable': 'فرستادن کد الان ممکن نیست. کمی بعد دوباره تلاش کنید.',
  'error.disabled': 'این حساب غیرفعال است. با پشتیبانی سازمان تماس بگیرید.',
  'error.captcha': 'بررسی امنیتی انجام نشد. دوباره تلاش کنید.',
  'error.generic': 'کار انجام نشد. دوباره تلاش کنید.',
  'notFound.title': 'این صفحه پیدا نشد',
  'notFound.description': 'نشانی را بررسی کنید.',
};

export type MessageKey = keyof typeof fa;
export type Messages = Readonly<Record<MessageKey, string>>;

const en: Messages = {
  'app.name': 'Portal',
  'signIn.title': 'Sign in or sign up',
  'signIn.description':
    'We send you a one-time code. If you have no account yet, the code creates one.',
  'signIn.closed.title': 'Portal sign-in is not open yet',
  'signIn.closed.description': 'This organisation has not opened a way to sign in to its portal.',
  'signIn.method': 'Send the code by',
  'signIn.method.email': 'Email',
  'signIn.method.mobile': 'Mobile phone',
  'signIn.address.email': 'Email address',
  'signIn.address.mobile': 'Mobile number',
  'signIn.address.mobileHint': 'Write the number with its leading 0 or its country code.',
  'signIn.send': 'Send code',
  'signIn.sending': 'Sending the code…',
  'code.title': 'Enter the code',
  'code.sentTo': 'We sent a six-digit code to',
  'code.label': 'Sign-in code',
  'code.submit': 'Sign in',
  'code.checking': 'Checking…',
  'code.resend': 'Send a new code',
  'code.resendIn': 'Send again in {seconds} seconds',
  'code.change': 'Change address',
  'code.resent': 'A new code is on its way.',
  'account.title': 'My account',
  'account.description': 'How you sign in to this portal.',
  'account.contact.email': 'Email',
  'account.contact.mobile': 'Mobile phone',
  'account.contact.unreadable': 'Not available',
  'account.signOut': 'Sign out',
  'account.signOutFailed': 'Sign-out failed. Try again.',
  'error.invalidAddress': 'This address is not valid. Check it.',
  'error.invalidCode': 'The code is wrong or has expired. Try again or ask for a new code.',
  'error.tooMany': 'Too many attempts. Try again a little later.',
  'error.unavailable': 'A code cannot be sent right now. Try again a little later.',
  'error.disabled': "This account is disabled. Contact the organisation's support.",
  'error.captcha': 'The security check failed. Try again.',
  'error.generic': 'That did not work. Try again.',
  'notFound.title': 'Page not found',
  'notFound.description': 'Check the address.',
};

const BY_LANGUAGE: Readonly<Record<string, Messages>> = { fa, en };

/** The texts for a locale tag, by its language; English when the language has none. */
export function messagesFor(locale: string): Messages {
  let language = 'en';
  try {
    language = new Intl.Locale(locale).language;
  } catch {
    // A malformed tag reads as English.
  }
  return BY_LANGUAGE[language] ?? en;
}

/** `text` with each `{name}` replaced by its value. */
export function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
