import type EntitySchema from '../meta/entity/entity-schema.js'
import { getModel } from '../meta/index.js'
import type { Newable } from '../meta/newable.js'
import { getModelByName, unknownDefinitionError } from '../meta/map-schema.js'
import type Neode from '../neode.service.js'
import type PropertySchema from '../meta/property-schema.js'

/**
Fake-invocation cap when retrying a unique property's `fake` for a
distinct value within one batch (NTS-444)
*/
const MAX_FAKE_ATTEMPTS = 1000

/**
Options for one `.with()` call on a factory builder (NTS-444)
*/
export interface FactoryWithSpec {
  /** Number of target nodes to create and relate, per created instance */
  count: number
  /**
  Properties for each target node: a static map, or a function of the
  target's index within the batch
  */
  properties?: Record<string, unknown> | ((index: number) => Record<string, unknown>)
}

/**
Resolve a factory target to a registered model constructor: a model
name looks up the map-defined registry (`defineModel` / `model()`),
a decorated class passes through as-is
*/
function resolveConstructor(model: string | Newable): Newable {
  if (typeof model !== 'string') {
    return model
  }

  const found = getModelByName(model)

  if (!found) {
    throw new Error(unknownDefinitionError(model))
  }

  return found
}

/**
Chainable factory builder (NTS-444): seed fake data through the library's
normal create/relate services, so validation, defaults, timestamps and
relationship logic all apply.

	neode.factory('User')
		.count(10)
		.with('posts', { count: 2, properties: { title: 'Seeded' } })
		.create({ role: 'admin' })

Precedence on create: explicit value > `default` > `fake`. Unique
properties with a `fake` generator are retried until the values are
distinct within one batch (app-level check) — across runs the user's
fake fn must be DB-safe (e.g. random UUIDs). An override on a unique
property applies to the first row; later rows fake distinct values
around it.
*/
export default class FactoryBuilder<T extends object = any> {
  private readonly neode: Neode

  private readonly newable: Newable

  private readonly schema: EntitySchema

  private total: number | undefined

  private readonly withs: { relationshipName: string; spec: FactoryWithSpec }[] = []

  constructor(neode: Neode, model: string | Newable) {
    this.neode = neode
    this.newable = resolveConstructor(model)

    const schema = getModel(this.newable)

    if (!schema) {
      const name = (this.newable as { name?: string }).name || 'unknown'

      throw new Error(
        `Couldn't find a model for "${name}". Register the model via model() or a decorator first.`,
      )
    }

    this.schema = schema
  }

  /**
  Seed `n` instances — `.create()` then resolves to an array
  */
  count(count: number): this {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('count() requires a positive integer')
    }

    this.total = count

    return this
  }

  /**
  Seed `count` factory-created target nodes over the relationship named
  by its definition key, relating each to every created instance.
  Chainable; multiple `.with()` calls are allowed.
  */
  with(relationshipName: string, spec: FactoryWithSpec): this {
    if (!Number.isInteger(spec.count) || spec.count < 0) {
      throw new Error(`with() requires a non-negative integer count for "${relationshipName}"`)
    }

    this.withs.push({ relationshipName, spec })

    return this
  }

  /**
  Create the seeded instance(s) — a single hydrated instance without
  `.count(n)`, an array with it. Explicit `overrides` win over fake
  values and schema defaults and are validated like any create().
  */
  async create(overrides: Record<string, unknown> = {}): Promise<T | T[]> {
    const total = this.total ?? 1

    // Unique properties with a fake generator: pre-generate distinct
    // values for the batch (app-level check — the fake fn must still be
    // DB-safe across runs). Explicit overrides win and seed the used set.
    const uniques = this.schema
      .getProperties()
      .filter((property) => property.isUnique() && typeof property.getFake() === 'function')

    const used = new Map<string, Set<unknown>>(
      uniques
        .filter((property) => overrides[property.getKey()] !== undefined)
        .map((property) => [property.getKey(), new Set([overrides[property.getKey()]])]),
    )

    // Unique+fake overrides apply to the FIRST row; later rows fake
    // distinct values around the used set. The copy keeps the caller's
    // object untouched while createOne consumes overrides row by row.
    const rowOverrides: Record<string, unknown> = { ...overrides }

    const instances: T[] = []

    for (let index = 0; index < total; index++) {
      instances.push(await this.createOne(rowOverrides, uniques, used))
    }

    for (const instance of instances) {
      for (const { relationshipName, spec } of this.withs) {
        await this.seedRelationships(instance, relationshipName, spec)
      }
    }

    return this.total === undefined ? instances[0]! : instances
  }

  private async createOne(
    overrides: Record<string, unknown>,
    uniques: PropertySchema[],
    used: Map<string, Set<unknown>>,
  ): Promise<T> {
    const properties: Record<string, unknown> = { ...overrides }

    for (const property of uniques) {
      const key = property.getKey()
      const fake = property.getFake()!

      // An override on a unique property applies to this row only —
      // consume it so later rows fake distinct values around the used set
      if (properties[key] !== undefined) {
        delete overrides[key]

        continue
      }

      const seen = used.get(key) ?? new Set<unknown>()

      let value: unknown
      let attempts = 0

      do {
        value = fake()

        if (++attempts > MAX_FAKE_ATTEMPTS) {
          throw new Error(
            `The fake() generator for unique property "${key}" did not produce a distinct value after ${MAX_FAKE_ATTEMPTS} attempts`,
          )
        }
      } while (seen.has(value))

      seen.add(value)
      used.set(key, seen)
      properties[key] = value
    }

    return this.neode.create<T>(this.newable as new (...arguments_: never[]) => T, properties)
  }

  private async seedRelationships(
    instance: T,
    relationshipName: string,
    spec: FactoryWithSpec,
  ): Promise<void> {
    if (!this.schema.hasRelationship(relationshipName)) {
      throw new Error(
        `Unknown relationship "${relationshipName}" on ${this.schema.getLabels().join(':') || 'entity'}`,
      )
    }

    const rel = this.schema.getRelationship(relationshipName)

    const target = rel.getTarget()

    if (!target) {
      throw new Error(`Couldn't find a model for the target of relationship "${relationshipName}"`)
    }

    for (let n = 0; n < spec.count; n++) {
      const properties =
        typeof spec.properties === 'function' ? spec.properties(n) : spec.properties

      const related = await this.neode.create(
        target as new (
          ...arguments_: never[]
        ) => any,
        properties,
      )

      await this.neode.relate(
        this.newable as new (
          ...arguments_: never[]
        ) => T,
        instance,
        related,
        relationshipName,
      )
    }
  }
}
