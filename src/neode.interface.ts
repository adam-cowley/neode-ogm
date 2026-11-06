import { QueryOutput, QueryParams } from './driver/types'

export default interface INeode {
  find<T>(
    constructor: new (...args: never[]) => T,
    value: string,
    database?: string,
  ): Promise<T | undefined>
  findById<T>(
    constructor: new (...args: never[]) => T,
    elementId: string,
    database?: string,
  ): Promise<T | undefined>
  save<T>(entity: T, database?: string): Promise<T>
  delete<T>(entity: T, database?: string): Promise<void>
  readCypher(query: string, params: QueryParams, database?: string): Promise<QueryOutput>
  writeCypher(query: string, params: QueryParams, database?: string): Promise<QueryOutput>
}
