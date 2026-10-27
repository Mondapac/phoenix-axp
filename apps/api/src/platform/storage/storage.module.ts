import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { FileIntake } from './file-intake';
import { OBJECT_STORE, UnconfiguredObjectStore } from './object-store';
import type { ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';

/** Thrown at start-up in production when no malware scanner is bound (ADR-0010, ADR-0012). */
export class MalwareScannerRequiredError extends Error {
  constructor() {
    super('Production needs a malware scanner bound to MALWARE_SCANNER for file intake');
    this.name = 'MalwareScannerRequiredError';
  }
}

/**
 * Refuses a production start without a malware scanner, checks the bucket at start-up and
 * closes the S3 connections at shutdown.
 */
@Injectable()
class ObjectStoreLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FileIntake) private readonly intake: FileIntake,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.nodeEnv === 'production' && !this.intake.scans) {
      throw new MalwareScannerRequiredError();
    }
    if (this.store instanceof S3ObjectStore) {
      await this.store.ensureBucket(this.config.nodeEnv !== 'production');
    }
  }

  onApplicationShutdown(): void {
    if (this.store instanceof S3ObjectStore) this.store.destroy();
  }
}

/**
 * Object storage and file intake (ADR-0012). Binds the S3 adapter when `S3_*` is set, else a
 * store that refuses every call. Global; exports `OBJECT_STORE` and `FileIntake` only.
 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ObjectStore =>
        config.storage ? new S3ObjectStore(config.storage) : new UnconfiguredObjectStore(),
    },
    ObjectStoreLifecycle,
    FileIntake,
  ],
  exports: [OBJECT_STORE, FileIntake],
})
export class StorageModule {}
