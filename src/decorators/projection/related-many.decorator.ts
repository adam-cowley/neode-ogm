import { mergeProperty } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { RelatedConfig } from './projection-config.interface.js'

/**
NTS-135 — eagerly load related entities as a read-only list. With a field
subset the result is projected flat: a single field yields a scalar array
(`completedLessons: string[]`), several fields an array of plain DTOs.
Without `fields`, full entities are eagerly loaded (same behaviour as an
eager @OneToMany).

Example:
```ts
@RelatedMany({ type: 'COMPLETED_LESSON', fields: ['slug'] })
completedLessons: string[];
```
*/
export default function RelatedMany(config: RelatedConfig) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    const property = mergeProperty(
      constructor,
      propertyKey,
      PropertyType.RELATED_MANY,
      config.fields ? { fields: config.fields } : {},
    )

    property.setRelationshipType(config.type)
    property.setDirection(toDirection(config.direction))

    const entity: Newable | undefined =
      config.target?.() ??
      (config.fields ? undefined : Reflect.getMetadata('design:type', target, propertyKey))

    if (entity) {
      property.setEntity(entity)
    }
  }
}
