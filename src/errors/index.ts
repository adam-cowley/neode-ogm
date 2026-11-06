// Typed error taxonomy (NTS-129): classifyError maps raw driver/engine
// errors (neo4j-driver's Neo4jError, the Relate client's RelateError) to
// these types; unknown errors pass through untouched.
export { default as NeodeError } from './neode-error'
export { default as ConstraintViolationError } from './constraint-violation'
export { default as TransientError } from './transient'
export { classifyError, isTransientError } from './classify'
