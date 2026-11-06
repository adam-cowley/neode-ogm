// Typed error taxonomy (NTS-129): classifyError maps raw driver/engine
// errors (neo4j-driver's Neo4jError, the Relate client's RelateError) to
// these types; unknown errors pass through untouched.
export { default as NeodeError } from './neode-error.js'
export { default as ConstraintViolationError } from './constraint-violation.js'
export { default as TransientError } from './transient.js'
export { classifyError, isTransientError } from './classify.js'
