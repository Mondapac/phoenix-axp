'use client';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';
import { directionOf } from '../locale/locale';

/**
 * The root of a panel's client tree. `locale` is the one the server resolved from the host
 * (tenant or site setting) and already put on <html>; Base UI receives the same direction for
 * its positioning and keyboard handling. Nothing here switches direction later. `nonce` is the
 * request's CSP nonce, which Base UI puts on the few `<style>` tags it renders (a select's popup).
 */
export function UiProvider({
  locale,
  nonce,
  children,
}: {
  locale: string;
  nonce?: string;
  children: ReactNode;
}) {
  return (
    <CSPProvider nonce={nonce}>
      <DirectionProvider direction={directionOf(locale)}>
        <Tooltip.Provider delay={400}>{children}</Tooltip.Provider>
      </DirectionProvider>
    </CSPProvider>
  );
}
