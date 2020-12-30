export default interface INeode {
    find<T extends Object>(constructor: any, value: string, database?: string) : Promise<T | undefined>

    save<T extends Object>(entity: T, database?: string): Promise<T>

    delete<T extends Object>(entity: T, database?: string): Promise<void>
}