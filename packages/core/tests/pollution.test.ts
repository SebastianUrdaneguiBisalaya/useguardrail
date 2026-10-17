import { afterEach, describe, expect, it } from "vitest";
import {
  createAuthorizationStore,
  createContext,
  createEngine,
  createRbacEvaluator,
  createRebacEvaluator,
  createRelationGraph,
  InvalidContextError,
} from "../src/index.js";

const polluted: string[] = [];
const pollute = (key: string, value: unknown) => {
  polluted.push(key);
  Object.defineProperty(Object.prototype, key, {
    configurable: true,
    value,
    writable: true,
  });
};

afterEach(() => {
  for (const key of polluted.splice(0)) {
    delete (Object.prototype as Record<string, unknown>)[key];
  }
});

describe("resistance to Object.prototype pollution", () => {
  it("does not grant roles inherited from the prototype", () => {
    const engine = createEngine({
      evaluators: [
        createRbacEvaluator({
          roles: {
            admin: {
              permissions: [
                "*",
              ],
            },
          },
        }),
      ],
    });
    const request = {
      action: "delete",
      context: {},
      resource: {
        id: "1",
        type: "doc",
      },
      subject: {
        id: "u1",
      },
    };
    expect(engine.evaluate(request).effect).toBe("deny");
    pollute("roles", [
      "admin",
    ]);
    expect(engine.evaluate(request).effect).toBe("deny");
    expect(
      engine.evaluate({
        ...request,
        subject: {
          id: "u1",
          roles: [
            "admin",
          ],
        },
      }).effect,
    ).toBe("allow");
  });

  it("does not take tenantId or attributes from the prototype", () => {
    pollute("tenantId", "evil");
    pollute("attributes", {
      plan: "free",
    });
    expect(createContext({})).toEqual({});
    expect(
      createContext({
        tenantId: "acme",
      }),
    ).toEqual({
      tenantId: "acme",
    });
  });

  it("does not take a resource id from the prototype", () => {
    const rebac = createRebacEvaluator({
      graph: createRelationGraph({
        tuples: [
          {
            object: "doc:secret",
            relation: "viewer",
            subject: "user:ana",
          },
        ],
      }),
      requirements: {
        doc: {
          read: "viewer",
        },
      },
    });
    pollute("id", "secret");
    expect(
      rebac({
        action: "read",
        context: {},
        resource: {
          type: "doc",
        },
        subject: {
          id: "user:ana",
        },
      }),
    ).toBeUndefined();
  });

  it("does not accept a subject whose id comes from the prototype", () => {
    pollute("id", "user:admin");
    expect(() =>
      createAuthorizationStore({
        engine: createEngine({
          evaluators: [],
        }),
        subject: {} as never,
      }),
    ).toThrow(InvalidContextError);
  });
});
