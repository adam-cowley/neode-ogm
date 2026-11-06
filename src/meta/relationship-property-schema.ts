import type { Newable } from '../meta/newable.js'
import { Direction } from '../query/index.js'
import type {PropertyType} from './property-schema.js';
import type PropertySchema from './property-schema.js'

export type RelationshipType =
  | (typeof PropertyType)['ONE_TO_ONE']
  | (typeof PropertyType)['ONE_TO_MANY']

export default class RelationshipPropertySchema {
  private readonly key: string
  private type!: string
  private direction!: Direction
  private target!: Newable
  private many!: boolean
  private eager = false

  constructor(key: string) {
    this.key = key
  }

  static fromPropertySchema(original: PropertySchema): RelationshipPropertySchema {
    const cloned = new RelationshipPropertySchema(original.getKey())

    return cloned
  }

  getKey() {
    return this.key
  }

  setType(type: string) {
    this.type = type
  }

  getType() {
    return this.type
  }

  setDirection(direction: Direction) {
    this.direction = direction
  }

  getDirection() {
    return this.direction
  }

  setTarget(target: Newable) {
    this.target = target
  }

  getTarget() {
    return this.target
  }

  setMany(many: boolean) {
    this.many = many
  }

  getMany() {
    return this.many
  }

  setEager(eager: boolean) {
    this.eager = eager
  }

  getEager() {
    return this.eager
  }

  toString(relAlias = '') {
    return `${this.direction === Direction.INCOMING ? '<' : ''}-[${relAlias}:${this.type}]-${this.direction === Direction.OUTGOING ? '>' : ''}`
  }
}
