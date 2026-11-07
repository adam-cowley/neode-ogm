import type { ConnectionProvider } from '../../driver/types.js'
import { getModels } from '../../meta/index.js'
import type { EntitySchema } from '../../meta/entity/entity-schema.js'
import type { PropertySchema } from '../../meta/property-schema.js';
import { PropertyType } from '../../meta/property-schema.js'
import FulltextIndexService from './fulltext.service.js'

export const ConstraintAction = {
  CREATE: 'CREATE',
  DROP: 'DROP',
} as const

export type ConstraintAction = (typeof ConstraintAction)[keyof typeof ConstraintAction]

export const ConstraintType = {
  UNIQUE: 'UNIQUE',
  EXISTS: 'EXISTS',
  INDEX: 'INDEX',
  FULLTEXT: 'FULLTEXT',
  VECTOR: 'VECTOR',
  PROPERTY_TYPE: 'PROPERTY_TYPE',
} as const

export type ConstraintType = (typeof ConstraintType)[keyof typeof ConstraintType]

export interface SchemaResult {
  action: ConstraintAction
  type: ConstraintType
  label: string
  property: string
  /**
  All indexed properties (composite and full-text cover more than one)
  */
  properties?: string[]
  statement: string
  success: boolean
  error?: Error
}

/**
Deterministic schema object name: `<label>_<property>_<type>` (PLAN §G)
*/
export const schemaObjectName = (label: string, property: string, type: string): string =>
  `${label.toLowerCase()}_${property}_${type.toLowerCase()}`

/**
Deterministic name for a composite object: `<label>_<props joined by _>_<type>`
*/
export const compositeSchemaObjectName = (
  label: string,
  properties: string[],
  type: string,
): string =>
  schemaObjectName(label, properties.map((property) => property.toLowerCase()).join('_'), type)

/**
Backtick-escape a Cypher identifier
*/
const quote = (identifier: string): string => `\`${identifier.replaceAll('`', '``')}\``

/**
Cypher property-type name for a declared property type, or undefined when
the type has no single Cypher equivalent (NUMBER spans INTEGER + FLOAT, ANY
is untyped): property-type constraints cannot be generated for those.
*/
export function cypherPropertyType(type: PropertyType): string | undefined {
  switch (type) {
    case PropertyType.STRING:
    case PropertyType.UUID: {
      return 'STRING'
    }
    case PropertyType.INTEGER: {
      return 'INTEGER'
    }
    case PropertyType.FLOAT: {
      return 'FLOAT'
    }
    case PropertyType.BOOLEAN: {
      return 'BOOLEAN'
    }
    case PropertyType.DATE: {
      return 'DATE'
    }
    case PropertyType.TIME: {
      return 'TIME'
    }
    case PropertyType.DATETIME: {
      return 'DATETIME'
    }
    case PropertyType.LOCALTIME: {
      return 'LOCALTIME'
    }
    case PropertyType.LOCALDATETIME: {
      return 'LOCALDATETIME'
    }
    case PropertyType.POINT: {
      return 'POINT'
    }
    case PropertyType.DURATION: {
      return 'DURATION'
    }
    default: {
      return undefined
    }
  }
}

/**
CREATE/DROP statement for a single- or composite-property UNIQUE, EXISTS or
INDEX schema object. Composite uniques use the parenthesised property list —
the only spelling the Relate engine parses.
*/
export function schemaStatement(
  action: ConstraintAction,
  type: ConstraintType,
  label: string,
  properties: string[],
  name: string = schemaObjectName(label, properties[0] ?? '', type),
): string {
  if (properties.length === 0) {
    throw new TypeError(`Cannot create a ${type} schema object on ${label}: no properties given`)
  }

  const kind = type === ConstraintType.INDEX ? 'INDEX' : 'CONSTRAINT'

  if (action === ConstraintAction.DROP) {
    return `DROP ${kind} ${name} IF EXISTS`
  }

  const quoted = properties.map((property) => `n.${quote(property)}`)
  const target =
    type === ConstraintType.INDEX
      ? `ON (${quoted.join(', ')})`
      : type === ConstraintType.UNIQUE
        ? quoted.length > 1
          ? `REQUIRE (${quoted.join(', ')}) IS UNIQUE`
          : `REQUIRE ${quoted[0]} IS UNIQUE`
        : `REQUIRE ${quoted[0]} IS NOT NULL`

  return `CREATE ${kind} ${name} IF NOT EXISTS FOR (n:${label}) ${target}`
}

/**
CREATE/DROP statement for a property-type constraint (NTS-141): `REQUIRE n.prop IS :: STRING`
*/
export function propertyTypeStatement(
  action: ConstraintAction,
  label: string,
  property: string,
  cypherType: string,
  name: string = schemaObjectName(label, property, ConstraintType.PROPERTY_TYPE),
): string {
  return action === ConstraintAction.DROP ? `DROP CONSTRAINT ${name} IF EXISTS` : `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${quote(property)} IS :: ${cypherType}`;
}

export default class SchemaService {
  private readonly connection: ConnectionProvider
  private readonly enterprise: boolean = false

  constructor(connection: ConnectionProvider, enterprise = false) {
    this.connection = connection
    this.enterprise = enterprise
  }

  async create(): Promise<SchemaResult[]> {
    return this.runSchemaStatements(ConstraintAction.CREATE)
  }

  async drop(): Promise<SchemaResult[]> {
    return this.runSchemaStatements(ConstraintAction.DROP)
  }

