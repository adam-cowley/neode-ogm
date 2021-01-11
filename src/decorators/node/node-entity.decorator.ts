import { mergeModel } from "../../meta";
import NodeConfig from "../node-config.interface";

export default function NodeEntity(config: NodeConfig = {}) {
    return function(constructor: Function)  {
        // Merge Model into map
        const model = mergeModel(constructor)

        // If no label has been defined, use the constructor name
        const labels = config.labels || [constructor.name]

        // Sort Labels by name
        labels.sort()

        // Set Labels in definition
        model.setLabels(labels)
    }
}