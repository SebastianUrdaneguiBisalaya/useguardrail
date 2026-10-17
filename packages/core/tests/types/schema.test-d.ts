/**
 * Type-level tests for user-defined schemas (`forSchema<S>()`): what must compile and what must
 * not. Nothing here runs; `pnpm run typecheck` fails if the typing regresses.
 */
import { expectTypeOf } from "vitest";
import type {
  ActionName,
  AuthorizationStore,
  Engine,
  EvaluationInput,
  Evaluator,
  PermissionString,
  ResourceName,
} from "../../src/index.js";
import {
  createEngine,
  createRbacEvaluator,
  createRelationGraph,
  forSchema,
} from "../../src/index.js";

type AppSchema = {
  invoice: "read" | "update" | "delete";
  user: "read" | "invite";
};

const auth = forSchema<AppSchema>();
const graph = createRelationGraph({
  tuples: [],
});
const subject = {
  id: "user:ana",
};
const context = {};

// ---- Helper types ----

expectTypeOf<ResourceName<AppSchema>>().toEqualTypeOf<"invoice" | "user">();
expectTypeOf<ActionName<AppSchema>>().toEqualTypeOf<
  "read" | "update" | "delete" | "invite"
>();
expectTypeOf<PermissionString<AppSchema>>().toEqualTypeOf<
  | "*"
  | "invoice:read"
  | "invoice:update"
  | "invoice:delete"
  | "invoice:*"
  | "user:read"
  | "user:invite"
  | "user:*"
  | "*:read"
  | "*:update"
  | "*:delete"
  | "*:invite"
>();
// Without a schema, any string (it is validated when the evaluator is created).
expectTypeOf<PermissionString>().toEqualTypeOf<string>();

// ---- RBAC permissions ----

export const rbac = auth.createRbacEvaluator({
  roles: {
    editor: {
      permissions: [
        "invoice:update",
        "user:*",
        "*:read",
        "*",
      ],
    },
  },
});
expectTypeOf(rbac).toEqualTypeOf<Evaluator<AppSchema>>();

auth.createRbacEvaluator({
  roles: {
    broken: {
      permissions: [
        // @ts-expect-error "invite" is not an invoice action
        "invoice:invite",
        // @ts-expect-error "order" is not a resource type of the schema
        "order:read",
        // @ts-expect-error not a "<type>:<action>" permission
        "nocolon",
      ],
    },
  },
});

// ---- ABAC scopes ----

export const abac = auth.createAbacEvaluator({
  policies: [
    {
      actions: [
        "read",
        "*",
      ],
      effect: "allow",
      id: "p",
      resources: [
        "invoice",
        "*",
      ],
    },
  ],
});

auth.createAbacEvaluator({
  policies: [
    {
      actions: [
        // @ts-expect-error "publish" is not an action of the schema
        "publish",
      ],
      effect: "allow",
      id: "p",
      resources: [
        // @ts-expect-error "order" is not a resource type of the schema
        "order",
      ],
    },
  ],
});

// ---- ReBAC requirements ----

export const rebac = auth.createRebacEvaluator({
  graph,
  requirements: {
    invoice: {
      read: "viewer",
      update: "editor",
    },
    user: {
      invite: "admin",
    },
  },
});

auth.createRebacEvaluator({
  graph,
  requirements: {
    invoice: {
      // @ts-expect-error "invite" is not an invoice action
      invite: "admin",
    },
  },
});
auth.createRebacEvaluator({
  graph,
  requirements: {
    // @ts-expect-error "order" is not a resource type of the schema
    order: {
      read: "viewer",
    },
  },
});

// ---- Engine and store ----

export const engine = auth.createEngine({
  evaluators: [
    rbac,
    abac,
    rebac,
  ],
});
expectTypeOf(engine).toEqualTypeOf<Engine<AppSchema>>();

