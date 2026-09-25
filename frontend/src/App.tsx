import { useEffect, useState } from 'react';
import { api } from './api';
import type { Item, ItemInput } from './types';
import ItemForm from './components/ItemForm';
import ItemList from './components/ItemList';

const empty: ItemInput = { name: '', description: '' };

/** Items page: holds the page state and wires the API to the form and the list. */
export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState<ItemInput>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setItems(await api.list());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    try {
      if (editingId) await api.update(editingId, form);
      else await api.create(form);
      setForm(empty);
      setEditingId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const edit = (item: Item) => {
    setEditingId(item.id);
    setForm({ name: item.name, description: item.description ?? '' });
  };

  const cancel = () => {
    setEditingId(null);
    setForm(empty);
  };

  const remove = async (id: string) => {
    try {
      await api.remove(id);
      if (id === editingId) cancel();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main>
      <h1>Items</h1>

      <ItemForm value={form} editing={editingId !== null} onChange={setForm} onSubmit={submit} onCancel={cancel} />

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p>No items yet.</p>
      ) : (
        <ItemList
          items={items}
          openId={openId}
          onToggleImages={(id) => setOpenId(openId === id ? null : id)}
          onEdit={edit}
          onRemove={remove}
          onAttachmentsChange={load}
        />
      )}
    </main>
  );
}
