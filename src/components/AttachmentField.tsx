import { useState } from 'react';
import type { Attachment } from '../state/store';
import { putFile, deleteFile } from '../data/fileStore';

// A pending change to a song's attachment slot, resolved to a stored Attachment on save.
export type AttachmentDraft =
  | { type: 'keep' }                                        // leave the existing one as-is
  | { type: 'none' }                                        // clear it
  | { type: 'link'; url: string }                           // external URL
  | { type: 'file'; file: File; name: string; mime: string }; // newly picked bytes

// Apply a draft against the previously-saved attachment: writes/removes IndexedDB blobs
// and returns the Attachment to persist on the Song (or undefined if cleared).
export async function resolveAttachment(
  draft: AttachmentDraft,
  existing?: Attachment,
): Promise<Attachment | undefined> {
  if (draft.type === 'keep') return existing;
  // Any non-keep change discards an existing uploaded blob.
  if (existing?.kind === 'file') await deleteFile(existing.fileId).catch(() => {});
  if (draft.type === 'none') return undefined;
  if (draft.type === 'link') {
    const url = draft.url.trim();
    return url ? { kind: 'link', url } : undefined;
  }
  const id = await putFile(draft.file, { name: draft.name, mime: draft.mime });
  return { kind: 'file', fileId: id, name: draft.name, mime: draft.mime, size: draft.file.size };
}

function summary(existing: Attachment | undefined, draft: AttachmentDraft): string {
  if (draft.type === 'file') return `${draft.name} (upload)`;
  if (draft.type === 'link') return draft.url.trim() ? `${draft.url.trim()} (link)` : 'none';
  if (draft.type === 'none') return 'none';
  if (!existing) return 'none';
  return existing.kind === 'file' ? `${existing.name} (uploaded)` : `${existing.url} (link)`;
}

export function AttachmentField({ label, accept, existing, draft, onChange }: {
  label: string;
  accept: string;
  existing?: Attachment;
  draft: AttachmentDraft;
  onChange: (d: AttachmentDraft) => void;
}) {
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  const has = draft.type === 'file' || draft.type === 'link' ||
    (draft.type === 'keep' && !!existing);

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        <span className="muted" style={{ fontSize: 12 }}>{summary(existing, draft)}</span>
        <div className="spacer" />
        {has && (
          <button className="button" style={{ padding: '2px 8px', fontSize: 12 }}
            onClick={() => onChange({ type: 'none' })}>Remove</button>
        )}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 4 }}>
          <button className={'button' + (mode === 'upload' ? ' primary' : '')}
            style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => setMode('upload')}>Upload</button>
          <button className={'button' + (mode === 'link' ? ' primary' : '')}
            style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => setMode('link')}>Link</button>
        </div>
        {mode === 'upload' ? (
          <input type="file" accept={accept}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onChange({ type: 'file', file: f, name: f.name, mime: f.type });
            }}
            style={{ flex: '1 1 200px' }}
          />
        ) : (
          <input type="url" placeholder="https://…"
            defaultValue={draft.type === 'link' ? draft.url : (existing?.kind === 'link' ? existing.url : '')}
            onChange={e => onChange({ type: 'link', url: e.target.value })}
            style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 8, flex: '1 1 200px' }}
          />
        )}
      </div>
    </div>
  );
}
