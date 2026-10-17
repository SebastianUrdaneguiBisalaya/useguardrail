import type { AuthorizationStore } from "@useguardril/core";
import type { ReactElement, ReactNode } from "react";
import { createContext, useContext } from "react";
import { MissingProviderError } from "../errors.js";

const AuthorizationContext = createContext<AuthorizationStore | null>(null);

/** Props for {@link AuthorizationProvider}. */
export type AuthorizationProviderProps = {
  /** The store created with `createAuthorizationStore` from `@useguardril/core`. */
  readonly store: AuthorizationStore;
  readonly children?: ReactNode;
};

/**
 * Makes an authorization store available to `useCan`, `<Can>` and the other hooks below it.
 * The provider never re-renders on store changes by itself; only the hooks that subscribe do.
 *
 * @example
 * <AuthorizationProvider store={store}>
 *   <App />
 * </AuthorizationProvider>
 */
export function AuthorizationProvider({
  children,
  store,
}: AuthorizationProviderProps): ReactElement {
  return (
    <AuthorizationContext.Provider value={store}>
      {children}
    </AuthorizationContext.Provider>
  );
}

/**
 * Returns the store from the nearest `AuthorizationProvider`, e.g. to call `setSubject`
 * or `setContext`. It does not subscribe, so calling it never causes re-renders.
 *
 * @throws {MissingProviderError} When used outside an `AuthorizationProvider`.
 */
export function useAuthorizationStore(): AuthorizationStore {
  const store = useContext(AuthorizationContext);
  if (store === null) {
    throw new MissingProviderError(
      "useAuthorizationStore must be used inside an <AuthorizationProvider>.",
      {
        code: "PROVIDER_MISSING",
      },
    );
  }
  return store;
}
