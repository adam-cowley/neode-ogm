export default interface PropertyConfig {
    array?: boolean;
    default?: any;
    primary?: boolean;
    unique?: boolean;
    onCreateSet?: boolean;
    onMatchSet?: boolean;
    alwaysSet?: boolean;
}
