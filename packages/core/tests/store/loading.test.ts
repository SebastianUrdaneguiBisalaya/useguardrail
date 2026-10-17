import { describe, expect, it, vi } from "vitest";
import type { AuthorizationLoadResult } from "../../src/index.js";
import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
  InvalidContextError,
  InvalidPolicyError,
} from "../../src/index.js";

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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    reject,
    resolve,
  };
};

describe("authorization store: status", () => {
  it("defaults to ready, with no error", () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().error).toBeUndefined();
    expect(store.can("update", resource)).toBe(true);
  });

  it("denies everything with code LOADING while loading, even with a subject", () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
      subject: editor,
    });
    expect(store.getSnapshot().status).toBe("loading");
    expect(store.can("update", resource)).toBe(false);
    expect(store.evaluate("update", resource).code).toBe("LOADING");
  });

  it("setStatus switches between loading and ready, and notifies", () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
      subject: editor,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setStatus("ready");
    expect(store.can("update", resource)).toBe(true);
    store.setStatus("ready");
    expect(listener).toHaveBeenCalledTimes(1);
    store.setStatus("loading");
    expect(store.evaluate("update", resource).code).toBe("LOADING");
  });

  it("setError denies with code LOAD_FAILED and keeps the cause; setStatus clears it", () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });
    const cause = new Error("offline");
    store.setError(cause);
    expect(store.getSnapshot()).toMatchObject({
      error: cause,
      status: "error",
    });
    expect(store.evaluate("update", resource).code).toBe("LOAD_FAILED");
    store.setStatus("ready");
    expect(store.getSnapshot().error).toBeUndefined();
    expect(store.can("update", resource)).toBe(true);
  });

  it("stays signed-out (NO_SUBJECT) when ready without a subject", () => {
    const store = createAuthorizationStore({
      engine,
    });
    expect(store.evaluate("update", resource).code).toBe("NO_SUBJECT");
  });
});

describe("authorization store: load", () => {
  it("goes loading -> ready and applies subject, context and engine together", async () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
    });
    const seen: string[] = [];
    store.subscribe(() => {
      const { context, status, subject } = store.getSnapshot();
      seen.push(`${status}:${subject?.id ?? "-"}:${context.tenantId ?? "-"}`);
    });
    const gate = deferred<AuthorizationLoadResult>();
    const done = store.load(() => gate.promise);
    expect(store.getSnapshot().status).toBe("loading");

    gate.resolve({
      context: {
        tenantId: "acme",
      },
      subject: editor,
    });
    await done;

    expect(store.getSnapshot().status).toBe("ready");
    expect(store.can("update", resource)).toBe(true);
    // One notification for entering loading (a no-op while already loading is skipped), one for the result.
    expect(seen.at(-1)).toBe("ready:user:ana:acme");
    expect(seen.every((entry) => !entry.startsWith("ready:-"))).toBe(true);
  });

  it("keeps omitted fields and clears the subject on an explicit undefined", async () => {
    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine,
      subject: editor,
    });
    await store.load(() => ({
      context: {
        tenantId: "other",
      },
    }));
    expect(store.getSnapshot().subject).toBe(editor);
    expect(store.getSnapshot().context.tenantId).toBe("other");

    await store.load(() => ({
      subject: undefined,
    }));
    expect(store.getSnapshot().subject).toBeUndefined();
    expect(store.getSnapshot().context.tenantId).toBe("other");
  });

  it("accepts a synchronous loader", async () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
    });
    await store.load(() => ({
      subject: editor,
    }));
    expect(store.can("update", resource)).toBe(true);
  });

  it("never rejects: a throwing loader leaves the store in error", async () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });
    const cause = new Error("500");
    await expect(
      store.load(async () => {
        throw cause;
      }),
    ).resolves.toBeUndefined();
    expect(store.getSnapshot()).toMatchObject({
      error: cause,
      status: "error",
    });
    expect(store.evaluate("update", resource).code).toBe("LOAD_FAILED");
  });

  it("recovers from an error with a later successful load", async () => {
    const store = createAuthorizationStore({
      engine,
    });
    await store.load(() => Promise.reject(new Error("x")));
    expect(store.getSnapshot().status).toBe("error");
    await store.load(() => ({
      subject: editor,
    }));
    expect(store.getSnapshot()).toMatchObject({
      error: undefined,
      status: "ready",
    });
    expect(store.can("update", resource)).toBe(true);
  });

  it("ignores a stale load and aborts its signal", async () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
    });
    const first = deferred<AuthorizationLoadResult>();
    const second = deferred<AuthorizationLoadResult>();
    let firstSignal: AbortSignal | undefined;

    const firstDone = store.load(({ signal }) => {
      firstSignal = signal;
      return first.promise;
    });
    const secondDone = store.load(() => second.promise);
    expect(firstSignal?.aborted).toBe(true);

    second.resolve({
      subject: {
        id: "user:fresh",
        roles: [
          "editor",
        ],
      },
    });
    await secondDone;
    first.resolve({
      subject: {
        id: "user:stale",
      },
    });
    await firstDone;

    expect(store.getSnapshot().subject?.id).toBe("user:fresh");
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("ignores the failure of a stale load", async () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
    });
    const first = deferred<AuthorizationLoadResult>();
    const firstDone = store.load(() => first.promise);
    await store.load(() => ({
      subject: editor,
    }));
    first.reject(new Error("late failure"));
    await firstDone;
    expect(store.getSnapshot()).toMatchObject({
      error: undefined,
      status: "ready",
    });
  });

  it("turns invalid loader results into the error state", async () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });

    await store.load((() => 5) as never);
    expect(store.getSnapshot().error).toBeInstanceOf(InvalidContextError);
    expect((store.getSnapshot().error as InvalidContextError).code).toBe(
      "LOAD_RESULT_INVALID",
    );

    await store.load(() => ({
      subject: {
        id: "",
      },
    }));
    expect((store.getSnapshot().error as InvalidContextError).code).toBe(
      "SUBJECT_INVALID",
    );

    await store.load(
      () =>
        ({
          context: {
            tenantId: 1,
          },
        }) as never,
    );
    expect(store.getSnapshot().error).toBeInstanceOf(InvalidContextError);

    await store.load(
      () =>
        ({
          engine: {},
        }) as never,
    );
    expect(store.getSnapshot().error).toBeInstanceOf(InvalidPolicyError);

    // Nothing from the failed attempts was applied.
    expect(store.getSnapshot().subject).toBe(editor);
  });

  it("only reads own properties of the result (prototype pollution)", async () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
    });
    Object.defineProperty(Object.prototype, "subject", {
      configurable: true,
      value: {
        id: "user:admin",
      },
      writable: true,
    });
    try {
      await store.load(() => ({}));
    } finally {
      Reflect.deleteProperty(Object.prototype, "subject");
    }
    expect(store.getSnapshot().subject).toBeUndefined();
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("rejects a non-function loader with LOADER_INVALID", async () => {
    const store = createAuthorizationStore({
      engine,
    });
    await expect(store.load(5 as never)).rejects.toMatchObject({
      code: "LOADER_INVALID",
    });
  });

  it("flips a selector subscriber exactly once across loading -> ready", async () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
    });
    const onAnswer = vi.fn();
    store.subscribeSelector(() => store.can("update", resource), onAnswer);
    await store.load(() => ({
      subject: editor,
    }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(true, false);
  });
});
