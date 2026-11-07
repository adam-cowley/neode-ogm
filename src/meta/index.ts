import type { Newable } from '../meta/newable.js'
import type { Direction } from '../query/index.js'
import type INeode from '../neode.interface.js'
export type { DefaultValue } from './property-schema.js'
import type { PropertySchema } from './property-schema.js'
import { PropertyType } from './property-schema.js'

import type { RelationshipPropertySchema } from './relationship-property-schema.js'

import { EntitySchema, EntityType } from './entity/entity-schema.js'
import type { PropertyConfig } from '../decorators/property-config.interface.js'
import type { PropertyDefinition } from './schema-definition.interface.js'
import { replayRegistrations } from '../decorators/registrations.js'
import Repository from '../repository/index.js'

const models = new Map<Newable, EntitySchema>()

/**
Config keys consumed by the metamodel; anything else is a validation rule
*/
const METAMODEL_KEYS = new Set([
  'type',
  'primary',
  'unique',
  'array',
  'default',
  'onCreateSet',
  'onMatchSet',
  'alwaysSet',
  'required',
  'hidden',
  'fulltext',
  'protected',
  'readonly',
  'index',
  'exists',
  'fields',
  'where',
  'minHops',
  'maxHops',
  'label',
  'expression',
  'compute',
  'coalesce',
  'typed',
  'description',
  'fake',
])

export function getModels() {
  return models
}

export function getModel(constructor: any): EntitySchema {
  // Bare classes (no class decorator) register their field decorators lazily
  replayRegistrations(constructor)

  return getModels().get(constructor)!
}

export function mergeModel(constructor: any): EntitySchema {
  // Field decorators queue registrations on the class's Symbol.metadata;
  // replay them before resolving so bare classes register lazily too
  replayRegistrations(constructor)

  if (!getModels().has(constructor)) {
    getModels().set(constructor, new EntitySchema())
  }

  return getModels().get(constructor)!
}

export function mergeRelationshipModel(constructor: any): EntitySchema {
  // Decorators are run in a weird order (accessor, property then class decorators)
  // So this may already exist as a NodeEntity and should be confirmed
  if (!getModels().has(constructor)) {
    getModels().set(constructor, new EntitySchema())
  }

  const model = getModels().get(constructor)!
  model.setType(EntityType.RelationshipEntity)

  return model
}

