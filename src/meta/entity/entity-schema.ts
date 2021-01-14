import PropertySchema from "../property-schema";
import RelationshipPropertySchema from "../relationship-property-schema";

export enum EntityType {
    NodeEntity,
    RelationshipEntity
}

export default class EntitySchema {
    protected properties: Map<string, PropertySchema> = new Map;
    protected relationships: Map<string, RelationshipPropertySchema> = new Map;

    private labels: string[] = [];
    private objectConstructor: ObjectConstructor;


    constructor(protected entityType: EntityType = EntityType.NodeEntity) {}


    setLabels(labels: string[]) {
        this.labels = labels
    }

    getLabels(): string[] {
        return this.labels
    }

    addRelationship(key: string,) {
        this.relationships.set(key, new RelationshipPropertySchema(key))
    }

    hasRelationship(key: string) {
        return this.relationships.has(key)
    }

    getRelationship(key: string): RelationshipPropertySchema {
        return this.relationships.get(key)
    }


    getRelationships(): RelationshipPropertySchema[] {
        return Array.from( this.relationships.values() )
    }

    setConstructor(constructor: ObjectConstructor) {
        this.objectConstructor = constructor
    }

    getConstructor() {
        return this.objectConstructor
    }

    setType(type: EntityType) {
        this.entityType = type
    }

    getType(): EntityType {
        return this.entityType
    }

    hasProperty(key: string) {
        return this.properties.has(key)
    }

    getPrimaryKey() {
        return this.getProperties()
            .find(property => property.isPrimaryKey())
    }

    getProperty(key: string) {
        return this.properties.get(key)
    }

    addProperty(key: string) {
        return this.properties.set(key, new PropertySchema(key))
    }

    getProperties(): PropertySchema[] {
        return Array.from( this.properties.values() )
    }
}