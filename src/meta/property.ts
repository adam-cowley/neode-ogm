export enum PropertyType {
    INTERNAL_ID,
    UUID,
    STRING
}

export class Property {
    private type: PropertyType = PropertyType.STRING;
    private defaultValue: any;

    private primaryKey: boolean;
    private unique: boolean;

    constructor(
        private readonly key: string
    ) {}

    getKey(): string {
        return this.key
    }

    setType(type: PropertyType) {
        this.type = type
    }

    getType(): PropertyType {
        return this.type
    }

    setDefaultValue(value: any) {
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


}