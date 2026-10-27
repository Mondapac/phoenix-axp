// Today in the owning party's zone (ADR-0008 decision 2). The only wall-clock read in the
// portal; the product injects the Clock instead.
import 'server-only';
import { Temporal } from '@phoenix/shared-kernel';

export const today = (timeZone: string): string => Temporal.Now.plainDateISO(timeZone).toString();
