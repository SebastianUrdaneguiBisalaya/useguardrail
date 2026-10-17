/**
 * Type-level tests for the public API of @useguardril/adapters. Nothing here runs:
 * `pnpm run typecheck` (tsc) fails if the declared contract changes.
 */
import type {
  Context,
  RelationTuple,
  RoleDefinition,
  Subject,
} from "@useguardril/core";
import { expectTypeOf } from "vitest";
import type {
  Adapter,
  RolesMapping,
  Session,
  SessionMapping,
  TuplesMapping,
} from "../../src/index.js";
import {
  createRolesAdapter,
  createSessionAdapter,
  createTuplesAdapter,
  openFgaTuplesAdapter,
  spiceDbTuplesAdapter,
} from "../../src/index.js";

expectTypeOf<Adapter<number>>().toEqualTypeOf<(response: unknown) => number>();

expectTypeOf<Session>().toEqualTypeOf<{
  readonly subject: Subject;
  readonly context: Context;
}>();
expectTypeOf(createSessionAdapter).parameter(0).toEqualTypeOf<SessionMapping>();
expectTypeOf(createSessionAdapter).returns.toEqualTypeOf<Adapter<Session>>();
expectTypeOf<SessionMapping["subjectId"]>().toEqualTypeOf<string>();
expectTypeOf<SessionMapping["tenantId"]>().toEqualTypeOf<string | undefined>();

expectTypeOf(createRolesAdapter).parameter(0).toEqualTypeOf<RolesMapping>();
expectTypeOf(createRolesAdapter).returns.toEqualTypeOf<
  Adapter<Record<string, RoleDefinition>>
>();

expectTypeOf(createTuplesAdapter).parameter(0).toEqualTypeOf<TuplesMapping>();
expectTypeOf(createTuplesAdapter).returns.toEqualTypeOf<
  Adapter<RelationTuple[]>
>();
expectTypeOf(openFgaTuplesAdapter).toEqualTypeOf<Adapter<RelationTuple[]>>();
expectTypeOf(spiceDbTuplesAdapter).toEqualTypeOf<Adapter<RelationTuple[]>>();

// @ts-expect-error `subjectId` is required
createSessionAdapter({});
// @ts-expect-error `name` and `permissions` are required
createRolesAdapter({
  list: "roles",
});
// @ts-expect-error `object`, `relation`, and `subject` are required
createTuplesAdapter({
  list: "grants",
});
