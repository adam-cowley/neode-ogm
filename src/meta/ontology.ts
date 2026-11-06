import { getModels } from './index.js'
import { PropertyType } from './property-schema.js'
import { Direction } from '../query/index.js'

/**
Human-readable property type names for ontology emission (NTS-445),
keyed by the numeric PropertyType.
*/
const PROPERTY_TYPE_NAMES: Partial<Record<PropertyType, string>> = {
  [PropertyType.ANY]: 'any',
  [PropertyType.INTERNAL_ID]: 'internalId',
  [PropertyType.UUID]: 'uuid',
  [PropertyType.STRING]: 'string',
  [PropertyType.INTEGER]: 'integer',
  [PropertyType.FLOAT]: 'float',
  [PropertyType.NUMBER]: 'number',
  [PropertyType.BOOLEAN]: 'boolean',
  [PropertyType.DATE]: 'date',
  [PropertyType.TIME]: 'time',
  [PropertyType.DATETIME]: 'datetime',
  [PropertyType.LOCALTIME]: 'localtime',
  [PropertyType.LOCALDATETIME]: 'localdatetime',
  [PropertyType.POINT]: 'point',
  [PropertyType.DURATION]: 'duration',
  [PropertyType.RELATED_ONE]: 'relatedOne',
  [PropertyType.RELATED_MANY]: 'relatedMany',
  [PropertyType.RELATIONSHIP_COUNT]: 'relationshipCount',
  [PropertyType.RELATIONSHIP_EXISTS]: 'relationshipExists',
  [PropertyType.LABEL_PRESENT]: 'labelPresent',
  [PropertyType.EXPRESSION]: 'expression',
  [PropertyType.COMPUTED]: 'computed',
}

/**
Short ontology spellings for Direction (NTS-445)
*/
const DIRECTION_NAMES: Record<Direction, string> = {
  [Direction.INCOMING]: 'in',
  [Direction.OUTGOING]: 'out',
  [Direction.BOTH]: 'both',
}

/**
One property of an entity, as exposed to LLM agents (NTS-445)
*/
export interface PropertyOntology {
  name: string
  type: string
  required: boolean
  unique: boolean
  indexed: boolean
  description?: string
}

/**
One relationship of an entity, as exposed to LLM agents (NTS-445)
*/
export interface RelationshipOntology {
  name: string
  relationship: string
  direction: string
  target: string
  description?: string
}

/**
One entity (registered model), as exposed to LLM agents (NTS-445)
*/
export interface EntityOntology {
  name: string
  labels: string[]
  description?: string
  properties: PropertyOntology[]
  relationships: RelationshipOntology[]
}

/**
The full ontology over every registered model (NTS-445)
*/
export interface Ontology {
  entities: EntityOntology[]
}

/**
Build an agent-readable ontology over ALL registered models (NTS-445):
entities with their labels, descriptions, properties and relationships,
pulled from the shared metadata registry the map API and decorators both
write into. Purely synchronous, no database connection required.
*/
export function ontology(): Ontology {
  const entities: EntityOntology[] = []

  for (const [constructor, schema] of getModels()) {
    const properties = schema.getProperties().map((property) => {
      const description = property.getDescription()

      return {
        name: property.getKey(),
        type: PROPERTY_TYPE_NAMES[property.getType()] ?? 'any',
        required: property.isRequired(),
        unique: property.isUnique() || property.getCompositeUnique() !== undefined,
        indexed: property.isIndex() || property.getCompositeIndex() !== undefined,
        ...(description !== undefined ? { description } : {}),
      }
    })

    const relationships = schema.getRelationships().map((rel) => {
      const description = rel.getDescription()

      return {
        name: rel.getKey(),
        relationship: rel.getType(),
        direction: DIRECTION_NAMES[rel.getDirection()] ?? 'both',
        target: rel.getTarget()?.name ?? '',
        ...(description !== undefined ? { description } : {}),
      }
    })

    const entityDescription = schema.getDescription()

    entities.push({
      name: constructor.name,
      labels: schema.getLabels(),
      ...(entityDescription !== undefined ? { description: entityDescription } : {}),
      properties,
      relationships,
    })
  }

  return { entities }
}

/**
Render `ontology()` as prompt-ready markdown (NTS-445): a heading per
entity, bullet lists per property and relationship, descriptions included
where declared.
*/
export function ontologyMarkdown(): string {
  const lines: string[] = ['# Graph ontology', '']

  for (const entity of ontology().entities) {
    lines.push(`## ${entity.name}`, '')

    if (entity.description !== undefined) {
      lines.push(entity.description, '')
    }

    lines.push(`Labels: ${entity.labels.join(', ')}`, '')

    if (entity.properties.length > 0) {
      lines.push('### Properties', '')

      for (const property of entity.properties) {
        const flags = [
          property.required && 'required',
          property.unique && 'unique',
          property.indexed && 'indexed',
        ]
          .filter(Boolean)
          .join(', ')

        const qualifier = flags ? `${property.type}, ${flags}` : property.type

        lines.push(
          `- \`${property.name}\` (${qualifier})${property.description ? `: ${property.description}` : ''}`,
        )
      }

      lines.push('')
    }

    if (entity.relationships.length > 0) {
      lines.push('### Relationships', '')

      for (const relationship of entity.relationships) {
        lines.push(
          `- \`${relationship.name}\` :${relationship.relationship} ${relationship.direction} -> ${relationship.target}${
            relationship.description ? `: ${relationship.description}` : ''
          }`,
        )
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}
