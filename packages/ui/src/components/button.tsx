'use client';
import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-classes';

export interface ButtonProps extends Omit<ComponentProps<typeof BaseButton>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * A button. An icon-only button (`size="icon"`) must carry an `aria-label`; the label comes from
 * the panel's messages, never from this component.
 */
export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return (
    <BaseButton type={type} className={cn(buttonClasses(variant, size), className)} {...props} />
  );
}
