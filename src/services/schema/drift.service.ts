import type { ConnectionProvider } from '../../driver/types.js'
import { getModels } from '../../meta/index.js'
import {
  ConstraintAction,
  ConstraintType,
  type SchemaResult,
  cypherPropertyType,
  propertyTypeStatement,
  schemaObjectName,
  schemaStatement,
} from './schema.service.js'
import {
  type FulltextIndexDefinition,
  createFulltextStatement,
  dropFulltextStatement,
} from './fulltext.service.js'
import {
  type VectorIndexDefinition,
  createVectorStatement,
  dropVectorStatement,
  vectorIndexName,
} from './vector.service.js'
import {
  type InspectOptions,
  type SchemaDiff,
  type SchemaObject,
  inspectSchema,
} from './inspect.service.js'

/**
One drifted schema object: what it is, where it lives, and the exact
statement(s) that would resolve the drift (NTS-450)
*/
export interface SchemaDriftEntry {
  name: string
  type: string
  labelsOrTypes: string[]
  properties: string[]
  /**
  The CREATE statement that would install the object — present on
  missing and mismatched entries
  */
  createStatement?: string | undefined
  /**
  The DROP statement that would remove the object — present on stale
  and mismatched entries
  */
  dropStatement?: string | undefined
}

/**
Drift of one schema family (constraints or indexes), grouped by action
*/
export interface SchemaDriftGroup {
  /**
  Declared but not installed — applied by `applySchemaDiff`
  */
  missing: SchemaDriftEntry[]
  /**
  Installed but not declared — only dropped with `dropStale: true`
  */
  stale: SchemaDriftEntry[]
  /**
  Installed under a declared name with a different definition — never
  applied automatically: resolving one means dropping and re-creating
  */
  mismatched: SchemaDriftEntry[]
}

export interface SchemaDrift {
  constraints: SchemaDriftGroup
  indexes: SchemaDriftGroup
}

export interface ApplySchemaDiffOptions {
  /**
  Also drop stale objects (installed but not declared). Off by default:
  dropping is destructive
  */
  dropStale?: boolean
}

/**
Full-text indexes declared on model properties (the `fulltext: true`
flag), one per label — the same objects SchemaService installs
*/
function declaredFulltextDefinitions(): FulltextIndexDefinition[] {
  const definitions: FulltextIndexDefinition[] = []

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      const properties = model
        .getProperties()
        .filter((property) => property.getFulltext())
        .map((property) => property.getKey())

      if (properties.length > 0) {
        definitions.push({ label, properties })
      }
    }
  }

  return definitions
}

/**
Cypher property type per declared property-type constraint name: the
statement builder needs it and the inspected SchemaObject does not
carry it
*/
function declaredPropertyTypes(): Map<string, string> {
  const types = new Map<string, string>()

  for (const model of getModels().values()) {
    for (const label of model.getLabels()) {
      for (const property of model.getProperties()) {
        if (property.isTyped()) {
          const cypherType = cypherPropertyType(property.getType())

          if (cypherType) {
            types.set(
              schemaObjectName(label, property.getKey(), ConstraintType.PROPERTY_TYPE),
              cypherType,
            )
          }
        }
      }
    }
  }

  return types
}

/**
CREATE statement for a declared object, built by the same statement
builders the install paths use (NTS-450)
*/
function createStatement(
  object: SchemaObject,
  vectors: Map<string, VectorIndexDefinition>,
  types: Map<string, string>,
): string | undefined {
  const label = object.labelsOrTypes[0] ?? ''

  if (object.type === ConstraintType.VECTOR) {
    const definition = vectors.get(object.name)

    return definition ? createVectorStatement(definition) : undefined
  }

  if (object.type === ConstraintType.FULLTEXT) {
    return createFulltextStatement({ label, properties: object.properties, name: object.name })
  }

  if (object.type === ConstraintType.PROPERTY_TYPE) {
    const cypherType = types.get(object.name)

    return cypherType
      ? propertyTypeStatement(
          ConstraintAction.CREATE,
          label,
          object.properties[0] ?? '',
          cypherType,
          object.name,
        )
      : undefined
  }

  return schemaStatement(
    ConstraintAction.CREATE,
    object.type as ConstraintType,
    label,
    object.properties,
    object.name,
  )
}

