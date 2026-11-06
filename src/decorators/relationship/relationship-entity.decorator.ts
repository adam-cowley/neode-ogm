import { Newable } from '../../meta/newable'
import { mergeRelationshipModel } from '../../meta'

export default function RelationshipEntity() {
  return function (constructor: Newable) {
    // Merge Model into map or update the type to relationship
    mergeRelationshipModel(constructor)
  }
}
