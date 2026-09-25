// Relative URLs: CloudFront routes /api/* to API Gateway and /files/* to S3 on the same domain.
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (HTTP ${res.status}).`);
  return data as T;
}
