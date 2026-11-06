import type { QueryOutput, QueryParams as QueryParameters } from './driver/types.js'

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
}
