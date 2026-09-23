// Shared by both services: Postgres pool + schema bootstrap.
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

function iamToken() {
  const signer = new Signer({ hostname: DB_HOST, port: Number(DB_PORT), username: DB_USER, region: AWS_REGION });
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

// Scaffold-level migration, idempotent. Replace with a migration tool (node-pg-migrate,
// Flyway) run as a CI/CD step once the schema starts changing.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id           uuid PRIMARY KEY,
    item_id      uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    file_name    text NOT NULL,
    content_type text NOT NULL,
    size_bytes   integer NOT NULL,
    s3_key       text NOT NULL,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','rejected')),
    created_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS attachments_item_idx ON attachments (item_id, created_at);
`;

let schemaReady;
export const ensureSchema = () =>
  (schemaReady ??= pool.query(SCHEMA).catch((err) => {
    schemaReady = undefined;
    throw err;
  }));
