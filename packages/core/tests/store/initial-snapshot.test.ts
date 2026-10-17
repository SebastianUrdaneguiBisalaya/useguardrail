import { describe, expect, it } from "vitest";
import {
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
  createStore,
  evaluateState,
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

describe("initial snapshot", () => {
  it("createStore keeps the state it was created with", () => {
    const store = createStore({
      count: 0,
    });
    const initial = store.getInitialSnapshot();
    store.setState({
      count: 5,
    });
    expect(store.getInitialSnapshot()).toBe(initial);
    expect(store.getInitialSnapshot()).toEqual({
      count: 0,
    });
    expect(store.getSnapshot()).toEqual({
      count: 5,
    });
  });

  it("the authorization store's initial snapshot ignores later changes", () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });
    const initial = store.getInitialSnapshot();
    store.setStatus("loading");
    store.setSubject(undefined);
    expect(store.getInitialSnapshot()).toBe(initial);
    expect(initial).toMatchObject({
      status: "ready",
      subject: editor,
    });
    expect(store.getSnapshot().status).toBe("loading");
  });
});

describe("evaluateState", () => {
  it("evaluates against any state, without a store", () => {
    const ready = createAuthorizationStore({
      engine,
      subject: editor,
    });
    const state = ready.getSnapshot();
    expect(evaluateState(state, "update", resource).effect).toBe("allow");
    expect(evaluateState(state, "delete", resource).effect).toBe("deny");
  });

  it("denies with the matching code for loading, error, and signed-out states", () => {
    const base = createAuthorizationStore({
      engine,
      subject: editor,
    }).getSnapshot();
    expect(
      evaluateState(
        {
          ...base,
          status: "loading",
        },
        "update",
        resource,
      ).code,
    ).toBe("LOADING");
    expect(
      evaluateState(
        {
          ...base,
          status: "error",
        },
        "update",
        resource,
      ).code,
    ).toBe("LOAD_FAILED");
    expect(
      evaluateState(
        {
          ...base,
          subject: undefined,
        },
        "update",
        resource,
      ).code,
    ).toBe("NO_SUBJECT");
  });

  it("is what store.evaluate returns for the current state", () => {
    const store = createAuthorizationStore({
      engine,
      subject: editor,
    });
    expect(store.evaluate("update", resource)).toEqual(
      evaluateState(store.getSnapshot(), "update", resource),
    );
  });
});
