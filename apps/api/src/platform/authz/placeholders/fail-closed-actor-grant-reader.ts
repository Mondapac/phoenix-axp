// Phoenix ADR-0010 decision 2: the fail-closed placeholder of identity's actor-grant reader,
// bound by AuthzModule while no module binds its own.
import { Injectable } from '@nestjs/common';
import { FailClosedPlaceholder } from '../../placeholders/placeholder-markers';
import type { ActorGrant, ActorGrantReader } from '../actor-grants';

/** Always no grant: no site-scope key covers any site. Constant. */
@FailClosedPlaceholder('identity.actorGrantReader')
@Injectable()
export class FailClosedActorGrantReader implements ActorGrantReader {
  grantsOf(): Promise<readonly ActorGrant[]> {
    return Promise.resolve([]);
  }
}
