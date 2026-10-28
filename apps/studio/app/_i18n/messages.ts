// The studio's texts. The tenant's locale (its configuration, GET /tenancy/presentation) picks
// the language; a language without its own texts falls back to English. No text is written
// in a component.

const fa = {
  'app.name': 'استودیو',
  'shell.nav': 'منوی اصلی',
  'shell.openMenu': 'باز کردن منو',
  'shell.closeMenu': 'بستن منو',
  'shell.collapseMenu': 'جمع کردن منو',
  'shell.expandMenu': 'باز کردن منو',
  'menu.home': 'پیشخوان',
  'menu.people': 'کارکنان و نقش‌ها',
  'menu.accounts': 'کاربران',
  'menu.roles': 'نقش‌ها',
  'menu.structure': 'ساختار',
  'menu.sites': 'سایت‌ها',
  'menu.organizations': 'نمودار سازمانی',
  'site.label': 'سایت جاری',
  'site.placeholder': 'انتخاب سایت',
  'account.menu': 'حساب کاربری',
  'account.signOut': 'خروج',
  'account.signOutFailed': 'خروج انجام نشد. دوباره تلاش کنید.',
  'signIn.title': 'ورود کارکنان',
  'signIn.description': 'با حساب سازمانی خود وارد شوید.',
  'signIn.action': 'ورود',
  'signIn.error.unavailable': 'ورود الان در دسترس نیست. کمی بعد دوباره تلاش کنید.',
  'signIn.error.refused': 'ورود انجام نشد. دوباره تلاش کنید.',
  'home.title': 'خوش آمدید',
  'home.description': 'بخشی را از منو انتخاب کنید.',
  'notFound.title': 'این صفحه پیدا نشد',
  'notFound.description': 'نشانی را بررسی کنید یا از منو بخش دیگری را انتخاب کنید.',
  'notFound.home': 'بازگشت به پیشخوان',
} as const;

export type MessageKey = keyof typeof fa;
export type Messages = Readonly<Record<MessageKey, string>>;

const en: Messages = {
  'app.name': 'Studio',
  'shell.nav': 'Main menu',
  'shell.openMenu': 'Open menu',
  'shell.closeMenu': 'Close menu',
  'shell.collapseMenu': 'Collapse menu',
  'shell.expandMenu': 'Expand menu',
  'menu.home': 'Dashboard',
  'menu.people': 'People and roles',
  'menu.accounts': 'Users',
  'menu.roles': 'Roles',
  'menu.structure': 'Structure',
  'menu.sites': 'Sites',
  'menu.organizations': 'Organization chart',
  'site.label': 'Current site',
  'site.placeholder': 'Choose a site',
  'account.menu': 'Account',
  'account.signOut': 'Sign out',
  'account.signOutFailed': 'Sign-out did not complete. Try again.',
  'signIn.title': 'Staff sign-in',
  'signIn.description': 'Sign in with your organisation account.',
  'signIn.action': 'Sign in',
  'signIn.error.unavailable': 'Sign-in is unavailable right now. Try again shortly.',
  'signIn.error.refused': 'Sign-in did not complete. Try again.',
  'home.title': 'Welcome',
  'home.description': 'Choose a section from the menu.',
  'notFound.title': 'Page not found',
  'notFound.description': 'Check the address or choose another section from the menu.',
  'notFound.home': 'Back to the dashboard',
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

/** Whether `key` names a studio text (menu labels arrive as strings). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(fa, key);
}
