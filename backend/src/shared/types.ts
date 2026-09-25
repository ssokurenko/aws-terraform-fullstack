// Data shapes shared by both services: database rows and the JSON the API returns.

export type AttachmentStatus = 'pending' | 'ready' | 'rejected';

/** Validated body of POST/PUT /api/items. */
export interface ItemInput {
  name: string;
  description: string | null;
}

/** An item as returned by the API (see ITEM_COLUMNS in functions/items/repository.ts). */
export interface ItemDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachmentCount: number;
}

/** A row of the attachments table, as pg returns it. */
export interface AttachmentRow {
  id: string;
  item_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  s3_key: string;
  status: AttachmentStatus;
  created_at: Date;
}

/** An attachment as returned by the API. */
export interface AttachmentDto {
  id: string;
  itemId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  /** Public path served by CloudFront at /files/*, only once the image is ready. */
  url: string | null;
  createdAt: Date;
}
