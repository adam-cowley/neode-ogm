import type { Newable } from '../meta/newable.js'
import type { Direction } from '../query/index.js'

export default interface RelationshipConfig {
  type: string
  target?: () => Newable
  direction: Direction
  eager?: boolean
}
