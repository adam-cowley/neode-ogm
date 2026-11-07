import type { QueryOutput, QueryParams as QueryParameters } from './driver/types.js'
import type { ScoredEntity } from './services/query/search.service.js'

export default interface INeode {
  find<T>(
    constructor: new (...arguments_: never[]) => T,
    value: string,
    database?: string,
  ): Promise<T | undefined>
  findById<T>(
    constructor: new (...arguments_: never[]) => T,
    elementId: string,
    database?: string,
  ): Promise<T | undefined>
  save<T>(entity: T, database?: string): Promise<T>
  delete<T>(entity: T, database?: string): Promise<void>
  readCypher(query: string, parameters: QueryParameters, database?: string): Promise<QueryOutput>
  writeCypher(query: string, parameters: QueryParameters, database?: string): Promise<QueryOutput>
  search<T>(
    constructor: new (...arguments_: never[]) => T,
    indexName: string,
    query: string,
    limit?: number,
  ): Promise<ScoredEntity<T>[]>
  cypher<T>(
    query: string,
    parameters?: QueryParameters,
    options?: { hydrate: new (...arguments_: never[]) => T; alias?: string; database?: string },
  ): Promise<T[]>
  cypher(
    query: string,
    parameters?: QueryParameters,
    options?: { database?: string },
  ): Promise<QueryOutput>
}
