// next-intl without locale routing: the locale is a property of the site (host), set by the
// layout with setRequestLocale. There is no default locale; a page that sets none fails.
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale, locale }) => {
  const resolved = locale ?? (await requestLocale);
  if (!resolved || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(resolved)) {
    throw new Error('no locale for this request: the site layout must set it');
  }
  const catalogue = (await import(`../../messages/${resolved}.json`)) as {
    default: Record<string, unknown>;
  };
  const messages = catalogue.default;
  return { locale: resolved, messages };
});
