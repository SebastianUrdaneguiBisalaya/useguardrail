import { describe, expect, it } from "vitest";
import {
  createAbacEvaluator,
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
  forSchema,
} from "../src/index.js";

type AppSchema = {
  invoice: "read" | "update" | "delete";
  user: "read" | "invite";
};

describe("forSchema", () => {
  const auth = forSchema<AppSchema>();

  it("returns the very same factories, only retyped (no wrappers at runtime)", () => {
    expect(auth.createEngine).toBe(createEngine);
    expect(auth.createRbacEvaluator).toBe(createRbacEvaluator);
    expect(auth.createAbacEvaluator).toBe(createAbacEvaluator);
    expect(auth.createRebacEvaluator).toBe(createRebacEvaluator);
    expect(auth.createAuthorizationStore).toBe(createAuthorizationStore);
    expect(Object.isFrozen(auth)).toBe(true);
  });

  it("works end to end with typed RBAC, ABAC, and ReBAC", () => {
    const graph = createRelationGraph({
      tuples: [
        {
          object: "invoice:1",
          relation: "editor",
          subject: "user:ana",
        },
      ],
    });
    const engine = auth.createEngine({
      evaluators: [
        auth.createRbacEvaluator({
          roles: {
            viewer: {
              permissions: [
                "*:read",
              ],
            },
          },
        }),
        auth.createAbacEvaluator({
          policies: [
            {
              actions: [
                "delete",
              ],
              effect: "deny",
              id: "no-delete",
              resources: [
                "invoice",
              ],
            },
          ],
        }),
        auth.createRebacEvaluator({
          graph,
          requirements: {
            invoice: {
              delete: "editor",
              update: "editor",
            },
          },
        }),
      ],
    });
    const store = auth.createAuthorizationStore({
      engine,
      subject: {
        id: "user:ana",
        roles: [
          "viewer",
        ],
      },
    });

    expect(
      store.can("read", {
        id: "1",
        type: "invoice",
      }),
    ).toBe(true); // RBAC
    expect(
      store.can("update", {
        id: "1",
        type: "invoice",
      }),
    ).toBe(true); // ReBAC
    expect(
      store.can("delete", {
        id: "1",
        type: "invoice",
      }),
    ).toBe(false); // ABAC deny wins
    expect(
      store.can("invite", {
        type: "user",
      }),
    ).toBe(false); // nobody grants it
  });

  it("accepts a schema-less evaluator next to typed ones (e.g. built from an adapter)", () => {
    const loose = createRbacEvaluator({
      roles: {
        admin: {
          permissions: [
            "anything:goes",
          ],
        },
      },
    });
    const engine = auth.createEngine({
      evaluators: [
        loose,
      ],
    });
    expect(
      engine.evaluate({
        action: "read",
        context: {},
        resource: {
          type: "invoice",
        },
        subject: {
          id: "u",
          roles: [
            "admin",
          ],
        },
      }).effect,
    ).toBe("deny");
  });

  it("still validates at runtime what the types cannot see (plain JS callers)", () => {
    expect(() =>
      auth.createRbacEvaluator({
        roles: {
          a: {
            permissions: [
              "nocolon" as never,
            ],
          },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PERMISSION_FORMAT_INVALID",
      }),
    );
  });
});
