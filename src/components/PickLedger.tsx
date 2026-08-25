import { Sparkline } from './Sparkline';
import { DeleteButton } from './DeleteButton';
import { deletePickAttempt, type PickRecord } from '../state/store';

// The performance ledger for one picking exercise — the sibling of the swap
// routine's "Pairs you've trained" list, and it reads the same way: a headline
// number, the run of attempts as a sparkline, then the attempts themselves.
//
// Only CLEAN runs feed the sparkline, because only a clean run means anything
// about tempo; a slipped run still shows in the rows, since it was still
// practice and hiding it would make the ledger a highlight reel.

export function PickLedger({ record, title = 'Your runs', limit = 10 }: {
  record: PickRecord | undefined;
  title?: string;
  limit?: number;
}) {
  if (!record || record.history.length === 0) return null;
  const clean = record.history.filter(h => h.clean).map(h => ({ count: h.bpm, at: h.at }));
  const rows = [...record.history].reverse().slice(0, limit);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="spacer" />
        <span className="muted">
          best clean <strong>{record.bestCleanBpm || '—'}</strong> · last {record.lastBpm} · {record.attempts}×
        </span>
      </div>
      {clean.length > 1 && <Sparkline history={clean} small />}
      <div className="col" style={{ marginTop: 8 }}>
        {rows.map(a => (
          <div key={a.at} className="row ledger-row">
            <span className="mono">{a.bpm} bpm</span>
            <span className={a.clean ? 'ledger-clean' : 'muted'}>
              {a.clean ? 'kept pace' : 'slipped'}
            </span>
            <div className="spacer" />
            <span className="muted">
              {a.chordIds.length ? a.chordIds.join(' ') : 'riff'}
            </span>
            <span className="muted" title={new Date(a.at).toLocaleString()}>
              {new Date(a.at).toLocaleDateString()}
            </span>
            <DeleteButton size={13}
              what={`${a.bpm} bpm · ${new Date(a.at).toLocaleString()}`}
              heading="Delete this run?"
              onDelete={() => deletePickAttempt(record.patternId, a.at)} />
          </div>
        ))}
      </div>
    </div>
  );
}
