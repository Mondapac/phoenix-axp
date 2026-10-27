// Phoenix ADR-0010 decision 2 and ADR-0024 decision 5: the fail-closed placeholder of
// identity's field-rule reader, bound by AuthzModule while no module binds its own.
import { Injectable } from '@nestjs/common';
import { FailClosedPlaceholder } from '../../placeholders/placeholder-markers';
import type { FieldGrant, FieldRuleReader } from '../field-policy';

/**
 * Always no grant: no operation on a definition is held and every field is hidden. Constant:
 * it reads no configuration and no environment.
 */
@FailClosedPlaceholder('identity.fieldRuleReader')
@Injectable()
export class FailClosedFieldRuleReader implements FieldRuleReader {
  grantsFor(): Promise<readonly FieldGrant[]> {
    return Promise.resolve([]);
  }
}
