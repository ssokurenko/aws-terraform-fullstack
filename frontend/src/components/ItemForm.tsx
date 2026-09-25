import type { FormEvent } from 'react';
import type { ItemInput } from '../types';

interface Props {
  value: ItemInput;
  editing: boolean;
  onChange: (value: ItemInput) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Add a new item, or edit the selected one. */
export default function ItemForm({ value, editing, onChange, onSubmit, onCancel }: Props) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={submit}>
      <input
        id="item-name"
        placeholder="Name"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        required
        maxLength={200}
      />
      <input
        id="item-description"
        placeholder="Description"
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      <button type="submit">{editing ? 'Save' : 'Add'}</button>
      {editing && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}
