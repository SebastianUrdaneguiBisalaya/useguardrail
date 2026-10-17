import { bench, describe } from "vitest";
import type {
  AbacPolicy,
  EvaluationInput,
  RelationTuple,
  RoleDefinition,
} from "../../src/index.js";
import {
  createAbacEvaluator,
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
  createStore,
} from "../../src/index.js";

const input: EvaluationInput = {
  action: "update",
  context: {
    tenantId: "acme",
  },
  resource: {
    attributes: {
      department: "sales",
      status: "open",
    },
    id: "42",
    type: "invoice",
  },
  subject: {
    attributes: {
      age: 30,
      department: "sales",
    },
    id: "user:ana",
    roles: [
      "role-499",
    ],
  },
};

const ABAC_POLICIES = 1_000;
const policies: AbacPolicy[] = Array.from(
  {
    length: ABAC_POLICIES,
  },
  (_, i) => ({
    actions: [
      "read",
      "update",
      "delete",
    ],
    conditions: [
      {
        field: "resource.attributes.status",
        op: "eq",
        value: `s-${i}`,
      },
      {
        field: "subject.attributes.department",
        op: "eq",
        valueFrom: "resource.attributes.department",
      },
    ],
    effect: i % 2 === 0 ? "allow" : "deny",
    id: `policy-${i}`,
    resources: [
      "invoice",
    ],
  }),
);
const abac = createAbacEvaluator({
  policies,
});

const RESOURCE_TYPES = 50;
const ACTIONS = [
  "read",
  "update",
  "delete",
  "create",
];
const spreadPolicies: AbacPolicy[] = Array.from(
  {
    length: ABAC_POLICIES,
  },
  (_, i) => ({
    actions: [
      ACTIONS[Math.floor(i / RESOURCE_TYPES) % ACTIONS.length] as string,
    ],
    conditions: [
      {
        field: "resource.attributes.status",
        op: "eq",
        value: `s-${i}`,
      },
      {
        field: "subject.attributes.department",
        op: "eq",
        valueFrom: "resource.attributes.department",
      },
    ],
    effect: i % 2 === 0 ? "allow" : "deny",
    id: `spread-${i}`,
    resources: [
      i % RESOURCE_TYPES === 0 ? "invoice" : `type-${i % RESOURCE_TYPES}`,
    ],
  }),
);
const abacSpread = createAbacEvaluator({
  policies: spreadPolicies,
});

const ROLES = 500;
const roles: Record<string, RoleDefinition> = {};
for (let i = 0; i < ROLES; i += 1) {
  roles[`role-${i}`] = {
    permissions: [
      `resource-${i}:read`,
    ],
    ...(i > 0
      ? {
          inherits: [
            `role-${i - 1}`,
          ],
        }
      : {}),
  };
}
roles["role-0"] = {
  permissions: [
    "invoice:update",
  ],
};

const DEPTH = 12;
const tuples: RelationTuple[] = [
  {
    object: "folder:0",
    relation: "viewer",
    subject: "user:ana",
  },
];
for (let i = 1; i <= DEPTH; i += 1) {
  tuples.push({
    object: `folder:${i}`,
    relation: "parent",
    subject: `folder:${i - 1}`,
  });
}
tuples.push({
  object: "invoice:42",
  relation: "parent",
  subject: `folder:${DEPTH}`,
});
for (let i = 0; i < 5_000; i += 1) {
  tuples.push({
    object: `invoice:${i + 100}`,
    relation: "viewer",
    subject: `user:other-${i}`,
  });
}
const graph = createRelationGraph({
  rules: {
    viewer: {
      inheritFrom: [
        {
          relation: "viewer",
          via: "parent",
        },
      ],
    },
  },
  tuples,
});

const rbac = createRbacEvaluator({
  roles,
});
const rebac = createRebacEvaluator({
  graph,
  requirements: {
    invoice: {
      update: "viewer",
    },
  },
});
const engine = createEngine({
  evaluators: [
    rbac,
    abac,
    rebac,
  ],
});

describe("evaluation", () => {
  bench(`ABAC: ${ABAC_POLICIES} policies, none match`, () => {
    abac(input);
  });

  bench(
    `ABAC: ${ABAC_POLICIES} policies spread over ${RESOURCE_TYPES} types x ${ACTIONS.length} actions`,
    () => {
      abacSpread(input);
    },
  );

  bench(`RBAC: ${ROLES}-role inheritance chain, role at the top`, () => {
    rbac(input);
  });

  bench(`ReBAC: ${DEPTH}-deep parent chain, ${tuples.length} tuples`, () => {
    graph.check("user:ana", "viewer", "invoice:42");
  });

  bench("ReBAC: negative lookup walks the whole chain", () => {
    graph.check("user:nobody", "viewer", "invoice:42");
  });

  bench("engine: RBAC + ABAC + ReBAC combined", () => {
    engine.evaluate(input);
  });
});

describe("construction", () => {
  bench(`RBAC: build ${ROLES} roles`, () => {
    createRbacEvaluator({
      roles,
    });
  });

  bench(`ABAC: compile ${ABAC_POLICIES} policies`, () => {
    createAbacEvaluator({
      policies,
    });
  });

  bench(`ReBAC: index ${tuples.length} tuples`, () => {
    createRelationGraph({
      tuples,
    });
  });
});

describe("store", () => {
  const LISTENERS = 1_000;

  bench(`setState notifying ${LISTENERS} listeners`, () => {
    const store = createStore(0);
    for (let i = 0; i < LISTENERS; i += 1) {
      store.subscribe(() => undefined);
    }
    store.setState(1);
  });

  bench(`setContext with ${LISTENERS} selector subscribers`, () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
      subject: input.subject,
    });
    for (let i = 0; i < LISTENERS; i += 1) {
      store.subscribeSelector(
        () => store.can("update", input.resource),
        () => undefined,
      );
    }
    store.setContext({
      tenantId: "other",
    });
  });
});
