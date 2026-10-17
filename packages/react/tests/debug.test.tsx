import { cleanup, render, screen } from "@testing-library/react";
import type { StoreDecisionEvent } from "@useguardrail/core";
import { createAuthorizationStore } from "@useguardrail/core";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorizationProvider, Can, useCan } from "../src/index.js";
import { engine } from "./setup.js";

afterEach(cleanup);

const resource = {
  id: "1",
  type: "invoice",
};

describe("debugging checks made from components", () => {
  it("reports each check a component makes to the store's onDecision", () => {
    const events: StoreDecisionEvent[] = [];
    const store = createAuthorizationStore({
      engine,
      onDecision: (event) => events.push(event),
      subject: {
        id: "user:ana",
        roles: [
          "viewer",
        ],
      },
    });

    const Probe = () => <p>{String(useCan("update", resource))}</p>;
    render(
      <AuthorizationProvider store={store}>
        <Probe />
        <Can
          action="read"
          resource={resource}
        >
          <p>content</p>
        </Can>
      </AuthorizationProvider>,
    );

    expect(screen.queryByText("false")).not.toBeNull();
    expect(screen.queryByText("content")).not.toBeNull();

    // React may check more than once per render, so look at which checks happened, not how many.
    const byAction = new Map(
      events.map((event) => [
        event.action,
        event.decision,
      ]),
    );
    expect(byAction.get("update")).toMatchObject({
      code: "DEFAULT_DENY",
      effect: "deny",
    });
    expect(byAction.get("read")).toMatchObject({
      code: "ROLE_GRANTS",
      effect: "allow",
    });
  });

  it("lets you ask the store why a component is hidden", () => {
    const store = createAuthorizationStore({
      engine,
      status: "loading",
      subject: {
        id: "user:ana",
        roles: [
          "viewer",
        ],
      },
    });
    render(
      <AuthorizationProvider store={store}>
        <Can
          action="read"
          fallback={<p>hidden</p>}
          resource={resource}
        >
          <p>content</p>
        </Can>
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("hidden")).not.toBeNull();
    expect(store.explain("read", resource).decision.code).toBe("LOADING");
  });
});
