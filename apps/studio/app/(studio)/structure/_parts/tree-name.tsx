import Link from 'next/link';
import { indentOf } from '../../../_lib/structure';

// A node's name in a tree list: indented by its depth, with a corner that points at its
// parent. Logical properties only, so the tree mirrors in a right-to-left tenant.

const STEP_REM = 1.25;

export function TreeName(props: {
  readonly depth: number;
  readonly name: string;
  readonly href: string;
}) {
  const indent = indentOf(props.depth);
  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      style={indent > 1 ? { paddingInlineStart: `${(indent - 1) * STEP_REM}rem` } : undefined}
    >
      {indent > 0 ? (
        <span
          aria-hidden
          className="mb-2 size-3 shrink-0 rounded-es-sm border-b border-s border-line-strong"
        />
      ) : null}
      <Link href={props.href} className="truncate font-medium text-fg hover:text-accent">
        <bdi>{props.name}</bdi>
      </Link>
    </span>
  );
}
