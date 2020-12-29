import { Driver, Session, Transaction } from "neo4j-driver";
import { DEFAULT_DATABASE } from "../constants";

export class TransactionManager {
    private sessions: Map<string | undefined, Session> = new Map();
    private transactions: Map<string | undefined, Transaction> = new Map();

    constructor(private readonly driver: Driver) {}

    open(database: string | undefined = DEFAULT_DATABASE): Transaction {
        if ( ! this.sessions.has(database) ) {
            this.sessions.set(database, this.driver.session({ database }))
        }

        if ( ! this.transactions.has(database) ) {
            this.transactions.set(database, this.sessions.get(database).beginTransaction())
        }

        return this.transactions.get(database);
    }

    // async commit(): Promise<void> {
    //     // Commit the transaction
    //     await this.transaction.commit()

    //     // Close the session
    //     await this.session.close()

    //     // Unset the transaction & session
    //     this.transaction = undefined
    //     this.session = undefined
    // }

    // async rollback(): Promise<void> {
    //     // Commit the transaction
    //     await this.transaction.rollback()

    //     // Close the session
    //     await this.session.close()

    //     // Unset the transaction & session
    //     this.transaction = undefined
    //     this.session = undefined
    // }
}