import { act, cleanup, render, screen } from "@testing-library/react";
import {
  createAbacEvaluator,
  createAuthorizationStore,
  createEngine,
  createRbacEvaluator,
} from "@useguardrail/core";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorizationProvider, useCan } from "../../src/index.js";

afterEach(cleanup);

const rbac = createRbacEvaluator({
  roles: {
    editor: {
      permissions: [
        "invoice:update",
        "report:read",
      ],
    },
  },
});
const sameTenant = createAbacEvaluator({
  policies: [
    {
      conditions: [
        {
          field: "context.tenantId",
          op: "eq",
          value: "acme",
        },
      ],
      effect: "allow",
      id: "acme-reports",
      resources: [
        "report",
      ],
    },
  ],
});

const createStore = () =>
  createAuthorizationStore({
    context: {
      tenantId: "acme",
    },
    engine: createEngine({
      evaluators: [
        rbac,
        sameTenant,
      ],
    }),
    subject: {
      id: "user:ana",
      roles: [
        "editor",
      ],
    },
  });

describe("core + react integration", () => {
  it("re-renders only the components whose own answer changed", () => {
    const renders = {
      invoice: 0,
      report: 0,
    };

    const InvoiceButton = () => {
      renders.invoice += 1;
      const allowed = useCan("update", {
        id: "1",
        type: "invoice",
      });
      return <p>invoice:{String(allowed)}</p>;
    };
    const ReportLink = () => {
      renders.report += 1;
      const allowed = useCan("read", {
        id: "1",
        type: "report",
      });
      return <p>report:{String(allowed)}</p>;
    };

    const store = createStore();
    render(
      <AuthorizationProvider store={store}>
        <InvoiceButton />
        <ReportLink />
      </AuthorizationProvider>,
    );
    expect(renders).toEqual({
      invoice: 1,
      report: 1,
    });

    // Unrelated attribute change: no answer flips, nobody re-renders.
    act(() =>
      store.setContext({
        attributes: {
          theme: "dark",
        },
        tenantId: "acme",
      }),
    );
    expect(renders).toEqual({
      invoice: 1,
      report: 1,
    });

    // Switching tenant removes the ABAC grant but RBAC still grants report:read,
    // so neither answer flips.
    act(() =>
      store.setContext({
        tenantId: "other",
      }),
    );
    expect(renders).toEqual({
      invoice: 1,
      report: 1,
    });

    // Removing the role flips both answers.
    act(() =>
      store.setSubject({
        id: "user:ana",
        roles: [],
      }),
    );
    expect(renders.invoice).toBe(2);
    expect(renders.report).toBe(2);
    expect(screen.queryByText("invoice:false")).not.toBeNull();
    expect(screen.queryByText("report:false")).not.toBeNull();
  });

  it("re-renders only the affected component when one answer flips", () => {
    const renders = {
      invoice: 0,
      report: 0,
    };

    const InvoiceButton = () => {
      renders.invoice += 1;
      return (
        <p>
          invoice:
          {String(
            useCan("update", {
              type: "invoice",
            }),
          )}
        </p>
      );
    };
    const ReportLink = () => {
      renders.report += 1;
      return (
        <p>
          report:
          {String(
            useCan("read", {
              type: "report",
            }),
          )}
        </p>
      );
    };

    const store = createAuthorizationStore({
      context: {
        tenantId: "acme",
      },
      engine: createEngine({
        evaluators: [
          sameTenant,
        ],
      }),
      subject: {
        id: "user:ana",
      },
    });
    render(
      <AuthorizationProvider store={store}>
        <InvoiceButton />
        <ReportLink />
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("report:true")).not.toBeNull();
    expect(renders).toEqual({
      invoice: 1,
      report: 1,
    });

    act(() =>
      store.setContext({
        tenantId: "other",
      }),
    );
    expect(screen.queryByText("report:false")).not.toBeNull();
    expect(renders.invoice).toBe(1);
    expect(renders.report).toBe(2);
  });

  it("picks up a swapped engine (e.g. after policies change)", () => {
    const Probe = () => (
      <p>
        {String(
          useCan("update", {
            id: "1",
            type: "invoice",
          }),
        )}
      </p>
    );
    const store = createStore();
    render(
      <AuthorizationProvider store={store}>
        <Probe />
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("true")).not.toBeNull();
    act(() =>
      store.setEngine(
        createEngine({
          evaluators: [],
        }),
      ),
    );
    expect(screen.queryByText("false")).not.toBeNull();
  });
});
