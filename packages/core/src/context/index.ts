import { InvalidContextError } from "../errors.js";
import type { Attributes, Context } from "../types/index.js";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates and freezes an evaluation {@link Context}. Tenancy is always carried here,
 * explicitly, never in module-level state. The input is copied.
 *
 * @throws {InvalidContextError} If `tenantId` is not a non-empty string or `attributes` is not an object.
 *
 * @example
 * const context = createContext({ tenantId: "acme", attributes: { plan: "pro" } });
 */
export function createContext(input: Context = {}): Context {
  if (!isPlainObject(input)) {
    throw new InvalidContextError("Context must be an object.");
  }
  const { attributes, tenantId } = input as {
    attributes?: unknown;
    tenantId?: unknown;
  };

  const context: {
    attributes?: Attributes;
    tenantId?: string;
  } = {};
  if (tenantId !== undefined) {
    if (typeof tenantId !== "string" || tenantId === "") {
      throw new InvalidContextError(
        "Context `tenantId` must be a non-empty string.",
      );
    }
    context.tenantId = tenantId;
  }
  if (attributes !== undefined) {
    if (!isPlainObject(attributes)) {
      throw new InvalidContextError("Context `attributes` must be an object.");
    }
    context.attributes = Object.freeze({
      ...attributes,
    });
  }
  return Object.freeze(context);
}
