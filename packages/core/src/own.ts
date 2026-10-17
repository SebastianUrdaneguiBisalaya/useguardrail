/**
 * Reads an own property only. Optional inputs such as `roles` or `tenantId` must never be
 * satisfied by a value inherited from a polluted `Object.prototype`.
 */
export const ownProperty = (value: object, key: string): unknown =>
  Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
