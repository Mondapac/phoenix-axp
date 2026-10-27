import { Injectable } from '@nestjs/common';
import type { Id, Temporal, TenantContext } from '@phoenix/shared-kernel';
import type { SubjectKeyStore } from '../../subject-keys/subject-key-store';
import { PrismaService } from '../prisma.service';

const dateOf = (instant: Temporal.Instant): Date => new Date(instant.epochMilliseconds);

/** `platform.subject_key` through `tx(tenant)`, in the caller's unit. */
@Injectable()
export class PrismaSubjectKeyStore implements SubjectKeyStore {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    tenant: TenantContext,
    key: {
      readonly subjectId: Id<string>;
      readonly module: string;
      readonly wrappedKey: Uint8Array;
    },
    at: Temporal.Instant,
  ): Promise<void> {
    await this.prisma.tx(tenant).subjectKey.create({
      data: {
        tenantId: tenant.tenantId,
        subjectId: key.subjectId,
        module: key.module,
        wrappedKey: Uint8Array.from(key.wrappedKey),
        createdAt: dateOf(at),
      },
    });
  }

  async wrappedKeys(
    tenant: TenantContext,
    subjectIds: readonly Id<string>[],
  ): Promise<ReadonlyMap<string, Uint8Array | null>> {
    if (subjectIds.length === 0) return new Map();
    const rows = await this.prisma.tx(tenant).subjectKey.findMany({
      where: { tenantId: tenant.tenantId, subjectId: { in: [...subjectIds] } },
      select: { subjectId: true, wrappedKey: true },
    });
    return new Map(rows.map((row) => [row.subjectId, row.wrappedKey]));
  }

  async destroy(
    tenant: TenantContext,
    subjectId: Id<string>,
    at: Temporal.Instant,
  ): Promise<boolean> {
    const { count } = await this.prisma.tx(tenant).subjectKey.updateMany({
      where: { tenantId: tenant.tenantId, subjectId, destroyedAt: null },
      data: { wrappedKey: null, destroyedAt: dateOf(at) },
    });
    return count === 1;
  }
}
