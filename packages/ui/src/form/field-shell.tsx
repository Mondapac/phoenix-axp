'use client';
import { Field } from '@base-ui/react/field';
import type { ReactNode } from 'react';

/** Label, description and error around one control; Base UI Field wires the ids and aria. */
export function FieldShell({
  name,
  label,
  description,
  error,
  required,
  requiredMark,
  children,
}: {
  name: string;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  requiredMark: string;
  children: ReactNode;
}) {
  return (
    <Field.Root name={name} invalid={Boolean(error)} className="flex flex-col gap-1">
      <Field.Label className="font-semibold text-fg">
        {label}
        {required && (
          <span className="ms-1 text-critical">
            <span aria-hidden="true">*</span>
            <span className="sr-only">({requiredMark})</span>
          </span>
        )}
      </Field.Label>
      {children}
      {description && (
        <Field.Description className="text-sm text-fg-muted">{description}</Field.Description>
      )}
      {error && (
        <Field.Error match className="text-sm font-semibold text-critical">
          {error}
        </Field.Error>
      )}
    </Field.Root>
  );
}

export const controlClass =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-fg ' +
  'aria-invalid:border-critical aria-invalid:border-2';
