import { useEffect, useState } from 'react';
import { api } from './api.js';
import Attachments from './Attachments.jsx';

const empty = { name: '', description: '' };

export default function App() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setItems(await api.list());
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) await api.update(editingId, form);
      else await api.create(form);
      setForm(empty);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const edit = (item) => {
    setEditingId(item.id);
    setForm({ name: item.name, description: item.description ?? '' });
  };

  const cancel = () => {
    setEditingId(null);
    setForm(empty);
  };

  const remove = async (id) => {
    try {
      await api.remove(id);
      if (id === editingId) cancel();
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <main>
      <h1>Items</h1>

      <form onSubmit={submit}>
        <input
          id="item-name"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          maxLength={200}
        />
        <input
          id="item-description"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <button type="submit">{editingId ? 'Save' : 'Add'}</button>
        {editingId && (
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        )}
      </form>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p>No items yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <div className="row">
                <div>
                  <strong>{item.name}</strong>
                  {item.description && <span> · {item.description}</span>}
                </div>
                <div className="actions">
                  <button onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                    Images ({item.attachmentCount ?? 0})
                  </button>
                  <button onClick={() => edit(item)}>Edit</button>
                  <button onClick={() => remove(item.id)}>Delete</button>
                </div>
              </div>
              {openId === item.id && <Attachments itemId={item.id} onChange={load} />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
