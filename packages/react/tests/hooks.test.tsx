import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProvider,
  MissingProviderError,
  useAuthorizationStore,
  useCan,
  useSubject,
} from "../src/index.js";
import { createTestStore } from "./setup.js";

afterEach(cleanup);

const wrapperFor =
  (store: ReturnType<typeof createTestStore>) =>
  ({ children }: { children: ReactNode }) => (
    <AuthorizationProvider store={store}>{children}</AuthorizationProvider>
  );

describe("useCan", () => {
  it("reflects the current decision", () => {
    const store = createTestStore();
    const wrapper = wrapperFor(store);
    const read = renderHook(
      () =>
        useCan("read", {
          id: "1",
          type: "invoice",
        }),
      {
        wrapper,
      },
    );
    const update = renderHook(
      () =>
        useCan("update", {
          id: "1",
          type: "invoice",
        }),
      {
        wrapper,
      },
    );
    expect(read.result.current).toBe(true);
    expect(update.result.current).toBe(false);
  });

  it("updates when the subject changes", () => {
    const store = createTestStore();
    const { result } = renderHook(
      () =>
        useCan("update", {
          id: "1",
          type: "invoice",
        }),
      {
        wrapper: wrapperFor(store),
      },
    );
    expect(result.current).toBe(false);
    act(() =>
      store.setSubject({
        id: "user:ana",
        roles: [
          "editor",
        ],
      }),
    );
    expect(result.current).toBe(true);
    act(() => store.setSubject(undefined));
    expect(result.current).toBe(false);
  });

  it("follows a changed action or resource between renders", () => {
    const store = createTestStore();
    const { rerender, result } = renderHook(
      ({ action }: { action: string }) =>
        useCan(action, {
          id: "1",
          type: "invoice",
        }),
      {
        initialProps: {
          action: "read",
        },
        wrapper: wrapperFor(store),
      },
    );
    expect(result.current).toBe(true);
    rerender({
      action: "update",
    });
    expect(result.current).toBe(false);
  });

  it("throws MissingProviderError outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      renderHook(() =>
        useCan("read", {
          type: "invoice",
        }),
      ),
    ).toThrow(MissingProviderError);
    try {
      renderHook(() =>
        useCan("read", {
          type: "invoice",
        }),
      );
    } catch (error) {
      expect((error as MissingProviderError).code).toBe("PROVIDER_MISSING");
    }
    spy.mockRestore();
  });
});

describe("useSubject", () => {
  it("returns the subject and updates when it is replaced", () => {
    const store = createTestStore();
    const { result } = renderHook(() => useSubject(), {
      wrapper: wrapperFor(store),
    });
    expect(result.current?.id).toBe("user:ana");
    act(() => store.setSubject(undefined));
    expect(result.current).toBeUndefined();
  });
});

describe("useAuthorizationStore", () => {
  it("returns the provided store", () => {
    const store = createTestStore();
    const { result } = renderHook(() => useAuthorizationStore(), {
      wrapper: wrapperFor(store),
    });
    expect(result.current).toBe(store);
  });
});
