/**
 * Type-level tests for `forSchema<S>()` in @useguardril/react. Nothing here runs:
 * `pnpm run typecheck` fails if the typing regresses.
 */
import type { AuthorizationStore } from "@useguardril/core";
import { forSchema as coreForSchema } from "@useguardril/core";
import { expectTypeOf } from "vitest";
import type { AccessState } from "../../src/index.js";
import {
  AuthorizationProvider,
  Can,
  forSchema,
  useAccess,
  useCan,
} from "../../src/index.js";

type AppSchema = {
  invoice: "read" | "update" | "delete";
  user: "read" | "invite";
};

const ui = forSchema<AppSchema>();
const core = coreForSchema<AppSchema>();
const store = core.createAuthorizationStore({
  engine: core.createEngine({
    evaluators: [],
  }),
});

// ---- Hooks ----

export const Hooks = () => {
  const canUpdate = ui.useCan("update", {
    id: "1",
    type: "invoice",
  });
  const access = ui.useAccess("invite", {
    type: "user",
  });
  expectTypeOf(canUpdate).toEqualTypeOf<boolean>();
  expectTypeOf(access).toEqualTypeOf<AccessState>();

  // @ts-expect-error "invite" is not an invoice action
  ui.useCan("invite", {
    type: "invoice",
  });
  ui.useAccess("read", {
    // @ts-expect-error "order" is not a resource type of the schema
    type: "order",
  });
  return null;
};

// ---- Can ----

export const Elements = (
  <>
    <ui.Can
      action="update"
      resource={{
        type: "invoice",
      }}
    >
      ok
    </ui.Can>
    <ui.Can
      action="invite"
      loading="…"
      resource={{
        type: "user",
      }}
    >
      ok
    </ui.Can>
    <ui.Can
      // @ts-expect-error "invite" is not an invoice action
      action="invite"
      resource={{
        type: "invoice",
      }}
    />
  </>
);

// ---- Provider and store ----

expectTypeOf(ui.useAuthorizationStore).returns.toEqualTypeOf<
  AuthorizationStore<AppSchema>
>();
export const Provided = (
  <ui.AuthorizationProvider store={store}>
    <Hooks />
  </ui.AuthorizationProvider>
);
// The untyped provider also accepts a schema-bound store.
export const AlsoProvided = (
  <AuthorizationProvider store={store}>
    <Hooks />
  </AuthorizationProvider>
);

// ---- The untyped exports stay loose ----

export const Loose = () => {
  useCan("anything", {
    type: "anything",
  });
  useAccess("whatever", {
    type: "whatever",
  });
  return (
    <Can
      action="anything"
      resource={{
        type: "anything",
      }}
    />
  );
};
