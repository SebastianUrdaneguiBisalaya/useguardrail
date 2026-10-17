import { act, cleanup } from "@testing-library/react";
import { createAuthorizationStore } from "@useguardril/core";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProvider,
  Can,
  useAccess,
  useAuthorizationError,
  useAuthorizationStatus,
  useCan,
  useSubject,
} from "../src/index.js";
import { engine } from "./setup.js";

afterEach(cleanup);

const resource = {
  id: "1",
  type: "invoice",
};
const viewer = {
  id: "user:ana",
  roles: [
    "viewer",
  ],
};

type Store = ReturnType<typeof storeWith>;

/** SSR renders a store's *initial* state, so the data goes in at creation. */
const storeWith = (config: {
  status?: "loading" | "ready";
  signedOut?: true;
}) =>
  createAuthorizationStore({
    context: {
      tenantId: "acme",
    },
    engine,
    ...(config.status === undefined
      ? {}
      : {
          status: config.status,
        }),
    ...(config.signedOut
      ? {}
      : {
          subject: viewer,
        }),
  });

const Status = () => {
  const status = useAuthorizationStatus();
  const subject = useSubject();
  const access = useAccess("update", resource);
  return <p>{`${status}:${subject?.id ?? "none"}:${access}`}</p>;
};

const App = ({ store }: { store: Store }) => (
  <AuthorizationProvider store={store}>
    <Can
      action="read"
      fallback={<p>no access</p>}
      loading={<p>skeleton</p>}
      resource={resource}
    >
      <p>content</p>
    </Can>
    <Status />
  </AuthorizationProvider>
);

const hydrate = async (html: string, store: Store) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);
  const recoverable: unknown[] = [];
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  await act(async () => {
    hydrateRoot(container, <App store={store} />, {
      onRecoverableError: (error) => recoverable.push(error),
    });
  });
  const errors = consoleError.mock.calls.slice();
  consoleError.mockRestore();
  return {
    container,
    errors,
    recoverable,
  };
};

describe("server rendering", () => {
  it("renders allowed content and never the denied fallback", () => {
    const html = renderToString(<App store={storeWith({})} />);
    expect(html).toContain("content");
    expect(html).not.toContain("no access");
    expect(html).toContain("ready:user:ana:denied");
  });

  it("renders the loading prop while the store is loading", () => {
    const html = renderToString(
      <App
        store={storeWith({
          status: "loading",
        })}
      />,
    );
    expect(html).toContain("skeleton");
    expect(html).not.toContain("no access");
    expect(html).toContain("loading:user:ana:loading");
  });

  it("renders the fallback when signed out", () => {
    const html = renderToString(
      <App
        store={storeWith({
          signedOut: true,
        })}
      />,
    );
    expect(html).toContain("no access");
    expect(html).toContain("ready:none:denied");
  });

  it("renders the store's initial state: changes made after creation are not part of it", () => {
    const store = storeWith({});
    store.setStatus("loading");
    store.setSubject(undefined);
    const html = renderToString(<App store={store} />);
    // Rendered as created (ready, signed in as a viewer), not as it is now.
    expect(html).toContain("content");
    expect(html).toContain("ready:user:ana:denied");
  });
});

describe("every hook on the server", () => {
  it("useCan and useAuthorizationError read the initial snapshot", () => {
    const Probe = () => {
      const can = useCan("read", resource);
      const error = useAuthorizationError();
      return <p>{`${can}:${String(error)}`}</p>;
    };
    const html = renderToString(
      <AuthorizationProvider store={storeWith({})}>
        <Probe />
      </AuthorizationProvider>,
    );
    expect(html).toContain("true:undefined");

    const store = storeWith({});
    store.setError(new Error("after creation"));
    const stillInitial = renderToString(
      <AuthorizationProvider store={store}>
        <Probe />
      </AuthorizationProvider>,
    );
    expect(stillInitial).toContain("true:undefined");
  });
});

describe("hydration", () => {
  it("matches the server HTML when the client store starts in the same state", async () => {
    const html = renderToString(<App store={storeWith({})} />);
    const { container, errors, recoverable } = await hydrate(
      html,
      storeWith({}),
    );
    expect(recoverable).toEqual([]);
    expect(errors).toEqual([]);
    expect(container.textContent).toContain("content");
  });

  it("still matches when the client store already received data before hydration, then catches up", async () => {
    // The server rendered the loading skeleton...
    const html = renderToString(
      <App
        store={storeWith({
          status: "loading",
        })}
      />,
    );
    expect(html).toContain("skeleton");

    // ...but on the client the data arrived before React hydrated.
    const clientStore = storeWith({
      status: "loading",
    });
    clientStore.setStatus("ready");

    const { container, errors, recoverable } = await hydrate(html, clientStore);

    // No hydration mismatch: React hydrated against the store's initial snapshot,
    // then re-rendered with the live state.
    expect(recoverable).toEqual([]);
    expect(errors).toEqual([]);
    expect(container.textContent).toContain("content");
    expect(container.textContent).not.toContain("skeleton");
    expect(container.textContent).toContain("ready:user:ana:denied");
  });

  it("keeps updating after hydration", async () => {
    const html = renderToString(
      <App
        store={storeWith({
          status: "loading",
        })}
      />,
    );
    const store = storeWith({
      status: "loading",
    });
    const { container } = await hydrate(html, store);
    expect(container.textContent).toContain("skeleton");

    await act(async () => {
      store.setStatus("ready");
    });
    expect(container.textContent).toContain("content");
  });
});
