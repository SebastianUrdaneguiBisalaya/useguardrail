/**
 * Type-level tests for the public API of @useguardril/core.
 *
 * Nothing here runs: `pnpm run typecheck` (tsc) fails if the declared contract changes, so a
 * breaking change to the published `.d.ts` can't slip in unnoticed.
 */
import { expectTypeOf } from "vitest";
import type {
  AbacPolicy,
  Action,
  AuthorizationLoader,
  AuthorizationLoadResult,
  AuthorizationState,
  AuthorizationStatus,
  AuthorizationStore,
  AuthorizationStoreConfig,
  Condition,
  ConditionOperator,
  Context,
  Decision,
  DecisionCode,
  DecisionEffect,
  DecisionEvent,
  Engine,
  EngineConfig,
  ErrorCode,
  EvaluationInput,
  Evaluator,
  EvaluatorOutcome,
  EvaluatorTrace,
  MessageParams,
  RbacConfig,
  RelationGraph,
  RelationGraphConfig,
  RelationTuple,
  Resource,
  RoleDefinition,
  Store,
  StoreDecisionEvent,
  Subject,
} from "../../src/index.js";
import {
  type AdapterMappingError,
  type AuthorizationError,
  createAbacEvaluator,
  createAuthorizationStore,
  createContext,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
  createStore,
  type DECISION_CODES,
  type ERROR_CODES,
  evaluateState,
  type InvalidContextError,
  type InvalidPolicyError,
} from "../../src/index.js";

declare const engine: Engine;

// ---- Domain types ----

