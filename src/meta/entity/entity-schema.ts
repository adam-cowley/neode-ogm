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

    // Default Primary Key to <first label lowercased>_id (see neode Model.js)
    const [firstLabel] = this.getLabels()

    if (!firstLabel) {
      return undefined
    }

    const key = `${firstLabel.toLowerCase()}_id`

    if (!this.hasProperty(key)) {
      this.addProperty(key)
    }

    const property = this.getProperty(key)

    property.setPrimaryKey()

    return property
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