/**
Constraint-like types as SHOW reports them: dropped with DROP CONSTRAINT
rather than DROP INDEX
*/
const isConstraintType = (type: string): boolean => /UNIQUE|EXIST|PROPERTY|KEY/i.test(type)

/**
DROP statement for an installed object, built by the same statement
builders the drop paths use (NTS-450)
*/
function dropStatement(object: SchemaObject): string {
  if (object.type === ConstraintType.VECTOR) {
    return dropVectorStatement(object.name)
  }

  if (object.type === ConstraintType.FULLTEXT) {
    return dropFulltextStatement(object.name)
  }

  if (isConstraintType(object.type)) {
    return object.properties.length > 0
      ? schemaStatement(
          ConstraintAction.DROP,
          object.type as ConstraintType,
          object.labelsOrTypes[0] ?? '',
          object.properties,
          object.name,
        )
      : `DROP CONSTRAINT ${object.name} IF EXISTS`
  }

  // shortcut: no builder exists for range/text/point index drops, and
  // they all share the plain DROP INDEX spelling — add one per kind if
  // their syntax ever diverges
  return `DROP INDEX ${object.name} IF EXISTS`
}

/**
SHOW INDEXES reports range indexes as RANGE and SHOW CONSTRAINTS reports
existence constraints as EXISTENCE — compare installed objects against
the declared spellings through one normal form
*/
const normaliseType = (type: string): string => {
  const upper = type.toUpperCase()

  if (upper === 'RANGE') {
    return ConstraintType.INDEX
  }

  if (upper === 'EXISTENCE') {
    return ConstraintType.EXISTS
  }

  return upper
}

const sameDefinition = (declared: SchemaObject, installed: SchemaObject): boolean =>
  normaliseType(declared.type) === normaliseType(installed.type) &&
  [...declared.labelsOrTypes].sort().join(',') ===
    [...installed.labelsOrTypes].sort().join(',') &&
  [...declared.properties].sort().join(',') === [...installed.properties].sort().join(',')

function driftGroup(
  group: SchemaDiff,
  vectors: Map<string, VectorIndexDefinition>,
  types: Map<string, string>,
): SchemaDriftGroup {
  const installedByName = new Map(group.installed.map((object) => [object.name, object]))
  const declaredNames = new Set(group.declared.map((object) => object.name))
  const installedNames = new Set(group.installed.map((object) => object.name))

  const missing = group.declared
    .filter((object) => !installedNames.has(object.name))
    .map((object): SchemaDriftEntry => ({
      name: object.name,
      type: object.type,
      labelsOrTypes: object.labelsOrTypes,
      properties: object.properties,
      createStatement: createStatement(object, vectors, types),
    }))

  const stale = group.installed
    .filter((object) => !declaredNames.has(object.name))
    .map((object): SchemaDriftEntry => ({
      name: object.name,
      type: object.type,
      labelsOrTypes: object.labelsOrTypes,
      properties: object.properties,
      dropStatement: dropStatement(object),
    }))

  const mismatched = group.declared
    .filter((object) => {
      const installed = installedByName.get(object.name)

      return installed !== undefined && !sameDefinition(object, installed)
    })
    .map((object): SchemaDriftEntry => {
      const installed = installedByName.get(object.name) as SchemaObject

      return {
        name: object.name,
        type: object.type,
        labelsOrTypes: object.labelsOrTypes,
        properties: object.properties,
        createStatement: createStatement(object, vectors, types),
        dropStatement: dropStatement(installed),
      }
    })

  return { missing, stale, mismatched }
}

