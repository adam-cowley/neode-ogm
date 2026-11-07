import { EAGER_ID, EAGER_LABELS, eagerPattern } from '../query/eager-utilities.js'
import { Direction } from '../query/index.js'
import type { EntitySchema } from '../meta/entity/entity-schema.js'
import type { PropertySchema } from '../meta/property-schema.js';
import { PropertyType, isProjectedProperty } from '../meta/property-schema.js'
import { RelationshipPropertySchema } from '../meta/relationship-property-schema.js'
import { getModel } from '../meta/index.js'

/**
Read-model projection composition (NTS-135/136/137/138).

Every projected property kind composes into the RETURN map projection of
the one read query — pattern comprehensions for related subsets, inline
`COUNT { }` / `EXISTS { }` subqueries, label predicates and raw
expressions — instead of chasing each relationship with its own query.
*/

/**
Backtick-quote a Cypher identifier (label / relationship type)
*/
function quote(identifier: string): string {
  return '`' + identifier.replaceAll('`', '``') + '`'
}

/**
Target node labels as a Cypher label pattern (':A:B'), or ''
*/
function targetLabels(property: PropertySchema): string {
  const entity = property.getEntity()

  if (!entity) {
    return ''
  }

  const labels = getModel(entity)?.getLabels()

  return labels?.length ? ':' + labels.map(quote).join(':') : ''
}

/**
Variable-length hop pattern ('', '*2', '*1..2', '*..3', '*1..')
*/
function hopPattern(property: PropertySchema): string {
  const minHops = property.getMinHops()
  const maxHops = property.getMaxHops()

  if (minHops === undefined && maxHops === undefined) {
    return ''
  }

  if (minHops !== undefined && minHops === maxHops) {
    return `*${minHops}`
  }

  if (minHops !== undefined && maxHops !== undefined) {
    return `*${minHops}..${maxHops}`
  }

  if (minHops !== undefined) {
    return `*${minHops}..`
  }

  return `*..${maxHops}`
}

/**
Relationship pattern with the target node bound to `node` — the variable
convention for `where` fragments (and what the subqueries count / test).
*/
function relationshipPattern(alias: string, property: PropertySchema): string {
  const direction = property.getDirection() ?? Direction.OUTGOING

  const type = (property.getRelationshipType() ?? '')
    .split('|')
    .filter((part) => part.length)
    .map((part) => quote(part))
    .join('|')

  const types = type ? `:${type}` : ''

  const dirIn = direction === Direction.INCOMING ? '<' : ''
  const dirOut = direction === Direction.OUTGOING ? '>' : ''

  return `(${alias})${dirIn}-[${types}${hopPattern(property)}]-${dirOut}(node${targetLabels(property)})`
}

/**
WHERE fragment inside COUNT { } / EXISTS { } subqueries
*/
function subqueryWhere(property: PropertySchema): string {
  return property.getWhere() ? ` WHERE ${property.getWhere()}` : ''
}

/**
Pattern comprehension for a @RelatedOne / @RelatedMany property
*/
function relatedProjection(alias: string, property: PropertySchema): string {
  const key = property.getKey()
  const fields = property.getFields()

  // No field subset: full-entity eager loading (the existing eager patterns)
  if (!fields?.length) {
    const rel = new RelationshipPropertySchema(key)

    rel.setType(property.getRelationshipType() ?? key)
    rel.setDirection(property.getDirection() ?? Direction.OUTGOING)
    rel.setTarget(property.getEntity())
    rel.setMany(property.getType() === PropertyType.RELATED_MANY)

    return eagerPattern(1, alias, rel)
  }

  const isMany = property.getType() === PropertyType.RELATED_MANY

  const pattern =
    fields.length === 1
      ? `node.${fields[0]}`
      : `node { ${fields.map((field) => `.${field}`).join(', ')} }`

  const comprehension = `[ ${relationshipPattern(alias, property)} | ${pattern} ]`

  // First related node only for the singular form
  return isMany ? `${key}: ${comprehension}` : `${key}: ${comprehension}[0]`
}

/**
One `key: expression` pair of the RETURN map projection
*/
function projectedProperty(alias: string, property: PropertySchema): string {
  switch (property.getType()) {
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY: {
      return relatedProjection(alias, property)
    }

    case PropertyType.RELATIONSHIP_COUNT: {
      return `${property.getKey()}: COUNT { ${relationshipPattern(alias, property)}${subqueryWhere(property)} }`
    }

    case PropertyType.RELATIONSHIP_EXISTS: {
      return `${property.getKey()}: EXISTS { ${relationshipPattern(alias, property)}${subqueryWhere(property)} }`
    }

    case PropertyType.LABEL_PRESENT: {
      return `${property.getKey()}: ${alias}:${quote(property.getLabel()!)}`
    }

    case PropertyType.EXPRESSION: {
      return `${property.getKey()}: ${property.getExpression()}`
    }

    default: {
      // COMPUTED runs in TypeScript after hydration
      return ''
    }
  }
}

/**
True when any property of the model projects a read-model value
*/
export function hasProjectedProperties(schema: EntitySchema): boolean {
  return schema.getProperties().some(isProjectedProperty)
}

/**
The RETURN map projection for a model's read query: all properties, the
hydration identity markers, full-entity eager relationships and every
projected property — one query per read.
*/
export function projectionNode(alias: string, schema: EntitySchema): string {
  const parts: string[] = [
    '.*',
    `${EAGER_ID}: elementId(${alias})`,
    `${EAGER_LABELS}: labels(${alias})`,
  ]

  // Full-entity eager relationships (existing eager machinery)
  for (const rel of schema
    .getRelationships()
    .filter((rel) => rel.getEager())) {parts.push(eagerPattern(1, alias, rel))}

  // Projected read-model properties
  for (const property of schema
    .getProperties()
    .filter(
      (property) => isProjectedProperty(property) && property.getType() !== PropertyType.COMPUTED,
    )) {parts.push(projectedProperty(alias, property))}

  return `${alias} { ${parts.join(', ')} }`
}
