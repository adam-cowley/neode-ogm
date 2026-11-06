import { Newable } from "../meta/newable";
import EntitySchema from "./entity/entity-schema";

export enum PropertyType {
    ANY,
    INTERNAL_ID,
    ALL_PROPERTIES,
    UUID,
    STRING,
    INTEGER,

    // Numbers
    FLOAT,
    NUMBER,

    BOOLEAN,

    // Temporal
    DATE,
    TIME,
    DATETIME,
    LOCALTIME,
    LOCALDATETIME,

    // Spatial
    POINT,

    // Durations
    DURATION,

    // Relationships
    ONE_TO_ONE,
    ONE_TO_MANY,

    START_NODE,
    END_NODE,
    OTHER_NODE,

    NODE,
    RELATIONSHIP
}

/** Property types that map onto Neo4j temporal values */
export const TemporalTypes = [
    PropertyType.DATE,
    PropertyType.TIME,
    PropertyType.DATETIME,
    PropertyType.LOCALTIME,
    PropertyType.LOCALDATETIME,
];

export const RelationshipTypes = [
    PropertyType.ONE_TO_ONE,
    PropertyType.ONE_TO_ONE
]

export type DefaultValue = (model: object, schema: EntitySchema) => any | any | undefined

export default class PropertySchema {
    private type: PropertyType = PropertyType.ANY;
    private defaultValue: DefaultValue;

    private primaryKey: boolean = false;
    private unique: boolean = false;
    private array: boolean = false;
    private required: boolean = false;
    private hidden: boolean = false;
    private protectedOption: boolean = false;
    private readOnly: boolean = false;
    private index: boolean = false;
    private exists: boolean = false;
    private onCreateSet: boolean = false;
    private onMatchSet: boolean = false;
    private alwaysSet: boolean = false;

    private entity: Newable;

    /** neode validation rules (min, max, email, regex, …) beyond the metamodel flags */
    private rules: Record<string, unknown> = {};

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

    setRequired(value = true) {
        this.required = value
    }

    isRequired() {
        return this.required
    }

    setHidden(value = true) {
        this.hidden = value
    }

    isHidden() {
        return this.hidden
    }

    setProtected(value = true) {
        this.protectedOption = value
    }

    isProtected() {
        return this.protectedOption
    }

    setReadonly(value = true) {
        this.readOnly = value
    }

    isReadonly() {
        return this.readOnly
    }

    setIndex(value = true) {
        this.index = value
    }

    isIndex() {
        return this.index
    }

    setExists(value = true) {
        this.exists = value
    }

    isExists() {
        return this.exists
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

    setEntity(entity: Newable) {
        this.entity = entity
    }

    getEntity() {
        return this.entity
    }

    /** Merge the given rules over any previously stored ones */
    setRules(rules: Record<string, unknown>) {
        this.rules = { ...this.rules, ...rules }
    }

    getRules() {
        return this.rules
    }
}
