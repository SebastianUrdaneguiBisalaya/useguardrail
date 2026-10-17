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

/**
 * Where the authorization data is in its lifecycle:
 * - `"ready"`: the subject, context, and engine are usable (a missing subject means signed out).
 * - `"loading"`: data is still on its way; every check is denied.
 * - `"error"`: loading failed; every check is denied.
 */
export type AuthorizationStatus = "loading" | "ready" | "error";

/** What an {@link AuthorizationStore} holds. Replaced (never mutated) on every change. */
export type AuthorizationState = {
  readonly context: Context;
  readonly engine: Engine;
  /** The current actor, or `undefined` when nobody is authenticated (everything is denied). */
  readonly subject: Subject | undefined;
  readonly status: AuthorizationStatus;
  /** Why the last load failed, while `status` is `"error"`; otherwise `undefined`. */
  readonly error: unknown;
};

/** Configuration for {@link createAuthorizationStore}. */
export type AuthorizationStoreConfig = {
  readonly engine: Engine;
  readonly subject?: Subject;
  readonly context?: Context;
  /**
   * Initial status. Defaults to `"ready"`. Pass `"loading"` when the subject is not known yet
   * (for example, a session request is in flight) so checks are denied as "loading", and the UI
   * can show a skeleton instead of flashing "no access".
   */
  readonly status?: "loading" | "ready";
};

/**
 * What a loader returns. Only the fields that are present are applied, all at once:
 * omit a field to keep its current value, or pass `subject: undefined` to sign out.
 */
export type AuthorizationLoadResult = {
  readonly subject?: Subject | undefined;
  readonly context?: Context;
  readonly engine?: Engine;
};

/**
 * Fetches authorization data. `signal` is aborted when a newer `load` starts, so you can
 * pass it to `fetch` to cancel the outdated request.
 */
export type AuthorizationLoader = (options: {
  readonly signal: AbortSignal;
}) => Promise<AuthorizationLoadResult> | AuthorizationLoadResult;

/** A reactive store that couples an engine with the current subject and context. */
export type AuthorizationStore = Pick<
  Store<AuthorizationState>,
  "getSnapshot" | "subscribe" | "subscribeSelector"
> & {
  /**
   * Evaluates an action against the current subject, context, and engine. Never throws.
   * While `status` is `"loading"` or `"error"`, the result is always `deny`.
   */
  readonly evaluate: (action: Action, resource: Resource) => Decision;
  /** Shorthand for `evaluate(...).effect === "allow"`. */
  readonly can: (action: Action, resource: Resource) => boolean;
  /** Sets (or clears, with `undefined`) the current subject. Does not change `status`. */
  readonly setSubject: (subject: Subject | undefined) => void;
  /** Replaces the context, e.g. when switching tenant. Does not change `status`. */
  readonly setContext: (context: Context) => void;
  /** Replaces the engine, e.g. after policies or relations changed. Does not change `status`. */
  readonly setEngine: (engine: Engine) => void;
  /**
   * Sets the status by hand, clearing any error. Prefer {@link AuthorizationStore.load},
   * which manages the status for you.
   */
  readonly setStatus: (status: "loading" | "ready") => void;
  /** Puts the store in the `"error"` state with the given cause. Every check is denied. */
  readonly setError: (error: unknown) => void;
  /**
   * Runs an async loader and applies its result atomically.
   *
   * Evaluation stays synchronous; only the data fetching is async. The status goes
   * `"loading"` → `"ready"`, or `"error"` if the loader throws or returns invalid data.
   * Never rejects. If a newer `load` starts first, the older one is aborted and its
   * result is ignored, so a slow stale response can never overwrite fresh data.
   */
  readonly load: (loader: AuthorizationLoader) => Promise<void>;
};

const deny = (code: string, reason: string): Decision =>
  Object.freeze({
    code,
    effect: "deny",
    reason,
  });

const NO_SUBJECT = deny("NO_SUBJECT", "No subject; access denied.");
const LOADING = deny(
  "LOADING",
  "Authorization data is still loading; access denied.",
);
const LOAD_FAILED = deny(
  "LOAD_FAILED",
  "Authorization data failed to load; access denied.",
);

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
 *
 * @example
 * // Session not known yet: start in "loading" and let `load` fill it in.
 * const store = createAuthorizationStore({ engine, status: "loading" });
 * await store.load(async ({ signal }) => {
 *   const me = await fetch("/api/me", { signal }).then((r) => r.json());
 *   return { subject: { id: me.id, roles: me.roles }, context: { tenantId: me.tenant } };
 * });
 */
export function createAuthorizationStore(
  config: AuthorizationStoreConfig,
): AuthorizationStore {
  const store = createStore<AuthorizationState>({
    context: createContext(config?.context),
    engine: assertEngine(config?.engine),
    error: undefined,
    status: config.status === "loading" ? "loading" : "ready",
    subject: assertSubject(config.subject),
  });

  const evaluate = (action: Action, resource: Resource): Decision => {
    const { context, engine, status, subject } = store.getSnapshot();
    if (status === "loading") {
      return LOADING;
    }
    if (status === "error") {
      return LOAD_FAILED;
    }
    return subject
      ? engine.evaluate({
          action,
          context,
          resource,
          subject,
        })
      : NO_SUBJECT;
  };

  let current: AbortController | undefined;

  const load = async (loader: AuthorizationLoader): Promise<void> => {
    if (typeof loader !== "function") {
      throw new InvalidPolicyError("`load` requires a loader function.", {
        code: "LOADER_INVALID",
      });
    }

    current?.abort();
    const controller = new AbortController();
    current = controller;
    store.setState((state) =>
      state.status === "loading" && state.error === undefined
        ? state
        : {
            ...state,
            error: undefined,
            status: "loading",
          },
    );

    try {
      const result: unknown = await loader({
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      if (typeof result !== "object" || result === null) {
        throw new InvalidContextError(
          "A loader must return an object with `subject`, `context`, and/or `engine`.",
          {
            code: "LOAD_RESULT_INVALID",
          },
        );
      }

      const next: {
        context?: Context;
        engine?: Engine;
        subject?: Subject | undefined;
      } = {};
      if (Object.hasOwn(result, "subject")) {
        next.subject = assertSubject(ownProperty(result, "subject"));
      }
      if (Object.hasOwn(result, "context")) {
        next.context = createContext(ownProperty(result, "context") as Context);
      }
      if (Object.hasOwn(result, "engine")) {
        next.engine = assertEngine(ownProperty(result, "engine"));
      }
      store.setState((state) => ({
        ...state,
        ...next,
        error: undefined,
        status: "ready",
      }));
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      store.setState((state) => ({
        ...state,
        error,
        status: "error",
      }));
    }
  };

  return Object.freeze({
    can: (action: Action, resource: Resource): boolean =>
      evaluate(action, resource).effect === "allow",
    evaluate,
    getSnapshot: store.getSnapshot,
    load,
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
    setError: (error: unknown): void => {
      store.setState((state) => ({
        ...state,
        error,
        status: "error",
      }));
    },
    setStatus: (status: "loading" | "ready"): void => {
      const target = status === "loading" ? "loading" : "ready";
      store.setState((state) =>
        state.status === target && state.error === undefined
          ? state
          : {
              ...state,
              error: undefined,
              status: target,
            },
      );
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
