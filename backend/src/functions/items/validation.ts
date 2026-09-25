import type { ItemInput } from '../../shared/types.js';

export type ItemValidation = (ItemInput & { error?: never }) | { error: string };

/** Validates the body of POST/PUT /api/items. */
export function validateItemInput(input: Record<string, unknown>): ItemValidation {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 200) return { error: 'Name is required (1-200 characters).' };
  const description = input.description == null ? null : String(input.description);
  return { name, description };
}
