// Allowed image types and file-signature checks. Pure functions: unit-tested in test/.
// SVG deliberately excluded: it can carry script.

type Bytes = ArrayLike<number>;

export interface ImageType {
  ext: 'jpg' | 'png' | 'gif' | 'webp';
  /** True when the first bytes of a file carry this type's signature ("magic bytes"). */
  magic: (bytes: Bytes) => boolean;
}

const ascii = (b: Bytes, from: number, to: number): string =>
  String.fromCharCode(...Array.from(b).slice(from, to));

export const IMAGE_TYPES: Record<string, ImageType> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  'image/gif': { ext: 'gif', magic: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a' },
  'image/webp': { ext: 'webp', magic: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
};

/** True when the first bytes of a file match the declared image type. */
export const matchesSignature = (contentType: string, bytes: Bytes | null | undefined): boolean =>
  Boolean(IMAGE_TYPES[contentType]?.magic(bytes ?? []));

export type UploadCheck = { status: number; message: string; type?: never } | { type: ImageType; status?: never };

/** Validates an upload request. Returns { status, message } on error, or { type } when ok. */
export function checkUploadRequest(
  { contentType, size }: { contentType: unknown; size: unknown },
  maxBytes: number,
): UploadCheck {
  const type = typeof contentType === 'string' ? IMAGE_TYPES[contentType] : undefined;
  if (!type) return { status: 415, message: 'Only JPEG, PNG, GIF or WebP images are allowed.' };
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    return { status: 400, message: 'File size is required.' };
  }
  if (size > maxBytes) {
    return { status: 413, message: `Image is larger than ${(maxBytes / 1024 / 1024).toFixed(0)} MB.` };
  }
  return { type };
}
