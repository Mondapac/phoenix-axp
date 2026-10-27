'use client';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CheckboxProps extends Omit<ComponentProps<typeof BaseCheckbox.Root>, 'className'> {
  label: ReactNode;
  className?: string;
}

/** A checkbox with its label. */
export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-fg', className)}
    >
      <BaseCheckbox.Root
        className="flex size-5 shrink-0 items-center justify-center rounded-[0.3rem] border border-line-strong bg-surface data-[checked]:border-accent data-[checked]:bg-accent data-[disabled]:opacity-50"
        {...props}
      >
        <BaseCheckbox.Indicator className="text-on-accent data-[unchecked]:hidden">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label}
    </label>
  );
}

export interface SwitchProps extends Omit<ComponentProps<typeof BaseSwitch.Root>, 'className'> {
  label: ReactNode;
  className?: string;
}

/** An on/off switch with its label. The thumb moves to the inline end in either direction. */
export function Switch({ label, className, ...props }: SwitchProps) {
  return (
    <label
      className={cn('inline-flex cursor-pointer items-center gap-2 text-sm text-fg', className)}
    >
      <BaseSwitch.Root
        className="relative flex h-6 w-11 shrink-0 items-center rounded-pill border border-line-strong bg-subtle p-0.5 transition-colors data-[checked]:border-accent data-[checked]:bg-accent data-[disabled]:opacity-50"
        {...props}
      >
        <BaseSwitch.Thumb className="size-[1.125rem] rounded-pill bg-surface shadow-card transition-transform data-[checked]:translate-x-5 rtl:data-[checked]:-translate-x-5" />
      </BaseSwitch.Root>
      {label}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<
  ComponentProps<typeof BaseSelect.Root<string>>,
  'items' | 'children'
> {
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/** A single-choice list. Use inside a Field for its label, or give an aria-label. */
export function Select({ options, placeholder, className, ...props }: SelectProps) {
  return (
    <BaseSelect.Root items={options} {...props}>
      <BaseSelect.Trigger
        aria-label={props['aria-label']}
        className={cn(
          'flex h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm text-fg hover:border-fg-muted data-[popup-open]:border-focus',
          className,
        )}
      >
        <BaseSelect.Value
          className="truncate data-[placeholder]:text-fg-muted"
          placeholder={placeholder}
        />
        <BaseSelect.Icon className="text-fg-muted">
          <ChevronsUpDown className="size-4" aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          sideOffset={6}
          className="z-50 outline-none"
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-control border border-line bg-raised p-1 text-sm text-fg shadow-popup">
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-[0.375rem] px-2.5 py-2 outline-none data-[highlighted]:bg-subtle data-[selected]:font-medium"
              >
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="text-accent">
                  <Check className="size-4" aria-hidden />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
