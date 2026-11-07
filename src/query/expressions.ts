/**
Leaf Cypher expression helpers.

Statement structure lives in Builder (match / where / call / unwind …);
these helpers only compose single expressions for RETURN / SET / WHERE
positions, so repositories never assemble hand-written clause strings.
Every value a caller supplies must be bound as a parameter (`$name`) —
these helpers interpolate structure, never data.
*/
export const expr = {
  coalesce: (...expressions: string[]): string => `coalesce(${expressions.join(', ')})`,
  toString: (expression: string): string => `toString(${expression})`,
  datetime: (expression?: string): string => (expression ? `datetime(${expression})` : 'datetime()'),
  randomUUID: (): string => 'randomUUID()',
  size: (expression: string): string => `size(${expression})`,
  head: (expression: string): string => `head(${expression})`,
  last: (expression: string): string => `last(${expression})`,
  exists: (expression: string): string => `exists(${expression})`,
  isEmpty: (expression: string): string => `isEmpty(${expression})`,
  trim: (expression: string): string => `trim(${expression})`,
  count: (expression = '*'): string => `count(${expression})`,
  countDistinct: (expression: string): string => `count(DISTINCT ${expression})`,
  sum: (expression: string): string => `sum(${expression})`,
  any: (variable: string, list: string, predicate: string): string =>
    `any(${variable} IN ${list} WHERE ${predicate})`,
  all: (variable: string, list: string, predicate: string): string =>
    `all(${variable} IN ${list} WHERE ${predicate})`,
  /**
  Pattern comprehension: `[(a)-[:REL]->(b) | b.prop]` — the pattern is
  composed from fragments, the projection is an expression
  */
  listComprehension: (pattern: string, projection: string): string =>
    `[${pattern} | ${projection}]`,
  /**
  APOC helpers used by the GraphAcademy port (apoc.coll / apoc.text)
  */
  apocCollToSet: (expression: string): string => `apoc.coll.toSet(${expression})`,
  apocBase64Encode: (expression: string): string => `apoc.text.base64Encode(${expression})`,
}

/**
CASE expression: `CASE WHEN c1 THEN t1 [WHEN …] [ELSE fallback] END`.
Conditions and results are Cypher expressions composed by the caller.
*/
export function caseExpr(
  pairs: { when: string; then: string }[],
  fallback?: string,
): string {
  const parts = pairs.map((pair) => `WHEN ${pair.when} THEN ${pair.then}`)

  if (fallback !== undefined) {
    parts.push(`ELSE ${fallback}`)
  }

  return `CASE ${parts.join(' ')} END`
}
