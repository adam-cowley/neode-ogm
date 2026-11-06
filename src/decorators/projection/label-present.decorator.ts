import { mergeProperty } from '../../meta/index.js'
import { PropertyType } from '../../meta/property-schema.js'

/**
NTS-137 — label predicate boolean: true when the node has the given label.

Example:
```ts
@LabelPresent('OptionalLesson')
isOptional: boolean;
```
*/
export default function LabelPresent(label: string) {
  return function (target: any, propertyKey: string, _descriptor?: any): void {
    const constructor = target.constructor

    const property = mergeProperty(constructor, propertyKey, PropertyType.LABEL_PRESENT, {})

    property.setLabel(label)
  }
}
