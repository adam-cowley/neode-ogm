// Node Entities
export { default as NodeEntity } from './node/node-entity.decorator'

export { default as InternalId } from './internal-id.decorator'

export { default as Primary } from './node/primary.decorator'
export { default as Uuid } from './node/uuid.decorator'
// @deprecated Use @Property({ type: 'string' }) instead
export { default as String } from './node/string.decorator'
export { default as Number } from './node/number.decorator'
export { default as OneToOne } from './node/one-to-one.decorator'
export { default as OneToMany } from './node/one-to-many.decorator'

// Properties
export { default as Property } from './property.decorator'
export { default as Boolean } from './node/boolean.decorator'
export { default as Float } from './node/float.decorator'
export { default as Date } from './node/date.decorator'
export { default as Time } from './node/time.decorator'
export { default as DateTime } from './node/date-time.decorator'
export { default as LocalTime } from './node/local-time.decorator'
export { default as LocalDateTime } from './node/local-date-time.decorator'
export { default as Point } from './node/point.decorator'
export { default as Duration } from './node/duration.decorator'

// Property Options
export { default as Default } from './node/default.decorator'
export { default as OnCreateSet } from './node/on-create-set.decorator'
export { default as OnMatchSet } from './node/on-match-set.decorator'
export { default as Index } from './node/index.decorator'
export { default as Unique } from './node/unique.decorator'
export { default as Required } from './node/required.decorator'
export { default as Hidden } from './node/hidden.decorator'
export { default as Protected } from './node/protected.decorator'
export { default as Readonly } from './node/readonly.decorator'

// Relationship Entities
export { default as RelationshipEntity } from './relationship/relationship-entity.decorator'

export { default as StartNode } from './relationship/start-node.decorator'
export { default as EndNode } from './relationship/end-node.decorator'
export { default as OtherNode } from './relationship/other-node.decorator'

// Read-model projections (NTS-135/136/137/138)
export { default as RelatedOne } from './projection/related-one.decorator'
export { default as RelatedMany } from './projection/related-many.decorator'
export { default as RelationshipCount } from './projection/relationship-count.decorator'
export { default as RelationshipExists } from './projection/relationship-exists.decorator'
export { default as LabelPresent } from './projection/label-present.decorator'
export { default as Computed } from './projection/computed.decorator'
export { default as Expression } from './projection/expression.decorator'
export type { RelatedConfig, RelationshipCountConfig, RelationshipExistsConfig, ProjectionDirection } from './projection/projection-config.interface'

// Repositories
export { default as EntityRepository } from './repository.decorator'
