import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorizationProvider, Can } from "../src/index.js";
import { createTestStore } from "./setup.js";

afterEach(cleanup);

const resource = {
  id: "1",
  type: "invoice",
};

describe("<Can>", () => {
  it("renders children when allowed", () => {
    render(
      <AuthorizationProvider store={createTestStore()}>
        <Can
          action="read"
          resource={resource}
        >
          <p>visible</p>
        </Can>
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("visible")).not.toBeNull();
  });

  it("renders nothing, or the fallback, when denied", () => {
    render(
      <AuthorizationProvider store={createTestStore()}>
        <Can
          action="update"
          resource={resource}
        >
          <p>hidden</p>
        </Can>
        <Can
          action="update"
          fallback={<p>read only</p>}
          resource={resource}
        >
          <p>hidden too</p>
        </Can>
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("hidden")).toBeNull();
    expect(screen.queryByText("hidden too")).toBeNull();
    expect(screen.queryByText("read only")).not.toBeNull();
  });

  it("switches when the store changes", () => {
    const store = createTestStore();
    render(
      <AuthorizationProvider store={store}>
        <Can
          action="update"
          fallback={<p>no</p>}
          resource={resource}
        >
          <p>yes</p>
        </Can>
      </AuthorizationProvider>,
    );
    expect(screen.queryByText("no")).not.toBeNull();
    act(() =>
      store.setSubject({
        id: "user:ana",
        roles: [
          "editor",
        ],
      }),
    );
    expect(screen.queryByText("yes")).not.toBeNull();
    expect(screen.queryByText("no")).toBeNull();
  });
});
