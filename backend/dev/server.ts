// Local stand-in for API Gateway + CloudFront /files/* + the S3 ObjectCreated trigger.
// Runs the real Lambda handlers in-process, so what you test here is what ships.
//
//   npm run dev        (loads dev/local.env, restarts on file changes)
//
// Routes mirror infra/api.tf exactly: the event passed to each handler has the same
// httpMethod / resource / pathParameters shape API Gateway sends with AWS_PROXY.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, S3Event } from 'aws-lambda';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { handler as items } from '../src/functions/items/index.js';
import { handler as attachments } from '../src/functions/attachments/index.js';

const PORT = Number(process.env.PORT ?? 3001);
const BUCKET = process.env.BUCKET!;
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, forcePathStyle: true });

// ---------- API Gateway emulation (keep in sync with infra/api.tf) ----------

type ApiFn = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult | void>;

interface Route {
  method: string;
  resource: string;
  fn: ApiFn;
  names: string[];
  re: RegExp;
}

const ROUTES: Route[] = ([
  ['GET', '/api/items', items],
  ['POST', '/api/items', items],
  ['GET', '/api/items/{id}', items],
  ['PUT', '/api/items/{id}', items],
  ['DELETE', '/api/items/{id}', items],
  ['GET', '/api/items/{id}/attachments', attachments],
  ['POST', '/api/items/{id}/attachments', attachments],
  ['GET', '/api/attachments/{attachmentId}', attachments],
  ['DELETE', '/api/attachments/{attachmentId}', attachments],
] as const).map(([method, resource, fn]) => {
  const names = [...resource.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const re = new RegExp(`^${resource.replace(/\{\w+\}/g, '([^/]+)')}$`);
  return { method, resource, fn, names, re };
});

type RouteMatch =
  | { route: Route; pathParameters: Record<string, string>; pathMatched?: never }
  | { route?: never; pathParameters?: never; pathMatched: boolean };

function matchRoute(method: string, path: string): RouteMatch {
  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const pathParameters = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return { route: r, pathParameters };
  }
  return { pathMatched };
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const { route, pathParameters, pathMatched } = matchRoute(req.method!, url.pathname);
  if (!route) {
    // API Gateway answers unknown routes itself, without invoking Lambda
    res.writeHead(pathMatched ? 405 : 403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: pathMatched ? 'Method Not Allowed' : 'Missing Authentication Token' }));
    return;
  }
  const body = await readBody(req);
  // Only the fields the handlers read are filled in; the rest of the AWS_PROXY event is omitted.
  const event = {
    httpMethod: req.method!,
    resource: route.resource,
    path: url.pathname,
    pathParameters: Object.keys(pathParameters).length ? pathParameters : null,
    queryStringParameters: url.search ? Object.fromEntries(url.searchParams) : null,
    headers: req.headers,
    body: body || null,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent;
  const started = Date.now();
  const out = (await route.fn(event)) as APIGatewayProxyResult;
  console.log(`${req.method} ${url.pathname} -> ${out.statusCode} (${Date.now() - started} ms)`);
  res.writeHead(out.statusCode, out.headers as http.OutgoingHttpHeaders | undefined);
  res.end(out.body ?? '');
}

// ---------- CloudFront /files/* emulation ----------

async function handleFiles(res: ServerResponse, url: URL): Promise<void> {
  try {
    const key = decodeURIComponent(url.pathname.slice(1)); // files/<item>/<id>.<ext>
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    res.writeHead(200, {
      'Content-Type': obj.ContentType ?? 'application/octet-stream',
      'Cache-Control': obj.CacheControl ?? 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    (obj.Body as Readable).pipe(res);
  } catch {
    res.writeHead(403).end(); // what CloudFront + OAC returns for a missing key
  }
}

// ---------- S3 ObjectCreated emulation ----------
// Polls incoming/ and invokes the attachments handler with the same event shape S3 sends.
// Emulator-agnostic: works with any S3-compatible store, no webhook setup.

const inflight = new Set<string>();
async function pollIncoming(): Promise<void> {
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'incoming/' }));
  for (const { Key } of Contents) {
    if (!Key || inflight.has(Key)) continue;
    inflight.add(Key);
    const event = {
      Records: [{
        eventSource: 'aws:s3',
        eventName: 'ObjectCreated:Post',
        s3: { bucket: { name: BUCKET }, object: { key: encodeURIComponent(Key).replace(/%2F/g, '/') } },
      }],
    } as unknown as S3Event;
    attachments(event)
      .then(() => console.log(`s3 event: validated ${Key}`))
      .catch((err: Error) => console.error(`s3 event: ${Key} failed: ${err.message}`))
      .finally(() => setTimeout(() => inflight.delete(Key), 2000));
  }
}

// ---------- startup ----------

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`created bucket ${BUCKET}`);
  }
}

await ensureBucket();
setInterval(() => pollIncoming().catch((e: Error) => console.error('poll failed:', e.message)), 1000);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/files/')) return await handleFiles(res, url);
      res.writeHead(404).end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
    }
  })
  .listen(PORT, () => {
    console.log(`API + files on http://localhost:${PORT}`);
    console.log(`S3 emulator ${process.env.S3_ENDPOINT} (console http://localhost:9001), bucket "${BUCKET}"`);
  });
