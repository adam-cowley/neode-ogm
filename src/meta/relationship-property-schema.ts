import type { Newable } from '../meta/newable.js'
import { Direction } from '../query/index.js'
import type { PropertyType } from './property-schema.js'
import type { PropertySchema } from './property-schema.js'

export type RelationshipType =
  | (typeof PropertyType)['ONE_TO_ONE']
  | (typeof PropertyType)['ONE_TO_MANY']

export class RelationshipPropertySchema {
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

  static fromPropertySchema(original: PropertySchema): RelationshipPropertySchema {
    const cloned = new RelationshipPropertySchema(original.getKey())

    return cloned
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

  setMany(many: boolean): void {
    this.many = many
  }

  getMany(): boolean {
    return this.many
  }

  setEager(eager: boolean): void {
    this.eager = eager
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

  toString(relAlias = ''): string {
    return `${this.direction === Direction.INCOMING ? '<' : ''}-[${relAlias}:${this.type}]-${this.direction === Direction.OUTGOING ? '>' : ''}`
  }
}
