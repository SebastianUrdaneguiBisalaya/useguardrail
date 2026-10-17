import type { Action, Resource } from "@useguardrail/core";
import type { ReactElement, ReactNode } from "react";
import { useAccess } from "../hooks/index.js";

/** Props for {@link Can}. */
export type CanProps = {
  readonly action: Action;
  readonly resource: Resource;
  /** Rendered when the subject is allowed. */
  readonly children?: ReactNode;
  /** Rendered when the subject is not allowed. Defaults to nothing. */
  readonly fallback?: ReactNode;
  /**
   * Rendered while the authorization data is still loading. Defaults to `fallback`, so
   * without it the component behaves as "denied" until the data arrives.
   */
  readonly loading?: ReactNode;
};

/**
 * Renders `children` only when the current subject may perform `action` on `resource`.
 * This is UI gating, not security: the backend must enforce every decision again.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 *
 * @example
 * <Can
 *   action="update"
 *   resource={{ type: "invoice", id }}
 *   loading={<Skeleton />}
 *   fallback={<ReadOnlyBadge />}
 * >
 *   <EditButton />
 * </Can>
 */
export function Can({
  action,
  children,
  fallback = null,
  loading = fallback,
  resource,
}: CanProps): ReactElement {
  const access = useAccess(action, resource);
  if (access === "loading") {
    return <>{loading}</>;
  }
  return <>{access === "allowed" ? children : fallback}</>;
}
