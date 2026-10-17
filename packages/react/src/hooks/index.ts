import type { Action, Resource, Subject } from "@useguardril/core";
import { useSyncExternalStore } from "react";
import { useAuthorizationStore } from "../provider/index.js";

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
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
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
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
