import type { Newable } from '../meta/newable.js'
import { Direction } from '../query/index.js'
import type { PropertyType } from './property-schema.js'
import type PropertySchema from './property-schema.js'

export type RelationshipType =
  | (typeof PropertyType)['ONE_TO_ONE']
  | (typeof PropertyType)['ONE_TO_MANY']

export default class RelationshipPropertySchema {
  private readonly key: string
  private type!: string
  private direction!: Direction
  private target: Newable | undefined

  /**
  A target provider for forward-referenced classes: the arrow thunk the
  user wrote, resolved on first getTarget() — the target class may be
  declared later in the file, inside its temporal dead zone at registration
  */
  private targetProvider: (() => Newable) | undefined
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

  setTarget(target: Newable | (() => Newable)) {
    // An arrow thunk has no prototype — store it for deferred resolution
    // instead of calling it during registration
    if (typeof target === 'function' && (target as Newable).prototype === undefined) {
      this.targetProvider = target as () => Newable
    } else {
      this.target = target as Newable
    }
  }

  getTarget(): Newable {
    if (this.targetProvider) {
      const provider = this.targetProvider

      this.targetProvider = undefined
      this.target = provider()
    }

    return this.target!
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

  setDescription(description: string) {
    this.description = description
  }

  getDescription() {
    return this.description
  }

  toString(relAlias = '') {
    return `${this.direction === Direction.INCOMING ? '<' : ''}-[${relAlias}:${this.type}]-${this.direction === Direction.OUTGOING ? '>' : ''}`
  }
}
