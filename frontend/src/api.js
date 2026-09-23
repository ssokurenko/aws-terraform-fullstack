// Relative URLs: CloudFront routes /api/* to API Gateway and /files/* to S3 on the same domain.
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (HTTP ${res.status}).`);
  return data;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const api = {
  list: () => request('/items'),
  get: (id) => request(`/items/${id}`),
  create: (item) => request('/items', { method: 'POST', body: JSON.stringify(item) }),
  update: (id, item) => request(`/items/${id}`, { method: 'PUT', body: JSON.stringify(item) }),
  remove: (id) => request(`/items/${id}`, { method: 'DELETE' }),

  listAttachments: (itemId) => request(`/items/${itemId}/attachments`),
  getAttachment: (id) => request(`/attachments/${id}`),
  removeAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),

  // 1) ask the attachments service for a presigned POST, 2) upload straight to S3,
  // 3) wait until the server-side validator publishes (or rejects) the image.
  async uploadImage(itemId, file) {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Only JPEG, PNG, GIF or WebP images are allowed.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 2 MB.');

    const { attachment, upload } = await request(`/items/${itemId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
    });

    const form = new FormData();
    Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', file); // must be the last field
    const s3 = await fetch(upload.url, { method: 'POST', body: form });
    if (!s3.ok) throw new Error(`Storage rejected the upload (HTTP ${s3.status}). Images must be 2 MB or less.`);

    for (let i = 0; i < 15; i++) {
      await sleep(500 + i * 100);
      const a = await this.getAttachment(attachment.id).catch(() => null);
      if (a?.status === 'ready') return a;
      if (a?.status === 'rejected' || a === null) throw new Error('The file is not a valid image.');
    }
    throw new Error('The image is still processing. Refresh in a moment.');
  },
};
