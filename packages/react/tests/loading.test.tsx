import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuthorizationProvider,
  Can,
  useAccess,
  useAuthorizationError,
  useAuthorizationStatus,
} from "../src/index.js";
import { createTestStore } from "./setup.js";

afterEach(cleanup);

const resource = {
  id: "1",
  type: "invoice",
};
const viewer = {
  id: "user:ana",
  roles: [
    "viewer",
  ],
};

const loadingStore = () => {
  const store = createTestStore(viewer);
  store.setStatus("loading");
  return store;
};

const wrapperFor =
  (store: ReturnType<typeof createTestStore>) =>
  ({ children }: { children: ReactNode }) => (
    <AuthorizationProvider store={store}>{children}</AuthorizationProvider>
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve,
  };
};

describe("useAccess", () => {
  it("is loading, then allowed or denied, with no denied flash in between", async () => {
    const store = loadingStore();
    const seen: string[] = [];
    const Probe = () => {
      const access = useAccess("read", resource);
      seen.push(access);
      return <p>{access}</p>;
    };
    render(
      <AuthorizationProvider store={store}>
        <Probe />
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("loading")).not.toBeNull();

    const gate = deferred<{
      subject: typeof viewer;
    }>();
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = store.load(() => gate.promise);
    });
    await act(async () => {
      gate.resolve({
        subject: viewer,
      });
      await done;
    });

    expect(screen.queryByText("allowed")).not.toBeNull();
    expect(seen).not.toContain("denied");
    expect(seen[0]).toBe("loading");
    expect(seen.at(-1)).toBe("allowed");
  });

  it("reports denied for a ready store without permission, and denied on error", () => {
    const store = createTestStore(viewer);
    const { result } = renderHook(() => useAccess("update", resource), {
      wrapper: wrapperFor(store),
    });
    expect(result.current).toBe("denied");
    act(() => store.setError(new Error("boom")));
    expect(result.current).toBe("denied");
  });
});

describe("useAuthorizationStatus and useAuthorizationError", () => {
  it("follow the store", async () => {
    const store = loadingStore();
    const wrapper = wrapperFor(store);
    const status = renderHook(() => useAuthorizationStatus(), {
      wrapper,
    });
    const error = renderHook(() => useAuthorizationError(), {
      wrapper,
    });
    expect(status.result.current).toBe("loading");
    expect(error.result.current).toBeUndefined();

    const cause = new Error("offline");
    await act(async () => {
      await store.load(() => Promise.reject(cause));
    });
    expect(status.result.current).toBe("error");
    expect(error.result.current).toBe(cause);

    await act(async () => {
      await store.load(() => ({
        subject: viewer,
      }));
    });
    expect(status.result.current).toBe("ready");
    expect(error.result.current).toBeUndefined();
  });
});

describe("<Can> while loading", () => {
  it("renders the loading prop instead of the fallback", async () => {
    const store = loadingStore();
    render(
      <AuthorizationProvider store={store}>
        <Can
          action="read"
          fallback={<p>no access</p>}
          loading={<p>skeleton</p>}
          resource={resource}
        >
          <p>content</p>
        </Can>
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("skeleton")).not.toBeNull();
    expect(screen.queryByText("no access")).toBeNull();

    await act(async () => {
      await store.load(() => ({
        subject: viewer,
      }));
    });
    expect(screen.queryByText("content")).not.toBeNull();
    expect(screen.queryByText("skeleton")).toBeNull();
  });

  it("falls back to the fallback when no loading prop is given", () => {
    render(
      <AuthorizationProvider store={loadingStore()}>
        <Can
          action="read"
          fallback={<p>no access</p>}
          resource={resource}
        >
          <p>content</p>
        </Can>
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("no access")).not.toBeNull();
  });

  it("renders the fallback, not the loading prop, when loading failed", async () => {
    const store = loadingStore();
    render(
      <AuthorizationProvider store={store}>
        <Can
          action="read"
          fallback={<p>no access</p>}
          loading={<p>skeleton</p>}
          resource={resource}
        >
          <p>content</p>
        </Can>
      </AuthorizationProvider>,
    );
    await act(async () => {
      await store.load(() => Promise.reject(new Error("x")));
    });
    expect(screen.queryByText("no access")).not.toBeNull();
    expect(screen.queryByText("skeleton")).toBeNull();
  });
});
