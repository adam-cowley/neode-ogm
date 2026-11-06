/**
 * A reference to an entity class (constructor), e.g. `Person`.
 *
 * Deliberately looser than TypeScript's `Newable`, which
 * demands every static Object method.
 */
export interface Newable {
  new (...args: never[]): unknown
}
