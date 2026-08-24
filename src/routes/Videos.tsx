import { useMemo } from 'react';
import { BackLink } from '../components/BackLink';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { ROADMAP_VIDEOS, youtubeUrl } from '../data/roadmapVideos';
import { EXTRA_VIDEOS } from '../data/roadmapExtraVideos';
import { useWatchedVideos } from '../state/store';

type Row = { n: number; id: string; title: string; levelShort: string; channel?: string };

// A target key is either a level id ("l1".."l8") or a roadmap item id
// ("l1-basics"); the level is the leading "l<number>" either way.
function levelOf(key: string): string {
  const m = key.match(/^l\d+/);
  return (m ? m[0] : key).toUpperCase();
}

// All of Justin's course videos, flattened and sorted by their chronological
// course number `n` (1..N across the whole series).
function buildJustin(): Row[] {
  const rows: Row[] = [];
  for (const [key, videos] of Object.entries(ROADMAP_VIDEOS)) {
    for (const v of videos) rows.push({ n: v.n, id: v.id, title: v.title, levelShort: levelOf(key) });
  }
  return rows.sort((a, b) => a.n - b.n);
}

// The hand-curated extra videos from other teachers, in roadmap order, given a
// made-up sequential ordering of their own (1..M).
function buildOther(): Row[] {
  const rows: Row[] = [];
  for (const [key, videos] of Object.entries(EXTRA_VIDEOS)) {
    for (const v of videos) rows.push({ n: 0, id: v.id, title: v.title, levelShort: levelOf(key), channel: v.channel });
  }
  return rows.map((r, i) => ({ ...r, n: i + 1 }));
}

export default function Videos() {
  const [watched, setWatched] = useWatchedVideos();
  const justin = useMemo(buildJustin, []);
  const other = useMemo(buildOther, []);

  const total = justin.length + other.length;
  const done = [...justin, ...other].filter(v => watched[v.id]).length;

  function toggle(videoId: string) {
    setWatched(prev => {
      const next = { ...prev };
      if (next[videoId]) delete next[videoId];
      else next[videoId] = true;
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        title="Videos"
        leading={<BackLink to="/roadmap" label="Roadmap" />}
      />
      <div style={{ marginTop: 10 }}>
        <ProgressBar value={done} total={total} unit="watched" />
      </div>


      <VideoGroup
        title="JustinGuitar — full course"
        subtitle="Every lesson in Justin's beginner-to-advanced course, in chronological order."
        rows={justin}
        watched={watched}
        onToggle={toggle}
      />

      <VideoGroup
        title="Other videos"
        subtitle="Hand-picked lessons from other teachers, in their own order."
        rows={other}
        watched={watched}
        onToggle={toggle}
      />
    </div>
  );
}

function VideoGroup({
  title,
  subtitle,
  rows,
  watched,
  onToggle,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  watched: Record<string, boolean>;
  onToggle: (videoId: string) => void;
}) {
  if (rows.length === 0) return null;
  const done = rows.filter(v => watched[v.id]).length;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <div className="spacer" />
        <span className="muted" style={{ flexShrink: 0 }}>{done}/{rows.length}</span>
      </div>
      <p className="muted" style={{ margin: '2px 0 0' }}>{subtitle}</p>

      <div className="col" style={{ gap: 2, marginTop: 10 }}>
        {rows.map(v => {
          const isWatched = !!watched[v.id];
          return (
            <div key={v.id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 8 }}>
              <input
                type="checkbox"
                checked={isWatched}
                onChange={() => onToggle(v.id)}
                title={isWatched ? 'Watched' : 'Mark as watched'}
                style={{ marginTop: 4, flexShrink: 0 }}
              />
              <span
                title="Order in this list"
                style={{
                  flexShrink: 0,
                  minWidth: 34,
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginTop: 2,
                  textAlign: 'right',
                }}
              >#{v.n}</span>
              <span
                title="Roadmap level"
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--accent)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: '0 5px',
                  marginTop: 2,
                }}
              >{v.levelShort}</span>
              <a
                href={youtubeUrl(v.id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: isWatched ? 'var(--muted)' : 'var(--ink)',
                  textDecoration: isWatched ? 'line-through' : 'none',
                }}
              >
                {v.title}
                {v.channel && (
                  <span className="muted" style={{ fontSize: 12, textDecoration: 'none' }}> · {v.channel}</span>
                )}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
