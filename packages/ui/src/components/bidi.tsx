import type { ComponentProps, ReactNode } from 'react';

/**
 * Left-to-right data inside right-to-left text, or the reverse: identifiers, e-mail addresses,
 * URLs, phone numbers and code. Isolated so the surrounding sentence keeps its order.
 */
export function Ltr(props: ComponentProps<'span'>) {
  return <span dir="ltr" data-bidi="isolate" {...props} />;
}

/**
 * An icon whose meaning has a direction (arrow, chevron, "back"): mirrored in right-to-left
 * pages. Icons without a direction (check, search, play) are used as they are.
 */
export function DirectionalIcon({ children }: { children: ReactNode }) {
  return <span className="inline-flex rtl:-scale-x-100">{children}</span>;
}
