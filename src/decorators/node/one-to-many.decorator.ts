import type { Newable } from '../../meta/newable.js'
import { Direction } from '../../query/index.js'
import { mergeRelationshipProperty } from '../../meta/index.js'

export default function OneToMany(
  entity: () => Newable,
  type?: string,
  direction?: Direction,
  eager?: boolean,
) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    // Merge Property Key
    mergeRelationshipProperty(
      constructor,
      propertyKey,
      type ?? '',
      entity(),
      direction ?? Direction.BOTH,
      true,
      eager,
    )
  }
}
