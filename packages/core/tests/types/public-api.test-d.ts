/**
 * Type-level tests for the public API of @useguardril/core.
 *
 * Nothing here runs: `pnpm run typecheck` (tsc) fails if the declared contract changes, so a
 * breaking change to the published `.d.ts` can't slip in unnoticed.
 */
import { expectTypeOf } from "vitest";
import type {
  AbacConfig,
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
  Engine,
  EngineConfig,
  ErrorCode,
  EvaluationInput,
  Evaluator,
  MessageParams,
  RbacConfig,
  RebacConfig,
  RelationGraph,
  RelationGraphConfig,
  RelationTuple,
  Resource,
  RoleDefinition,
  Store,
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

expectTypeOf(createEngine).parameter(0).toEqualTypeOf<EngineConfig>();
expectTypeOf(createEngine).returns.toEqualTypeOf<Engine>();
expectTypeOf<Engine["evaluate"]>().toEqualTypeOf<
  (input: EvaluationInput) => Decision
>();
expectTypeOf<EngineConfig["evaluators"]>().toEqualTypeOf<
  readonly Evaluator[]
>();
expectTypeOf(createRbacEvaluator).parameter(0).toEqualTypeOf<RbacConfig>();
expectTypeOf(createRbacEvaluator).returns.toEqualTypeOf<Evaluator>();
expectTypeOf(createAbacEvaluator).parameter(0).toEqualTypeOf<AbacConfig>();
expectTypeOf(createAbacEvaluator).returns.toEqualTypeOf<Evaluator>();
expectTypeOf(createRebacEvaluator).parameter(0).toEqualTypeOf<RebacConfig>();
expectTypeOf(createRebacEvaluator).returns.toEqualTypeOf<Evaluator>();
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
expectTypeOf(createAuthorizationStore)
  .parameter(0)
  .toEqualTypeOf<AuthorizationStoreConfig>();
expectTypeOf(
  createAuthorizationStore,
).returns.toEqualTypeOf<AuthorizationStore>();
expectTypeOf<AuthorizationStore["can"]>().toEqualTypeOf<
  (action: Action, resource: Resource) => boolean
>();
expectTypeOf<AuthorizationStore["evaluate"]>().toEqualTypeOf<
  (action: Action, resource: Resource) => Decision
>();
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
