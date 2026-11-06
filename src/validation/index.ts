import EntitySchema from '../meta/entity/entity-schema';
import { PropertyType } from '../meta/property-schema';
import { buildPropertySchema } from './rule-table';
import ValidationError, { ValidationDetail } from './validation-error';

/** Property types that reference entities or internals — never validated as values */
const SKIPPED_TYPES = new Set([
    PropertyType.INTERNAL_ID,
    PropertyType.ONE_TO_ONE,
    PropertyType.ONE_TO_MANY,
    PropertyType.START_NODE,
    PropertyType.END_NODE,
    PropertyType.OTHER_NODE,
    PropertyType.NODE,
    PropertyType.RELATIONSHIP,
]);

/**
 * Validate an object against an entity schema. Runs the Zod schema for every
 * registered property (type base + rules), collecting all issues — like
 * Joi's abortEarly: false — and throwing a ValidationError when anything
 * fails.
 *
 * Unknown keys are always allowed (allowUnknown): only registered properties
 * are validated. undefined is skipped unless the property is required; null
 * behaves the same (a required property fails with `"<key>" is required`,
 * an optional property passes).
 */
export function validate(properties: Record<string, unknown>, schema: EntitySchema): void {
    const details: ValidationDetail[] = [];

    schema.getProperties().forEach(property => {
        if (SKIPPED_TYPES.has(property.getType())) return;

        const key = property.getKey();
        const value = Object.hasOwn(properties, key) ? properties[ key ] : undefined;

        // Joi's default `empty` value: '' is treated as unset
        const effective = value === '' ? undefined : value;

        if (effective === undefined || effective === null) {
            if (property.isRequired()) {
                details.push({ message: `"${key}" is required`, path: [ key ], type: 'any.required' });
            }

            return;
        }

        const result = buildPropertySchema(property).safeParse(effective);

        if (!result.success) {
            result.error.issues.forEach(issue => {
                details.push({
                    message: issue.message,
                    path: [ key, ...issue.path.map(String) ],
                    type: issue.code,
                });
            });
        }
    });

    if (details.length) {
        throw new ValidationError(details, properties);
    }
}

export { buildPropertySchema };
export { default as ValidationError, ERROR_VALIDATION } from './validation-error';
