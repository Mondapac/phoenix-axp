// Violation: no-core-imports (twice).
import { SitesController } from '@phoenix/api/modules/tenancy';
import { AppModule } from '../../../api/src/app.module';

export const core = [SitesController, AppModule];
