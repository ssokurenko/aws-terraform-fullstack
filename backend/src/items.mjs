// Items service: CRUD on /api/items.
import { pool, ensureSchema } from './shared/db.mjs';
import { reply, parseBody, UUID_RE, withErrors } from './shared/http.mjs';

function validate(input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 200) return { error: 'Name is required (1-200 characters).' };
  const description = input.description == null ? null : String(input.description);
  return { name, description };
}

const COLUMNS = `i.id, i.name, i.description, i.created_at AS "createdAt", i.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM attachments a WHERE a.item_id = i.id AND a.status = 'ready') AS "attachmentCount"`;

export const handler = withErrors(async (event) => {
  await ensureSchema();

  const route = `${event.httpMethod} ${event.resource}`;
  const id = event.pathParameters?.id;
  if (id && !UUID_RE.test(id)) return reply(400, { message: 'Invalid item id.' });

  switch (route) {
    case 'GET /api/items': {
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM items i ORDER BY i.created_at DESC LIMIT 100`,
      );
      return reply(200, rows);
    }
    case 'POST /api/items': {
      const v = validate(parseBody(event));
      if (v.error) return reply(400, { message: v.error });
      const { rows } = await pool.query(
        `WITH i AS (INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *)
         SELECT ${COLUMNS} FROM i`,
        [v.name, v.description],
      );
      return reply(201, rows[0]);
    }
    case 'GET /api/items/{id}': {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM items i WHERE i.id = $1`, [id]);
      return rows[0] ? reply(200, rows[0]) : reply(404, { message: 'Item not found.' });
    }
    case 'PUT /api/items/{id}': {
      const v = validate(parseBody(event));
      if (v.error) return reply(400, { message: v.error });
      const { rows } = await pool.query(
        `WITH i AS (UPDATE items SET name = $2, description = $3, updated_at = now()
                    WHERE id = $1 RETURNING *)
         SELECT ${COLUMNS} FROM i`,
        [id, v.name, v.description],
      );
      return rows[0] ? reply(200, rows[0]) : reply(404, { message: 'Item not found.' });
    }
    case 'DELETE /api/items/{id}': {
      // Attachment rows cascade. Their files under files/<id>/ are left in S3 (see README roadmap).
      const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
      return rowCount ? reply(204) : reply(404, { message: 'Item not found.' });
    }
    default:
      return reply(404, { message: `No route for ${route}.` });
  }
});
