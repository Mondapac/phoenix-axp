// Phoenix ADR-0010 decision 2 and ADR-0025: the fail-closed placeholder of identity's role
// holding reader, bound by AuthzModule while no module binds its own.
import { Injectable } from '@nestjs/common';
import { FailClosedPlaceholder } from '../../placeholders/placeholder-markers';
import type { RoleHolding, RoleHoldingReader } from '../role-holdings';

/** Always no holding: no task queue admits anybody. Constant: it reads nothing. */
@FailClosedPlaceholder('identity.roleHoldingReader')
@Injectable()
export class FailClosedRoleHoldingReader implements RoleHoldingReader {
  holdingsOf(): Promise<readonly RoleHolding[]> {
    return Promise.resolve([]);
  }
}
