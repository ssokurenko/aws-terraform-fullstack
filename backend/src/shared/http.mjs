const headers = {
  'Content-Type': 'application/json',
  // Same-origin via CloudFront in prod; CORS only matters when calling the direct API URL.
  'Access-Control-Allow-Origin': '*',
};

export const reply = (statusCode, body) => ({
  statusCode,
  headers,
  body: body === undefined ? '' : JSON.stringify(body),
});

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  return JSON.parse(raw);
}

// Wraps a route handler: JSON errors -> 400, anything else -> logged 500.
export const withErrors = (fn) => async (event) => {
  try {
    return await fn(event);
  } catch (err) {
    if (err instanceof SyntaxError) return reply(400, { message: 'Request body must be valid JSON.' });
    console.error(JSON.stringify({ msg: 'unhandled', error: err.message, stack: err.stack }));
    return reply(500, { message: 'Internal error.' });
  }
};