/**
Structured schema drift (NTS-450): the declared-vs-installed inspection
of constraints and every index kind (range/text/fulltext/vector), with
the exact fix statement per entry.

Cheap and drift-never-throws: drift is data, not an error — failing a
CI run on a non-empty diff is the caller's job.
*/
export async function schemaDrift(
  connection: ConnectionProvider,
  options: InspectOptions = {},
): Promise<SchemaDrift> {
  const inspection = await inspectSchema(connection, {
    ...options,
    fulltext: [...declaredFulltextDefinitions(), ...(options.fulltext ?? [])],
  })

  const vectors = new Map(
    (options.vector ?? []).map((definition) => [vectorIndexName(definition), definition]),
  )
  const types = declaredPropertyTypes()

  return {
    constraints: driftGroup(inspection.constraints, vectors, types),
    indexes: driftGroup(inspection.indexes, vectors, types),
  }
}

/**
Human-readable multi-line drift report, grouped by action (missing /
stale / mismatched), one line per object plus its fix statement.
Pure function — no database access (NTS-450).
*/
export function formatSchemaDrift(drift: SchemaDrift): string {
  const groups: [string, SchemaDriftEntry[], string][] = [
    ['missing', [...drift.constraints.missing, ...drift.indexes.missing], 'declared but not installed'],
    ['stale', [...drift.constraints.stale, ...drift.indexes.stale], 'installed but not declared'],
    [
      'mismatched',
      [...drift.constraints.mismatched, ...drift.indexes.mismatched],
      'installed definition differs from the declaration',
    ],
  ]

  const lines: string[] = []

  for (const [action, entries, note] of groups) {
    if (entries.length > 0) {
      lines.push(`${action} (${entries.length}) — ${note}:`)

      for (const entry of entries) {
        const where = entry.labelsOrTypes.map((label) => `:${label}`).join('')
        lines.push(`  - ${entry.type} ${entry.name} on ${where} (${entry.properties.join(', ')})`)

        if (entry.createStatement) {
          lines.push(`      fix: ${entry.createStatement}`)
        }

        if (entry.dropStatement) {
          // mismatched entries need both statements; stale ones are
          // only applied with the explicit dropStale flag
          lines.push(
            entry.createStatement
              ? `      drop first: ${entry.dropStatement}`
              : `      fix (requires dropStale: true): ${entry.dropStatement}`,
          )
        }
      }
    }
  }

  return lines.length === 0
    ? 'no schema drift: the declared schema matches the database'
    : lines.join('\n')
}

/**
Apply the missing objects of a drift idempotently — every CREATE
carries IF NOT EXISTS. Stale objects are only dropped with
`dropStale: true` (dropping is destructive). Mismatched objects are
never applied automatically. Each statement is reported with a
SchemaResult, following the SchemaService pattern (NTS-450).
*/
export async function applySchemaDrift(
  connection: ConnectionProvider,
  drift: SchemaDrift,
  options: ApplySchemaDiffOptions = {},
): Promise<SchemaResult[]> {
  const targets: { action: ConstraintAction, entry: SchemaDriftEntry, statement: string }[] = []

  for (const group of [drift.constraints, drift.indexes]) {
    for (const entry of group.missing) {
      if (entry.createStatement) {
        targets.push({ action: ConstraintAction.CREATE, entry, statement: entry.createStatement })
      }
    }

    if (options.dropStale) {
      for (const entry of group.stale) {
        if (entry.dropStatement) {
          targets.push({ action: ConstraintAction.DROP, entry, statement: entry.dropStatement })
        }
      }
    }
  }

  return Promise.all(
    targets.map(async ({ action, entry, statement }) => {
      const result: SchemaResult = {
        action,
        // stale objects may carry a SHOW-only type (RANGE, TEXT, …)
        // that has no declared equivalent
        type: entry.type as ConstraintType,
        label: entry.labelsOrTypes[0] ?? '',
        property: entry.properties[0] ?? '',
        statement,
        success: false,
      }

      if (entry.properties.length > 1) {
        result.properties = entry.properties
      }

      try {
        await connection.run(statement, {}, 'WRITE')

        result.success = true
      } catch (error) {
        result.error = error as Error
      }

      return result
    }),
  )
}
