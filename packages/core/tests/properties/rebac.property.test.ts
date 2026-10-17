import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RelationRule, RelationTuple } from "../../src/index.js";
import {
  createRelationGraph,
  createTenantRelationGraph,
} from "../../src/index.js";

// Typed references so that `<type>:*` wildcards have something to match.
const USERS = [
  "user:u0",
  "user:u1",
  "bot:u2",
];
const WILDCARDS = [
  "user:*",
  "bot:*",
];
const OBJECTS = [
  "o0",
  "o1",
  "o2",
  "t0",
];
const RELATIONS = [
  "viewer",
  "editor",
  "member",
  "parent",
];

const subjectArb = fc.oneof(
  fc.constantFrom(...USERS),
  fc.constantFrom(...WILDCARDS),
  fc.constantFrom(...OBJECTS),
  fc
    .tuple(fc.constantFrom(...OBJECTS), fc.constantFrom(...RELATIONS))
    .map(([object, relation]) => `${object}#${relation}`),
);

const tuplesArb: fc.Arbitrary<RelationTuple[]> = fc.array(
  fc.record({
    object: fc.constantFrom(...OBJECTS),
    relation: fc.constantFrom(...RELATIONS),
    subject: subjectArb,
  }),
  {
    maxLength: 14,
  },
);

const ruleArb: fc.Arbitrary<RelationRule> = fc.record({
  impliedBy: fc.subarray(RELATIONS),
  inheritFrom: fc.subarray(RELATIONS).map((relations) =>
    relations.map((relation) => ({
      relation,
      via: "parent",
    })),
  ),
});

const rulesArb = fc.record(
  {
    editor: ruleArb,
    member: ruleArb,
    viewer: ruleArb,
  },
  {
    requiredKeys: [],
  },
) as fc.Arbitrary<Record<string, RelationRule>>;

// ---- Reference implementation: least fixpoint of the derivation rules. ----

const derive = (
  tuples: RelationTuple[],
  rules: Record<string, RelationRule>,
): Set<string> => {
  const facts = new Set<string>();
  const key = (user: string, relation: string, object: string) =>
    `${user}\u0000${relation}\u0000${object}`;
  const universe = new Set<string>([
    ...OBJECTS,
    ...tuples.flatMap((tuple) => [
      tuple.object,
      tuple.subject,
    ]),
  ]);
  let changed = true;
  const add = (fact: string) => {
    if (!facts.has(fact)) {
      facts.add(fact);
      changed = true;
    }
  };

  while (changed) {
    changed = false;
    for (const tuple of tuples) {
      const hash = tuple.subject.indexOf("#");
      if (hash === -1) {
        if (tuple.subject.endsWith(":*")) {
          // A wildcard covers every concrete subject with the same type prefix.
          const prefix = tuple.subject.slice(0, -1);
          for (const user of USERS) {
            if (user.startsWith(prefix)) {
              add(key(user, tuple.relation, tuple.object));
            }
          }
        } else {
          add(key(tuple.subject, tuple.relation, tuple.object));
        }
        continue;
      }
      const reference = tuple.subject.slice(0, hash);
      const relation = tuple.subject.slice(hash + 1);
      for (const user of USERS) {
        if (facts.has(key(user, relation, reference))) {
          add(key(user, tuple.relation, tuple.object));
        }
      }
    }
    for (const [relation, rule] of Object.entries(rules)) {
      for (const object of universe) {
        for (const implied of rule.impliedBy ?? []) {
          for (const user of USERS) {
            if (facts.has(key(user, implied, object))) {
              add(key(user, relation, object));
            }
          }
        }
      }
      for (const tuple of tuples) {
        if (tuple.relation !== "parent") continue;
        for (const inherit of rule.inheritFrom ?? []) {
          for (const user of USERS) {
            if (facts.has(key(user, inherit.relation, tuple.subject))) {
              add(key(user, relation, tuple.object));
            }
          }
        }
      }
    }
  }
  return facts;
};

describe("ReBAC properties", () => {
  it("agrees with a naive fixpoint on every (user, relation, object), including cyclic graphs", () => {
    fc.assert(
      fc.property(tuplesArb, rulesArb, (tuples, rules) => {
        const graph = createRelationGraph({
          maxDepth: 200,
          rules,
          tuples,
        });
        const facts = derive(tuples, rules);
        for (const user of USERS) {
          for (const relation of RELATIONS) {
            for (const object of OBJECTS) {
              expect(graph.check(user, relation, object)).toBe(
                facts.has(`${user}\u0000${relation}\u0000${object}`),
              );
            }
          }
        }
      }),
      {
        numRuns: 300,
      },
    );
  });

  it("fails closed under a small maxDepth: it may miss a path, but never invents one", () => {
    fc.assert(
      fc.property(
        tuplesArb,
        rulesArb,
        fc.integer({
          max: 3,
          min: 1,
        }),
        (tuples, rules, maxDepth) => {
          const graph = createRelationGraph({
            maxDepth,
            rules,
            tuples,
          });
          const facts = derive(tuples, rules);
          for (const user of USERS) {
            for (const relation of RELATIONS) {
              for (const object of OBJECTS) {
                if (graph.check(user, relation, object)) {
                  expect(
                    facts.has(`${user}\u0000${relation}\u0000${object}`),
                  ).toBe(true);
                }
              }
            }
          }
        },
      ),
      {
        numRuns: 200,
      },
    );
  });

  it("always terminates and returns a boolean, for any strings", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        (subject, relation, object) => {
          const graph = createRelationGraph({
            rules: {
              viewer: {
                impliedBy: [
                  "viewer",
                ],
                inheritFrom: [
                  {
                    relation: "viewer",
                    via: "viewer",
                  },
                ],
              },
            },
            tuples: [
              {
                object: "o",
                relation: "viewer",
                subject: "o",
              },
            ],
          });
          expect(typeof graph.check(subject, relation, object)).toBe("boolean");
        },
      ),
    );
  });

  it("a tenant graph answers for each tenant exactly like a graph built from that tenant's tuples alone", () => {
    fc.assert(
      fc.property(tuplesArb, tuplesArb, rulesArb, (acme, globex, rules) => {
        const tenants = createTenantRelationGraph({
          maxDepth: 200,
          rules,
          tuples: {
            acme,
            globex,
          },
        });
        const alone = {
          acme: createRelationGraph({
            maxDepth: 200,
            rules,
            tuples: acme,
          }),
          globex: createRelationGraph({
            maxDepth: 200,
            rules,
            tuples: globex,
          }),
        };
        for (const tenant of [
          "acme",
          "globex",
        ] as const) {
          for (const user of USERS) {
            for (const relation of RELATIONS) {
              for (const object of OBJECTS) {
                expect(tenants.check(tenant, user, relation, object)).toBe(
                  alone[tenant].check(user, relation, object),
                );
              }
            }
          }
        }
      }),
      {
        numRuns: 200,
      },
    );
  });
});
