import type { ErrorDetails } from "@useguardrail/core";
import { AuthorizationError } from "@useguardrail/core";

/** Thrown when a hook or component is used outside an `AuthorizationProvider`. */
export class MissingProviderError extends AuthorizationError {
  constructor(message: string, details: ErrorDetails = {}) {
    super(message, {
      ...details,
      code: details.code ?? "PROVIDER_MISSING",
    });
    this.name = "MissingProviderError";
  }
}
