import { mergeModel, mergeProperty, repositories } from '../meta/index'
import { PropertyType } from '../meta/property'

interface NodeConfig {
    labels?: string[];
}

export function Repository(entity: Object) {
    return function(constructor: Function)  {
        repositories.set(constructor, entity)
    }
}

export function Node(config: NodeConfig = {}) {
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

export function Uuid() {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.STRING)

        // Set Default
        // TODO: Call the function
        property.setDefaultValue('___DEFAULT___')

    }
}

export function String() {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.STRING)
    }
}

export function Primary() {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.STRING)

        property.setPrimaryKey()
    }
}

export function Unique() {
    return function(target: any, propertyKey: string, descriptor?: any): void {
        const constructor = target.constructor

        // Merge Property Key
        const property = mergeProperty(constructor, propertyKey, PropertyType.STRING)

        property.setUnique()
    }
}