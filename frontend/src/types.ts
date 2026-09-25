// API shapes. Keep in sync with backend/src/shared/types.ts (dates arrive as ISO strings).

export interface Item {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  attachmentCount: number;
}

/** Body of POST/PUT /api/items. */
export interface ItemInput {
  name: string;
  description: string;
}

export type AttachmentStatus = 'pending' | 'ready' | 'rejected';

export interface Attachment {
  id: string;
  itemId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  /** Relative /files/... URL, set once the image is ready. */
  url: string | null;
  createdAt: string;
}

/** Presigned S3 POST: send `fields` plus the file (last) as multipart/form-data to `url`. */
export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}
