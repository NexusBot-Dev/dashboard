import mysql, { type Pool } from 'mysql2/promise';
import { DB_PASSWORD } from './secrets';

// const DB_PASSWORD = getSecret('NEXUS_DASHBOARD_DB_PASSWORD', 'DB_PASSWORD_FILE');

const globalForDb = globalThis as unknown as { dbPool: Pool };

export const pool =
  globalForDb.dbPool ??
  mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 2,
    idleTimeout: 60000,
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.dbPool = pool;
}

export default pool;