import { createContext } from "../context/index.js";
import type { Engine, EvaluatorTrace } from "../engine/index.js";
import { InvalidContextError, InvalidPolicyError } from "../errors.js";
import { ownProperty } from "../own.js";
import { rethrowAsync } from "../report.js";
import type {
  Context,
  Decision,
  EvaluationInput,
  ResourceFor,
  ResourceName,
  Schema,
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
export type AuthorizationState<S extends Schema = Schema> = {
  readonly context: Context;
  readonly engine: Engine<S>;
  /** The current actor, or `undefined` when nobody is authenticated (everything is denied). */
  readonly subject: Subject | undefined;
  readonly status: AuthorizationStatus;
  /** Why the last load failed, while `status` is `"error"`; otherwise `undefined`. */
  readonly error: unknown;
};

/**
 * Everything about one check made through the store: the request, the state it ran in, and the
 * decision. Meant for debugging and auditing; treat it as read-only.
 */
export type StoreDecisionEvent<S extends Schema = Schema> = {
  readonly action: S[ResourceName<S>];
  readonly resource: ResourceFor<ResourceName<S>>;
  readonly subject: Subject | undefined;
  readonly context: Context;
  /** The store's status when the check ran. */
  readonly status: AuthorizationStatus;
  readonly decision: Decision;
  /**
   * What each consulted evaluator answered. Empty when the engine was not consulted
   * (the store was loading or in error, or nobody was signed in).
   */
  readonly trace: readonly EvaluatorTrace[];
};

/** Configuration for {@link createAuthorizationStore}. */
export type AuthorizationStoreConfig<S extends Schema = Schema> = {
  /** An engine for the schema, or one without a schema (it accepts any request). */
  readonly engine: Engine<S> | Engine;
  readonly subject?: Subject;
  readonly context?: Context;
  /**
   * Initial status. Defaults to `"ready"`. Pass `"loading"` when the subject is not known yet
   * (for example, a session request is in flight) so checks are denied as "loading", and the UI
   * can show a skeleton instead of flashing "no access".
   */
  readonly status?: "loading" | "ready";
  /**
   * Called after every check made through the store (`can`, `evaluate`, `explain`), including
   * checks denied because the store is loading, failed, or has no subject, which never reach
   * the engine. Use it for debugging and auditing; the library itself never logs.
   *
   * Components call `can` during render, so this fires on every such check (and more than once
   * per render in React). It cannot change the decision; if it throws, the error is rethrown
   * asynchronously. The event contains the subject and context, so redact it before sending it
   * anywhere. The engine has its own `onDecision` for evaluations.
   */
  readonly onDecision?: (event: StoreDecisionEvent<S>) => void;
};

/**
 * What a loader returns. Only the fields that are present are applied, all at once:
 * omit a field to keep its current value, or pass `subject: undefined` to sign out.
 */
export type AuthorizationLoadResult<S extends Schema = Schema> = {
  readonly subject?: Subject | undefined;
  readonly context?: Context;
  readonly engine?: Engine<S> | Engine;
};

/**
 * Fetches authorization data. `signal` is aborted when a newer `load` starts, so you can
 * pass it to `fetch` to cancel the outdated request.
 */
export type AuthorizationLoader<S extends Schema = Schema> = (options: {
  readonly signal: AbortSignal;
}) => Promise<AuthorizationLoadResult<S>> | AuthorizationLoadResult<S>;

/** A reactive store that couples an engine with the current subject and context. */
export type AuthorizationStore<S extends Schema = Schema> = Pick<
  Store<AuthorizationState<S>>,
  "getInitialSnapshot" | "getSnapshot" | "subscribe" | "subscribeSelector"
> & {
  /**
   * Evaluates an action against the current subject, context, and engine. Never throws.
   * While `status` is `"loading"` or `"error"`, the result is always `deny`.
   */
  readonly evaluate: <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ) => Decision;
  /**
   * Like `evaluate`, but returns the whole {@link StoreDecisionEvent}: the decision, the state
   * it ran in, and what each evaluator answered. Use it to find out why something was denied.
   * It reports to `onDecision` like `evaluate` does. Never throws.
   *
   * @example
   * const { decision, status, trace } = store.explain("update", { type: "invoice", id });
   */
  readonly explain: <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ) => StoreDecisionEvent<S>;
  /** Shorthand for `evaluate(...).effect === "allow"`. */
  readonly can: <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ) => boolean;
  /** Sets (or clears, with `undefined`) the current subject. Does not change `status`. */
  readonly setSubject: (subject: Subject | undefined) => void;
  /** Replaces the context, e.g. when switching tenant. Does not change `status`. */
  readonly setContext: (context: Context) => void;
  /** Replaces the engine, e.g. after policies or relations changed. Does not change `status`. */
  readonly setEngine: (engine: Engine<S> | Engine) => void;
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
  readonly load: (loader: AuthorizationLoader<S>) => Promise<void>;
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

