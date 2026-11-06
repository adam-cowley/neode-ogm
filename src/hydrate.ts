import type { GraphNode, QueryOutput, QueryRecord } from './driver/types.js'
import { getModel } from './meta/index.js'
import type EntitySchema from './meta/entity/entity-schema.js'
import { type EagerRelationship, hydrateNode } from './utils.js'
import type { WithMethods } from './entity-methods.js'
import Collection from './collection.js'

export { hydrateProjection } from './projection/index.js'

const DEFAULT_ALIAS = 'this'

function requireSchema(constructor: new (...arguments_: never[]) => unknown): EntitySchema {
  const schema = getModel(constructor)

  if (!schema) {
    const name = (constructor as { name?: string })?.name || 'unknown'

    throw new Error(`Couldn't find a model for "${name}".`)
  }

  return schema
}

/**
Extra record columns (every key except the node alias) as the eager values
hydrateNode understands: one legacy eager entry per column, whose node is
the column value
*/
function eagerColumns(row: QueryRecord, alias: string): Record<string, EagerRelationship[]> {
  return Object.fromEntries(
    row.keys
      .filter((key) => key !== alias)
      .map((key) => [key, [{ other: { node: row.get(key) as GraphNode } } as EagerRelationship]]),
  )
}

/**
Hydrate a raw query result (as returned by readCypher/writeCypher or
Builder#execute) into typed entities: each record's `alias` column is the
node, any other column feeds eager relationship hydration
(neode's Factory.hydrate)
*/
export function hydrate<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): WithMethods<T>[] {
  const schema = requireSchema(constructor)

  return output.records
    .filter((row) => row.has(alias) && row.get(alias) != null)
    .map(
      (row) =>
        // Hydration wires the active-record methods onto the prototype —
        // the returned instance IS a WithMethods<T>
        hydrateNode<T>(
          schema,
          constructor,
          row.get(alias) as GraphNode,
          eagerColumns(row, alias),
        ) as WithMethods<T>,
    )
}

/**
Hydrate the first record of a raw query result, or undefined when the
result set is empty (neode's Factory.hydrateFirst)
*/
export function hydrateFirst<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): WithMethods<T> | undefined {
  return hydrate<T>(constructor, output, alias)[0]
}

/**
Hydrate a raw query result into a Collection (neode's Factory.hydrate
return shape)
*/
export function toCollection<T>(
  constructor: new (...arguments_: never[]) => T,
  output: QueryOutput,
  alias = DEFAULT_ALIAS,
): Collection<T> {
  return new Collection(hydrate<T>(constructor, output, alias))
}
