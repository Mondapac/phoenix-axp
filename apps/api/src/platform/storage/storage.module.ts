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

/** Checks the bucket at start-up and closes the S3 connections at shutdown. */
@Injectable()
class ObjectStoreLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
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
