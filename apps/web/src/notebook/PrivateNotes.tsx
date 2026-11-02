import { useEffect, useState } from 'react';
import { useSessionStore } from '@iz/ui';

type Note = { id: string; body: string; updatedAt?: string };

export function PrivateNotes() {
  const token = useSessionStore((state) => state.session?.token);
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState('');
  const [currentId, setCurrentId] = useState<string>();
  const [feedback, setFeedback] = useState('');
  const headers = { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' };
  useEffect(() => {
    let active = true;
    void fetch('/api/notes', { headers: { authorization: `Bearer ${token ?? ''}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Private notes could not be loaded.');
        const result = await response.json() as { notes: Note[] };
        if (active) setNotes(result.notes);
      }).catch((error: unknown) => { if (active) setFeedback(error instanceof Error ? error.message : 'Notes unavailable.'); });
    return () => { active = false; };
  }, [token]);
  return <section style={{ padding: 12 }} aria-label="Private notebook">
    <p>Only you can see these notes. They are not sent to teammates or agents.</p>
    <ul>{notes.map((note) => <li key={note.id}><button className="iz-btn" type="button" onClick={() => { setCurrentId(note.id); setBody(note.body); }}>{note.body.slice(0, 60) || 'Untitled note'}</button></li>)}</ul>
    <form onSubmit={(event) => {
      event.preventDefault();
      const id = currentId ?? crypto.randomUUID();
      void fetch('/api/notes', { method: 'PUT', headers, body: JSON.stringify({ id, body }) })
        .then(async (response) => {
          if (!response.ok) throw new Error('Private note could not be saved.');
          const note = await response.json() as Note;
          setNotes((items) => [...items.filter((item) => item.id !== id), note]);
          setCurrentId(id); setFeedback('Private note saved.');
        }).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'Save failed.'));
    }}>
      <label>Private note<textarea className="iz-input" value={body} maxLength={65536} onChange={(event) => setBody(event.target.value)} /></label>
      <button className="iz-btn" type="submit">Save private note</button>
      <button className="iz-btn iz-btn--quiet" type="button" onClick={() => { setCurrentId(undefined); setBody(''); }}>New note</button>
      <p role="status">{feedback}</p>
    </form>
  </section>;
}
