// Attachments service: image uploads for items.
//
// 1. POST /api/items/{id}/attachments  -> presigned S3 POST to incoming/<item>/<att>.<ext>
//    S3 itself enforces: exact key, exact Content-Type, 1 byte..2 MB (content-length-range).
// 2. Browser uploads directly to S3 (no file bytes through API Gateway/Lambda).
// 3. S3 ObjectCreated on incoming/ -> this function validates size + magic bytes,
//    copies to files/<item>/<att>.<ext> (served by CloudFront at /files/*), marks row ready.
// 4. GET list / GET one / DELETE via API.
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import { pool, ensureSchema } from './shared/db.mjs';
import { reply, parseBody, UUID_RE, withErrors } from './shared/http.mjs';
import { matchesSignature, checkUploadRequest } from './shared/images.mjs';

// S3_ENDPOINT points at a local S3-compatible emulator during local development.
const s3 = new S3Client(
  process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {},
);
const BUCKET = process.env.BUCKET;
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 2 * 1024 * 1024);
const MAX_PER_ITEM = Number(process.env.MAX_PER_ITEM ?? 10);

const toDto = (r) => ({
  id: r.id,
  itemId: r.item_id,
  fileName: r.file_name,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  status: r.status,
  url: r.status === 'ready' ? `/${r.s3_key}` : null,
  createdAt: r.created_at,
});

// ---------------------------------------------------------------- entry point

export async function handler(event) {
  if (event.Records?.[0]?.eventSource === 'aws:s3') {
    await ensureSchema();
    return processUploads(event.Records);
  }
  return api(event);
}

// ---------------------------------------------------------------- REST API

const api = withErrors(async (event) => {
  await ensureSchema();
  const route = `${event.httpMethod} ${event.resource}`;
  const { id: itemId, attachmentId } = event.pathParameters ?? {};
  if (itemId && !UUID_RE.test(itemId)) return reply(400, { message: 'Invalid item id.' });
  if (attachmentId && !UUID_RE.test(attachmentId)) return reply(400, { message: 'Invalid attachment id.' });

  switch (route) {
    case 'GET /api/items/{id}/attachments': {
      const { rows } = await pool.query(
        `SELECT * FROM attachments WHERE item_id = $1 AND status = 'ready' ORDER BY created_at`,
        [itemId],
      );
      return reply(200, rows.map(toDto));
    }

    case 'POST /api/items/{id}/attachments': {
      const { fileName, contentType, size } = parseBody(event);
      const check = checkUploadRequest({ contentType, size }, MAX_BYTES);
      if (check.status) return reply(check.status, { message: check.message });
      const { type } = check;

      const item = await pool.query('SELECT 1 FROM items WHERE id = $1', [itemId]);
      if (!item.rowCount) return reply(404, { message: 'Item not found.' });

      const { rows: [{ n }] } = await pool.query(
        `SELECT count(*)::int AS n FROM attachments WHERE item_id = $1 AND status <> 'rejected'`,
        [itemId],
      );
      if (n >= MAX_PER_ITEM) return reply(409, { message: `An item can have at most ${MAX_PER_ITEM} images.` });

      const id = randomUUID();
      const key = `incoming/${itemId}/${id}.${type.ext}`;
      const name = String(fileName ?? `image.${type.ext}`).slice(0, 255);
      const { rows } = await pool.query(
        `INSERT INTO attachments (id, item_id, file_name, content_type, size_bytes, s3_key)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, itemId, name, contentType, size, key],
      );

      const upload = await createPresignedPost(s3, {
        Bucket: BUCKET,
        Key: key,
        Conditions: [
          ['content-length-range', 1, MAX_BYTES],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: 300, // seconds
      });
      return reply(201, { attachment: toDto(rows[0]), upload });
    }

    case 'GET /api/attachments/{attachmentId}': {
      const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [attachmentId]);
      return rows[0] ? reply(200, toDto(rows[0])) : reply(404, { message: 'Attachment not found.' });
    }

    case 'DELETE /api/attachments/{attachmentId}': {
      const { rows } = await pool.query('DELETE FROM attachments WHERE id = $1 RETURNING s3_key', [attachmentId]);
      if (!rows[0]) return reply(404, { message: 'Attachment not found.' });
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: rows[0].s3_key }));
      return reply(204);
    }

    default:
      return reply(404, { message: `No route for ${route}.` });
  }
});

// ---------------------------------------------------------------- S3 upload validation

const KEY_RE = /^incoming\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|gif|webp)$/;

async function processUploads(records) {
  for (const rec of records) {
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));
    try {
      await validateUpload(key);
    } catch (err) {
      console.error(JSON.stringify({ msg: 'validation failed', key, error: err.message }));
      throw err; // let Lambda retry the async event
    }
  }
}

async function validateUpload(key) {
  const drop = () => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  const reject = async (id, reason) => {
    console.warn(JSON.stringify({ msg: 'upload rejected', key, reason }));
    await drop();
    await pool.query(`UPDATE attachments SET status = 'rejected' WHERE id = $1`, [id]);
  };

  const m = KEY_RE.exec(key);
  if (!m) return drop();
  const [, itemId, id, ext] = m;

  const { rows: [row] } = await pool.query(
    `SELECT * FROM attachments WHERE id = $1 AND item_id = $2 AND status = 'pending'`,
    [id, itemId],
  );
  if (!row) return drop(); // unknown, already processed, or item deleted

  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  if (head.ContentLength > MAX_BYTES) return reject(id, 'too large');
  if (head.ContentType !== row.content_type) return reject(id, 'content-type mismatch');

  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: 'bytes=0-15' }));
  const bytes = await obj.Body.transformToByteArray();
  if (!matchesSignature(row.content_type, bytes)) return reject(id, 'not a real image of the declared type');

  const finalKey = `files/${itemId}/${id}.${ext}`;
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${key}`,
    Key: finalKey,
    MetadataDirective: 'REPLACE',
    ContentType: row.content_type,
    CacheControl: 'public, max-age=31536000, immutable',
    ContentDisposition: 'inline',
  }));
  await drop();
  await pool.query(
    `UPDATE attachments SET status = 'ready', s3_key = $2, size_bytes = $3 WHERE id = $1`,
    [id, finalKey, head.ContentLength],
  );
}
