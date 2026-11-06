// Node Entities
export { default as NodeEntity } from './node/node-entity.decorator.js'

export { default as InternalId } from './internal-id.decorator.js'

export { default as Primary } from './node/primary.decorator.js'
export { default as Uuid } from './node/uuid.decorator.js'
// @deprecated Use @Property({ type: 'string' }) instead
export { default as String } from './node/string.decorator.js'
export { default as Number } from './node/number.decorator.js'
export { default as OneToOne } from './node/one-to-one.decorator.js'
export { default as OneToMany } from './node/one-to-many.decorator.js'

// Properties
export { default as Property } from './property.decorator.js'
export { default as Boolean } from './node/boolean.decorator.js'
export { default as Float } from './node/float.decorator.js'
export { default as Date } from './node/date.decorator.js'
export { default as Time } from './node/time.decorator.js'
export { default as DateTime } from './node/date-time.decorator.js'
export { default as LocalTime } from './node/local-time.decorator.js'
export { default as LocalDateTime } from './node/local-date-time.decorator.js'
export { default as Point } from './node/point.decorator.js'
export { default as Duration } from './node/duration.decorator.js'

// Property Options
export { default as Default } from './node/default.decorator.js'
export { default as OnCreateSet } from './node/on-create-set.decorator.js'
export { default as OnMatchSet } from './node/on-match-set.decorator.js'
export { default as Index } from './node/index.decorator.js'
export { default as Unique } from './node/unique.decorator.js'
export { default as Required } from './node/required.decorator.js'
export { default as Hidden } from './node/hidden.decorator.js'
export { default as Protected } from './node/protected.decorator.js'
export { default as Readonly } from './node/readonly.decorator.js'

// Relationship Entities
export { default as RelationshipEntity } from './relationship/relationship-entity.decorator.js'

export { default as StartNode } from './relationship/start-node.decorator.js'
export { default as EndNode } from './relationship/end-node.decorator.js'
export { default as OtherNode } from './relationship/other-node.decorator.js'

// Read-model projections (NTS-135/136/137/138)
export { default as RelatedOne } from './projection/related-one.decorator.js'
export { default as RelatedMany } from './projection/related-many.decorator.js'
export { default as RelationshipCount } from './projection/relationship-count.decorator.js'
export { default as RelationshipExists } from './projection/relationship-exists.decorator.js'
export { default as LabelPresent } from './projection/label-present.decorator.js'
export { default as Computed } from './projection/computed.decorator.js'
export { default as Expression } from './projection/expression.decorator.js'
export type {
  RelatedConfig,
  RelationshipCountConfig,
  RelationshipExistsConfig,
  ProjectionDirection,
} from './projection/projection-config.interface.js'

// Repositories
export { default as EntityRepository } from './repository.decorator.js'
