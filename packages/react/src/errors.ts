import { AuthorizationError } from "@useguardril/core";

/** Thrown when a hook or component is used outside an `AuthorizationProvider`. */
export class MissingProviderError extends AuthorizationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MissingProviderError";
  }
}
