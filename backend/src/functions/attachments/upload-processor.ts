// S3 ObjectCreated on incoming/ -> validate size + magic bytes, copy to files/<item>/<att>.<ext>
// (served by CloudFront at /files/*), mark the row ready. Anything invalid is deleted and
// the row marked rejected.

import type { S3EventRecord } from 'aws-lambda';
import { matchesSignature } from '../../shared/images.js';
import { MAX_BYTES } from './config.js';
import * as db from './repository.js';
import { headObject, readFirstBytes, copyToPublished, deleteObject } from './storage.js';

const KEY_RE = /^incoming\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|gif|webp)$/;

export async function processUploads(records: S3EventRecord[]): Promise<void> {
  for (const rec of records) {
    // S3 event keys are URL-encoded, with spaces as '+'.
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, ' '));
    try {
      await validateUpload(key);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ msg: 'validation failed', key, error }));
      throw err; // let Lambda retry the async event
    }
  }
}

async function validateUpload(key: string): Promise<void> {
  const drop = () => deleteObject(key);
  const reject = async (id: string, reason: string) => {
    console.warn(JSON.stringify({ msg: 'upload rejected', key, reason }));
    await drop();
    await db.markRejected(id);
  };

  const m = KEY_RE.exec(key);
  if (!m) return drop();
  const [, itemId, id, ext] = m;

  const row = await db.getPendingAttachment(id, itemId);
  if (!row) return drop(); // unknown, already processed, or item deleted

  const head = await headObject(key);
  const size = head.ContentLength ?? 0;
  if (size > MAX_BYTES) return reject(id, 'too large');
  if (head.ContentType !== row.content_type) return reject(id, 'content-type mismatch');

  const bytes = await readFirstBytes(key, 16);
  if (!matchesSignature(row.content_type, bytes)) return reject(id, 'not a real image of the declared type');

  const finalKey = `files/${itemId}/${id}.${ext}`;
  await copyToPublished(key, finalKey, row.content_type);
  await drop();
  await db.markReady(id, finalKey, size);
}
