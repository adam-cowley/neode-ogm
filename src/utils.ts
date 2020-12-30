import neo4j from 'neo4j-driver'
import Neode from './neode.service'
import { TransactionManager } from "./transaction/manager"

export function fromEnv(): Neode {
    // Load vars from .env
    require('dotenv').config();

    const connection_string = `${process.env.NEO4J_PROTOCOL}://${process.env.NEO4J_HOST}:${process.env.NEO4J_PORT}`;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;
    const enterprise = process.env.NEO4J_ENTERPRISE === 'true';

    // Multi-database
    const database = process.env.NEO4J_DATABASE || 'neo4j';

    // Build additional config
    const config = {};

    const settings = {
        NEO4J_MAX_CONNECTION_POOLSIZE: 'maxConnectionPoolSize',
        NEO4J_MAX_TRANSACTION_RETRY_TIME: 'maxTransactionRetryTime',
        NEO4J_LOAD_BALANCING_STRATEGY: 'loadBalancingStrategy',
        NEO4J_MAX_CONNECTION_LIFETIME: 'maxConnectionLifetime',
        NEO4J_CONNECTION_TIMEOUT: 'connectionTimeout',
        NEO4J_DISABLE_LOSSLESS_INTEGERS: 'disableLosslessIntegers',
        NEO4J_LOGGING_LEVEL: 'logging',
    };

    Object.keys(settings).forEach(setting => {
        if ( process.env.hasOwnProperty(setting) ) {
            const key = settings[ setting ];
            let value: any = process.env[ setting ];

            if ( key == "trustedCertificates" ) {
                value = value.split(',');
            }
            else if ( key == "disableLosslessIntegers" ) {
                value = value === 'true';
            }
            else if ( key == 'maxTransactionRetryTime' || key == 'connectionTimeout' || key == 'connectionAcquisitionTimeout' ) {
                value = parseInt(value)
            }

            config[ key ] = value;
        }
    });

    // TODO: Load env vars
    const driver = neo4j.driver(connection_string, neo4j.auth.basic(username, password))

    return new Neode(driver,database, enterprise)
}