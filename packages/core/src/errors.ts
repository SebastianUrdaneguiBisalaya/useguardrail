import type { MessageParams } from "./types/index.js";

/**
 * Every stable error `code` the SDK can produce, across all `@useguardril/*` packages.
 * Codes never change meaning, so you can translate them with your own i18n catalog:
 * look up `error.code` and fill in `error.params`.
 */
export const ERROR_CODES = [
  // Defaults used by the base class and the three core subclasses.
  "AUTHORIZATION_ERROR",
  "INVALID_POLICY",
  "INVALID_CONTEXT",
  "ADAPTER_MAPPING",
  // Context, subject, engine.
  "CONTEXT_NOT_OBJECT",
  "CONTEXT_TENANT_ID_INVALID",
  "CONTEXT_ATTRIBUTES_INVALID",
  "SUBJECT_INVALID",
  "ENGINE_REQUIRED",
  "EVALUATORS_INVALID",
  // RBAC.
  "RBAC_ROLES_INVALID",
  "ROLE_NOT_OBJECT",
  "ROLE_PERMISSIONS_INVALID",
  "ROLE_INHERITS_INVALID",
  "PERMISSION_NOT_STRING",
  "PERMISSION_FORMAT_INVALID",
  "ROLE_INHERITANCE_CYCLE",
  "ROLE_INHERITS_UNKNOWN",
  // ABAC.
  "ABAC_POLICIES_INVALID",
  "POLICY_NOT_OBJECT",
  "POLICY_ID_INVALID",
  "POLICY_ID_DUPLICATE",
  "POLICY_EFFECT_INVALID",
  "POLICY_CONDITIONS_INVALID",
  "POLICY_SCOPE_INVALID",
  "CONDITION_NOT_OBJECT",
  "CONDITION_OPERATOR_UNKNOWN",
  "CONDITION_FIELD_INVALID",
  "CONDITION_EXISTS_INVALID",
  "CONDITION_VALUE_SOURCE_INVALID",
  "CONDITION_ARRAY_REQUIRED",
  // ReBAC.
  "GRAPH_TUPLES_INVALID",
  "TUPLE_NOT_OBJECT",
  "TUPLE_FIELDS_INVALID",
  "TUPLE_REFERENCE_INVALID",
  "GRAPH_RULES_INVALID",
  "RULE_NOT_OBJECT",
  "RULE_IMPLIED_BY_INVALID",
  "RULE_INHERIT_FROM_INVALID",
  "GRAPH_MAX_DEPTH_INVALID",
  "REBAC_GRAPH_REQUIRED",
  "REBAC_REQUIREMENTS_INVALID",
  "REBAC_REQUIREMENT_TYPE_INVALID",
  "REBAC_REQUIREMENT_INVALID",
  // @useguardril/react.
  "PROVIDER_MISSING",
  // @useguardril/adapters.
  "ADAPTER_PATH_INVALID",
  "ADAPTER_LIST_NOT_ARRAY",
  "ADAPTER_STRING_LIST_INVALID",
  "ADAPTER_ATTRIBUTES_INVALID",
  "ADAPTER_FIELD_MISSING",
  "ADAPTER_SUBJECT_ID_MISSING",
  "ADAPTER_TENANT_ID_MISSING",
  "ADAPTER_ROLES_NOT_ARRAY",
  "ADAPTER_ROLE_NAME_MISSING",
  "ADAPTER_ROLE_NAME_UNSAFE",
  "ADAPTER_ROLE_DUPLICATE",
  "ADAPTER_PERMISSIONS_MISSING",
] as const;

/** A stable, language-neutral identifier for an error. See {@link ERROR_CODES}. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Optional details for an SDK error. Also accepts a plain `{ cause }`. */
export type ErrorDetails = {
  /** Stable identifier; defaults to the class's own code. */
  readonly code?: ErrorCode;
  /**
   * Values that fill in the message (positions, role names, policy ids, paths).
   * Never contains user ids, tuple values, or other backend response data.
   */
  readonly params?: MessageParams;
  readonly cause?: unknown;
};

/**
 * Base class for every error thrown by `@useguardril/*`. Use `instanceof` to narrow, and
 * `code` + `params` to show a message in your own language. `message` is always English.
 */
export class AuthorizationError extends Error {
  /** Stable identifier for this error; safe to switch on and to use as a translation key. */
  readonly code: ErrorCode;
  /** Values that fill in a translated message for `code`. */
  readonly params: MessageParams;

  constructor(message: string, details: ErrorDetails = {}) {
    super(
      message,
      details.cause === undefined
        ? undefined
        : {
            cause: details.cause,
          },
    );
    this.name = "AuthorizationError";
    this.code = details.code ?? "AUTHORIZATION_ERROR";
    this.params = Object.freeze({
      ...details.params,
    });
  }
}

/** Thrown when a policy, role, or relation definition is malformed. */
export class InvalidPolicyError extends AuthorizationError {
  constructor(message: string, details: ErrorDetails = {}) {
    super(message, {
      ...details,
      code: details.code ?? "INVALID_POLICY",
    });
    this.name = "InvalidPolicyError";
  }
}

/** Thrown when external backend data cannot be mapped to the SDK contract. */
export class AdapterMappingError extends AuthorizationError {
  constructor(message: string, details: ErrorDetails = {}) {
    super(message, {
      ...details,
      code: details.code ?? "ADAPTER_MAPPING",
    });
    this.name = "AdapterMappingError";
  }
}

/** Thrown when a subject or context passed to the SDK is malformed. */
export class InvalidContextError extends AuthorizationError {
  constructor(message: string, details: ErrorDetails = {}) {
    super(message, {
      ...details,
      code: details.code ?? "INVALID_CONTEXT",
    });
    this.name = "InvalidContextError";
  }
}
