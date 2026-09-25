// SQL for the items table. Every read returns the API shape (ItemDto) directly.
import { pool } from '../../shared/db.js';
import type { ItemDto, ItemInput } from '../../shared/types.js';

const ITEM_COLUMNS = `i.id, i.name, i.description, i.created_at AS "createdAt", i.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM attachments a WHERE a.item_id = i.id AND a.status = 'ready') AS "attachmentCount"`;

export async function listItems(): Promise<ItemDto[]> {
  const { rows } = await pool.query<ItemDto>(
    `SELECT ${ITEM_COLUMNS} FROM items i ORDER BY i.created_at DESC LIMIT 100`,
  );
  return rows;
}

export async function getItem(id: string): Promise<ItemDto | undefined> {
  const { rows } = await pool.query<ItemDto>(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = $1`, [id]);
  return rows[0];
}

export async function createItem({ name, description }: ItemInput): Promise<ItemDto> {
  const { rows } = await pool.query<ItemDto>(
    `WITH i AS (INSERT INTO items (name, description) VALUES ($1, $2) RETURNING *)
     SELECT ${ITEM_COLUMNS} FROM i`,
    [name, description],
  );
  return rows[0];
}

/** Returns undefined when the item does not exist. */
export async function updateItem(id: string, { name, description }: ItemInput): Promise<ItemDto | undefined> {
  const { rows } = await pool.query<ItemDto>(
    `WITH i AS (UPDATE items SET name = $2, description = $3, updated_at = now()
                WHERE id = $1 RETURNING *)
     SELECT ${ITEM_COLUMNS} FROM i`,
    [id, name, description],
  );
  return rows[0];
}

/** Returns false when the item does not exist. */
export async function deleteItem(id: string): Promise<boolean> {
  // Attachment rows cascade. Their files under files/<id>/ are left in S3 (see README roadmap).
  const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [id]);
  return Boolean(rowCount);
}
