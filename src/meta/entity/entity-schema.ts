import type { Newable } from '../newable.js'
import { PropertySchema } from '../property-schema.js'
import { RelationshipPropertySchema } from '../relationship-property-schema.js'

export const EntityType = {
  NodeEntity: 0,
  RelationshipEntity: 1,
} as const

export type EntityType = (typeof EntityType)[keyof typeof EntityType]

export class EntitySchema {
  protected properties = new Map<string, PropertySchema>()
  protected relationships = new Map<string, RelationshipPropertySchema>()

  private labels: string[] = []
  private objectConstructor!: Newable
  protected entityType: EntityType = EntityType.NodeEntity

  /**
  Undeclared default primary keys (<first label lowercased>_id), cached per
  key so getPrimaryKey() is reference-stable without registering the
  property on the schema
  */
  private phantomPrimaryKeys = new Map<string, PropertySchema>()

  /**
  Free-text explanation emitted by the agent ontology (NTS-445)
  */
  private description: string | undefined

  constructor(entityType: EntityType = EntityType.NodeEntity) {
    this.entityType = entityType
  }

  setLabels(labels: string[]): void {
    this.labels = [...new Set(labels)].sort()
  }

  getLabels(): string[] {
    return [...this.labels]
  }

  addLabel(label: string): void {
    this.setLabels([...this.labels, label])
  }

  setDescription(description: string): void {
    this.description = description
  }

  getDescription(): string | undefined {
    return this.description
  }

  addRelationship(key: string): void {
    this.relationships.set(key, new RelationshipPropertySchema(key))
  }

  hasRelationship(key: string): boolean {
    return this.relationships.has(key)
  }

  getRelationship(key: string): RelationshipPropertySchema {
    return this.relationships.get(key)!
  }

  getRelationships(): RelationshipPropertySchema[] {
    return Array.from(this.relationships.values())
  }

  setConstructor(constructor: Newable): void {
    this.objectConstructor = constructor
  }

  getConstructor(): Newable {
    return this.objectConstructor
  }

  setType(type: EntityType): void {
    this.entityType = type
  }

  getType(): EntityType {
    return this.entityType
  }

  hasProperty(key: string): boolean {
    return this.properties.has(key)
  }

  getPrimaryKey(): PropertySchema | undefined {
    // Explicit primary key always wins
    const explicit = this.getProperties().find((property) => property.isPrimaryKey())

    if (explicit) {
      return explicit
    }

    // Default primary key to <first label lowercased>_id (see neode Model.js)
    const [firstLabel] = this.getLabels()

    if (!firstLabel) {
      return undefined
    }

    const key = `${firstLabel.toLowerCase()}_id`

    if (this.hasProperty(key)) {
      const property = this.getProperty(key)

      property.setPrimaryKey()

      return property
    }

    // Undeclared default: a phantom property, deliberately NOT added to the
    // schema — a getter must not mutate, and a registered-but-never-written
    // property would install a dead unique constraint and hydrate as a
    // field. Cached per key so repeated calls return the same instance.
    let phantom = this.phantomPrimaryKeys.get(key)

    if (!phantom) {
      phantom = new PropertySchema(key)
      phantom.setPrimaryKey()
      this.phantomPrimaryKeys.set(key, phantom)
    }

    return phantom
  }

  getProperty(key: string): PropertySchema {
    return this.properties.get(key)!
  }

  addProperty(key: string): Map<string, PropertySchema> {
    return this.properties.set(key, new PropertySchema(key))
  }

  getProperties(): PropertySchema[] {
    return Array.from(this.properties.values())
  }
}
