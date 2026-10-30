'use client';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { X } from 'lucide-react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { buttonClasses } from './button-classes';

const POPUP = 'rounded-card border border-line bg-raised text-fg shadow-popup outline-none';
const BACKDROP =
  'fixed inset-0 z-40 bg-overlay transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0';

// Dialog -------------------------------------------------------------------------------------

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  /** The accessible name of the close button, from the panel's messages. */
  closeLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function DialogHeading({ title, description, closeLabel }: DialogContentProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0 space-y-1">
        <BaseDialog.Title className="text-base font-semibold">{title}</BaseDialog.Title>
        {description ? (
          <BaseDialog.Description className="text-sm text-fg-muted">
            {description}
          </BaseDialog.Description>
        ) : null}
      </div>
      <BaseDialog.Close aria-label={closeLabel} className={buttonClasses('ghost', 'icon-sm')}>
        <X aria-hidden />
      </BaseDialog.Close>
    </div>
  );
}

/** A modal dialog, centred; full width less the gutter on a phone. */
export function DialogContent(props: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={BACKDROP} />
      <BaseDialog.Popup
        className={cn(
          POPUP,
          'fixed inset-x-0 top-1/2 z-50 mx-auto flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-y-1/2 flex-col',
          'transition-[opacity,scale] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
          props.className,
        )}
      >
        <DialogHeading {...props} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">{props.children}</div>
        {props.footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
            {props.footer}
          </div>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

/** A panel that slides in from the inline start or end edge (never "left" or "right"). */
export function SheetContent({
  side = 'end',
  ...props
}: DialogContentProps & { side?: 'start' | 'end' }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={BACKDROP} />
      <BaseDialog.Popup
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-50 flex w-[min(24rem,calc(100vw-3rem))] flex-col border-line bg-raised text-fg shadow-popup outline-none transition-transform',
          side === 'end' ? 'end-0 border-s' : 'start-0 border-e',
          side === 'end'
            ? 'data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full rtl:data-[starting-style]:-translate-x-full rtl:data-[ending-style]:-translate-x-full'
            : 'data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full rtl:data-[starting-style]:translate-x-full rtl:data-[ending-style]:translate-x-full',
          props.className,
        )}
      >
        <DialogHeading {...props} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">{props.children}</div>
        {props.footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
            {props.footer}
          </div>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

// Menu ---------------------------------------------------------------------------------------

export const Menu = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

export function MenuContent({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={6} align={align} className="z-50">
        <BaseMenu.Popup className={cn(POPUP, 'min-w-48 p-1 text-sm', className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseMenu.Item>, 'className'> & { className?: string }) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-[0.375rem] px-2.5 py-2 outline-none data-[highlighted]:bg-subtle data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="my-1 h-px bg-line" />;
}

export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <BaseMenu.Group>
      <BaseMenu.GroupLabel className="px-2.5 py-1.5 text-xs font-medium text-fg-muted">
        {children}
      </BaseMenu.GroupLabel>
    </BaseMenu.Group>
  );
}

// Popover ------------------------------------------------------------------------------------

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;

export function PopoverContent({
  children,
  align = 'center',
  className,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner sideOffset={8} align={align} className="z-50">
        <BasePopover.Popup
          className={cn(POPUP, 'w-72 max-w-[calc(100vw-2rem)] p-4 text-sm', className)}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

// Tooltip ------------------------------------------------------------------------------------

/** A short hint on hover and focus. The trigger keeps its own accessible name. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="rounded-control bg-fg px-2.5 py-1.5 text-xs text-page shadow-popup">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
