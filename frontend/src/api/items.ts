import type { Item, ItemInput } from '../types';
import { request } from './request';

export const listItems = () => request<Item[]>('/items');

export const getItem = (id: string) => request<Item>(`/items/${id}`);

export const createItem = (item: ItemInput) =>
  request<Item>('/items', { method: 'POST', body: JSON.stringify(item) });

export const updateItem = (id: string, item: ItemInput) =>
  request<Item>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(item) });

export const removeItem = (id: string) => request<null>(`/items/${id}`, { method: 'DELETE' });
