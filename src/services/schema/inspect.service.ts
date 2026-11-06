import type { ConnectionProvider } from '../../driver/types.js'
import { getModels } from '../../meta/index.js'
import {
  ConstraintType,
  compositeSchemaObjectName,
  cypherPropertyType,
  schemaObjectName,
} from './schema.service.js'
import { type FulltextIndexDefinition, fulltextIndexName } from './fulltext.service.js'
import { type VectorIndexDefinition, vectorIndexName } from './vector.service.js'

/**
Push a schema object into the declared list unless its name is already declared
*/
function declared(list: SchemaObject[], object: SchemaObject): void {
  if (list.every((existing) => existing.name !== object.name)) {
    list.push(object)
  }
}

export interface InspectOptions {
  /**
  Full-text index definitions to include in the declared set
  */
  fulltext?: FulltextIndexDefinition[]
  /**
  Vector index definitions to include in the declared set
  */
  vector?: VectorIndexDefinition[]
  /**
  Existence constraints are Enterprise-only: include them in the declared set
  */
  enterprise?: boolean
}

export interface SchemaObject {
  name: string
  type: string
  labelsOrTypes: string[]
  properties: string[]
}

export interface SchemaDiff {
  /**
  Objects found on the database
  */
  installed: SchemaObject[]
  /**
  Objects the registered schemas would install
  */
  declared: SchemaObject[]
  /**
  Declared but not installed
  */
  missing: string[]
  /**
  Installed but not declared
  */
  extra: string[]
}

export interface SchemaInspection {
  constraints: SchemaDiff
  indexes: SchemaDiff
}

/**
The schema objects the registered models (plus the given definitions) would install
*/
export function declaredSchemaObjects(options: InspectOptions = {}): {
  constraints: SchemaObject[]
  indexes: SchemaObject[]
} {
  const constraints: SchemaObject[] = []
  const indexes: SchemaObject[] = []

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      for (const property of model.getProperties()) {
        const key = property.getKey()

        if (property.isUnique()) {
          constraints.push({
            name: schemaObjectName(label, key, ConstraintType.UNIQUE),
            type: ConstraintType.UNIQUE,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        if (property.isExists() && options.enterprise) {
          constraints.push({
            name: schemaObjectName(label, key, ConstraintType.EXISTS),
            type: ConstraintType.EXISTS,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        if (property.isIndex()) {
          indexes.push({
            name: schemaObjectName(label, key, ConstraintType.INDEX),
            type: ConstraintType.INDEX,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        // Property-type constraint (NTS-141), opt-in via `typed: true`
        if (property.isTyped() && cypherPropertyType(property.getType())) {
          constraints.push({
            name: schemaObjectName(label, key, ConstraintType.PROPERTY_TYPE),
            type: ConstraintType.PROPERTY_TYPE,
            labelsOrTypes: [label],
            properties: [key],
          })
        }

        // Composite unique / index (NTS-140): the full composite is
        // declared on one property — dedup by name when more than
        // one of its properties declares it
        const compositeUnique = property.getCompositeUnique()

        if (compositeUnique?.length) {
          declared(constraints, {
            name: compositeSchemaObjectName(label, compositeUnique, ConstraintType.UNIQUE),
            type: ConstraintType.UNIQUE,
            labelsOrTypes: [label],
            properties: compositeUnique,
          })
        }

        const compositeIndex = property.getCompositeIndex()

        if (compositeIndex?.length) {
          declared(indexes, {
            name: compositeSchemaObjectName(label, compositeIndex, ConstraintType.INDEX),
            type: ConstraintType.INDEX,
            labelsOrTypes: [label],
            properties: compositeIndex,
          })
        }
      }
    }
  }

  for (const definition of options.fulltext || []) {
    indexes.push({
      name: fulltextIndexName(definition),
      type: ConstraintType.FULLTEXT,
      labelsOrTypes: [definition.label],
      properties: definition.properties,
    })
  }

  for (const definition of options.vector || []) {
    indexes.push({
      name: vectorIndexName(definition),
      type: ConstraintType.VECTOR,
      labelsOrTypes: [definition.label],
      properties: [definition.property],
    })
  }

  return { constraints, indexes }
}

/**
Read the installed schema (SHOW CONSTRAINTS / SHOW INDEXES) and diff it against the declared schema
*/
export async function inspectSchema(
  connection: ConnectionProvider,
  options: InspectOptions = {},
): Promise<SchemaInspection> {
  const [constraintRows, indexRows] = await Promise.all([
    connection.run('SHOW CONSTRAINTS', {}, 'READ'),
    connection.run('SHOW INDEXES', {}, 'READ'),
  ])

  const rowToObject = (row: {
    has(key: string): boolean
    get(key: string): unknown
  }): SchemaObject => ({
    name: (row.get('name') as string) || '',
    type: (row.get('type') as string) || '',
    labelsOrTypes: row.has('labelsOrTypes') ? (row.get('labelsOrTypes') as string[]) || [] : [],
    properties: row.has('properties') ? (row.get('properties') as string[]) || [] : [],
  })

  // Constraint-backed indexes are reported by both SHOW commands — keep
  // them out of the index diff, as are the system-managed token lookup
  // indexes
  const indexRowsToObject = (row: {
    has(key: string): boolean
    get(key: string): unknown
  }): SchemaObject | null => {
    const object = rowToObject(row)

    return object.type === 'LOOKUP' ||
      (row.has('owningConstraint') && row.get('owningConstraint') != null) ? null : object;
  }

  const installedConstraints = constraintRows.records.map(rowToObject)
  const installedIndexes = indexRows.records
    .map(indexRowsToObject)
    .filter((object): object is SchemaObject => object !== null)

  const declared = declaredSchemaObjects(options)

  return {
    constraints: diff(declared.constraints, installedConstraints),
    indexes: diff(declared.indexes, installedIndexes),
  }
}

function diff(declared: SchemaObject[], installed: SchemaObject[]): SchemaDiff {
  const declaredNames = new Set(declared.map((object) => object.name))
  const installedNames = new Set(installed.map((object) => object.name))

  return {
    installed,
    declared,
    missing: declared
      .filter((object) => !installedNames.has(object.name))
      .map((object) => object.name),
    extra: installed
      .filter((object) => !declaredNames.has(object.name))
      .map((object) => object.name),
  }
}
