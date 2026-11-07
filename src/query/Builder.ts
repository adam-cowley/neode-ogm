import Match from './Match.js'
import Order from './Order.js'
import Property from './Property.js'
import Relationship from './Relationship.js'
import Statement from './Statement.js'
import Where, { OPERATOR_EQUALS } from './Where.js'
import LabelPredicate from './LabelPredicate.js'
import WhereBetween from './WhereBetween.js'
import WhereId from './WhereId.js'
import WhereNull from './WhereNull.js'
import WhereRaw from './WhereRaw.js'
import WhereStatement from './WhereStatement.js'
import type { Direction } from './Direction.js'
import WithDistinctStatement from './WithDistinctStatement.js'
import WithStatement from './WithStatement.js'
import {
  ConstraintAction,
  ConstraintType,
  propertyTypeStatement,
  schemaStatement,
} from '../services/schema/schema.service.js'
import type { AccessMode, ConnectionProvider, QueryOutput, Runner } from '../driver/types.js'
import type EntitySchema from '../meta/entity/entity-schema.js'

/**
Identity criteria for a persisted entity, as produced by
matchCriteriaForEntity: the elementId when known, else the primary key
property to match on
*/
export interface EntityMatchCriteria {
  elementId?: string
  key: string
  value: unknown
}

export const mode = {
  READ: 'READ',
  WRITE: 'WRITE',
} as const

export type BuilderParams = Record<string, unknown>

type WhereArguments = [left: string, operator: string, value: unknown] | [left: string, value: unknown]

/**
Fluent Cypher query builder.

A statement-based builder: every `match()` / `create()` / `merge()` call
starts a new statement segment; where clauses accumulate against the
current segment and are flushed into it when the next segment starts or
when `build()` is called.

All user values are passed as query parameters - the generated query
contains only aliases.
*/
export default class Builder {
  private readonly params: BuilderParams = {}
  private readonly statements: { toString(includePrefix?: boolean): string }[] = []

  private current?: Statement
  private whereClause?: WhereStatement
  private setCount = 0
  private subCount = 0

  /**
  Register a named parameter for use in raw expressions (`$name`) — the
  channel for values inside setExpr / callProcedure / whereRaw positions,
  where the builder cannot bind values itself (NTS-462/473)
  */
  param(name: string, value: unknown): this {
    this.params[name] = value

    return this
  }

  /**
  Start a new query segment and set the current statement
  */
  statement(prefix?: string): this {
    if (this.current) {
      this.statements.push(this.current)
    }

    this.current = new Statement(prefix)

    return this
  }

  /**
  Start a new where segment. When a where segment is already open, it is
  flushed into the current statement first.
  */
  whereStatement(prefix?: string): this {
    if (this.whereClause && this.current) {
      this.current.where(this.whereClause.toString())
    }

    this.whereClause = new WhereStatement(prefix)

    return this
  }

