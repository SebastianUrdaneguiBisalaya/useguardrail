import type { Engine, EngineConfig } from "./engine/index.js";
import { createEngine } from "./engine/index.js";
import type { RebacConfig } from "./relations/rebac.js";
import { createRebacEvaluator } from "./relations/rebac.js";
import type { AbacConfig } from "./rules/abac.js";
import { createAbacEvaluator } from "./rules/abac.js";
import type { RbacConfig } from "./rules/rbac.js";
import { createRbacEvaluator } from "./rules/rbac.js";
import type {
  AuthorizationStore,
  AuthorizationStoreConfig,
} from "./store/authorization.js";
import { createAuthorizationStore } from "./store/authorization.js";
import type { Evaluator, Schema } from "./types/index.js";

/** The factories of `@useguardril/core`, bound to one {@link Schema}. */
export type SchemaKit<S extends Schema> = {
  readonly createEngine: (config: EngineConfig<S>) => Engine<S>;
  readonly createRbacEvaluator: (config: RbacConfig<S>) => Evaluator<S>;
  readonly createAbacEvaluator: (config: AbacConfig<S>) => Evaluator<S>;
  readonly createRebacEvaluator: (config: RebacConfig<S>) => Evaluator<S>;
  readonly createAuthorizationStore: (
    config: AuthorizationStoreConfig<S>,
  ) => AuthorizationStore<S>;
};

/**
 * Binds every factory to your schema in one place, so actions and resources are checked at
 * compile time everywhere without repeating the type argument. At runtime these are the very
 * same functions; only the types change.
 *
 * @example
 * type AppSchema = {
 *   invoice: "read" | "update" | "delete";
 *   user: "read" | "invite";
 * };
 *
 * export const auth = forSchema<AppSchema>();
 *
 * const rbac = auth.createRbacEvaluator({
 *   roles: { editor: { permissions: ["invoice:update", "user:*"] } }, // "invoice:publish" would not compile
 * });
 * const engine = auth.createEngine({ evaluators: [rbac] });
 * const store = auth.createAuthorizationStore({ engine, subject });
 *
 * store.can("update", { type: "invoice", id }); // ok
 * store.can("invite", { type: "invoice" }); // compile error: "invite" is a user action
 */
export function forSchema<S extends Schema>(): SchemaKit<S> {
  return Object.freeze({
    createAbacEvaluator,
    createAuthorizationStore,
    createEngine,
    createRbacEvaluator,
    createRebacEvaluator,
  }) as unknown as SchemaKit<S>;
}
