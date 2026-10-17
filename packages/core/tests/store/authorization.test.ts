import { describe, expect, it, vi } from "vitest";
import type { Evaluator } from "../../src/index.js";
import {
  createAuthorizationStore,
  createEngine,
  InvalidContextError,
  InvalidPolicyError,
} from "../../src/index.js";

const sameTenantOnly: Evaluator = ({ context, resource }) =>
  context.tenantId !== undefined &&
  (
    resource.attributes as
      | {
          tenant?: unknown;
        }
      | undefined
  )?.tenant === context.tenantId
    ? {
        effect: "allow",
        reason: "same tenant",
      }
    : undefined;

const engine = createEngine({
  evaluators: [
    sameTenantOnly,
  ],
});
const doc = {
  attributes: {
    tenant: "acme",
  },
  id: "1",
  type: "doc",
};

describe("createAuthorizationStore", () => {
  it("denies everything while there is no subject", () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
    });
    expect(store.can("read", doc)).toBe(false);
    expect(store.evaluate("read", doc).effect).toBe("deny");
  });

  it("evaluates with the current subject and context", () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
      subject: {
        id: "user:ana",
      },
    });
    expect(store.can("read", doc)).toBe(true);
    store.setContext({
      tenantId: "other",
    });
    expect(store.can("read", doc)).toBe(false);
  });

  it("notifies on subject, context, and engine changes with fresh snapshots", () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    store.setSubject({
      id: "user:ana",
    });
    store.setContext({
      attributes: {
        plan: "pro",
      },
      tenantId: "acme",
    });
    store.setEngine(
      createEngine({
        evaluators: [],
      }),
    );

    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.can("read", doc)).toBe(false);
  });

  it("lets a consumer re-render only when its own answer changes", () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
      subject: {
        id: "user:ana",
      },
    });
    const onAnswer = vi.fn();
    store.subscribeSelector(() => store.can("read", doc), onAnswer);

    store.setContext({
      attributes: {
        unrelated: true,
      },
      tenantId: "acme",
    });
    expect(onAnswer).not.toHaveBeenCalled();

    store.setContext({
      tenantId: "other",
    });
    expect(onAnswer).toHaveBeenCalledWith(false, true);
  });

  it("clears the subject with undefined", () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
      subject: {
        id: "user:ana",
      },
    });
    store.setSubject(undefined);
    expect(store.can("read", doc)).toBe(false);
  });

  it("rejects malformed engine, subject, and context", () => {
    const create = (config: unknown) => () =>
      createAuthorizationStore(config as never);
    expect(create(undefined)).toThrow(InvalidPolicyError);
    expect(
      create({
        engine: {},
      }),
    ).toThrow(InvalidPolicyError);
    expect(
      create({
        engine,
        subject: {
          id: "",
        },
      }),
    ).toThrow(InvalidContextError);
    expect(
      create({
        engine,
        subject: "ana",
      }),
    ).toThrow(InvalidContextError);
    expect(
      create({
        context: {
          tenantId: 1,
        },
        engine,
      }),
    ).toThrow(InvalidContextError);

    const store = createAuthorizationStore({
      engine,
    });
    expect(() => store.setEngine({} as never)).toThrow(InvalidPolicyError);
    expect(() =>
      store.setSubject({
        id: 1,
      } as never),
    ).toThrow(InvalidContextError);
    expect(() =>
      store.setContext({
        tenantId: "",
      }),
    ).toThrow(InvalidContextError);
  });
});