  private async runSchemaStatements(action: ConstraintAction): Promise<SchemaResult[]> {
    const output = await Promise.all(
      Array.from(getModels().values()).map(async (model) =>
        this.runSchemaStatementsForModel(action, model),
      ),
    )

    return output.flat()
  }

  private async runSchemaStatementsForModel(
    action: ConstraintAction,
    model: EntitySchema,
  ): Promise<SchemaResult[]> {
    const output = await Promise.all(
      model.getLabels().map(async (label) => this.runSchemaStatementsForLabel(action, model, label)),
    )

    return output.flat()
  }

  private async runSchemaStatementsForLabel(
    action: ConstraintAction,
    model: EntitySchema,
    label: string,
  ): Promise<SchemaResult[]> {
    const properties = model.getProperties()

    const uniques = await this.runUniqueConstraintStatementsForLabel(action, properties, label)

    const indexes = await this.runIndexStatementsForLabel(action, properties, label)

    // Composite unique/index constraints (NTS-140), deduped by name:
    // the composite may be declared on more than one of its properties
    const compositeUniques = await this.runCompositeStatementsForLabel(
      action,
      properties,
      label,
      ConstraintType.UNIQUE,
      (property) => property.getCompositeUnique(),
    )

    const compositeIndexes = await this.runCompositeStatementsForLabel(
      action,
      properties,
      label,
      ConstraintType.INDEX,
      (property) => property.getCompositeIndex(),
    )

    // Property-type constraints (NTS-141): opt-in via `typed: true`,
    // generated only for declared types with a Cypher equivalent
    const propertyTypes = await this.runPropertyTypeStatementsForLabel(action, properties, label)

    // Full-text indexes (NTS-436): one index per label covering every
    // property declared `fulltext: true`, installed/dropped alongside the
    // constraints so callers never handle index names
    const fulltext = await this.runFulltextStatementsForLabel(action, properties, label)

    if (this.enterprise) {
      const exists = await this.runExistsConstraintStatementsForLabel(action, properties, label)

      return uniques.concat(
        ...indexes,
        ...compositeUniques,
        ...compositeIndexes,
        ...propertyTypes,
        ...fulltext,
        ...exists,
      )
    }

    return uniques.concat(...indexes, ...compositeUniques, ...compositeIndexes, ...propertyTypes, ...fulltext)
  }

  private runFulltextStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    const fulltext = properties.filter((property) => property.getFulltext())

    if (fulltext.length === 0) {
      return Promise.resolve([])
    }

    const service = new FulltextIndexService(this.connection, [
      { label, properties: fulltext.map((property) => property.getKey()) },
    ])

    return action === ConstraintAction.CREATE ? service.create() : service.drop()
  }

  private async runUniqueConstraintStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isUnique())
        .map(async (property) =>
          this.runStatement(action, ConstraintType.UNIQUE, label, [property.getKey()]),
        ),
    )
  }

  private async runExistsConstraintStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isExists())
        .map(async (property) =>
          this.runStatement(action, ConstraintType.EXISTS, label, [property.getKey()]),
        ),
    )
  }

  private async runIndexStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isIndex())
        .map(async (property) =>
          this.runStatement(action, ConstraintType.INDEX, label, [property.getKey()]),
        ),
    )
  }

  private async runCompositeStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
    type: (typeof ConstraintType)['UNIQUE'] | (typeof ConstraintType)['INDEX'],
    select: (property: PropertySchema) => string[] | undefined,
  ): Promise<SchemaResult[]> {
    const composites = new Map<string, string[]>()

    for (const property of properties) {
      const list = select(property)

      if (!list?.length) {
        continue
      }

      composites.set(compositeSchemaObjectName(label, list, type), list)
    }

    return Promise.all(
      Array.from(composites).map(async ([name, list]) =>
        this.runStatement(action, type, label, list, name),
      ),
    )
  }

  private async runPropertyTypeStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isTyped())
        .map(async (property) => {
          const type = cypherPropertyType(property.getType())

          if (!type) {
            return {
              action,
              type: ConstraintType.PROPERTY_TYPE,
              label,
              property: property.getKey(),
              statement: '',
              success: false,
              error: new Error(
                `No property-type constraint can be generated for "${property.getKey()}": ` +
                  'its declared type has no single Cypher property type',
              ),
            }
          }

          return this.runStatement(
            action,
            ConstraintType.PROPERTY_TYPE,
            label,
            [property.getKey()],
            undefined,
            type,
          )
        }),
    )
  }

  private async runStatement(
    action: ConstraintAction,
    type: ConstraintType,
    label: string,
    properties: string[],
    name?: string,
    cypherType?: string,
  ): Promise<SchemaResult> {
    const property = properties[0]

    if (property === undefined) {
      throw new Error('A schema constraint requires at least one property')
    }

    let statement: string

    if (type === ConstraintType.PROPERTY_TYPE) {
      if (cypherType === undefined) {
        throw new Error('A property-type constraint requires a Cypher type')
      }

      statement = propertyTypeStatement(action, label, property, cypherType, name)
    } else {
      statement = schemaStatement(action, type, label, properties, name)
    }

    const output: SchemaResult = {
      action,
      type,
      label,
      property,
      ...((properties.length > 1) && { properties }),
      statement,
      success: false,
    }

    try {
      await this.connection.run(statement, {}, 'WRITE')

      output.success = true
    } catch (error) {
      output.error = error as Error
    }

    return output
  }
}