  /**
  Match a node pattern by alias and optional labels / inline properties
  */
  match(alias?: string, labels?: string | string[] | false, properties?: BuilderParams): this {
    this.whereStatement('WHERE')
    this.statement()

    this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Add an optional match to the query
  */
  optionalMatch(alias?: string, labels?: string | string[] | false): this {
    this.whereStatement('WHERE')
    this.statement('OPTIONAL MATCH')

    this.current!.match(new Match(alias, labels))

    return this
  }

  /**
  Add a `WITH` clause to the query
  */
  with(...variables: string[]): this {
    this.whereStatement('WHERE')
    this.statement()

    this.statements.push(new WithStatement(variables))

    return this
  }

  /**
  Add a `WITH DISTINCT` clause to the query
  */
  withDistinct(...variables: string[]): this {
    this.whereStatement('WHERE')
    this.statement()

    this.statements.push(new WithDistinctStatement(variables))

    return this
  }

  /**
  Start an `OR` where clause. Switches the connector used for the next
  condition appended to the current where segment (creating one if none
  is open) so that it combines with `OR` instead of `AND`.
  
  P2.2 parity (neode Builder#or): neode opens a separate `OR (...)`
  segment, which renders an invalid leading `OR (` when called before
  any where condition. Here the connector applies to the next clause
  inside the single WHERE group instead; Cypher's operator precedence
  keeps the semantics identical to neode's grouped output.
  */
  or(...arguments_: unknown[]): this {
    if (!this.whereClause) {
      this.whereStatement('WHERE')
    }

    this.whereClause!.setConnector('OR')

    return this.where(...(arguments_ as WhereArguments))
  }

  /**
  Generate a unique parameter name and add the value to the params object
  */
  private addParameter(key: string, value: unknown): string {
    let attempt = 1
    const base = `where_${key.replaceAll(/[^a-z0-9]+/gi, '_')}`

    let variable = base

    while (this.params[variable] !== undefined) {
      attempt++
      variable = `${base}_${attempt}`
    }

    this.params[variable] = value

    return variable
  }

  /**
  Add a where condition to the current statement. Supported forms:
  
  - `where('n.name', 'Adam')` - equality
  - `where('n.age', '>', 30)` - explicit operator
  - `where({ name: 'Adam' })` - object map
  - `where([['name', 'Adam'], ['age', '>', 30]])` - array of clauses
  - `where('n.name =~ ".*"')` - raw string
  */
  where(...arguments_: unknown[]): this {
    if (arguments_.length === 0 || !arguments_[0]) {
      return this
    }

    // Two arguments: property / value equality
    if (arguments_.length === 2) {
      arguments_ = [arguments_[0], OPERATOR_EQUALS, arguments_[1]]
    }

    // Single argument: object, array or raw string
    if (arguments_.length === 1) {
      const [argument] = arguments_

      if (Array.isArray(argument)) {
        for (const inner of argument) {
          this.where(...(inner as unknown[]))
        }
      } else if (typeof argument === 'object') {
        for (const [key, value] of Object.entries(argument as Record<string, unknown>)) {
          this.where(key, value)
        }
      } else {
        this.whereRaw(String(argument))
      }
    } else {
      const [left, operator, value] = arguments_ as [string, string, unknown]
      const variable = this.addParameter(left, value)

      this.whereClause!.append(new Where(left, operator, `$${variable}`))
    }

    return this
  }

  /**
  Query on element ID
  */
  whereId(alias: string, value: string | number): this {
    const variable = this.addParameter(`${alias}_id`, value)

    this.whereClause!.append(new WhereId(alias, variable))

    return this
  }

  /**
  Add a raw where clause
  */
  whereRaw(clause: string): this {
    this.whereClause!.append(new WhereRaw(clause))

    return this
  }

  /**
  Negate the previous where condition
  */
  whereNot(...arguments_: unknown[]): this {
    this.where(...arguments_)

    const last = this.whereClause!.last()

    if (last && typeof (last as Where).setNegative === 'function') {
      ;(last as Where).setNegative()
    }

    return this
  }

  /**
  Between clause: `$floor <= alias <= $ceiling`
  */
  whereBetween(alias: string, floor: unknown, ceiling: unknown): this {
    const floorVariable = this.addParameter(`${alias}_floor`, floor)
    const ceilingVariable = this.addParameter(`${alias}_ceiling`, ceiling)

    this.whereClause!.append(new WhereBetween(alias, floorVariable, ceilingVariable))

    return this
  }

  /**
  Negative between clause
  */
  whereNotBetween(alias: string, floor: unknown, ceiling: unknown): this {
    this.whereBetween(alias, floor, ceiling)

    const last = this.whereClause!.last()

    if (last && typeof (last as WhereBetween).setNegative === 'function') {
      ;(last as WhereBetween).setNegative()
    }

    return this
  }

  /**
  Membership test: `alias IN $param` over the given values
  */
  whereIn(property: string, values: unknown[]): this {
    const variable = this.addParameter(property, values)

    this.whereClause!.append(new Where(property, 'IN', `$${variable}`))

    return this
  }

  /**
  Substring test: `property CONTAINS $param`
  */
  whereContains(property: string, value: string): this {
    return this.whereStringOperator(property, value, 'CONTAINS')
  }

  /**
  Prefix test: `property STARTS WITH $param`
  */
  whereStartsWith(property: string, value: string): this {
    return this.whereStringOperator(property, value, 'STARTS WITH')
  }

  /**
  Suffix test: `property ENDS WITH $param`
  */
  whereEndsWith(property: string, value: string): this {
    return this.whereStringOperator(property, value, 'ENDS WITH')
  }

  private whereStringOperator(property: string, value: string, operator: string): this {
    const variable = this.addParameter(property, value)

    this.whereClause!.append(new Where(property, operator, `$${variable}`))

    return this
  }

  /**
  `property IS NULL`
  */
  whereNull(property: string): this {
    this.whereClause!.append(new WhereNull(property))

    return this
  }

  /**
  `property IS NOT NULL`
  */
  whereNotNull(property: string): this {
    this.whereNull(property)

    const last = this.whereClause!.last()

    if (last && typeof (last as WhereNull).setNegative === 'function') {
      ;(last as WhereNull).setNegative()
    }

    return this
  }

  /**
  Existential subquery: `EXISTS { pattern }`. The fragment is taken
  verbatim - pass a node/relationship pattern or an inner
  `MATCH ... RETURN ...` subquery; values inside cannot be parameterised.
  */
  whereExists(pattern: string): this {
    return this.whereRaw(`EXISTS { ${pattern} }`)
  }

  /**
  `ANY(variable IN list WHERE predicate)` over a list expression
  (a property holding a list, or a literal list). The predicate is
  taken verbatim - inline literals or use whereRaw for parameters.
  */
  whereAny(variable: string, list: string, predicate: string): this {
    return this.whereRaw(`ANY(${variable} IN ${list} WHERE ${predicate})`)
  }

  /**
  Label predicate: `alias:Label` (or `NOT alias:Label`), optionally
  over several labels - all of them must be present
  */
  whereLabel(alias: string, label: string | string[], negate = false): this {
    this.whereClause!.append(new LabelPredicate(alias, label, negate))

    return this
  }

  /**
  Order by a label predicate: `ORDER BY alias:Label [direction]`
  (shares the label-predicate machinery with whereLabel)
  */
  orderByLabel(alias: string, label: string | string[], direction = ''): this {
    this.current!.order(new Order(new LabelPredicate(alias, label).toString(), direction))

    return this
  }

  /**
  Add a `DELETE` clause
  */
  delete(...values: string[]): this {
    this.current!.delete(...values)

    return this
  }

  /**
  Add a `DETACH DELETE` clause
  */
  detachDelete(...values: string[]): this {
    this.current!.detachDelete(...values)

    return this
  }

  /**
  Start a `CREATE` statement
  */
  create(alias: string, labels?: string | string[] | false, properties?: BuilderParams): this {
    this.whereStatement('WHERE')
    this.statement('CREATE')

    this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Convert a map of properties into inline pattern properties,
  adding each value to the query parameters
  */
  private convertPropertyMap(alias: string | undefined, properties?: BuilderParams): Property[] {
    if (properties) {
      return Object.keys(properties).map((key) => {
        const propertyAlias = `${alias}_${key}`

        this.params[propertyAlias] = properties[key]

        return new Property(key, propertyAlias)
      })
    }

    return []
  }

  /**
  Start a `MERGE` statement
  */
  merge(alias: string, labels?: string | string[] | false, properties?: BuilderParams): this {
    this.whereStatement('WHERE')
    this.statement('MERGE')

    this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Set a property. Supported forms:
  
  - `set('n.name', 'Adam')` - parameterised set
  - `set('n.age', 30, '+=')` - explicit operator
  - `set({ 'n.name': 'Adam' })` - map of properties
  - `set('n.age = n.age + 1', undefined)` - raw set
  */
  set(
    property: string | Record<string, unknown>,
    value?: unknown,
    operator = '=',
  ): this {
    if (value === undefined && property instanceof Object) {
      for (const [key, value_] of Object.entries(property)) {
        this.set(key, value_)
      }
    } else {
      if (value === undefined) {
        this.current!.setRaw([property as string])
      } else {
        const alias = `set_${this.setCount}`
        this.params[alias] = value
        this.setCount++

        this.current!.set(property as string, alias, operator)
      }
    }

    return this
  }

  /**
  Set a property only on `ON CREATE SET`
  */
  onCreateSet(
    property: string | Record<string, unknown>,
    value?: unknown,
    operator = '=',
  ): this {
    if (value === undefined && property instanceof Object) {
      for (const [key, value_] of Object.entries(property)) {
        this.onCreateSet(key, value_)
      }
    } else {
      const alias = `set_${this.setCount}`
      this.params[alias] = value
      this.setCount++

      this.current!.onCreateSet(property as string, alias, operator)
    }

    return this
  }

  /**
  Set a property only on `ON MATCH SET`
  */
  onMatchSet(
    property: string | Record<string, unknown>,
    value?: unknown,
    operator = '=',
  ): this {
    if (value === undefined && property instanceof Object) {
      for (const [key, value_] of Object.entries(property)) {
        this.onMatchSet(key, value_)
      }
    } else {
      const alias = `set_${this.setCount}`
      this.params[alias] = value
      this.setCount++

      this.current!.onMatchSet(property as string, alias, operator)
    }

    return this
  }

  /**
  Remove properties or labels, in `n.prop` or `n:Label` format
  */
  remove(...items: string[]): this {
    this.current!.remove(items)

    return this
  }

  /**
  Set return fields / expressions
  */
  return(...values: string[]): this {
    this.current!.return(...values)

    return this
  }

  /**
  Set the record limit
  */
  limit(limit: number): this {
    this.current!.limit(limit)

    return this
  }

  /**
  Set records to skip
  */
  skip(skip: number): this {
    this.current!.skip(skip)

    return this
  }

  /**
  Add an order by clause. Supported forms:
  
  - `orderBy('n.name', 'DESC')`
  - `orderBy('n.name')`
  - `orderBy(['n.name', 'n.other'])`
  - `orderBy({ 'n.name': 'DESC' })`
  - `orderBy({ field: 'n.name', order: 'DESC' })`
  - `orderBy([{ field: 'n.name', order: 'ASC' }, { field: 'n.other', order: 'DESC' }])`
  */
  orderBy(...arguments_: unknown[]): this {
    let order: Order | undefined

    if (arguments_.length === 2) {
      order = new Order(String(arguments_[0]), String(arguments_[1]))
    } else if (Array.isArray(arguments_[0])) {
      ;for (const argument of (arguments_[0] as unknown[])) {this.orderBy(argument)}
    } else if (typeof arguments_[0] === 'object' && arguments_[0]) {
      const descriptor = arguments_[0] as { field?: unknown; order?: unknown }

      if (descriptor.field) {
        // P2.2 parity (neode Builder#orderBy): an object carrying a
        // `field` key is a single `{ field, order }` descriptor,
        // not a field -> direction map.
        order = new Order(
          String(descriptor.field),
          descriptor.order ? String(descriptor.order) : '',
        )
      } else {
        for (const [key, value] of Object.entries(descriptor as Record<string, unknown>)) {
          this.orderBy(key, value)
        }
      }
    } else if (arguments_[0]) {
      order = new Order(String(arguments_[0]))
    }

    if (order) {
      this.current!.order(order)
    }

    return this
  }

  /**
  Add a relationship pattern to the current statement
  
  @param type  Relationship type, or array of types
  @param direction  Direction of the relationship
  @param alias  Relationship alias
  @param degrees  Number of traversals (1, "1..2", "0..2", "..3")
  */
  relationship(
    type?: string | string[],
    direction?: string | Direction,
    alias?: string,
    degrees?: number | string,
  ): this {
    this.current!.match(new Relationship(type, direction, alias, degrees))

    return this
  }

  /**
  `SET <key> = <expression>` where the expression is raw Cypher
  (`datetime()`, `coalesce($email, u.email)`, …). Values inside the
  expression are bound via `param(name, value)` — the expression must
  never interpolate data.
  */
  setExpr(key: string, expression: string, params: BuilderParams = {}): this {
    this.current!.setRaw([`${key} = ${expression}`])

    for (const [name, value] of Object.entries(params)) {
      this.param(name, value)
    }

    return this
  }

  /**
  `ON CREATE SET <key> = <expression>` — expression-valued, so server-side
  values (`datetime()`, `randomUUID()`) and param-first coalesces compose
  without raw Cypher (NTS-460/462)
  */
  onCreateSetExpr(key: string, expression: string, params: BuilderParams = {}): this {
    this.current!.onCreateSetRaw([`${key} = ${expression}`])

    for (const [name, value] of Object.entries(params)) {
      this.param(name, value)
    }

    return this
  }

  /**
  `ON MATCH SET <key> = <expression>` — expression-valued (NTS-460/462)
  */
  onMatchSetExpr(key: string, expression: string, params: BuilderParams = {}): this {
    this.current!.onMatchSetRaw([`${key} = ${expression}`])

    for (const [name, value] of Object.entries(params)) {
      this.param(name, value)
    }

    return this
  }

  /**
  A procedure call with YIELD: `CALL db.index.fulltext.queryNodes($index, $q)
  YIELD node, score`. Arguments are expressions — bind values via
  `param(name, value)` and pass `'$name'` (NTS-464).
  */
  callProcedure(procedure: string, args: string[] = [], yields: string[] = []): this {
    this.flush()

    const argumentList = args.join(', ')
    const call = `CALL ${procedure}(${argumentList})`
    const yieldClause = yields.length > 0 ? ` YIELD ${yields.join(', ')}` : ''

    this.statements.push({ toString: () => `${call}${yieldClause}` })

    return this
  }

  /**
  Constraint / index DDL, composed like queries (NTS-474). Each call
  appends one idempotent schema statement.
  */
  createUniqueConstraint(label: string, property: string): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.UNIQUE, label, [property])
  }

  createRangeIndex(label: string, property: string): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.INDEX, label, [property])
  }

  createCompositeUniqueConstraint(label: string, properties: string[]): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.UNIQUE, label, properties)
  }

  createCompositeIndex(label: string, properties: string[]): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.INDEX, label, properties)
  }

  createExistenceConstraint(label: string, property: string): this {
    return this.schemaStatementSegment(ConstraintAction.CREATE, ConstraintType.EXISTS, label, [property])
  }

  createPropertyTypeConstraint(label: string, property: string, cypherType: string): this {
    return this.schemaStatementSegment(
      ConstraintAction.CREATE,
      ConstraintType.PROPERTY_TYPE,
      label,
      [property],
      cypherType,
    )
  }

  dropConstraint(label: string, property: string, type: ConstraintType = ConstraintType.UNIQUE): this {
    return this.schemaStatementSegment(ConstraintAction.DROP, type, label, [property])
  }

  private schemaStatementSegment(
    action: ConstraintAction,
    type: ConstraintType,
    label: string,
    properties: string[],
    cypherType?: string,
  ): this {
    this.flush()
    this.statements.push({
      toString: () =>
        type === ConstraintType.PROPERTY_TYPE
          ? propertyTypeStatement(action, label, properties[0] ?? '', cypherType ?? '')
          : schemaStatement(action, type, label, properties),
    })

    return this
  }

  /**
  Complete a relationship with a target node pattern
  */
  to(alias: string, labels?: string | string[] | false, properties?: BuilderParams): this {
    this.current!.match(new Match(alias, labels, this.convertPropertyMap(alias, properties)))

    return this
  }

  /**
  Flush any open statement / where segment into `statements`
  */
  private flush(): void {
    this.whereStatement()
    this.statement()
  }

  /**
  Compile a sub-builder into a query fragment, namespacing its parameters
  into this builder's parameter space (sub0_, sub1_, …) so nested queries
  never collide with parent or sibling parameters
  */
  private compileSub(
    build: (sub: Builder) => Builder,
    imports: string[] = [],
  ): { inner: string; imports: string[] } {
    const sub = new Builder()
    const returned = build(sub) ?? sub

    const { query, params } = returned.build()
    const prefix = `sub${this.subCount++}_`

    for (const [key, value] of Object.entries(params)) {
      this.params[`${prefix}${key}`] = value
    }

    return {
      inner: query.replaceAll(/\$(\w+)/g, (_match, key: string) => `$${prefix}${key}`),
      imports,
    }
  }

  /**
  A scoped subquery: `CALL (u) { … }`. The callback builds the inner
  query; `imports` names outer-scope variables passed into the subquery.
  */
  call(build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner } = this.compileSub(build, imports)
    const scope = imports.length > 0 ? `(${imports.join(', ')})` : ''

    this.flush()
    this.statements.push({ toString: () => `CALL ${scope} {\n${inner}\n}` })

    return this
  }

  /**
  `UNWIND <listExpression> AS <variable>`
  */
  unwind(listExpression: string, variable: string): this {
    this.flush()
    this.statements.push({ toString: () => `UNWIND ${listExpression} AS ${variable}` })

    return this
  }

  /**
  `FOREACH (<variable> IN <listExpression> | <clauses>)` — the callback
  builds the update clauses (SET / MERGE / DELETE …) applied per element
  */
  forEach(variable: string, listExpression: string, build: (sub: Builder) => Builder): this {
    const { inner } = this.compileSub(build)
    const clauses = inner.replaceAll('\n', ' ')

    this.flush()
    this.statements.push({ toString: () => `FOREACH (${variable} IN ${listExpression} | ${clauses})` })

    return this
  }

  /**
  `COUNT { … } AS <alias>` in a RETURN / WITH position (NTS: grouped and
  conditional counts without hand-written Cypher)
  */
  countSubquery(alias: string, build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    this.return(`COUNT { ${scope}${inner} } AS ${alias}`)

    return this
  }

  /**
  `COLLECT { … } AS <alias>` in a RETURN / WITH position (NTS: collected
  sub-projections without hand-written Cypher)
  */
  collectSubquery(
    alias: string,
    build: (sub: Builder) => Builder,
    imports: string[] = [],
  ): this {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    this.return(`COLLECT { ${scope}${inner} } AS ${alias}`)

    return this
  }

  /**
  `EXISTS { … }` as a WHERE predicate (NTS: relationship / property
  existence checks without hand-written Cypher)
  */
  whereExistsSubquery(build: (sub: Builder) => Builder, imports: string[] = []): this {
    const { inner, imports: scoped } = this.compileSub(build, imports)
    const scope = scoped.length > 0 ? `WITH ${scoped.join(', ')} ` : ''

    this.whereRaw(`EXISTS { ${scope}${inner} }`)

    return this
  }

  /**
  Match a node by an entity's identity (as produced by
  matchCriteriaForEntity): elementId when known, else the primary key
  property. One implementation keeps read and write paths in lockstep.
  */
  matchEntity(alias: string, schema: EntitySchema, criteria: EntityMatchCriteria): this {
    return criteria.elementId ? this.match(alias).whereId(alias, criteria.elementId) : this.match(alias, schema.getLabels(), { [criteria.key]: criteria.value });
  }

  /**
  Complete a relationship with a target node matched by an entity's
  identity (the `to(...)` counterpart of matchEntity)
  */
  toEntity(alias: string, schema: EntitySchema, criteria: EntityMatchCriteria): this {
    return criteria.elementId ? this.to(alias).whereId(alias, criteria.elementId) : this.to(alias, schema.getLabels(), { [criteria.key]: criteria.value });
  }

  /**
  Complete a relationship pointing to anything
  */
  toAnything(): this {
    this.current!.match(new Match())

    return this
  }

  /**
  Build the pattern without any keywords
  */
  pattern(): string {
    this.whereStatement()
    this.statement()

    return this.statements
      .map((statement) => statement.toString(false))
      .filter((statement) => statement.length)
      .join('\n')
  }

  /**
  Build and run the query against the given runner (neode's
  Builder#execute): pass `neode.getConnection()` to run it through the
  connection provider, which honours the READ / WRITE mode
  */
  async execute(runner: Runner, mode: AccessMode = 'WRITE'): Promise<QueryOutput> {
    const { query, params } = this.build()

    // A ConnectionProvider routes by mode; a bare Runner ignores the
    // extra argument
    return (runner as ConnectionProvider).run(query, params, mode)
  }

  /**
  Build the query
  */
  build(): { query: string; params: BuilderParams } {
    this.whereStatement()
    this.statement()

    const query = this.statements
      .map((statement) => statement.toString())
      .filter((statement) => statement.length)
      .join('\n')

    return {
      query,
      params: this.params,
    }
  }
}
