import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/**
 * Table primitives. The wrapper scrolls sideways on a narrow screen, so the page never does.
 * Give sibling tables the same `columns` (a <colgroup> of widths) to keep their columns aligned.
 * A numeric column sets `numeric` on its header and cells: end-aligned, tabular digits.
 */
export function Table({
  className,
  columns,
  children,
  ...props
}: ComponentProps<'table'> & { columns?: string[] }) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn('w-full border-collapse text-sm', columns && 'table-fixed', className)}
        {...props}
      >
        {columns ? (
          <colgroup>
            {columns.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-subtle', className)} {...props} />;
}

export function TableBody(props: ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-line last:border-b-0 hover:bg-subtle/60 aria-selected:bg-accent-subtle',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  numeric,
  ...props
}: ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 whitespace-nowrap px-4 text-xs font-medium text-fg-muted',
        numeric ? 'text-end' : 'text-start',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric,
  ...props
}: ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-4 py-3 align-middle text-fg',
        numeric ? 'text-end tabular-nums' : 'text-start',
        className,
      )}
      {...props}
    />
  );
}
