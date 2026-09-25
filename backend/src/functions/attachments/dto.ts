import type { AttachmentDto, AttachmentRow } from '../../shared/types.js';

/** Maps a database row to the API shape. The URL is served by CloudFront at /files/*. */
export const toAttachmentDto = (r: AttachmentRow): AttachmentDto => ({
  id: r.id,
  itemId: r.item_id,
  fileName: r.file_name,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  status: r.status,
  url: r.status === 'ready' ? `/${r.s3_key}` : null,
  createdAt: r.created_at,
});
