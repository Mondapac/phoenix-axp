import type { ReactNode } from 'react';
import './globals.css';

// The skeleton of the studio panel (slice 1.10). The tenant's language and direction come from
// the host in the next PR; until then the document is Persian, right to left.
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="bg-page text-fg">{children}</body>
    </html>
  );
}
