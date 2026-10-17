/**
 * Type-level tests for the public API of @useguardrail/react. Nothing here runs:
 * `pnpm run typecheck` (tsc) fails if the declared contract changes.
 */
import type {
  Action,
  AuthorizationError,
  AuthorizationStatus,
  AuthorizationStore,
  ErrorCode,
  Resource,
  Subject,
} from "@useguardrail/core";
import type { ReactElement, ReactNode } from "react";
import { expectTypeOf } from "vitest";
import type {
  AccessState,
  AuthorizationProviderProps,
  CanProps,
} from "../../src/index.js";
import {
  AuthorizationProvider,
  Can,
  type MissingProviderError,
  useAccess,
  useAuthorizationError,
  useAuthorizationStatus,
  useAuthorizationStore,
  useCan,
  useSubject,
} from "../../src/index.js";

declare const store: AuthorizationStore;
declare const resource: Resource;

// ---- Hooks ----

expectTypeOf(useCan).parameters.toEqualTypeOf<
  [
    Action,
    Resource,
  ]
>();
expectTypeOf(useCan).returns.toEqualTypeOf<boolean>();
expectTypeOf<AccessState>().toEqualTypeOf<"loading" | "allowed" | "denied">();
expectTypeOf(useAccess).parameters.toEqualTypeOf<
  [
    Action,
    Resource,
  ]
>();
expectTypeOf(useAccess).returns.toEqualTypeOf<AccessState>();
expectTypeOf(useSubject).returns.toEqualTypeOf<Subject | undefined>();
expectTypeOf(
  useAuthorizationStatus,
).returns.toEqualTypeOf<AuthorizationStatus>();
expectTypeOf(useAuthorizationError).returns.toEqualTypeOf<unknown>();
expectTypeOf(useAuthorizationStore).returns.toEqualTypeOf<AuthorizationStore>();

// ---- Components ----

expectTypeOf<
  AuthorizationProviderProps["store"]
>().toEqualTypeOf<AuthorizationStore>();
expectTypeOf<AuthorizationProviderProps["children"]>().toEqualTypeOf<
  ReactNode | undefined
>();
expectTypeOf(AuthorizationProvider).returns.toEqualTypeOf<ReactElement>();

expectTypeOf<CanProps["action"]>().toEqualTypeOf<Action>();
expectTypeOf<CanProps["resource"]>().toEqualTypeOf<Resource>();
expectTypeOf<CanProps["children"]>().toEqualTypeOf<ReactNode | undefined>();
expectTypeOf<CanProps["fallback"]>().toEqualTypeOf<ReactNode | undefined>();
expectTypeOf<CanProps["loading"]>().toEqualTypeOf<ReactNode | undefined>();
expectTypeOf(Can).returns.toEqualTypeOf<ReactElement>();

// @ts-expect-error a store is required
<AuthorizationProvider />;
// @ts-expect-error `action` is required
<Can resource={resource} />;
// @ts-expect-error `resource` is required
<Can action="read" />;
declare const notANode: {
  bad: true;
};
<Can
  action="read"
  // @ts-expect-error `loading` takes a renderable node, not an arbitrary object
  loading={notANode}
  resource={resource}
/>;
export const _provider = <AuthorizationProvider store={store} />;

// ---- Errors ----

expectTypeOf<MissingProviderError>().toExtend<AuthorizationError>();
expectTypeOf<MissingProviderError["code"]>().toEqualTypeOf<ErrorCode>();