expectTypeOf<Action>().toEqualTypeOf<string>();
expectTypeOf<DecisionEffect>().toEqualTypeOf<"allow" | "deny">();
expectTypeOf<Decision["effect"]>().toEqualTypeOf<DecisionEffect>();
expectTypeOf<Decision["reason"]>().toEqualTypeOf<string>();
expectTypeOf<Decision["code"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<Decision["params"]>().toEqualTypeOf<MessageParams | undefined>();
expectTypeOf<Evaluator>().toEqualTypeOf<
  (input: EvaluationInput) => Decision | undefined
>();
expectTypeOf<EvaluationInput>().toHaveProperty("subject");
expectTypeOf<EvaluationInput["subject"]>().toEqualTypeOf<Subject>();
expectTypeOf<EvaluationInput["resource"]>().toEqualTypeOf<Resource>();
expectTypeOf<EvaluationInput["context"]>().toEqualTypeOf<Context>();
expectTypeOf<Subject["id"]>().toEqualTypeOf<string>();
expectTypeOf<Subject["roles"]>().toEqualTypeOf<readonly string[] | undefined>();
expectTypeOf<Context["tenantId"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<MessageParams>().toEqualTypeOf<
  Readonly<Record<string, string | number | boolean | readonly string[]>>
>();

// Inputs are immutable by type.
declare const subject: Subject;
// @ts-expect-error Subject is readonly
subject.id = "other";

export const _badDecision: Decision = {
  // @ts-expect-error "maybe" is not an effect
  effect: "maybe",
  reason: "x",
};

// ---- Codes ----

expectTypeOf<ErrorCode>().toEqualTypeOf<(typeof ERROR_CODES)[number]>();
expectTypeOf<DecisionCode>().toEqualTypeOf<(typeof DECISION_CODES)[number]>();
expectTypeOf<"ROLE_INHERITANCE_CYCLE">().toExtend<ErrorCode>();
expectTypeOf<"NOT_A_CODE">().not.toExtend<ErrorCode>();
expectTypeOf<"ROLE_GRANTS">().toExtend<DecisionCode>();
expectTypeOf<"NOT_A_CODE">().not.toExtend<DecisionCode>();

// ---- Errors ----

expectTypeOf<AuthorizationError["code"]>().toEqualTypeOf<ErrorCode>();
expectTypeOf<AuthorizationError["params"]>().toEqualTypeOf<MessageParams>();
expectTypeOf<InvalidPolicyError>().toExtend<AuthorizationError>();
expectTypeOf<InvalidContextError>().toExtend<AuthorizationError>();
expectTypeOf<AdapterMappingError>().toExtend<AuthorizationError>();
expectTypeOf<AuthorizationError>().toExtend<Error>();

// ---- Engine and evaluators ----

expectTypeOf<Engine["evaluate"]>().toEqualTypeOf<
  (input: EvaluationInput) => Decision
>();
expectTypeOf<EngineConfig["evaluators"]>().toExtend<readonly Evaluator[]>();
expectTypeOf<RbacConfig["roles"]>().toEqualTypeOf<
  Readonly<Record<string, RoleDefinition>>
>();
expectTypeOf<ConditionOperator>().toEqualTypeOf<
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists"
>();
expectTypeOf<AbacPolicy["effect"]>().toEqualTypeOf<"allow" | "deny">();
expectTypeOf<Condition["op"]>().toEqualTypeOf<ConditionOperator>();

// The factories are generic over a schema; without one they take and return the loose types.
declare const looseEngine: Engine;
declare const looseGraph: RelationGraph;
expectTypeOf(
  createEngine({
    evaluators: [],
  }),
).toEqualTypeOf<Engine>();
expectTypeOf(
  createRbacEvaluator({
    roles: {},
  }),
).toEqualTypeOf<Evaluator>();
expectTypeOf(
  createAbacEvaluator({
    policies: [],
  }),
).toEqualTypeOf<Evaluator>();
expectTypeOf(
  createRebacEvaluator({
    graph: looseGraph,
    requirements: {},
  }),
).toEqualTypeOf<Evaluator>();
expectTypeOf(
  createAuthorizationStore({
    engine: looseEngine,
  }),
).toEqualTypeOf<AuthorizationStore>();

createEngine({
  // @ts-expect-error evaluators must be an array
  evaluators: "nope",
});
export const _badCondition: Condition = {
  field: "subject.id",
  // @ts-expect-error unknown operator
  op: "like",
  value: 1,
};
// @ts-expect-error an ABAC policy needs an id
export const _noId: AbacPolicy = {
  effect: "allow",
};

// ---- Relations ----

expectTypeOf(createRelationGraph)
  .parameter(0)
  .toEqualTypeOf<RelationGraphConfig>();
expectTypeOf(createRelationGraph).returns.toEqualTypeOf<RelationGraph>();
expectTypeOf<RelationGraph["check"]>().toEqualTypeOf<
  (subject: string, relation: string, object: string) => boolean
>();
expectTypeOf<RelationTuple>().toEqualTypeOf<{
  readonly object: string;
  readonly relation: string;
  readonly subject: string;
}>();

// ---- Context and plain store ----

expectTypeOf(createContext).returns.toEqualTypeOf<Context>();
expectTypeOf(createStore<number>).returns.toEqualTypeOf<Store<number>>();
expectTypeOf<Store<number>["getSnapshot"]>().toEqualTypeOf<() => number>();
expectTypeOf<Store<number>["getInitialSnapshot"]>().toEqualTypeOf<
  () => number
>();
expectTypeOf<ReturnType<Store<number>["subscribe"]>>().toEqualTypeOf<
  () => void
>();

// ---- Authorization store ----

expectTypeOf<AuthorizationStatus>().toEqualTypeOf<
  "loading" | "ready" | "error"
>();
expectTypeOf<keyof AuthorizationState>().toEqualTypeOf<
  "context" | "engine" | "subject" | "status" | "error"
>();
expectTypeOf<AuthorizationState["subject"]>().toEqualTypeOf<
  Subject | undefined
>();
expectTypeOf<AuthorizationState["error"]>().toEqualTypeOf<unknown>();
expectTypeOf<AuthorizationStoreConfig["status"]>().toEqualTypeOf<
  "loading" | "ready" | undefined
>();
expectTypeOf(
  createAuthorizationStore,
).returns.toEqualTypeOf<AuthorizationStore>();
// Without a schema the store accepts any action and resource type (and stays generic over them).
declare const looseStore: AuthorizationStore;
expectTypeOf(looseStore.can).toBeCallableWith("anything", {
  type: "anything",
});
expectTypeOf(looseStore.can).returns.toEqualTypeOf<boolean>();
expectTypeOf(looseStore.evaluate).toBeCallableWith("anything", {
  id: "1",
  type: "anything",
});
expectTypeOf(looseStore.evaluate).returns.toEqualTypeOf<Decision>();
expectTypeOf<AuthorizationStore["getSnapshot"]>().toEqualTypeOf<
  () => AuthorizationState
>();
expectTypeOf<AuthorizationStore["getInitialSnapshot"]>().toEqualTypeOf<
  () => AuthorizationState
>();
expectTypeOf<AuthorizationStore["load"]>().toEqualTypeOf<
  (loader: AuthorizationLoader) => Promise<void>
>();
expectTypeOf<AuthorizationStore["setStatus"]>()
  .parameter(0)
  .toEqualTypeOf<"loading" | "ready">();
expectTypeOf<AuthorizationStore["setSubject"]>()
  .parameter(0)
  .toEqualTypeOf<Subject | undefined>();
expectTypeOf<AuthorizationLoadResult["subject"]>().toEqualTypeOf<
  Subject | undefined
>();
expectTypeOf<
  Parameters<AuthorizationLoader>[0]["signal"]
>().toEqualTypeOf<AbortSignal>();
expectTypeOf(evaluateState).returns.toEqualTypeOf<Decision>();

// @ts-expect-error an engine is required
createAuthorizationStore({});
createAuthorizationStore({
  engine,
  // @ts-expect-error "idle" is not a status
  status: "idle",
});
declare const store: AuthorizationStore;
// @ts-expect-error "error" is set with setError, not setStatus
store.setStatus("error");

// ---- Debugging and auditing ----

expectTypeOf<EvaluatorOutcome>().toEqualTypeOf<
  "allow" | "deny" | "abstain" | "threw" | "malformed"
>();
expectTypeOf<EvaluatorTrace["index"]>().toEqualTypeOf<number>();
expectTypeOf<EvaluatorTrace["outcome"]>().toEqualTypeOf<EvaluatorOutcome>();
expectTypeOf<EvaluatorTrace["decision"]>().toEqualTypeOf<
  Decision | undefined
>();
expectTypeOf<EvaluatorTrace["error"]>().toEqualTypeOf<unknown>();
expectTypeOf<DecisionEvent["input"]>().toEqualTypeOf<EvaluationInput>();
expectTypeOf<DecisionEvent["decision"]>().toEqualTypeOf<Decision>();
expectTypeOf<DecisionEvent["trace"]>().toEqualTypeOf<
  readonly EvaluatorTrace[]
>();
expectTypeOf<Engine["explain"]>().toEqualTypeOf<
  (input: EvaluationInput) => DecisionEvent
>();
expectTypeOf<EngineConfig["onDecision"]>().toEqualTypeOf<
  ((event: DecisionEvent) => void) | undefined
>();
expectTypeOf<AuthorizationStoreConfig["onDecision"]>().toEqualTypeOf<
  ((event: StoreDecisionEvent) => void) | undefined
>();
expectTypeOf<
  StoreDecisionEvent["status"]
>().toEqualTypeOf<AuthorizationStatus>();
expectTypeOf<StoreDecisionEvent["subject"]>().toEqualTypeOf<
  Subject | undefined
>();
expectTypeOf<StoreDecisionEvent["trace"]>().toEqualTypeOf<
  readonly EvaluatorTrace[]
>();
expectTypeOf(looseStore.explain).toBeCallableWith("anything", {
  type: "anything",
});
expectTypeOf(looseStore.explain).returns.toEqualTypeOf<StoreDecisionEvent>();

createEngine({
  evaluators: [],
  // @ts-expect-error the hook receives an event, not a number
  onDecision: (event: number) => event,
});
