import { act, cleanup, render, screen } from "@testing-library/react";
import { forSchema as coreForSchema } from "@useguardrail/core";
import { afterEach, describe, expect, it } from "vitest";
import { Can, forSchema, useAccess, useCan } from "../src/index.js";

afterEach(cleanup);

type AppSchema = {
  invoice: "read" | "update";
  user: "read" | "invite";
};

const core = coreForSchema<AppSchema>();
const ui = forSchema<AppSchema>();

const rbac = core.createRbacEvaluator({
  roles: {
    admin: {
      permissions: [
        "user:invite",
        "invoice:*",
      ],
    },
    viewer: {
      permissions: [
        "*:read",
      ],
    },
  },
});
const makeStore = (roles: string[]) =>
  core.createAuthorizationStore({
    engine: core.createEngine({
      evaluators: [
        rbac,
      ],
    }),
    subject: {
      id: "user:ana",
      roles,
    },
  });

describe("forSchema (react)", () => {
  it("exposes the very same components and hooks, only retyped", () => {
    expect(ui.Can).toBe(Can);
    expect(ui.useCan).toBe(useCan);
    expect(ui.useAccess).toBe(useAccess);
    expect(Object.isFrozen(ui)).toBe(true);
  });

  it("works end to end with a typed provider, hooks, and Can", () => {
    const store = makeStore([
      "viewer",
    ]);

    const Probe = () => {
      const canRead = ui.useCan("read", {
        id: "1",
        type: "invoice",
      });
      const access = ui.useAccess("invite", {
        type: "user",
      });
      return <p>{`${canRead}:${access}`}</p>;
    };

    render(
      <ui.AuthorizationProvider store={store}>
        <Probe />
        <ui.Can
          action="update"
          fallback={<p>read only</p>}
          resource={{
            id: "1",
            type: "invoice",
          }}
        >
          <p>can edit</p>
        </ui.Can>
      </ui.AuthorizationProvider>,
    );
    expect(screen.queryByText("true:denied")).not.toBeNull();
    expect(screen.queryByText("read only")).not.toBeNull();

    act(() =>
      store.setSubject({
        id: "user:ana",
        roles: [
          "admin",
        ],
      }),
    );
    expect(screen.queryByText("false:allowed")).toBeNull();
    expect(screen.queryByText("can edit")).not.toBeNull();
  });
});
