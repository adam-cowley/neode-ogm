import { mergeRelationshipModel } from "../../meta";

export default function RelationshipEntity() {
    return function(constructor: Function)  {
        // Merge Model into map or update the type to relationship
        mergeRelationshipModel(constructor)

    }
}