// Scaffold-level migration, idempotent. Replace with a migration tool (node-pg-migrate,
// Flyway) run as a CI/CD step once the schema starts changing.
import { pool } from './db.js';

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

// Runs once per Lambda container; a failed attempt is retried on the next call.
let schemaReady: Promise<unknown> | undefined;
export const ensureSchema = (): Promise<unknown> =>
  (schemaReady ??= pool.query(SCHEMA).catch((err: unknown) => {
    schemaReady = undefined;
    throw err;
  }));
