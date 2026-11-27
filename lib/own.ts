/**
 * `o[key]` for the object's own keys only. A plain lookup table also "has" Object.prototype's
 * members, so data from a server ("constructor", "toString") could otherwise find a function.
 */
export function own<T>(o: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}
