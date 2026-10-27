# ADR-0011: AI as a Cross-Cutting, Agentic Capability

**Status:** Accepted — 2026-10-26 (owner decision: product name Phoenix AXP, "Agentic Experience
Platform"; AI rules approved in the Phase 0 review; build in Phase 5)
**Relates to:** MondaPac ADR-0019 (AI as a cross-cutting capability), ADR-0004, ADR-0009

## Context
"Agentic" is in the product name, and customers are governments and enterprises whose decisions
carry legal weight. Some deployments (Iran) cannot use foreign model APIs at all. MondaPac's AI
rules keep model output away from decisions and access control.

## Decision
1. **Agents propose and draft; humans decide.** Model output never decides, approves or rejects a
   process task, changes a domain record, or feeds an access check, an event or a rule-based
   automation. A draft takes effect only when a user submits it through the normal use case.
2. **One model entry point:** `platform/ai/model-gateway` is the only code that calls a model;
   provider SDKs are imported only there, checked by `pnpm boundaries`.
3. **Tools are READ or DRAFT**, declared as facade methods, run with the caller's `CallContext`
   through the same `UseCaseGate`. AI has no service identity and holds no permission. Ids a
   model supplies are input and meet the ownership check. No tools under the system actor.
4. **Per-tenant switch:** every capability can be switched off per tenant (and per site where it
   applies); an error means off; with AI off, failing or out of budget the flow completes
   without it. An operator can switch AI off without a release.
5. **Provider is tenant configuration with no default** ("none" is valid). For Iran the options
   are a local model or none. External services only under a no-retention, no-training contract
   within the tenant's data-residency rules.
6. **Data handling:** files, user text and tool results are data, never instructions; output is
   schema-validated and rendered inert. Credentials, sessions and identity documents never reach
   a model; personal data only in categories the owner approves.
7. **Timing:** no AI code before Phase 5; an AI slice starts only after its host module's facade
   is merged; every AI surface needs security-tester review.

## Consequences
- AI value comes as assistance in studio and portal flows, not autonomous action.
- Each module brief lists its AI uses (section 3) and their off-path.

## Alternatives considered
- Autonomous agents with service identities: unacceptable accountability for government.
- A default provider: breaks Iran deployments and data residency.
