import type {
  Action,
  AuthorizationStatus,
  Resource,
  Subject,
} from "@useguardril/core";
import { evaluateState } from "@useguardril/core";
import { useSyncExternalStore } from "react";
import { useAuthorizationStore } from "../provider/index.js";

/*
 * Every hook passes `store.getInitialSnapshot()` as the server snapshot. React uses it while
 * rendering on the server and while hydrating, so the first client render matches the server
 * HTML even if the client store already received data; React then re-renders with the live
 * state if it differs.
 */

/**
 * Whether the current subject may perform `action` on `resource`.
 *
 * Subscribes to the store through `useSyncExternalStore` with the boolean answer as the
 * snapshot, so the component re-renders only when this specific answer flips, not on every
 * store change.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 *
 * @example
 * const canEdit = useCan("update", { type: "invoice", id });
 * return <button disabled={!canEdit}>Edit</button>;
 */
export function useCan(action: Action, resource: Resource): boolean {
  const store = useAuthorizationStore();
  const getSnapshot = (): boolean => store.can(action, resource);
  const getServerSnapshot = (): boolean =>
    evaluateState(store.getInitialSnapshot(), action, resource).effect ===
    "allow";
  return useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The current subject, or `undefined` when nobody is authenticated.
 * Re-renders only when the subject itself is replaced.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 */
export function useSubject(): Subject | undefined {
  const store = useAuthorizationStore();
  const getSnapshot = (): Subject | undefined => store.getSnapshot().subject;
  const getServerSnapshot = (): Subject | undefined =>
    store.getInitialSnapshot().subject;
  return useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
}

/** The answer of {@link useAccess}. */
export type AccessState = "loading" | "allowed" | "denied";

/**
 * Like {@link useCan}, but distinguishes "still loading" from "denied", so the UI can show a
 * skeleton instead of flashing "no access" while the session loads.
 *
 * While the store is `"loading"` this returns `"loading"`. In the `"error"` state it returns
 * `"denied"` (fails closed); read {@link useAuthorizationStatus} to show an error message.
 * Re-renders only when this specific answer changes.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 *
 * @example
 * const access = useAccess("read", { type: "invoice", id });
 * if (access === "loading") return <Skeleton />;
 * return access === "allowed" ? <Invoice /> : <NoAccess />;
 */
export function useAccess(action: Action, resource: Resource): AccessState {
  const store = useAuthorizationStore();
  const getSnapshot = (): AccessState => {
    if (store.getSnapshot().status === "loading") {
      return "loading";
    }
    return store.can(action, resource) ? "allowed" : "denied";
  };
  const getServerSnapshot = (): AccessState => {
    const initial = store.getInitialSnapshot();
    if (initial.status === "loading") {
      return "loading";
    }
    return evaluateState(initial, action, resource).effect === "allow"
      ? "allowed"
      : "denied";
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The store's status: `"loading"`, `"ready"`, or `"error"`.
 * Re-renders only when the status changes.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 *
 * @example
 * const status = useAuthorizationStatus();
 * if (status === "error") return <RetryBanner />;
 */
export function useAuthorizationStatus(): AuthorizationStatus {
  const store = useAuthorizationStore();
  const getSnapshot = (): AuthorizationStatus => store.getSnapshot().status;
  const getServerSnapshot = (): AuthorizationStatus =>
    store.getInitialSnapshot().status;
  return useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Why the last load failed, or `undefined` when there is no error.
 * Re-renders only when the error changes.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 */
export function useAuthorizationError(): unknown {
  const store = useAuthorizationStore();
  const getSnapshot = (): unknown => store.getSnapshot().error;
  const getServerSnapshot = (): unknown => store.getInitialSnapshot().error;
  return useSyncExternalStore(store.subscribe, getSnapshot, getServerSnapshot);
}
