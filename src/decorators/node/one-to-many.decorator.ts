import type { Newable } from '../../meta/newable.js'
import { Direction } from '../../query/index.js'
import { mergeRelationshipProperty } from '../../meta/index.js'
import { addRegistration, memberName } from '../registrations.js'

export default function OneToMany(
  entity: () => Newable,
  type?: string,
  direction?: Direction,
  eager?: boolean,
) {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
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
    })
  }
}
