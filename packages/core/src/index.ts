export type { Engine, EngineConfig } from "./engine/index.js";
export { createEngine } from "./engine/index.js";
export {
  AdapterMappingError,
  AuthorizationError,
  InvalidPolicyError,
} from "./errors.js";
export type {
  AbacConfig,
  AbacPolicy,
  Condition,
  ConditionOperator,
  RbacConfig,
  RoleDefinition,
} from "./rules/index.js";
export { createAbacEvaluator, createRbacEvaluator } from "./rules/index.js";
export type {
  Action,
  Attributes,
  Context,
  Decision,
  DecisionEffect,
  EvaluationInput,
  Evaluator,
  Resource,
  Subject,
} from "./types/index.js";
