import { htmlAttributes, UiProvider } from '@phoenix/ui';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { messagesFor } from './_i18n/messages';
import { tenantPresentation } from './_server/panel';
import './globals.css';

// The portal's document: the language and direction of the tenant of the host (ADR-0016
// decision 4: the server decides them, nothing switches in the browser).

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await tenantPresentation();
  return { title: `${messagesFor(tenant.defaultLocale)['app.name']} · ${tenant.displayName}` };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const tenant = await tenantPresentation();
  const { lang, dir } = htmlAttributes(tenant.defaultLocale);
  // Set by proxy.ts for this request; Next.js puts it on its own scripts.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang={lang} dir={dir}>
      <body className="bg-page text-fg">
        <UiProvider locale={tenant.defaultLocale} nonce={nonce}>
          {children}
        </UiProvider>
      </body>
    </html>
  );
}
