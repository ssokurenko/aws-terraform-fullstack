// One entry point for all API calls: `api.list()`, `api.uploadImage(...)`, ...
import { listItems, getItem, createItem, updateItem, removeItem } from './items';
import { listAttachments, getAttachment, removeAttachment, uploadImage } from './attachments';

export { IMAGE_TYPES, MAX_IMAGE_BYTES } from './attachments';

export const api = {
  list: listItems,
  get: getItem,
  create: createItem,
  update: updateItem,
  remove: removeItem,

  listAttachments,
  getAttachment,
  removeAttachment,
  uploadImage,
};
