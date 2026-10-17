import { rethrowAsync } from "../report.js";

/** Called after the store's state changes. */
export type Listener = () => void;

/** Stops a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * A minimal reactive store, compatible with React's `useSyncExternalStore`
 * (`subscribe` + `getSnapshot`). State is replaced, never mutated, so snapshots
 * keep the same identity until a real change happens.
 */
export type Store<T> = {
  /** The current state. Same reference until the state changes. */
  readonly getSnapshot: () => T;
  /**
   * The state the store was created with, which never changes. Server rendering and
   * hydration use it as the "server snapshot", so a client store that already received data
   * before hydration still matches the HTML the server produced.
   */
  readonly getInitialSnapshot: () => T;
  /**
   * Replaces the state with a value, or with the result of an updater.
   * Setting a value identical (`Object.is`) to the current one notifies nobody.
   * `T` must not be a function type.
   */
  readonly setState: (next: T | ((previous: T) => T)) => void;
  /** Registers a listener for every state change. */
  readonly subscribe: (listener: Listener) => Unsubscribe;
  /**
   * Registers a listener that only runs when the selected slice changes
   * (compared with `isEqual`, `Object.is` by default).
   */
  readonly subscribeSelector: <S>(
    selector: (state: T) => S,
    listener: (selected: S, previous: S) => void,
    isEqual?: (a: S, b: S) => boolean,
  ) => Unsubscribe;
};

/**
 * Creates a reactive store.
 *
 * A listener that throws never prevents the others from running; its error is rethrown
 * asynchronously (so it surfaces as an unhandled error) instead of being swallowed.
 *
 * @example
 * const store = createStore({ count: 0 });
 * const stop = store.subscribe(() => render(store.getSnapshot()));
 * store.setState((s) => ({ count: s.count + 1 }));
 */
export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();

  const getSnapshot = (): T => state;
  const getInitialSnapshot = (): T => initial;

  const setState = (next: T | ((previous: T) => T)): void => {
    const value =
      typeof next === "function" ? (next as (previous: T) => T)(state) : next;
    if (Object.is(value, state)) {
      return;
    }
    state = value;
    for (const listener of [
      ...listeners,
    ]) {
      if (!listeners.has(listener)) {
        continue;
      }
      try {
        listener();
      } catch (error) {
        rethrowAsync(error);
      }
    }
  };

  const subscribe = (listener: Listener): Unsubscribe => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const subscribeSelector = <S>(
    selector: (state: T) => S,
    listener: (selected: S, previous: S) => void,
    isEqual: (a: S, b: S) => boolean = Object.is,
  ): Unsubscribe => {
    let current = selector(state);
    return subscribe(() => {
      const next = selector(state);
      if (!isEqual(current, next)) {
        const previous = current;
        current = next;
        listener(next, previous);
      }
    });
  };

  return Object.freeze({
    getInitialSnapshot,
    getSnapshot,
    setState,
    subscribe,
    subscribeSelector,
  });
}
