import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, IMAGE_TYPES } from '../api';
import type { Attachment } from '../types';

interface Props {
  itemId: string;
  onChange?: () => void;
}

/** Image gallery of one item, with upload and delete. */
export default function Attachments({ itemId, onChange }: Props) {
  const [images, setImages] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setImages(await api.listAttachments(itemId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, [itemId]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      await api.uploadImage(itemId, file);
      await load();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.removeAttachment(id);
      await load();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="attachments">
      <div className="gallery">
        {images.map((img) => (
          <figure key={img.id}>
            <a href={img.url ?? undefined} target="_blank" rel="noreferrer">
              <img src={img.url ?? undefined} alt={img.fileName} loading="lazy" />
            </a>
            <figcaption>
              <span title={img.fileName}>{img.fileName}</span>
              <button type="button" onClick={() => remove(img.id)} aria-label={`Delete ${img.fileName}`}>
                ×
              </button>
            </figcaption>
          </figure>
        ))}
        <button type="button" className="add" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : '+ Add image'}
        </button>
      </div>
      <input
        ref={input}
        id={`file-${itemId}`}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        onChange={onFile}
        hidden
      />
      <p className="hint">JPEG, PNG, GIF or WebP, up to 2 MB.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
