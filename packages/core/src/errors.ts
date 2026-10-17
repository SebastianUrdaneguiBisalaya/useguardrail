/** Base class for every error thrown by `@useguardril/core`. Use `instanceof` to narrow. */
export class AuthorizationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthorizationError";
  }
}

/** Thrown when a policy, role, or relation definition is malformed. */
export class InvalidPolicyError extends AuthorizationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidPolicyError";
  }
}

/** Thrown when external backend data cannot be mapped to the SDK contract. */
export class AdapterMappingError extends AuthorizationError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AdapterMappingError";
  }
}
