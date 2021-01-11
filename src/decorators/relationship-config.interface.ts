import { Direction } from "@neode/querybuilder";

export default interface RelationshipConfig {
    type: string;
    target?: () => ObjectConstructor;
    direction: Direction;
    eager?: boolean;
}