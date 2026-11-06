import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'

/**
NTS-138 — derived field, computed in TypeScript after hydration from the
entity's projected fields. Never sent to the database.

Example:
```ts
@Computed((entity) => `${entity.firstName} ${entity.lastName}`)
fullName: string;
```
*/
export default function Computed(compute: (entity: any) => unknown) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    const property = mergeProperty(constructor, propertyKey, PropertyType.COMPUTED, {})

    property.setCompute(compute)
  }
}
