import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a point (spatial) property.
*/
export default function Point(config: PropertyConfig = {}) {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.POINT, config)
    })
  }
}
