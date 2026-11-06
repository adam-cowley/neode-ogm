import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

/**
Register a boolean property.
*/
export default function Boolean(config: PropertyConfig = {}) {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      mergeProperty(constructor, propertyKey, PropertyType.BOOLEAN, config)
    })
  }
}
