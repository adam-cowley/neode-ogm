import { DefaultValue } from "../meta/property-schema";

export default interface PropertyConfig {
    array?: boolean;
    default?: DefaultValue;
    primary?: boolean;
    unique?: boolean;
    onCreateSet?: boolean;
    onMatchSet?: boolean;
    alwaysSet?: boolean;
}
