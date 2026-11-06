import { DefaultValue } from "../meta/property-schema";

export default interface PropertyConfig {
    /** Property type name, as accepted by the @Property decorator (e.g. 'string', 'datetime'). */
    type?: string;
    array?: boolean;
    default?: DefaultValue;
    primary?: boolean;
    unique?: boolean;
    onCreateSet?: boolean;
    onMatchSet?: boolean;
    alwaysSet?: boolean;
    required?: boolean;
    hidden?: boolean;
    protected?: boolean;
    readonly?: boolean;
    index?: boolean;
    exists?: boolean;
}
