import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuthorizationProvider,
  Can,
  useAccess,
  useAuthorizationStatus,
  useCan,
  useSubject,
} from "../src/index.js";
import { createTestStore } from "./setup.js";

afterEach(cleanup);

type Store = ReturnType<typeof createTestStore>;

/** Wraps a store so tests can see how many subscriptions are open. */
const instrument = (store: Store) => {
  const counts = {
    active: 0,
    subscribed: 0,
    unsubscribed: 0,
  };
  const wrapped: Store = {
    ...store,
    subscribe: (listener) => {
      counts.subscribed += 1;
      counts.active += 1;
      const stop = store.subscribe(listener);
      let stopped = false;
      return () => {
        if (!stopped) {
          stopped = true;
          counts.unsubscribed += 1;
          counts.active -= 1;
        }
        stop();
      };
    },
  };
  return {
    counts,
    store: wrapped,
  };
};

const resource = {
  id: "1",
  type: "invoice",
};

const Consumers = () => {
  const canRead = useCan("read", resource);
  const access = useAccess("update", resource);
  const status = useAuthorizationStatus();
  const subject = useSubject();
  return (
    <p>{`${canRead}:${access}:${status}:${subject?.roles?.join(",") ?? "-"}`}</p>
  );
};

describe("StrictMode", () => {
  it("renders correctly and follows store updates", () => {
    const store = createTestStore();
    render(
      <StrictMode>
        <AuthorizationProvider store={store}>
          <Consumers />
          <Can
            action="update"
            fallback={<p>read only</p>}
            resource={resource}
          >
            <p>can edit</p>
          </Can>
        </AuthorizationProvider>
      </StrictMode>,
    );
    expect(screen.queryByText("true:denied:ready:viewer")).not.toBeNull();
    expect(screen.queryByText("read only")).not.toBeNull();

    act(() =>
      store.setSubject({
        id: "user:ana",
        roles: [
          "editor",
        ],
      }),
    );
    expect(screen.queryByText("true:allowed:ready:editor")).not.toBeNull();
    expect(screen.queryByText("can edit")).not.toBeNull();
  });

  it("does not leak subscriptions across StrictMode's double effects or on unmount", () => {
    const { counts, store } = instrument(createTestStore());
    const { unmount } = render(
      <StrictMode>
        <AuthorizationProvider store={store}>
          <Consumers />
        </AuthorizationProvider>
      </StrictMode>,
    );
    // Four hooks, each subscribed once (StrictMode may subscribe, unsubscribe, and subscribe again).
    expect(counts.active).toBe(4);
    expect(counts.subscribed).toBeGreaterThanOrEqual(4);

    unmount();
    expect(counts.active).toBe(0);
    expect(counts.unsubscribed).toBe(counts.subscribed);
  });
});

describe("subscriptions", () => {
  it("subscribes once per hook and stays subscribed across re-renders", () => {
    const { counts, store } = instrument(createTestStore());
    const { rerender } = render(
      <AuthorizationProvider store={store}>
        <Consumers />
      </AuthorizationProvider>,
    );
    expect(counts.subscribed).toBe(4);

    for (let i = 0; i < 5; i += 1) {
      rerender(
        <AuthorizationProvider store={store}>
          <Consumers />
        </AuthorizationProvider>,
      );
    }
    expect(counts.subscribed).toBe(4);
    expect(counts.active).toBe(4);
  });

  it("moves its subscriptions when the provider receives a different store", () => {
    const first = instrument(createTestStore());
    const second = instrument(createTestStore());
    const { rerender, unmount } = render(
      <AuthorizationProvider store={first.store}>
        <Consumers />
      </AuthorizationProvider>,
    );
    expect(first.counts.active).toBe(4);

    rerender(
      <AuthorizationProvider store={second.store}>
        <Consumers />
      </AuthorizationProvider>,
    );
    expect(first.counts.active).toBe(0);
    expect(second.counts.active).toBe(4);

    unmount();
    expect(second.counts.active).toBe(0);
  });
});
