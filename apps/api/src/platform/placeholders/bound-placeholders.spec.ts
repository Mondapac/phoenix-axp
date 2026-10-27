// Ported from Mondapac apps/api/src/platform/placeholders/bound-placeholders.spec.ts, without the
// permissive-interim cases (Phoenix ADR-0010 allows fail-closed placeholders only).
import { Injectable, Scope, type LoggerService } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { loadAppConfig } from '../config/app-config';
import {
  boundPlaceholders,
  containerPlaceholders,
  isNonProductionStart,
  placeholdersAccepted,
} from './bound-placeholders';
import { FailClosedPlaceholder, placeholderMarkOf } from './placeholder-markers';

const READER = Symbol('READER');
const OTHER = Symbol('OTHER');

@FailClosedPlaceholder('tenancy.isWithinSubtree')
@Injectable()
class UnavailableReader {
  read(): 'error' {
    return 'error';
  }
}

class RealReader {}

function recordingLogger() {
  const lines: { level: string; message: string }[] = [];
  const logger: LoggerService = {
    log: (message: string) => void lines.push({ level: 'log', message }),
    warn: (message: string) => void lines.push({ level: 'warn', message }),
    error: (message: string) => void lines.push({ level: 'error', message }),
  };
  return { lines, logger };
}

async function containerWith(
  providers: Parameters<typeof Test.createTestingModule>[0]['providers'],
) {
  const moduleRef = await Test.createTestingModule({ providers }).compile();
  return moduleRef.get(ModulesContainer);
}

const UNSET = { nodeEnv: 'development' as const, nodeEnvExplicit: false };
const EXPLICIT_TEST = { nodeEnv: 'test' as const, nodeEnvExplicit: true };
const EXPLICIT_DEVELOPMENT = { nodeEnv: 'development' as const, nodeEnvExplicit: true };
const EXPLICIT_PRODUCTION = { nodeEnv: 'production' as const, nodeEnvExplicit: true };

describe('Phoenix ADR-0010 decision 4: the bound placeholder set', () => {
  it('marks a class once, with its kind and port', () => {
    expect(placeholderMarkOf(UnavailableReader)).toEqual({
      kind: 'fail-closed-placeholder',
      port: 'tenancy.isWithinSubtree',
    });
    expect(placeholderMarkOf(RealReader)).toBeUndefined();
  });

  it('refuses a second mark and a port that is not "<module>.<method>"', () => {
    expect(() => FailClosedPlaceholder('x.y')(UnavailableReader)).toThrow(/two placeholder marks/);
    expect(() => FailClosedPlaceholder('isWithinSubtree')).toThrow(/<module>.<method>/);
    expect(() => FailClosedPlaceholder('')).toThrow(/<module>.<method>/);
  });

  it('derives the set from the composition root, however the class is bound', async () => {
    const container = await containerWith([
      { provide: READER, useClass: UnavailableReader },
      { provide: OTHER, useFactory: () => new UnavailableReader() },
      { provide: Symbol('VALUE'), useValue: new UnavailableReader() },
      RealReader,
    ]);

    expect(containerPlaceholders(container)).toEqual([
      {
        kind: 'fail-closed-placeholder',
        port: 'tenancy.isWithinSubtree',
        className: 'UnavailableReader',
      },
    ]);
  });

  it('finds nothing in a graph with real bindings only', async () => {
    const container = await containerWith([{ provide: READER, useClass: RealReader }]);
    expect(containerPlaceholders(container)).toEqual([]);
  });

  it('counts a start as non-production only with NODE_ENV explicitly development or test', () => {
    expect(isNonProductionStart(EXPLICIT_TEST)).toBe(true);
    expect(isNonProductionStart(EXPLICIT_DEVELOPMENT)).toBe(true);
    expect(isNonProductionStart(UNSET)).toBe(false);
    expect(isNonProductionStart(EXPLICIT_PRODUCTION)).toBe(false);
  });

  it('refuses a start with NODE_ENV unset and one placeholder bound, and logs the set', async () => {
    const container = await containerWith([{ provide: READER, useClass: UnavailableReader }]);
    const { lines, logger } = recordingLogger();

    expect(placeholdersAccepted(containerPlaceholders(container), UNSET, logger)).toBe(false);
    expect(lines).toEqual([
      {
        level: 'error',
        message: expect.stringContaining(
          'tenancy.isWithinSubtree (fail-closed-placeholder: UnavailableReader)',
        ) as string,
      },
    ]);
  });

  it('refuses the configuration loaded from an environment without NODE_ENV (decision 4)', async () => {
    const container = await containerWith([{ provide: READER, useClass: UnavailableReader }]);
    const config = loadAppConfig({
      HOSTED_TENANTS: 'demo-fa',
      APP_ROLE: 'api',
      DATABASE_URL: 'postgresql://user:secret@localhost:5432/db',
    });
    expect(config.nodeEnvExplicit).toBe(false);
    expect(
      placeholdersAccepted(containerPlaceholders(container), config, recordingLogger().logger),
    ).toBe(false);
  });

  it('counts a subclass of a marked class, and a class built inside a scoped factory', async () => {
    class Narrower extends UnavailableReader {}
    @FailClosedPlaceholder('identity.authorisationCheck')
    class BuiltInFactory {}
    const container = await containerWith([
      { provide: READER, useClass: Narrower },
      { provide: OTHER, useFactory: () => new BuiltInFactory(), scope: Scope.TRANSIENT },
    ]);
    expect(boundPlaceholders(container).map((b) => b.className)).toEqual(
      expect.arrayContaining(['Narrower', 'BuiltInFactory']),
    );
  });

  it('refuses an explicit production start with one placeholder bound', async () => {
    const container = await containerWith([{ provide: READER, useClass: UnavailableReader }]);
    expect(
      placeholdersAccepted(
        containerPlaceholders(container),
        EXPLICIT_PRODUCTION,
        recordingLogger().logger,
      ),
    ).toBe(false);
  });

  it('lets an explicit development or test start go on with a warning', async () => {
    const container = await containerWith([{ provide: READER, useClass: UnavailableReader }]);
    for (const environment of [EXPLICIT_TEST, EXPLICIT_DEVELOPMENT]) {
      const { lines, logger } = recordingLogger();
      expect(placeholdersAccepted(containerPlaceholders(container), environment, logger)).toBe(
        true,
      );
      expect(lines.map((l) => l.level)).toEqual(['warn']);
    }
  });

  it('lets any start go on when nothing is bound, and says so', async () => {
    const container = await containerWith([RealReader]);
    const { lines, logger } = recordingLogger();
    expect(placeholdersAccepted(containerPlaceholders(container), UNSET, logger)).toBe(true);
    expect(lines).toEqual([
      { level: 'log', message: expect.stringContaining('No placeholder') as string },
    ]);
  });
});
