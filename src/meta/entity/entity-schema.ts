import { Newable } from "../newable";
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
    private objectConstructor: Newable;


    constructor(protected entityType: EntityType = EntityType.NodeEntity) {}


    setLabels(labels: string[]) {
        this.labels = [ ...new Set(labels) ].sort()
    }

    getLabels(): string[] {
        return [ ...this.labels ]
    }

    addLabel(label: string) {
        this.setLabels([ ...this.labels, label ])
    }

    addRelationship(key: string,) {
        this.relationships.set(key, new RelationshipPropertySchema(key))
    }

    hasRelationship(key: string) {
        return this.relationships.has(key)
    }

    getRelationship(key: string): RelationshipPropertySchema {
        return this.relationships.get(key)!
    }


    getRelationships(): RelationshipPropertySchema[] {
        return Array.from( this.relationships.values() )
    }

    setConstructor(constructor: Newable) {
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

    getPrimaryKey(): PropertySchema | undefined {
        // Explicit primary key always wins
        const explicit = this.getProperties()
            .find(property => property.isPrimaryKey())

        if ( explicit ) {
            return explicit
        }

        // Default Primary Key to <first label lowercased>_id (see neode Model.js)
        const [ firstLabel ] = this.getLabels()

        if ( !firstLabel ) {
            return undefined
        }

        const key = `${firstLabel.toLowerCase()}_id`

        if ( !this.hasProperty(key) ) {
            this.addProperty(key)
        }

        const property = this.getProperty(key)

        property.setPrimaryKey()

        return property
    }

    getProperty(key: string) {
        return this.properties.get(key)!
    }

    addProperty(key: string) {
        return this.properties.set(key, new PropertySchema(key))
    }

    getProperties(): PropertySchema[] {
        return Array.from( this.properties.values() )
    }
}