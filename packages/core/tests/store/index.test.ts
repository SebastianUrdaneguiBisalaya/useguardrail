import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createStore", () => {
  it("returns the same snapshot until the state changes", () => {
    const store = createStore({
      count: 0,
    });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    const before = store.getSnapshot();
    store.setState({
      count: 1,
    });
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot()).toEqual({
      count: 1,
    });
  });

  it("accepts an updater and notifies subscribers", () => {
    const store = createStore({
      count: 0,
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState((s) => ({
      count: s.count + 1,
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().count).toBe(1);
  });

  it("does not notify when the same value is set", () => {
    const initial = {
      count: 0,
    };
    const store = createStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState(initial);
    store.setState((s) => s);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe (idempotent)", () => {
    const store = createStore(0);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    stop();
    stop();
    store.setState(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("skips a listener unsubscribed by an earlier listener in the same notification", () => {
    const store = createStore(0);
    const second = vi.fn();
    let stopSecond: () => void = () => undefined;
    store.subscribe(() => stopSecond());
    stopSecond = store.subscribe(second);
    store.setState(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("isolates a throwing listener and rethrows its error asynchronously", () => {
    const rethrown: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        rethrown.push(error);
      }
    });
    const store = createStore(0);
    const boom = new Error("boom");
    const after = vi.fn();
    store.subscribe(() => {
      throw boom;
    });
    store.subscribe(after);
    expect(() => store.setState(1)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(rethrown).toEqual([
      boom,
    ]);
  });

  it("subscribeSelector only fires when the selected slice changes", () => {
    const store = createStore({
      a: 1,
      b: 1,
    });
    const onA = vi.fn();
    store.subscribeSelector((s) => s.a, onA);
    store.setState((s) => ({
      ...s,
      b: 2,
    }));
    expect(onA).not.toHaveBeenCalled();
    store.setState((s) => ({
      ...s,
      a: 2,
    }));
    expect(onA).toHaveBeenCalledWith(2, 1);
  });

  it("subscribeSelector supports a custom equality and unsubscribe", () => {
    const store = createStore({
      items: [
        1,
        2,
      ],
    });
    const listener = vi.fn();
    const stop = store.subscribeSelector(
      (s) => s.items,
      listener,
      (x, y) => x.length === y.length,
    );
    store.setState({
      items: [
        3,
        4,
      ],
    });
    expect(listener).not.toHaveBeenCalled();
    store.setState({
      items: [
        3,
      ],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.setState({
      items: [],
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
