// Ported from Mondapac apps/api/src/platform/placeholders/bound-placeholders.ts (Mondapac
// ADR-0031), as Phoenix ADR-0010 decision 4.
import type { LoggerService } from '@nestjs/common';
import type { ModulesContainer } from '@nestjs/core';
import type { AppConfig } from '../config/app-config';
import { loadedPlaceholders, type PlaceholderMark, placeholderMarkOf } from './placeholder-markers';

/** One marked binding found in the composition root. */
export interface BoundPlaceholder extends PlaceholderMark {
  /** The bound class's name, for the log line. */
  readonly className: string;
}

/**
 * Phoenix ADR-0010 decision 4: the bound set is derived at start-up, never hand-maintained: every
 * provider of every module of the composition root (its class, for `useClass` and class
 * providers, and the prototype of its instance, for `useValue` and `useFactory`), plus every
 * marked class the process has loaded, which covers a class built inside a factory and request-
 * or transient-scoped providers (Hassan S1). A subclass of a marked class counts (S2). Sorted by
 * port, one entry per class.
 */
export function boundPlaceholders(container: ModulesContainer): readonly BoundPlaceholder[] {
  return sorted([
    ...containerPlaceholders(container),
    ...loadedPlaceholders().map(({ className, mark }) => ({ ...mark, className })),
  ]);
}

/** The marked bindings the container shows: its providers' classes and instances only. */
export function containerPlaceholders(container: ModulesContainer): readonly BoundPlaceholder[] {
  const found: BoundPlaceholder[] = [];
  for (const module of container.values()) {
    for (const wrapper of module.providers.values()) {
      const candidates: unknown[] = [wrapper.metatype];
      const instance: unknown = wrapper.instance;
      if (typeof instance === 'object' && instance !== null) {
        // The prototype, not the overridable `constructor` property (Hassan S2).
        candidates.push(
          (Object.getPrototypeOf(instance) as { constructor?: unknown } | null)?.constructor,
        );
      }
      for (const candidate of candidates) {
        const mark = placeholderMarkOf(candidate);
        if (mark === undefined) continue;
        found.push({ ...mark, className: (candidate as { name: string }).name });
      }
    }
  }
  return sorted(found);
}

function sorted(list: readonly BoundPlaceholder[]): readonly BoundPlaceholder[] {
  const unique = new Map(list.map((b) => [`${b.port}|${b.className}`, b]));
  return [...unique.values()].sort((a, b) =>
    a.port === b.port ? a.className.localeCompare(b.className) : a.port.localeCompare(b.port),
  );
}

/**
 * Phoenix ADR-0010 decision 4: a start is non-production only when `NODE_ENV` was set explicitly to
 * `development` or `test`. Unset counts as production, with no override .
 */
export function isNonProductionStart(
  environment: Pick<AppConfig, 'nodeEnv' | 'nodeEnvExplicit'>,
): boolean {
  const { nodeEnv, nodeEnvExplicit } = environment;
  return nodeEnvExplicit === true && (nodeEnv === 'development' || nodeEnv === 'test');
}

/**
 * The start-up self-check of Phoenix ADR-0010 decision 4, run by the api and the worker before they
 * serve or schedule: the bound set is always logged, and a non-empty set refuses a production
 * start. Answers whether the process may go on. Callers pass {@link boundPlaceholders}.
 */
export function placeholdersAccepted(
  bound: readonly BoundPlaceholder[],
  environment: Pick<AppConfig, 'nodeEnv' | 'nodeEnvExplicit'>,
  logger: LoggerService,
): boolean {
  if (bound.length === 0) {
    logger.log('No placeholder binding is bound (Phoenix ADR-0010)', 'PlaceholderCheck');
    return true;
  }
  const list = bound.map((b) => `${b.port} (${b.kind}: ${b.className})`).join(', ');
  if (isNonProductionStart(environment)) {
    logger.warn(
      `Placeholder bindings are bound; this build must not start in production (Phoenix ADR-0010): ${list}`,
      'PlaceholderCheck',
    );
    return true;
  }
  logger.error(
    `A production start was refused because placeholder bindings are bound (Phoenix ADR-0010 decision 4): ${list}`,
    'PlaceholderCheck',
  );
  return false;
}
