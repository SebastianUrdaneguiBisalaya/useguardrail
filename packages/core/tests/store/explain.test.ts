import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreDecisionEvent } from "../../src/index.js";
import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
} from "../../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const engine = createEngine({
  evaluators: [
    createRbacEvaluator({
      roles: {
        editor: {
          permissions: [
            "invoice:update",
          ],
        },
      },
    }),
  ],
});
const resource = {
  id: "1",
  type: "invoice",
};
const editor = {
  id: "user:ana",
  roles: [
    "editor",
  ],
};

describe("store.explain", () => {
  it("explains an allowed check with the engine's trace", () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
      subject: editor,
    });
    const event = store.explain("update", resource);

    expect(event).toMatchObject({
      action: "update",
      context: {
        tenantId: "acme",
      },
      resource,
      status: "ready",
      subject: editor,
    });
    expect(event.decision).toMatchObject({
      code: "ROLE_GRANTS",
      effect: "allow",
    });
    expect(event.trace).toHaveLength(1);
    expect(event.trace[0]).toMatchObject({
      index: 0,
      outcome: "allow",
    });
  });

  it("explains a denial the engine decided", () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });
    const event = store.explain("delete", resource);
    expect(event.decision.code).toBe("DEFAULT_DENY");
    expect(event.trace.map((entry) => entry.outcome)).toEqual([
      "abstain",
    ]);
  });

  it("explains denials that never reach the engine: loading, error, signed out", () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
      subject: editor,
    });
    expect(store.explain("update", resource)).toMatchObject({
      decision: {
        code: "LOADING",
      },
      status: "loading",
      trace: [],
    });

    store.setError(new Error("offline"));
    expect(store.explain("update", resource)).toMatchObject({
      decision: {
        code: "LOAD_FAILED",
      },
      status: "error",
      trace: [],
    });

    const signedOut = createAuthorizationStore({
      engine,
    });
    expect(signedOut.explain("update", resource)).toMatchObject({
      decision: {
        code: "NO_SUBJECT",
      },
      status: "ready",
      subject: undefined,
      trace: [],
    });
  });

  it("works with a hand-written engine that has no explain", () => {
    const handWritten = {
      evaluate: () =>
        ({
          effect: "allow",
          reason: "ok",
        }) as const,
    };
    const store = createAuthorizationStore({
      engine: handWritten as never,
      subject: editor,
    });
    const event = store.explain("update", resource);
    expect(event.decision.effect).toBe("allow");
    expect(event.trace).toEqual([]);
  });
});

describe("store onDecision", () => {
  it("is called for every check, including ones the engine never sees", () => {
    const events: StoreDecisionEvent[] = [];
    const store = createAuthorizationStore({
      engine,
      onDecision: (event) => events.push(event),
      status: "loading",
    });

    store.can("update", resource); // loading
    store.setStatus("ready"); // ready, signed out
    store.evaluate("update", resource); // NO_SUBJECT
    store.setSubject(editor);
    store.can("update", resource); // allowed by the engine

    expect(events.map((event) => event.decision.code)).toEqual([
      "LOADING",
      "NO_SUBJECT",
      "ROLE_GRANTS",
    ]);
    expect(events.map((event) => event.status)).toEqual([
      "loading",
      "ready",
      "ready",
    ]);
    expect(events[2]?.trace).toHaveLength(1);
  });

  it("leaves the answers unchanged", () => {
    const plain = createAuthorizationStore({
      engine,
      subject: editor,
    });
    const hooked = createAuthorizationStore({
      engine,
      onDecision: () => undefined,
      subject: editor,
    });
    for (const action of [
      "update",
      "delete",
      "read",
    ]) {
      expect(hooked.evaluate(action, resource)).toEqual(
        plain.evaluate(action, resource),
      );
      expect(hooked.can(action, resource)).toBe(plain.can(action, resource));
    }
  });

  it("fires the engine's hook once per check as well, without duplicates", () => {
    const engineHook = vi.fn();
    const storeHook = vi.fn();
    const store = createAuthorizationStore({
      engine: createEngine({
        evaluators: [
          createRbacEvaluator({
            roles: {
              editor: {
                permissions: [
                  "invoice:update",
                ],
              },
            },
          }),
        ],
        onDecision: engineHook,
      }),
      onDecision: storeHook,
      subject: editor,
    });
    store.can("update", resource);
    expect(engineHook).toHaveBeenCalledTimes(1);
    expect(storeHook).toHaveBeenCalledTimes(1);
  });

  it("cannot break a check: a throwing hook is rethrown asynchronously", () => {
    const rethrown: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        rethrown.push(error);
      }
    });
    const boom = new Error("hook failed");
    const store = createAuthorizationStore({
      engine,
      onDecision: () => {
        throw boom;
      },
      subject: editor,
    });
    expect(store.can("update", resource)).toBe(true);
    expect(rethrown).toEqual([
      boom,
    ]);
  });

  it("rejects a hook that is not a function", () => {
    expect(() =>
      createAuthorizationStore({
        engine,
        onDecision: 1 as never,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ON_DECISION_INVALID",
      }),
    );
  });
});
