import { Property } from "./property";

export default class Schema {

    private labels: string[];
    private properties: Map<string, Property> = new Map;


    setLabels(labels: string[]) {
        this.labels = labels
    }

    getLabels(): string[] {
        return this.labels
    }

    hasProperty(key: string) {
        return this.properties.has(key)
    }

    getProperty(key: string) {
        return this.properties.get(key)
    }

    addProperty(key: string) {
        return this.properties.set(key, new Property(key))
    }

    getProperties(): Property[] {
        return Array.from( this.properties.values() );
    }
}