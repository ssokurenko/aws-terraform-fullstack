// Items service: CRUD on /api/items.
// Lambda entry point; routes mirror infra/api.tf.
import { ensureSchema } from '../../shared/schema.js';
import { reply, parseBody, UUID_RE, withErrors } from '../../shared/http.js';
import { validateItemInput } from './validation.js';
import { listItems, getItem, createItem, updateItem, deleteItem } from './repository.js';

export const handler = withErrors(async (event) => {
  await ensureSchema();

  const route = `${event.httpMethod} ${event.resource}`;
  const id = event.pathParameters?.id;
  if (id && !UUID_RE.test(id)) return reply(400, { message: 'Invalid item id.' });

  switch (route) {
    case 'GET /api/items': {
      return reply(200, await listItems());
    }
    case 'POST /api/items': {
      const v = validateItemInput(parseBody(event));
      if (v.error !== undefined) return reply(400, { message: v.error });
      return reply(201, await createItem(v));
    }
    case 'GET /api/items/{id}': {
      const item = await getItem(id!);
      return item ? reply(200, item) : reply(404, { message: 'Item not found.' });
    }
    case 'PUT /api/items/{id}': {
      const v = validateItemInput(parseBody(event));
      if (v.error !== undefined) return reply(400, { message: v.error });
      const item = await updateItem(id!, v);
      return item ? reply(200, item) : reply(404, { message: 'Item not found.' });
    }
    case 'DELETE /api/items/{id}': {
      return (await deleteItem(id!)) ? reply(204) : reply(404, { message: 'Item not found.' });
    }
    default:
      return reply(404, { message: `No route for ${route}.` });
  }
});