// PropertyConfig | PropertyDefinition: decorator configs vs the map adapter's
// (structurally compatible; PropertyDefinition just lacks the rule index signature)
export function mergeProperty(
  constructor: any,
  key: string,
  type: PropertyType,
  config: PropertyConfig | PropertyDefinition = {},
): PropertySchema {
  const model = mergeModel(constructor)

  if (!model.hasProperty(key)) {
    model.addProperty(key)
  }

  const property = model.getProperty(key)

  // If specificially set, then overwrite the type
  if (type !== PropertyType.ANY) {
    property.setType(type)
  }

  // Set Config
  if (config?.primary === true) {
    property.setPrimaryKey(true)
  }

  if (config?.unique === true) {
    property.setUnique(true)
  }

  if (Array.isArray(config?.unique)) {
    property.setCompositeUnique(config.unique)
  }

  if (config?.array === true) {
    property.setArray(true)
  }

  if (config?.required === true) {
    property.setRequired(true)
  }

  if (config?.hidden === true) {
    property.setHidden(true)
  }

  if (config?.protected === true) {
    property.setProtected(true)
  }

  if (config?.readonly === true) {
    property.setReadonly(true)
  }

  if (config?.index === true) {
    property.setIndex(true)
  }

  if (Array.isArray(config?.index)) {
    property.setCompositeIndex(config.index)
  }

  if (config?.typed === true) {
    property.setTyped(true)
  }

  if (config?.exists === true) {
    property.setExists(true)
  }

  if (Object.hasOwn(config, 'default')) {
    property.setDefaultValue(config.default!)
  }

  if (Object.hasOwn(config, 'onCreateSet')) {
    property.setOnCreateSet(config.onCreateSet)
  }

  if (Object.hasOwn(config, 'onMatchSet')) {
    property.setOnMatchSet(config.onMatchSet)
  }

  if (Object.hasOwn(config, 'alwaysSet')) {
    property.setAlwaysSet(config.alwaysSet)
  }

  if (config?.fulltext === true) {
    property.setFulltext(true)
  }

  // Agent-facing property explanation (NTS-445)
  if (typeof config?.description === 'string') {
    property.setDescription(config.description)
  }

  // Read-model projection config (NTS-135/136/137/138)
  const projection = config as Record<string, unknown>

  if (Array.isArray(projection['fields'])) {
    property.setFields(projection['fields'] as string[])
  }

  if (typeof projection['where'] === 'string') {
    property.setWhere(projection['where'])
  }

  if (typeof projection['minHops'] === 'number') {
    property.setMinHops(projection['minHops'])
  }

  if (typeof projection['maxHops'] === 'number') {
    property.setMaxHops(projection['maxHops'])
  }

  if (typeof projection['label'] === 'string') {
    property.setLabel(projection['label'])
  }

  if (typeof projection['expression'] === 'string') {
    property.setExpression(projection['expression'])
  }

  if (typeof projection['compute'] === 'function') {
    property.setCompute(projection['compute'] as (entity: any) => unknown)
  }

  // Hydration defaults (NTS-139): literal or sibling-property coalesce
  if (typeof projection['coalesce'] === 'string' || Array.isArray(projection['coalesce'])) {
    property.setCoalesce(projection['coalesce'] as string | string[])
  }

  // Factory seeding (NTS-444): per-property fake data generator
  if (typeof projection['fake'] === 'function') {
    property.setFake(projection['fake'] as () => unknown)
  }

  // Persist every config key the metamodel has no flag for as a validation rule
  property.setRules(
    Object.fromEntries(Object.entries(config).filter(([key]) => !METAMODEL_KEYS.has(key))),
  )

  return property
}

export function mergeRelationshipProperty(
  constructor: any,
  key: string,
  type: string,
  target: Newable,
  direction: Direction,
  many: boolean,
  eager?: boolean,
  description?: string,
): RelationshipPropertySchema {
  mergeModel(constructor)

  if (!models.get(constructor)!.hasProperty(key)) {
    models.get(constructor)!.addRelationship(key)
  }

  const rel = models.get(constructor)!.getRelationship(key)

  rel.setType(type)
  rel.setDirection(direction)
  rel.setTarget(target)
  rel.setMany(many)
  rel.setEager(eager || false)

  // Agent-facing relationship explanation (NTS-445)
  if (description !== undefined) {
    rel.setDescription(description)
  }

  return rel
}

/**
A (custom) repository class, registered per entity. Instances are created
with (neode, entity, database?) at resolution time — never stored.
*/
export type RepositoryConstructor = new (
  neode: INeode,
  entity: any,
  database?: string,
) => Repository<any>

const repositories = new Map<Newable, RepositoryConstructor>()

export function registerRepository(
  entity: Newable,
  repository: Repository<any> | RepositoryConstructor,
) {
  // An instance is accepted for convenience: its constructor is stored
  repositories.set(
    entity,
    typeof repository === 'function'
      ? repository
      : (repository.constructor as RepositoryConstructor),
  )
}

export function getRepository(entity: Newable): RepositoryConstructor | undefined {
  return repositories.get(entity)
}

/**
Resolution point for repositories: the custom repository registered for
the entity (constructed with the given neode and entity), or the default
Repository
*/
export function resolveRepository<Entity>(
  neode: INeode,
  entity: new (...arguments_: never[]) => Entity,
  database?: string,
): Repository<Entity> {
  const Custom = repositories.get(entity)

  return Custom
    ? (new Custom(neode, entity, database) as Repository<Entity>)
    : new Repository<Entity>(neode, entity, database)
}
