import EntitySchema from "./entity/entity-schema";

export enum PropertyType {
    ANY,
    INTERNAL_ID,
    ALL_PROPERTIES,
    UUID,
    STRING,
    INTEGER,

    ONE_TO_ONE,
    ONE_TO_MANY,

    START_NODE,
    END_NODE,
    OTHER_NODE,

    NODE,
    RELATIONSHIP
}

export const RelationshipTypes = [
    PropertyType.ONE_TO_ONE,
    PropertyType.ONE_TO_ONE
]

export type DefaultValue = (model: Object, schema: EntitySchema) => any | any | undefined

export default class PropertySchema {
    private type: PropertyType = PropertyType.ANY;
    private defaultValue: DefaultValue;

    private primaryKey: boolean;
    private unique: boolean;
    private array: boolean;
    private onCreateSet: boolean;
    private onMatchSet: boolean;
    private alwaysSet: boolean;

    private entity: ObjectConstructor;

    constructor(private readonly key: string) {}

    getKey(): string {
        return this.key
    }

    setType(type: PropertyType) {
        this.type = type
    }

    getType(): PropertyType {
        return this.type
    }

    setArray(value: boolean = true) {
        this.array = value
    }

    isArray() {
        return this.array
    }

    setDefaultValue(value: DefaultValue) {
        this.defaultValue = value
    }

    getDefaultValue() {
        return this.defaultValue
    }

    setPrimaryKey(value: boolean = true) {
        this.primaryKey = value
        this.unique = value
    }

    isPrimaryKey() {
        return this.primaryKey
    }

    setUnique(value: boolean = true) {
        this.unique = value
    }

    isUnique() {
        return this.unique
    }

    setOnCreateSet(value = true) {
        this.onCreateSet = value
    }

    getOnCreateSet() {
        return this.onCreateSet
    }

    setOnMatchSet(value = true) {
        this.onMatchSet = value
    }

    getOnMatchSet() {
        return this.onMatchSet
    }

    setAlwaysSet(value = true) {
        this.alwaysSet = value
    }

    getAlwaysSet() {
        return this.alwaysSet
    }

    setEntity(entity: ObjectConstructor) {
        this.entity = entity
    }

    getEntity() {
        return this.entity
    }
}
