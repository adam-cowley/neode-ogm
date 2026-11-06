import { ConnectionProvider } from '../../driver/types'
import { ConstraintAction, ConstraintType, SchemaResult, schemaObjectName } from './schema.service'

const SIMILARITY_FUNCTIONS = ['cosine', 'euclidean'] as const

/** A vector index to keep installed on the database */
export interface VectorIndexDefinition {
  label: string
  property: string
  /** Number of dimensions of the stored vectors — must match the embedding model */
  dimensions: number
  similarityFunction?: (typeof SIMILARITY_FUNCTIONS)[number]
  /** Defaults to `<label>_<property>_vector` */
  name?: string
}

export function vectorIndexName(definition: VectorIndexDefinition): string {
  return (
    definition.name ||
    schemaObjectName(definition.label, definition.property, ConstraintType.VECTOR)
  )
}

export function createVectorStatement(definition: VectorIndexDefinition): string {
  const dimensions = definition.dimensions

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new TypeError(
      `Cannot create a vector index on ${definition.label}: dimensions must be a positive integer`,
    )
  }

  const similarity = definition.similarityFunction || 'cosine'

  if (!SIMILARITY_FUNCTIONS.includes(similarity)) {
    throw new TypeError(
      `Cannot create a vector index on ${definition.label}: ` +
        `unknown similarity function "${similarity}" (expected ${SIMILARITY_FUNCTIONS.join(' or ')})`,
    )
  }

  return (
    `CREATE VECTOR INDEX ${vectorIndexName(definition)} IF NOT EXISTS ` +
    `FOR (n:${definition.label}) ON (n.\`${definition.property.replaceAll('`', '``')}\`) ` +
    `OPTIONS { indexConfig: { \`vector.dimensions\`: ${dimensions}, \`vector.similarity_function\`: '${similarity}' } }`
  )
}

export function dropVectorStatement(name: string): string {
  return `DROP VECTOR INDEX ${name} IF EXISTS`
}

/**
 * Installs/drops the given vector index definitions, following the same
 * result-reporting pattern as SchemaService
 */
export default class VectorIndexService {
  constructor(
    private readonly connection: ConnectionProvider,
    private readonly definitions: VectorIndexDefinition[],
  ) {}

  create(): Promise<SchemaResult[]> {
    return this.run(ConstraintAction.CREATE)
  }

  drop(): Promise<SchemaResult[]> {
    return this.run(ConstraintAction.DROP)
  }

  private run(action: ConstraintAction): Promise<SchemaResult[]> {
    return Promise.all(this.definitions.map((definition) => this.runOne(action, definition)))
  }

  private async runOne(
    action: ConstraintAction,
    definition: VectorIndexDefinition,
  ): Promise<SchemaResult> {
    const statement =
      action === ConstraintAction.CREATE
        ? createVectorStatement(definition)
        : dropVectorStatement(vectorIndexName(definition))

    const output: SchemaResult = {
      action,
      type: ConstraintType.VECTOR,
      label: definition.label,
      property: definition.property,
      properties: [definition.property],
      statement,
      success: false,
    }

    try {
      await this.connection.run(statement, {}, 'WRITE')

      output.success = true
    } catch (e) {
      output.error = e as Error
    }

    return output
  }
}
