import { act, cleanup, render, screen } from "@testing-library/react";
import { startTransition, useDeferredValue } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorizationProvider, useCan } from "../src/index.js";
import { createTestStore } from "./setup.js";

afterEach(cleanup);

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

describe("concurrent rendering", () => {
  it("never tears: every consumer shows the same answer after an update in a transition", () => {
    const store = createTestStore();
    const COUNT = 25;

    const ids = Array.from(
      {
        length: COUNT,
      },
      (_, i) => `c${i}`,
    );

    const Consumer = ({ id }: { id: string }) => {
      const allowed = useCan("update", resource);
      return <li data-testid={id}>{String(allowed)}</li>;
    };

    render(
      <AuthorizationProvider store={store}>
        <ul>
          {ids.map((id) => (
            <Consumer
              id={id}
              key={id}
            />
          ))}
        </ul>
      </AuthorizationProvider>,
    );
    const answers = () => ids.map((id) => screen.getByTestId(id).textContent);
    expect(new Set(answers())).toEqual(
      new Set([
        "false",
      ]),
    );

    act(() => {
      startTransition(() => {
        store.setSubject(editor);
      });
    });
    expect(new Set(answers())).toEqual(
      new Set([
        "true",
      ]),
    );

    act(() => {
      startTransition(() => {
        store.setSubject(undefined);
      });
    });
    expect(new Set(answers())).toEqual(
      new Set([
        "false",
      ]),
    );
  });

  it("leaves every component on the same store snapshot after an update", () => {
    const store = createTestStore();
    const latest = new Map<string, unknown>();

    const Probe = ({ id }: { id: string }) => {
      useCan("update", resource);
      latest.set(id, store.getSnapshot());
      return null;
    };

    render(
      <AuthorizationProvider store={store}>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" />
      </AuthorizationProvider>,
    );
    act(() => {
      startTransition(() => {
        store.setSubject(editor);
      });
    });

    // Probes that re-rendered did so against the newest snapshot, and none is left on a stale one.
    expect(new Set(latest.values()).size).toBe(1);
    expect(
      [
        ...latest.values(),
      ][0],
    ).toBe(store.getSnapshot());
  });

  it("works with useDeferredValue for the resource being checked", () => {
    const store = createTestStore(editor);

    const Viewer = ({ id }: { id: string }) => {
      const deferredId = useDeferredValue(id);
      const allowed = useCan("update", {
        id: deferredId,
        type: "invoice",
      });
      return <p>{`${deferredId}:${allowed}`}</p>;
    };

    const { rerender } = render(
      <AuthorizationProvider store={store}>
        <Viewer id="1" />
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("1:true")).not.toBeNull();

    rerender(
      <AuthorizationProvider store={store}>
        <Viewer id="2" />
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("2:true")).not.toBeNull();
  });

  it("updates several roots that share one store", () => {
    const store = createTestStore();
    const Probe = () => <p>{String(useCan("update", resource))}</p>;
    const a = render(
      <AuthorizationProvider store={store}>
        <Probe />
      </AuthorizationProvider>,
    );
    const b = render(
      <AuthorizationProvider store={store}>
        <Probe />
      </AuthorizationProvider>,
    );
    act(() => store.setSubject(editor));
    expect(a.container.textContent).toBe("true");
    expect(b.container.textContent).toBe("true");

    a.unmount();
    act(() => store.setSubject(undefined));
    expect(b.container.textContent).toBe("false");
  });
});