engine.evaluate({
  action: "read",
  context,
  resource: {
    type: "invoice",
  },
  subject,
});
// @ts-expect-error "invite" is not an invoice action
engine.evaluate({
  action: "invite",
  context,
  resource: {
    type: "invoice",
  },
  subject,
});

export const store = auth.createAuthorizationStore({
  engine,
});
expectTypeOf(store).toEqualTypeOf<AuthorizationStore<AppSchema>>();

store.can("update", {
  id: "1",
  type: "invoice",
});
store.evaluate("invite", {
  type: "user",
});
// @ts-expect-error "invite" is not an invoice action
store.can("invite", {
  type: "invoice",
});
store.can("read", {
  // @ts-expect-error "order" is not a resource type of the schema
  type: "order",
});
// @ts-expect-error "publish" is not an action of the schema
store.can("publish", {
  type: "invoice",
});
expectTypeOf(store.can).returns.toEqualTypeOf<boolean>();

// ---- Custom evaluators receive consistent (action, resource type) pairs ----

export const custom: Evaluator<AppSchema> = (input) => {
  expectTypeOf(input.action).toEqualTypeOf<
    "read" | "update" | "delete" | "invite"
  >();
  expectTypeOf(input.resource.type).toEqualTypeOf<"invoice" | "user">();
  return undefined;
};

// A pair that mixes an action with a resource type that does not declare it is not a valid input.
declare const mismatched: {
  readonly subject: {
    readonly id: string;
  };
  readonly context: object;
  readonly action: "invite";
  readonly resource: {
    readonly type: "invoice";
  };
};
// @ts-expect-error "invite" does not belong to "invoice"
export const notAnInput: EvaluationInput<AppSchema> = mismatched;

// ---- Schema-less code keeps working next to typed code ----

const loose = createRbacEvaluator({
  roles: {
    any: {
      permissions: [
        "whatever:you-like",
      ],
    },
  },
});
// An evaluator written without a schema fits an engine that has one.
export const mixed = auth.createEngine({
  evaluators: [
    loose,
    rbac,
  ],
});

// A schema-bound evaluator does NOT fit an engine without a schema, because that engine would
// hand it requests it was never typed for.
export const wrongEngine: Engine = createEngine<Record<string, string>>({
  evaluators: [
    // @ts-expect-error Evaluator<AppSchema> needs an engine for AppSchema
    rbac,
  ],
});

// ---- Declaring a schema ----

// @ts-expect-error a schema must be declared with `type`, not `interface`
forSchema<InterfaceSchema>();
interface InterfaceSchema {
  invoice: "read";
}

// ---- Inference without forSchema ----

import {
  createAuthorizationStore,
  createEngine as createEngineDirect,
} from "../../src/index.js";

export const inferredStore = createAuthorizationStore({
  engine,
});
expectTypeOf(inferredStore).toEqualTypeOf<AuthorizationStore<AppSchema>>();

export const inferredEngine = createEngineDirect({
  evaluators: [
    rbac,
  ],
});
expectTypeOf(inferredEngine).toEqualTypeOf<Engine<AppSchema>>();

// ---- Debugging and auditing keep the schema ----

export const audited = auth.createEngine({
  evaluators: [
    rbac,
  ],
  onDecision: (event) => {
    expectTypeOf(event.input).toEqualTypeOf<EvaluationInput<AppSchema>>();
    expectTypeOf(event.decision.effect).toEqualTypeOf<"allow" | "deny">();
  },
});
export const explained = audited.explain({
  action: "read",
  context,
  resource: {
    type: "invoice",
  },
  subject,
});
expectTypeOf(explained.input).toEqualTypeOf<EvaluationInput<AppSchema>>();

// @ts-expect-error "invite" is not an invoice action
audited.explain({
  action: "invite",
  context,
  resource: {
    type: "invoice",
  },
  subject,
});

store.explain("invite", {
  type: "user",
});
// @ts-expect-error "invite" is not an invoice action
store.explain("invite", {
  type: "invoice",
});
