import { ConnectionProvider } from '../../driver/types'
import { getModels } from '../../meta'
import EntitySchema from '../../meta/entity/entity-schema'
import PropertySchema, { PropertyType } from '../../meta/property-schema'

export enum ConstraintAction {
  CREATE = 'CREATE',
  DROP = 'DROP',
}

export enum ConstraintType {
  UNIQUE = 'UNIQUE',
  EXISTS = 'EXISTS',
  INDEX = 'INDEX',
  FULLTEXT = 'FULLTEXT',
  VECTOR = 'VECTOR',
  PROPERTY_TYPE = 'PROPERTY_TYPE',
}

export interface SchemaResult {
  action: ConstraintAction
  type: ConstraintType
  label: string
  property: string
  /** All indexed properties (composite and full-text cover more than one) */
  properties?: string[]
  statement: string
  success: boolean
  error?: Error
}

/** Deterministic schema object name: `<label>_<property>_<type>` (PLAN §G) */
export const schemaObjectName = (label: string, property: string, type: string): string =>
  `${label.toLowerCase()}_${property}_${type.toLowerCase()}`

/** Deterministic name for a composite object: `<label>_<props joined by _>_<type>` */
export const compositeSchemaObjectName = (
  label: string,
  properties: string[],
  type: string,
): string =>
  schemaObjectName(label, properties.map((property) => property.toLowerCase()).join('_'), type)

/** Backtick-escape a Cypher identifier */
const quote = (identifier: string): string => `\`${identifier.replaceAll('`', '``')}\``

/**
 * Cypher property-type name for a declared property type, or undefined when
 * the type has no single Cypher equivalent (NUMBER spans INTEGER + FLOAT, ANY
 * is untyped): property-type constraints cannot be generated for those.
 */
export function cypherPropertyType(type: PropertyType): string | undefined {
  switch (type) {
    case PropertyType.STRING:
    case PropertyType.UUID:
      return 'STRING'
    case PropertyType.INTEGER:
      return 'INTEGER'
    case PropertyType.FLOAT:
      return 'FLOAT'
    case PropertyType.BOOLEAN:
      return 'BOOLEAN'
    case PropertyType.DATE:
      return 'DATE'
    case PropertyType.TIME:
      return 'TIME'
    case PropertyType.DATETIME:
      return 'DATETIME'
    case PropertyType.LOCALTIME:
      return 'LOCALTIME'
    case PropertyType.LOCALDATETIME:
      return 'LOCALDATETIME'
    case PropertyType.POINT:
      return 'POINT'
    case PropertyType.DURATION:
      return 'DURATION'
    default:
      return undefined
  }
}

/**
 * CREATE/DROP statement for a single- or composite-property UNIQUE, EXISTS or
 * INDEX schema object. Composite uniques use the parenthesised property list —
 * the only spelling the Relate engine parses.
 */
export function schemaStatement(
  action: ConstraintAction,
  type: ConstraintType,
  label: string,
  properties: string[],
  name: string = schemaObjectName(label, properties[0], type),
): string {
  if (!properties.length) {
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

/** CREATE/DROP statement for a property-type constraint (NTS-141): `REQUIRE n.prop IS :: STRING` */
export function propertyTypeStatement(
  action: ConstraintAction,
  label: string,
  property: string,
  cypherType: string,
  name: string = schemaObjectName(label, property, ConstraintType.PROPERTY_TYPE),
): string {
  if (action === ConstraintAction.DROP) {
    return `DROP CONSTRAINT ${name} IF EXISTS`
  }

  return `CREATE CONSTRAINT ${name} IF NOT EXISTS FOR (n:${label}) REQUIRE n.${quote(property)} IS :: ${cypherType}`
}

export default class SchemaService {
  constructor(
    private readonly connection: ConnectionProvider,
    private readonly enterprise: boolean = false,
  ) {}

  create(): Promise<SchemaResult[]> {
    return this.runSchemaStatements(ConstraintAction.CREATE)
  }

  drop(): Promise<SchemaResult[]> {
    return this.runSchemaStatements(ConstraintAction.DROP)
  }

  private async runSchemaStatements(action: ConstraintAction): Promise<SchemaResult[]> {
    const output = await Promise.all(
      Array.from(getModels().values()).map((model) =>
        this.runSchemaStatementsForModel(action, model),
      ),
    )

    return output.reduce((acc: SchemaResult[], current: SchemaResult[]) => acc.concat(current), [])
  }

  private async runSchemaStatementsForModel(
    action: ConstraintAction,
    model: EntitySchema,
  ): Promise<SchemaResult[]> {
    const output = await Promise.all(
      model.getLabels().map((label) => this.runSchemaStatementsForLabel(action, model, label)),
    )

    return output.reduce((acc: SchemaResult[], current: SchemaResult[]) => acc.concat(current), [])
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

    if (this.enterprise) {
      const exists = await this.runExistsConstraintStatementsForLabel(action, properties, label)

      return uniques.concat(
        ...indexes,
        ...compositeUniques,
        ...compositeIndexes,
        ...propertyTypes,
        ...exists,
      )
    }

    return uniques.concat(...indexes, ...compositeUniques, ...compositeIndexes, ...propertyTypes)
  }

  private runUniqueConstraintStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isUnique())
        .map((property) =>
          this.runStatement(action, ConstraintType.UNIQUE, label, [property.getKey()]),
        ),
    )
  }

  private runExistsConstraintStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isExists())
        .map((property) =>
          this.runStatement(action, ConstraintType.EXISTS, label, [property.getKey()]),
        ),
    )
  }

  private runIndexStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isIndex())
        .map((property) =>
          this.runStatement(action, ConstraintType.INDEX, label, [property.getKey()]),
        ),
    )
  }

  private runCompositeStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
    type: ConstraintType.UNIQUE | ConstraintType.INDEX,
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
      Array.from(composites.entries()).map(([name, list]) =>
        this.runStatement(action, type, label, list, name),
      ),
    )
  }

  private runPropertyTypeStatementsForLabel(
    action: ConstraintAction,
    properties: PropertySchema[],
    label: string,
  ): Promise<SchemaResult[]> {
    return Promise.all(
      properties
        .filter((property) => property.isTyped())
        .map((property) => {
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
            } as SchemaResult
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
    const statement =
      type === ConstraintType.PROPERTY_TYPE
        ? propertyTypeStatement(action, label, properties[0], cypherType!, name)
        : schemaStatement(action, type, label, properties, name)

    const output: SchemaResult = {
      action,
      type,
      label,
      property: properties[0],
      ...(properties.length > 1 ? { properties } : {}),
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