const assertEngine = <S extends Schema = Schema>(
  engine: unknown,
): Engine<S> => {
  if (
    typeof engine !== "object" ||
    engine === null ||
    typeof (engine as Engine<S>).evaluate !== "function"
  ) {
    throw new InvalidPolicyError(
      "An engine created with createEngine is required.",
      {
        code: "ENGINE_REQUIRED",
      },
    );
  }
  return engine as Engine<S>;
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
 * Evaluates an action against a given store state, without touching any store. Pure and never
 * throws. While the state's `status` is `"loading"` or `"error"` the result is always `deny`.
 *
 * `store.evaluate` is this function applied to the current state; UI adapters also use it on
 * `store.getInitialSnapshot()` to render the same answer on the server and during hydration.
 *
 * @example
 * evaluateState(store.getInitialSnapshot(), "read", { type: "doc", id: "1" });
 */
export function evaluateState<
  S extends Schema = Schema,
  T extends ResourceName<S> = ResourceName<S>,
>(
  state: AuthorizationState<S>,
  action: S[T],
  resource: ResourceFor<T>,
): Decision {
  const { context, engine, status, subject } = state;
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
      } as EvaluationInput<S>)
    : NO_SUBJECT;
}

const explainState = <S extends Schema, T extends ResourceName<S>>(
  state: AuthorizationState<S>,
  action: S[T],
  resource: ResourceFor<T>,
): StoreDecisionEvent<S> => {
  const { context, engine, status, subject } = state;
  let decision: Decision;
  let trace: readonly EvaluatorTrace[] = [];
  if (status === "loading") {
    decision = LOADING;
  } else if (status === "error") {
    decision = LOAD_FAILED;
  } else if (!subject) {
    decision = NO_SUBJECT;
  } else {
    const input = {
      action,
      context,
      resource,
      subject,
    } as EvaluationInput<S>;
    // A hand-written engine may not have `explain`; fall back to a decision without a trace.
    if (typeof engine.explain === "function") {
      ({ decision, trace } = engine.explain(input));
    } else {
      decision = engine.evaluate(input);
    }
  }
  return Object.freeze({
    action,
    context,
    decision,
    resource,
    status,
    subject,
    trace,
  }) as unknown as StoreDecisionEvent<S>;
};

/**
 * Creates the reactive authorization store consumed by UI adapters.
 * Pair `can` with `subscribe`/`getSnapshot` so a component only re-renders when its own
 * answer changes.
 *
 * @throws {InvalidPolicyError} If `engine` is not an engine, or `onDecision` is not a function.
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
export function createAuthorizationStore<S extends Schema = Schema>(
  config: AuthorizationStoreConfig<S>,
): AuthorizationStore<S> {
  const onDecision: unknown = config?.onDecision;
  if (onDecision !== undefined && typeof onDecision !== "function") {
    throw new InvalidPolicyError(
      "Store config requires `onDecision` to be a function.",
      {
        code: "ON_DECISION_INVALID",
      },
    );
  }
  const hook = onDecision as
    | ((event: StoreDecisionEvent<S>) => void)
    | undefined;

  const store = createStore<AuthorizationState<S>>({
    context: createContext(config?.context),
    engine: assertEngine<S>(config?.engine),
    error: undefined,
    status: config.status === "loading" ? "loading" : "ready",
    subject: assertSubject(config.subject),
  });

  const explain = <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ): StoreDecisionEvent<S> => {
    const event = explainState<S, T>(store.getSnapshot(), action, resource);
    if (hook !== undefined) {
      try {
        hook(event);
      } catch (error) {
        rethrowAsync(error);
      }
    }
    return event;
  };

  const evaluate = <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ): Decision =>
    hook === undefined
      ? evaluateState<S, T>(store.getSnapshot(), action, resource)
      : explain<T>(action, resource).decision;

  let current: AbortController | undefined;

  const load = async (loader: AuthorizationLoader<S>): Promise<void> => {
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
        engine?: Engine<S>;
        subject?: Subject | undefined;
      } = {};
      if (Object.hasOwn(result, "subject")) {
        next.subject = assertSubject(ownProperty(result, "subject"));
      }
      if (Object.hasOwn(result, "context")) {
        next.context = createContext(ownProperty(result, "context") as Context);
      }
      if (Object.hasOwn(result, "engine")) {
        next.engine = assertEngine<S>(ownProperty(result, "engine"));
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
    can: <T extends ResourceName<S>>(
      action: S[T],
      resource: ResourceFor<T>,
    ): boolean => evaluate<T>(action, resource).effect === "allow",
    evaluate,
    explain,
    getInitialSnapshot: store.getInitialSnapshot,
    getSnapshot: store.getSnapshot,
    load,
    setContext: (context: Context): void => {
      const next = createContext(context);
      store.setState((state) => ({
        ...state,
        context: next,
      }));
    },
    setEngine: (engine: Engine<S> | Engine): void => {
      const next = assertEngine<S>(engine);
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
