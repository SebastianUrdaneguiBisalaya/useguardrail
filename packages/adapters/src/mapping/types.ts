/**
 * Converts a raw backend response into a value of the SDK contract.
 *
 * Adapters are pure, never mutate the response, and throw `AdapterMappingError` when the
 * response does not have the expected shape. Error messages name paths, never response values,
 * so they are safe to log.
 */
export type Adapter<T> = (response: unknown) => T;
