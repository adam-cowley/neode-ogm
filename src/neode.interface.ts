import { QueryResult } from "neo4j-driver";

export default interface INeode {
    find<T extends Object>(constructor: any, value: string, database?: string) : Promise<T | undefined>
    findById<T extends Object>(constructor: any, id: number, database?: string): Promise<T | undefined>
    save<T extends Object>(entity: T, database?: string): Promise<T>
    delete<T extends Object>(entity: T, database?: string): Promise<void>
    readCypher(query: string, params: Record<string, any>, database?: string): Promise<QueryResult>
    writeCypher(query: string, params: Record<string, any>, database?: string): Promise<QueryResult>

}