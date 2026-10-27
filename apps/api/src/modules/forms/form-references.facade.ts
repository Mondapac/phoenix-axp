import type { CallContext, Result } from '@phoenix/shared-kernel';
import type { AccessDenied } from '../../platform/authz';
import type { ResolvePublishedForms } from './application/use-cases/resolve-published-forms.use-case';
import type { FormReferences, PublishedFormReference } from './contracts/form-references';

/** The forms facade for references by key: every call passes the use case's gate. */
export class FormReferencesFacade implements FormReferences {
  constructor(private readonly resolve: ResolvePublishedForms) {}

  published(
    context: CallContext,
    keys: readonly string[],
  ): Promise<Result<readonly PublishedFormReference[], AccessDenied>> {
    return this.resolve.execute(context, { keys });
  }
}
