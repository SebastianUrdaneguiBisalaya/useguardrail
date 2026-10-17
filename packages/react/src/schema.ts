import type {
  AuthorizationStore,
  ResourceFor,
  ResourceName,
  Schema,
} from "@useguardrail/core";
import type { ReactElement, ReactNode } from "react";
import { Can } from "./components/index.js";
import type { AccessState } from "./hooks/index.js";
import { useAccess, useCan } from "./hooks/index.js";
import type { AuthorizationProviderProps } from "./provider/index.js";
import {
  AuthorizationProvider,
  useAuthorizationStore,
} from "./provider/index.js";

/** Props for the `Can` component of a {@link SchemaKit}. */
export type SchemaCanProps<S extends Schema, T extends ResourceName<S>> = {
  readonly action: S[T];
  readonly resource: ResourceFor<T>;
  /** Rendered when the subject is allowed. */
  readonly children?: ReactNode;
  /** Rendered when the subject is not allowed. Defaults to nothing. */
  readonly fallback?: ReactNode;
  /** Rendered while the authorization data is still loading. Defaults to `fallback`. */
  readonly loading?: ReactNode;
};

/** The provider, hooks, and `Can` of `@useguardrail/react`, bound to one {@link Schema}. */
export type SchemaKit<S extends Schema> = {
  readonly AuthorizationProvider: (
    props: AuthorizationProviderProps<S>,
  ) => ReactElement;
  readonly Can: <T extends ResourceName<S>>(
    props: SchemaCanProps<S, T>,
  ) => ReactElement;
  readonly useCan: <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ) => boolean;
  readonly useAccess: <T extends ResourceName<S>>(
    action: S[T],
    resource: ResourceFor<T>,
  ) => AccessState;
  readonly useAuthorizationStore: () => AuthorizationStore<S>;
};

/**
 * Binds the provider, `Can`, `useCan`, and `useAccess` to your schema, so actions and resource
 * types are checked at compile time. At runtime these are the very same functions; only the
 * types change. Use the same `AppSchema` you gave to `forSchema` from `@useguardrail/core`.
 *
 * @example
 * type AppSchema = { invoice: "read" | "update"; user: "read" | "invite" };
 *
 * export const { Can, useCan, useAccess } = forSchema<AppSchema>();
 *
 * useCan("update", { type: "invoice", id }); // ok
 * useCan("invite", { type: "invoice" }); // compile error: "invite" is a user action
 * <Can action="invite" resource={{ type: "user" }}>...</Can>; // ok
 */
export function forSchema<S extends Schema>(): SchemaKit<S> {
  return Object.freeze({
    AuthorizationProvider,
    Can,
    useAccess,
    useAuthorizationStore,
    useCan,
  }) as unknown as SchemaKit<S>;
}
