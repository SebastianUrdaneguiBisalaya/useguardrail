import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RoleDefinition } from "../../src/index.js";
import { createRbacEvaluator, InvalidPolicyError } from "../../src/index.js";

const PERMISSIONS = [
  "*",
  "a:r",
  "a:w",
  "b:r",
  "b:w",
  "a:*",
  "*:r",
  "b:*",
  "*:w",
];

type RoleSpec = {
  permissions: string[];
  parents: number[];
};

const specsArb = fc
  .tuple(
    fc.integer({
      max: 5,
      min: 1,
    }),
    fc.boolean(),
  )
  .chain(([count, acyclic]) =>
    fc.array(
      fc
        .integer({
          max: count - 1,
          min: 0,
        })
        .chain((index) =>
          fc.record({
            parents: fc.subarray(
              // Acyclic mode: parents only from earlier roles. Otherwise any role, plus one unknown.
              Array.from(
                {
                  length: acyclic ? index : count + 1,
                },
                (_, parent) => parent,
              ),
            ),
            permissions: fc.subarray(PERMISSIONS),
          }),
        ),
      {
        maxLength: count,
        minLength: count,
      },
    ),
  );

const toRoles = (specs: RoleSpec[]): Record<string, RoleDefinition> => {
  const roles: Record<string, RoleDefinition> = {};
  specs.forEach((spec, index) => {
    roles[`r${index}`] = {
      inherits: spec.parents.map((parent) => `r${parent}`),
      permissions: spec.permissions,
    };
  });
  return roles;
};

// ---- Reference implementation: deliberately naive. ----

const isValid = (specs: RoleSpec[]): boolean => {
  const state = new Map<number, "visiting" | "done">();
  const visit = (index: number): boolean => {
    if (state.get(index) === "done") return true;
    if (state.get(index) === "visiting") return false; // cycle
    state.set(index, "visiting");
    for (const parent of specs[index]?.parents ?? []) {
      if (parent >= specs.length) return false; // unknown role
      if (!visit(parent)) return false;
    }
    state.set(index, "done");
    return true;
  };
  return specs.every((_, index) => visit(index));
};

const closure = (specs: RoleSpec[], index: number): Set<string> => {
  const result = new Set<string>(specs[index]?.permissions ?? []);
  for (const parent of specs[index]?.parents ?? []) {
    for (const permission of closure(specs, parent)) result.add(permission);
  }
  return result;
};

const matches = (permission: string, type: string, action: string): boolean => {
  if (permission === "*") return true;
  const [resource, act] = permission.split(":") as [
    string,
    string,
  ];
  return (
    (resource === "*" || resource === type) && (act === "*" || act === action)
  );
};

describe("RBAC properties", () => {
  it("rejects exactly the graphs with a cycle or an unknown parent", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const create = () =>
          createRbacEvaluator({
            roles: toRoles(specs),
          });
        if (isValid(specs)) {
          expect(create).not.toThrow();
        } else {
          expect(create).toThrow(InvalidPolicyError);
        }
      }),
      {
        numRuns: 300,
      },
    );
  });

  it("agrees with a naive reference on who is allowed, and never denies", () => {
    fc.assert(
      fc.property(
        specsArb.filter(isValid),
        fc.constantFrom("a", "b", "c"),
        fc.constantFrom("r", "w", "x"),
        fc.nat(),
        (specs, type, action, seed) => {
          const evaluator = createRbacEvaluator({
            roles: toRoles(specs),
          });
          const names = [
            ...specs.map((_, index) => `r${index}`),
            "ghost",
          ];
          // Deterministic pseudo-random subset of role names from the seed.
          const subjectRoles = names.filter((_, index) => (seed >> index) & 1);

          const expected = subjectRoles.some((name) => {
            const index = specs.findIndex((_, i) => `r${i}` === name);
            return (
              index !== -1 &&
              [
                ...closure(specs, index),
              ].some((p) => matches(p, type, action))
            );
          });

          const decision = evaluator({
            action,
            context: {},
            resource: {
              type,
            },
            subject: {
              id: "u",
              roles: subjectRoles,
            },
          });
          expect(decision?.effect === "allow").toBe(expected);
          expect(decision === undefined || decision.effect === "allow").toBe(
            true,
          );
        },
      ),
      {
        numRuns: 300,
      },
    );
  });
});
