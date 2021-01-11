import { Direction } from "@neode/querybuilder";
import PropertySchema, { PropertyType } from "./property-schema";

export type RelationshipType = PropertyType.ONE_TO_ONE | PropertyType.ONE_TO_MANY

export default class RelationshipPropertySchema {

    private type: string;
    private direction: Direction;
    private target: ObjectConstructor;
    private many: boolean;
    private eager: boolean = false;

    constructor(private readonly key: string ) {}

    static fromPropertySchema(original: PropertySchema): RelationshipPropertySchema {
        const cloned = new RelationshipPropertySchema(original.getKey())


        return cloned;
    }

    getKey() {
        return this.key
    }

    setType(type: string) {
        this.type = type
    }

    getType() {
        return this.type
    }

    setDirection(direction: Direction) {
        this.direction = direction
    }

    getDirection() {
        return this.direction
    }

    setTarget(target: ObjectConstructor) {
        this.target = target
    }

    getTarget() {
        return this.target
    }

    setMany(many: boolean) {
        this.many = many
    }

    getMany() {
        return this.many
    }

    setEager(eager: boolean) {
        this.eager = eager
    }

    getEager() {
        return this.eager
    }

    toString(relAlias: string = '') {
        return `${this.direction === Direction.INCOMING ? '<' : ''}-[${relAlias}:${this.type}]-${this.direction === Direction.OUTGOING ? '>' : ''}`
    }

}