import pg from 'pg';
import { config } from '../config.js';
const { Pool } = pg;

const dbOptions = config.databaseUrl
  ? { connectionString: config.databaseUrl }
  : config.cloudSqlInstance
    ? {
        user: config.dbUser, password: config.dbPassword, database: config.dbName,
        host: `/cloudsql/${config.cloudSqlInstance}`
      }
    : {
        user: config.dbUser || undefined, password: config.dbPassword || undefined,
        database: config.dbName || undefined, host: process.env.DB_HOST || undefined,
        port: Number(process.env.DB_PORT || 5432)
      };

export const pool = new Pool({
  ...dbOptions,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 3000,
  keepAlive: true,
  allowExitOnIdle: false
});

pool.on('error', (err) => console.error('[DB_POOL_ERROR]', err));

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '4s'");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}
