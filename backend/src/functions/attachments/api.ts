// REST API of the attachments service (API Gateway events). Routes mirror infra/api.tf.
import { randomUUID } from 'node:crypto';
import { reply, parseBody, UUID_RE, withErrors } from '../../shared/http.js';
import { checkUploadRequest } from '../../shared/images.js';
import { ensureSchema } from '../../shared/schema.js';
import { MAX_BYTES, MAX_PER_ITEM } from './config.js';
import { toAttachmentDto } from './dto.js';
import * as db from './repository.js';
import { presignUpload, deleteObject } from './storage.js';

export const api = withErrors(async (event) => {
  await ensureSchema();
  const route = `${event.httpMethod} ${event.resource}`;
  const { id: itemId, attachmentId } = event.pathParameters ?? {};
  if (itemId && !UUID_RE.test(itemId)) return reply(400, { message: 'Invalid item id.' });
  if (attachmentId && !UUID_RE.test(attachmentId)) return reply(400, { message: 'Invalid attachment id.' });

  switch (route) {
    case 'GET /api/items/{id}/attachments': {
      const rows = await db.listReadyAttachments(itemId!);
      return reply(200, rows.map(toAttachmentDto));
    }

    // Step 1 of an upload: register a pending row and hand the browser a presigned S3 POST.
    case 'POST /api/items/{id}/attachments': {
      const { fileName, contentType, size } = parseBody(event);
      const check = checkUploadRequest({ contentType, size }, MAX_BYTES);
      if (check.status !== undefined) return reply(check.status, { message: check.message });
      const { type } = check;

      if (!(await db.itemExists(itemId!))) return reply(404, { message: 'Item not found.' });

      const n = await db.countActiveAttachments(itemId!);
      if (n >= MAX_PER_ITEM) return reply(409, { message: `An item can have at most ${MAX_PER_ITEM} images.` });

      // checkUploadRequest has verified contentType is an allowed type and size a positive integer.
      const id = randomUUID();
      const key = `incoming/${itemId}/${id}.${type.ext}`;
      const row = await db.insertPendingAttachment({
        id,
        itemId: itemId!,
        fileName: String(fileName ?? `image.${type.ext}`).slice(0, 255),
        contentType: contentType as string,
        sizeBytes: size as number,
        s3Key: key,
      });

      const upload = await presignUpload(key, contentType as string);
      return reply(201, { attachment: toAttachmentDto(row), upload });
    }

    case 'GET /api/attachments/{attachmentId}': {
      const row = await db.getAttachment(attachmentId!);
      return row ? reply(200, toAttachmentDto(row)) : reply(404, { message: 'Attachment not found.' });
    }

    case 'DELETE /api/attachments/{attachmentId}': {
      const s3Key = await db.deleteAttachment(attachmentId!);
      if (!s3Key) return reply(404, { message: 'Attachment not found.' });
      await deleteObject(s3Key);
      return reply(204);
    }

    default:
      return reply(404, { message: `No route for ${route}.` });
  }
});
