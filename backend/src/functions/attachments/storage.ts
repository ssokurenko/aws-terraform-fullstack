// S3 operations used by the attachments service.
//   incoming/<item>/<att>.<ext>  browser uploads here with a presigned POST (private)
//   files/<item>/<att>.<ext>     validated copies, served by CloudFront at /files/*
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import { BUCKET, MAX_BYTES, UPLOAD_EXPIRES_S } from './config.js';

// S3_ENDPOINT points at a local S3-compatible emulator during local development.
const s3 = new S3Client(
  process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {},
);

/**
 * Presigned POST for one upload. S3 itself enforces: exact key, exact Content-Type,
 * 1 byte..MAX_BYTES (content-length-range).
 */
export const presignUpload = (key: string, contentType: string): Promise<PresignedPost> =>
  createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: key,
    Conditions: [
      ['content-length-range', 1, MAX_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: UPLOAD_EXPIRES_S,
  });

export const headObject = (key: string): Promise<HeadObjectCommandOutput> =>
  s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

/** Reads only the first `count` bytes of an object (enough for a file-signature check). */
export async function readFirstBytes(key: string, count: number): Promise<Uint8Array> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=0-${count - 1}` }));
  return obj.Body ? obj.Body.transformToByteArray() : new Uint8Array();
}

/** Copies a validated upload to its public key with safe, long-lived caching headers. */
export async function copyToPublished(fromKey: string, toKey: string, contentType: string): Promise<void> {
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${fromKey}`,
    Key: toKey,
    MetadataDirective: 'REPLACE',
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    ContentDisposition: 'inline',
  }));
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
