'use client';
import Link from 'next/link';
import { buttonClasses, cn, type ButtonSize, type ButtonVariant } from '@phoenix/ui';
import type { ReactNode } from 'react';

// A link that looks like a button, for server pages: `buttonClasses` lives in the client
// bundle of `@phoenix/ui`, so a server component cannot call it.

export function LinkButton(props: {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={props.href}
      className={cn(buttonClasses(props.variant, props.size), 'no-underline [&_svg]:size-4')}
    >
      {props.children}
    </Link>
  );
}
