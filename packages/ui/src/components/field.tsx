'use client';
import { normaliseInput, type TextMode } from '@phoenix/shared-kernel/persian-text';
import { Field as BaseField } from '@base-ui/react/field';
import { Input } from '@base-ui/react/input';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

const CONTROL =
  'w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 text-sm text-fg ' +
  'placeholder:text-fg-muted transition-colors hover:border-fg-muted ' +
  'focus-visible:border-focus disabled:cursor-not-allowed disabled:opacity-50 ' +
  'data-[invalid]:border-critical';

export interface FieldProps extends Omit<ComponentProps<typeof BaseField.Root>, 'className'> {
  label: ReactNode;
  description?: ReactNode;
  /** The message shown while `invalid` is set (server-side or form-level validation). */
  error?: ReactNode;
  className?: string;
}

/** A labelled form field: label, control (the children), description and error message. */
export function Field({ label, description, error, className, children, ...props }: FieldProps) {
  return (
    <BaseField.Root className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props}>
      <BaseField.Label className="text-sm font-medium text-fg">{label}</BaseField.Label>
      {children}
      {description ? (
        <BaseField.Description className="text-xs text-fg-muted">
          {description}
        </BaseField.Description>
      ) : null}
      {error && props.invalid ? (
        <BaseField.Error className="text-xs text-critical" match>
          {error}
        </BaseField.Error>
      ) : null}
    </BaseField.Root>
  );
}

export interface TextInputProps extends Omit<ComponentProps<typeof Input>, 'className'> {
  /**
   * Persian normalisation at input (ADR-0008): `text` unifies letters and digit scripts,
   * `identifier` also turns every digit ASCII (national code, phone). Off when omitted.
   */
  normalise?: TextMode;
  className?: string;
}

type InputChangeEvent = Parameters<NonNullable<ComponentProps<typeof Input>['onChange']>>[0];

/** A single-line text input, for use inside a Field. */
export function TextInput({ normalise, onChange, className, ...props }: TextInputProps) {
  const handleChange =
    normalise === undefined
      ? onChange
      : (event: InputChangeEvent) => {
          const input = event.currentTarget;
          const normalised = normaliseInput(input.value, normalise);
          // Same length, so the caret stays where it was.
          if (normalised !== input.value) {
            const { selectionStart, selectionEnd } = input;
            input.value = normalised;
            input.setSelectionRange(selectionStart, selectionEnd);
          }
          onChange?.(event);
        };
  return <Input className={cn(CONTROL, 'h-10', className)} onChange={handleChange} {...props} />;
}

export interface TextAreaProps extends ComponentProps<'textarea'> {
  className?: string;
}

/** Multi-line text, for use inside a Field. */
export function TextArea({ className, ...props }: TextAreaProps) {
  return (
    <BaseField.Control
      render={<textarea />}
      className={cn(CONTROL, 'min-h-24 py-2', className)}
      {...(props as ComponentProps<typeof BaseField.Control>)}
    />
  );
}
