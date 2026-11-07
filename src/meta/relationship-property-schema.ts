import type { Newable } from '../meta/newable.js'
// Import Direction from its leaf module: the query barrel pulls the eager
// utilities, which pull the metamodel back in (dependency cycle)
import { Direction } from '../query/direction.js'
import type { PropertySchema, PropertyType } from './property-schema.js'

export type RelationshipType =
  | (typeof PropertyType)['ONE_TO_ONE']
  | (typeof PropertyType)['ONE_TO_MANY']

export class RelationshipPropertySchema {
  static fromPropertySchema(original: PropertySchema): RelationshipPropertySchema {
    const cloned = new RelationshipPropertySchema(original.getKey())

    return cloned
  }

  private readonly key: string
  private type!: string
  private direction!: Direction
  private target!: Newable
  private many!: boolean
  private eager = false

  /**
  Free-text explanation emitted by the agent ontology (NTS-445)
  */
  private description: string | undefined

  constructor(key: string) {
    this.key = key
  }

  getKey(): string {
    return this.key
  }

  setType(type: string): void {
    this.type = type
  }

  getType(): string {
    return this.type
  }

  setDirection(direction: Direction): void {
    this.direction = direction
  }

  getDirection(): Direction {
    return this.direction
  }

  setTarget(target: Newable): void {
    this.target = target
  }

  getTarget(): Newable {
    return this.target
  }

  setMany(isMany: boolean): void {
    this.many = isMany
  }

  getMany(): boolean {
    return this.many
  }

  setEager(isEager: boolean): void {
    this.eager = isEager
  }

  getEager(): boolean {
    return this.eager
  }

  setDescription(description: string): void {
    this.description = description
  }

  getDescription(): string | undefined {
    return this.description
  }

  toString(relationshipAlias = ''): string {
    return `${this.direction === Direction.INCOMING ? '<' : ''}-[${relationshipAlias}:${this.type}]-${this.direction === Direction.OUTGOING ? '>' : ''}`
  }
}
