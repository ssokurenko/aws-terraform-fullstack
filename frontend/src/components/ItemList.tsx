import type { Item } from '../types';
import Attachments from './Attachments';

interface Props {
  items: Item[];
  /** Item whose image gallery is expanded. */
  openId: string | null;
  onToggleImages: (id: string) => void;
  onEdit: (item: Item) => void;
  onRemove: (id: string) => void;
  /** Called after images change, so attachment counts refresh. */
  onAttachmentsChange: () => void;
}

export default function ItemList({ items, openId, onToggleImages, onEdit, onRemove, onAttachmentsChange }: Props) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <div className="row">
            <div>
              <strong>{item.name}</strong>
              {item.description && <span> · {item.description}</span>}
            </div>
            <div className="actions">
              <button onClick={() => onToggleImages(item.id)}>Images ({item.attachmentCount ?? 0})</button>
              <button onClick={() => onEdit(item)}>Edit</button>
              <button onClick={() => onRemove(item.id)}>Delete</button>
            </div>
          </div>
          {openId === item.id && <Attachments itemId={item.id} onChange={onAttachmentsChange} />}
        </li>
      ))}
    </ul>
  );
}
