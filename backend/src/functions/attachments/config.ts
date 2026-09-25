// Attachments service settings (set per environment in infra/services.tf).
export const BUCKET = process.env.BUCKET!;
export const MAX_BYTES = Number(process.env.MAX_BYTES ?? 2 * 1024 * 1024);
export const MAX_PER_ITEM = Number(process.env.MAX_PER_ITEM ?? 10);

/** How long a presigned upload stays valid, in seconds. */
export const UPLOAD_EXPIRES_S = 300;
