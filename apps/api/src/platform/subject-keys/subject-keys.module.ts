import { Global, Module } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { PrismaSubjectKeyStore } from '../persistence/subject-keys/prisma-subject-key-store';
import { SubjectKeyCipher } from './subject-key-cipher';
import { SUBJECT_KEY_STORE, type SubjectKeyStore } from './subject-key-store';
import { SUBJECT_KEY_SERVICE, SubjectKeyService } from './subject-key.service';

/**
 * Per-subject keys for personal data (ADR-0003, ADR-0007; ADR-0010 trigger: the first
 * personal-data field, form answers in slice 2.5). The KEK comes from `SUBJECT_KEY_KEK`;
 * without it (outside production only) the service refuses every seal and open. Global;
 * exports `SUBJECT_KEY_SERVICE` only.
 */
@Global()
@Module({
  providers: [
    { provide: SUBJECT_KEY_STORE, useClass: PrismaSubjectKeyStore },
    {
      provide: SUBJECT_KEY_SERVICE,
      inject: [APP_CONFIG, SUBJECT_KEY_STORE],
      useFactory: (config: AppConfig, store: SubjectKeyStore) =>
        new SubjectKeyService(new SubjectKeyCipher(config.subjectKeyKek), store),
    },
  ],
  exports: [SUBJECT_KEY_SERVICE],
})
export class SubjectKeysModule {}
