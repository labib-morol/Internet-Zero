import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useSessionStore } from '@iz/ui';

type Note = { id: string; body: string; updatedAt?: string };

/**
 * The in-progress draft lives OUTSIDE the component: switching apps (which
 * unmounts this window) must not eat unsaved work. It is wiped with the
 * session (session-lifecycle), never persisted to storage.
 */
interface NoteDraftState {
  draft: string;
  currentId: string | undefined;
  setDraft(draft: string): void;
  openNote(id: string | undefined, body: string): void;
  clear(): void;
}

const useNoteDraft = create<NoteDraftState>((set) => ({
  draft: '',
  currentId: undefined,
  setDraft: (draft) => set({ draft }),
  openNote: (currentId, draft) => set({ currentId, draft }),
  clear: () => set({ currentId: undefined, draft: '' }),
}));

/** Wipes unsaved drafts when a session ends (wired from session-lifecycle). */
export function resetNoteDrafts(): void {
  useNoteDraft.getState().clear();
}

export function PrivateNotes() {
  const token = useSessionStore((state) => state.session?.token);
  const teamId = useSessionStore((state) => state.session?.teamId);
  const draft = useNoteDraft((state) => state.draft);
  const currentId = useNoteDraft((state) => state.currentId);
  const setDraft = useNoteDraft((state) => state.setDraft);
  const openNote = useNoteDraft((state) => state.openNote);
  const clearDraft = useNoteDraft((state) => state.clear);
  const [notes, setNotes] = useState<Note[]>([]);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
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
  }, [token, teamId]); // notes are TEAM-scoped server-side: a join must refetch even though the token is unchanged.
  void teamId;

  return <section style={{ padding: 12 }} aria-label="Private notebook">
    <p>Only you can see these notes. They are not sent to teammates or agents.</p>
    <ul>{notes.map((note) => <li key={note.id}><button className="iz-btn" type="button" onClick={() => openNote(note.id, note.body)}>{note.body.slice(0, 60) || 'Untitled note'}</button></li>)}</ul>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (saving) return; // one write per submit: no double-save
      setSaving(true);
      const id = currentId ?? crypto.randomUUID();
      void fetch('/api/notes', { method: 'PUT', headers, body: JSON.stringify({ id, body: draft }) })
        .then(async (response) => {
          if (!response.ok) throw new Error('Private note could not be saved.');
          const note = await response.json() as Note;
          setNotes((items) => [...items.filter((item) => item.id !== id), note]);
          openNote(id, draft); setFeedback('Private note saved.');
        }).catch((error: unknown) => {
          // The draft stays in place for a retry — it was never cleared.
          setFeedback(error instanceof Error ? error.message : 'Save failed.');
        }).finally(() => setSaving(false));
    }}>
      <label>Private note<textarea className="iz-input" value={draft} maxLength={65536} onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="iz-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save private note'}</button>
      <button className="iz-btn iz-btn--quiet" type="button" disabled={saving} onClick={() => clearDraft()}>New note</button>
      <p role="status">{feedback}</p>
    </form>
  </section>;
}
