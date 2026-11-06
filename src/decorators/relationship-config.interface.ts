import { Newable } from '../meta/newable'
import { Direction } from '../query'

export default interface RelationshipConfig {
  type: string
  target?: () => Newable
  direction: Direction
  eager?: boolean
}
