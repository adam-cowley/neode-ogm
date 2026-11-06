export const DEFAULT_DATABASE = undefined
export const THIS_NODE = 'this'
export const INTERNAL_NODE = '__node'
export const INTERNAL_ID = '__id'

/**
 * Runtime stash for a hydrated entity's elementId: matching by elementId
 * works with or without the deprecated @InternalId property
 */
export const ELEMENT_ID = Symbol('neode.elementId')