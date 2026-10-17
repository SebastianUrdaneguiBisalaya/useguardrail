import type { Action, Resource } from "@useguardril/core";
import type { ReactElement, ReactNode } from "react";
import { useCan } from "../hooks/index.js";

/** Props for {@link Can}. */
export type CanProps = {
  readonly action: Action;
  readonly resource: Resource;
  /** Rendered when the subject is allowed. */
  readonly children?: ReactNode;
  /** Rendered when the subject is not allowed. Defaults to nothing. */
  readonly fallback?: ReactNode;
};

/**
 * Renders `children` only when the current subject may perform `action` on `resource`.
 * This is UI gating, not security: the backend must enforce every decision again.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 *
 * @example
 * <Can action="update" resource={{ type: "invoice", id }} fallback={<ReadOnlyBadge />}>
 *   <EditButton />
 * </Can>
 */
export function Can({
  action,
  children,
  fallback = null,
  resource,
}: CanProps): ReactElement {
  const allowed = useCan(action, resource);
  return <>{allowed ? children : fallback}</>;
}
