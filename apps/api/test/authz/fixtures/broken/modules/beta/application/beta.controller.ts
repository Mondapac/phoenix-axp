// Ported from Mondapac apps/api/test/authz/fixtures/broken/modules/beta/application/beta.controller.ts.
import { Controller as Route } from '@nestjs/common';

/** A controller outside presentation/, under an alias (L2). */
@Route('beta')
export class BetaController {}
