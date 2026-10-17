/**
 * Rethrows an error outside the current call stack, so it surfaces as an unhandled error
 * (visible in the console and in `window.onerror`) without interrupting the caller. Used for
 * consumer callbacks that must never be able to change an authorization result.
 */
export const rethrowAsync = (error: unknown): void => {
  queueMicrotask(() => {
    throw error;
  });
};
