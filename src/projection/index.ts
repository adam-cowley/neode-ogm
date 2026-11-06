/**
 * Read-model projections (NTS-135/136/137/138): declarative read models
 * composed into a single RETURN projection per read — one Cypher query,
 * no N+1.
 */
export { projectionNode, hasProjectedProperties } from './projection'
export { hydrateProjection } from './hydrate'
export { default as ProjectionService } from './projection.service'
