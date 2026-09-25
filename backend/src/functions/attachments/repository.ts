// SQL for the attachments table.
import { pool } from '../../shared/db.js';
import type { AttachmentRow } from '../../shared/types.js';

export async function itemExists(itemId: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM items WHERE id = $1', [itemId]);
  return Boolean(rowCount);
}

/** Published images of an item, oldest first. */
export async function listReadyAttachments(itemId: string): Promise<AttachmentRow[]> {
  const { rows } = await pool.query<AttachmentRow>(
    `SELECT * FROM attachments WHERE item_id = $1 AND status = 'ready' ORDER BY created_at`,
    [itemId],
  );
  return rows;
}

/** Pending + ready attachments of an item: what counts towards MAX_PER_ITEM. */
export async function countActiveAttachments(itemId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM attachments WHERE item_id = $1 AND status <> 'rejected'`,
    [itemId],
  );
  return rows[0].n;
}

export async function insertPendingAttachment(a: {
  id: string;
  itemId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
}): Promise<AttachmentRow> {
  const { rows } = await pool.query<AttachmentRow>(
    `INSERT INTO attachments (id, item_id, file_name, content_type, size_bytes, s3_key)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [a.id, a.itemId, a.fileName, a.contentType, a.sizeBytes, a.s3Key],
  );
  return rows[0];
}

export async function getAttachment(id: string): Promise<AttachmentRow | undefined> {
  const { rows } = await pool.query<AttachmentRow>('SELECT * FROM attachments WHERE id = $1', [id]);
  return rows[0];
}

/** Deletes the row and returns its S3 key, or undefined when it did not exist. */
export async function deleteAttachment(id: string): Promise<string | undefined> {
  const { rows } = await pool.query<Pick<AttachmentRow, 's3_key'>>(
    'DELETE FROM attachments WHERE id = $1 RETURNING s3_key',
    [id],
  );
  return rows[0]?.s3_key;
}

/** The pending row an uploaded object belongs to, if any. */
export async function getPendingAttachment(id: string, itemId: string): Promise<AttachmentRow | undefined> {
  const { rows } = await pool.query<AttachmentRow>(
    `SELECT * FROM attachments WHERE id = $1 AND item_id = $2 AND status = 'pending'`,
    [id, itemId],
  );
  return rows[0];
}

export async function markReady(id: string, s3Key: string, sizeBytes: number): Promise<void> {
  await pool.query(
    `UPDATE attachments SET status = 'ready', s3_key = $2, size_bytes = $3 WHERE id = $1`,
    [id, s3Key, sizeBytes],
  );
}

export async function markRejected(id: string): Promise<void> {
  await pool.query(`UPDATE attachments SET status = 'rejected' WHERE id = $1`, [id]);
}
