import { toJson } from './serialise'

/**
 * An iterable wrapper over an array of entities (parity with neode's
 * Collection): reads like an array, serialises through toJson().
 */
export default class Collection<T> {
  constructor(private readonly values: T[] = []) {}

  get length(): number {
    return this.values.length
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values.values()
  }

  get(index: number): T | undefined {
    return this.values[index]
  }

  first(): T | undefined {
    return this.values[0]
  }

  map<U>(fn: (value: T, index: number, array: T[]) => U): U[] {
    return this.values.map(fn)
  }

  find(fn: (value: T, index: number, array: T[]) => unknown): T | undefined {
    return this.values.find(fn)
  }

  forEach(fn: (value: T, index: number, array: T[]) => void): void {
    this.values.forEach(fn)
  }

  toJson(): Promise<unknown[]> {
    return Promise.all(this.values.map((value) => toJson(value)))
  }

  static from<T>(values: Iterable<T>): Collection<T> {
    return new Collection(Array.from(values))
  }
}
