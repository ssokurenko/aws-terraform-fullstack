// Attachments service: image uploads for items. One Lambda, two triggers:
//
// 1. POST /api/items/{id}/attachments  -> presigned S3 POST to incoming/<item>/<att>.<ext>   (api.ts)
// 2. Browser uploads directly to S3 (no file bytes through API Gateway/Lambda).
// 3. S3 ObjectCreated on incoming/ -> validate, publish to files/, mark row ready  (upload-processor.ts)
// 4. GET list / GET one / DELETE via API                                           (api.ts)

import type { APIGatewayProxyEvent, APIGatewayProxyResult, S3Event } from 'aws-lambda';
import { ensureSchema } from '../../shared/schema.js';
import { api } from './api.js';
import { processUploads } from './upload-processor.js';

const isS3Event = (event: unknown): event is S3Event =>
  (event as Partial<S3Event>).Records?.[0]?.eventSource === 'aws:s3';

export async function handler(event: APIGatewayProxyEvent | S3Event): Promise<APIGatewayProxyResult | void> {
  if (isS3Event(event)) {
    await ensureSchema();
    return processUploads(event.Records);
  }
  return api(event);
}
