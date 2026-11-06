import { mergeProperty } from '../../meta/index.js'
import type { Newable } from '../../meta/newable.js'
import { PropertyType } from '../../meta/property-schema.js'
import { toDirection } from '../../query/index.js'
import type { RelatedConfig } from './projection-config.interface.js'

/**
NTS-135 — eagerly load a related entity as a nested read-only DTO holding
only the named fields. Without `fields`, the full entity is eagerly loaded
(same behaviour as an eager @OneToOne).

Example:
```ts
@RelatedOne({ type: 'IN_COURSE', direction: 'out', fields: ['title', 'status'] })
course: { title: string; status: string };
```
*/
export default function RelatedOne(config: RelatedConfig) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    const property = mergeProperty(
      constructor,
      propertyKey,
      PropertyType.RELATED_ONE,
      config.fields ? { fields: config.fields } : {},
    )

    property.setRelationshipType(config.type)
    property.setDirection(toDirection(config.direction))

    // With a field subset the target class is not needed for hydration;
    // without one it drives full-entity eager loading, resolved from an
    // explicit target() or design:type (SWC cannot emit design:type for
    // self-referential property types — it falls back to Object)
    const entity: Newable | undefined =
      config.target?.() ??
      (config.fields ? undefined : Reflect.getMetadata('design:type', target, propertyKey))

    if (entity) {
      property.setEntity(entity)
    }
  }
}
