// Shared by both services: the Postgres connection pool.
// In AWS: via RDS Proxy with IAM auth, or straight to RDS with a password when the
// stack runs without the proxy (db_proxy_enabled = false).
import pg from 'pg';
import { Signer } from '@aws-sdk/rds-signer';

const {
  DB_HOST,
  DB_PORT = '5432',
  DB_NAME,
  DB_USER,
  DB_PASSWORD, // local development, or AWS without RDS Proxy; otherwise an IAM token is used
  DB_POOL_MAX,
  DB_SSL = 'true',
  AWS_REGION,
} = process.env;

function iamToken(): () => Promise<string> {
  const signer = new Signer({ hostname: DB_HOST!, port: Number(DB_PORT), username: DB_USER!, region: AWS_REGION });
  return () => signer.getAuthToken(); // fresh 15-min token per new connection
}

// One connection per Lambda container (DB_POOL_MAX=1 in AWS); RDS Proxy, when present, does the real pooling.
export const pool = new pg.Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD || iamToken(),
  // Proxy cert chains to Amazon Trust Services; direct RDS certs verify via NODE_EXTRA_CA_CERTS.
  ssl: DB_SSL === 'false' ? false : { rejectUnauthorized: true },
  max: Number(DB_POOL_MAX ?? (DB_PASSWORD ? 5 : 1)),
  idleTimeoutMillis: 60_000,
});
