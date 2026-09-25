import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSignature, checkUploadRequest } from '../src/shared/images.js';

const MAX = 2 * 1024 * 1024;
const bytes = (...xs: (number | string)[]) =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

test('accepts real signatures', () => {
  assert.ok(matchesSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)));
  assert.ok(matchesSignature('image/png', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a)));
  assert.ok(matchesSignature('image/gif', bytes('GIF89a')));
  assert.ok(matchesSignature('image/webp', bytes('RIFF', 0, 0, 0, 0, 'WEBP')));
});

test('rejects renamed or mismatched files', () => {
  assert.equal(matchesSignature('image/png', bytes(0xff, 0xd8, 0xff)), false); // JPEG declared as PNG
  assert.equal(matchesSignature('image/jpeg', bytes('MZ')), false); // Windows executable
  assert.equal(matchesSignature('image/jpeg', bytes('%PDF-1.7')), false);
  assert.equal(matchesSignature('image/svg+xml', bytes('<svg')), false); // not an allowed type
  assert.equal(matchesSignature('image/png', new Uint8Array()), false); // empty file
});

test('upload request: type allowlist', () => {
  assert.equal(checkUploadRequest({ contentType: 'image/png', size: 1000 }, MAX).type?.ext, 'png');
  assert.equal(checkUploadRequest({ contentType: 'image/svg+xml', size: 1000 }, MAX).status, 415);
  assert.equal(checkUploadRequest({ contentType: 'application/pdf', size: 1000 }, MAX).status, 415);
});

test('upload request: 2 MB limit is inclusive', () => {
  assert.ok(checkUploadRequest({ contentType: 'image/jpeg', size: MAX }, MAX).type);
  assert.equal(checkUploadRequest({ contentType: 'image/jpeg', size: MAX + 1 }, MAX).status, 413);
  assert.equal(checkUploadRequest({ contentType: 'image/jpeg', size: 0 }, MAX).status, 400);
  assert.equal(checkUploadRequest({ contentType: 'image/jpeg', size: '100' }, MAX).status, 400);
});
