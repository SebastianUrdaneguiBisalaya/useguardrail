import { createContext } from "../context/index.js";
import type { Engine } from "../engine/index.js";
import { InvalidContextError, InvalidPolicyError } from "../errors.js";
import { ownProperty } from "../own.js";
import type {
  Action,
  Context,
  Decision,
  Resource,
  Subject,
} from "../types/index.js";
import type { Store } from "./index.js";
import { createStore } from "./index.js";

/** What an {@link AuthorizationStore} holds. Replaced (never mutated) on every change. */
export type AuthorizationState = {
  readonly context: Context;
  readonly engine: Engine;
  /** The current actor, or `undefined` when nobody is authenticated (everything is denied). */
  readonly subject: Subject | undefined;
};

/** Configuration for {@link createAuthorizationStore}. */
export type AuthorizationStoreConfig = {
  readonly engine: Engine;
  readonly subject?: Subject;
  readonly context?: Context;
};

/** A reactive store that couples an engine with the current subject and context. */
export type AuthorizationStore = Pick<
  Store<AuthorizationState>,
  "getSnapshot" | "subscribe" | "subscribeSelector"
> & {
  /** Evaluates an action against the current subject, context, and engine. Never throws. */
  readonly evaluate: (action: Action, resource: Resource) => Decision;
  /** Shorthand for `evaluate(...).effect === "allow"`. */
  readonly can: (action: Action, resource: Resource) => boolean;
  /** Sets (or clears, with `undefined`) the current subject. */
  readonly setSubject: (subject: Subject | undefined) => void;
  /** Replaces the context, e.g. when switching tenant. */
  readonly setContext: (context: Context) => void;
  /** Replaces the engine, e.g. after policies or relations changed. */
  readonly setEngine: (engine: Engine) => void;
};

const NO_SUBJECT: Decision = Object.freeze({
  code: "NO_SUBJECT",
  effect: "deny",
  reason: "No subject; access denied.",
});

const assertEngine = (engine: unknown): Engine => {
  if (
    typeof engine !== "object" ||
    engine === null ||
    typeof (engine as Engine).evaluate !== "function"
  ) {
    throw new InvalidPolicyError(
      "An engine created with createEngine is required.",
      {
        code: "ENGINE_REQUIRED",
      },
    );
  }
  return engine as Engine;
};

const assertSubject = (subject: unknown): Subject | undefined => {
  if (subject === undefined) {
    return undefined;
  }
  const id =
    typeof subject === "object" && subject !== null
      ? ownProperty(subject, "id")
      : undefined;
  if (typeof id !== "string" || id === "") {
    throw new InvalidContextError(
      "Subject must be an object with a non-empty string `id`.",
      {
        code: "SUBJECT_INVALID",
      },
    );
  }
  return subject as Subject;
};

/**
 * Creates the reactive authorization store consumed by UI adapters.
 * Pair `can` with `subscribe`/`getSnapshot` so a component only re-renders when its own
 * answer changes.
 *
 * @throws {InvalidPolicyError} If `engine` is not an engine.
 * @throws {InvalidContextError} If `subject` or `context` is malformed.
 *
 * @example
 * const store = createAuthorizationStore({ engine, subject: { id: "user:ana" }, context: { tenantId: "acme" } });
 * store.can("read", { type: "doc", id: "1" });
 * store.setContext({ tenantId: "other" }); // subscribers are notified
 */
export function createAuthorizationStore(
  config: AuthorizationStoreConfig,
): AuthorizationStore {
  const store = createStore<AuthorizationState>({
    context: createContext(config?.context),
    engine: assertEngine(config?.engine),
    subject: assertSubject(config.subject),
  });

  const evaluate = (action: Action, resource: Resource): Decision => {
    const { context, engine, subject } = store.getSnapshot();
    return subject
      ? engine.evaluate({
          action,
          context,
          resource,
          subject,
        })
      : NO_SUBJECT;
  };

  return Object.freeze({
    can: (action: Action, resource: Resource): boolean =>
      evaluate(action, resource).effect === "allow",
    evaluate,
    getSnapshot: store.getSnapshot,
    setContext: (context: Context): void => {
      const next = createContext(context);
      store.setState((state) => ({
        ...state,
        context: next,
      }));
    },
    setEngine: (engine: Engine): void => {
      const next = assertEngine(engine);
      store.setState((state) => ({
        ...state,
        engine: next,
      }));
    },
    setSubject: (subject: Subject | undefined): void => {
      const next = assertSubject(subject);
      store.setState((state) => ({
        ...state,
        subject: next,
      }));
    },
    subscribe: store.subscribe,
    subscribeSelector: store.subscribeSelector,
  });
}
