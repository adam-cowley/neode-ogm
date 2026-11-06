import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'
import type PropertyConfig from '../property-config.interface.js'
import { addRegistration, memberName } from '../registrations.js'

export default function Primary(config: PropertyConfig = {}) {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void {
    const propertyKey = memberName(context)

    addRegistration(context.metadata, (constructor) => {
      // Merge Property Key
      const property = mergeProperty(constructor, propertyKey, PropertyType.ANY, config)

      property.setPrimaryKey()
    })
  }
}
