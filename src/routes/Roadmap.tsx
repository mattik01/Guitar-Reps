import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackLink } from '../components/BackLink';
import { IconAdd, IconAddNote, IconCollapsed, IconExpanded, IconPlay, YouTubeMark } from '../components/icons';
import { EditButton } from '../components/EditButton';
import { IconButton } from '../components/IconButton';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { evaluateLevel, type RequirementContext, type RequirementResult } from '../data/roadmapRequirements';
import { stepsFor } from '../data/transitionTargets';
import { TransitionGrid } from '../components/TransitionGrid';
import { cachedAnalysis, loadAnalysis } from '../data/songAnalysis';
import { catalogIdOf, playability, repertoireByBase } from '../data/songTransitions';
import {
  ROADMAP,
  PRACTICE_FRAMEWORK,
  ALL_ROADMAP_ITEM_IDS,
  type RoadmapLevel,
} from '../data/roadmap';
import { ROADMAP_VIDEOS, youtubeUrl } from '../data/roadmapVideos';
import { EXTRA_VIDEOS } from '../data/roadmapExtraVideos';
import {
  useRoadmapProgress, useWatchedVideos, useRepertoire, useSwapRecords, useSongs,
  useSongOverlays, usePlaylists, useChordProfiles, mergeSong, type Song,
} from '../state/store';

export default function Roadmap() {
  const [progress, setProgress] = useRoadmapProgress();
  const [watched, setWatched] = useWatchedVideos();
  const [repertoire] = useRepertoire();
  const [swaps] = useSwapRecords();
  const [savedSongs] = useSongs();
  const [overlays] = useSongOverlays();
  const [playlists] = usePlaylists();
  const [profiles] = useChordProfiles();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function toggleWatched(videoId: string) {
    setWatched(prev => {
      const next = { ...prev };
      if (next[videoId]) delete next[videoId];
      else next[videoId] = true;
      return next;
    });
  }

  const total = ALL_ROADMAP_ITEM_IDS.length;
  const done = useMemo(
    () => ALL_ROADMAP_ITEM_IDS.filter(id => progress[id]?.done).length,
    [progress]
  );

  // --- hard requirements ------------------------------------------------------
  // Everything the app can verify itself, evaluated once for the whole page.
  const songs = useMemo<Song[]>(
    () => savedSongs.map(s => mergeSong(s, s.ref ? overlays[s.ref] : undefined)),
    [savedSongs, overlays],
  );
  const byBase = useMemo(() => repertoireByBase(repertoire), [repertoire]);

  // A song can only be scored once its progression is loaded. Loading one hits the
  // catalog worker, which downloads the ~200 MB catalog on first use — so this is
  // gated on actually having songs, exactly like SongsPanel's resync. A user with no
  // songs fails the song requirements anyway; no request is worth making.
  const [analysisTick, setAnalysisTick] = useState(0);
  useEffect(() => {
    if (songs.length === 0) return;
    let cancelled = false;
    const missing = songs
      .map(catalogIdOf)
      .filter((id): id is number => id != null && cachedAnalysis(id) == null);
    if (missing.length === 0) return;
    Promise.all(missing.map(loadAnalysis)).then(() => { if (!cancelled) setAnalysisTick(t => t + 1); });
    return () => { cancelled = true; };
  }, [songs]);

  const reqContext = useMemo<RequirementContext>(() => ({
    repertoire,
    swaps,
    profiles,
    songs,
    playlists,
    playabilityOf: (song: Song) => {
      const id = catalogIdOf(song);
      const analysis = id == null ? null : cachedAnalysis(id);
      if (!analysis) return null; // not loaded yet — never counts as 0
      return playability(analysis.transitions, song.tempo ?? null, byBase, swaps);
    },
    // analysisTick: scores that became computable after the progressions arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [repertoire, swaps, profiles, songs, playlists, byBase, analysisTick]);

  function toggleDone(id: string) {
    setProgress(prev => ({
      ...prev,
      [id]: { ...prev[id], done: !prev[id]?.done, updatedAt: Date.now() },
    }));
  }

  function openEditor(id: string) {
    setEditingId(id);
    setDraft(progress[id]?.note ?? '');
  }

  function saveNote(id: string) {
    setProgress(prev => ({
      ...prev,
      [id]: { ...prev[id], note: draft.trim(), updatedAt: Date.now() },
    }));
    setEditingId(null);
    setDraft('');
  }

  function cancelEditor() {
    setEditingId(null);
    setDraft('');
  }

  function setPlaylist(levelId: string, url: string) {
    setProgress(prev => ({
      ...prev,
      [levelId]: { ...prev[levelId], playlistUrl: url, updatedAt: Date.now() },
    }));
  }

  return (
    <div>
      <PageHeader
        title="Roadmap"
        leading={<BackLink to="/videos" label="All videos" icon={<IconPlay size={14} />}
          title="Every lesson video, in order" />}
      />

      {/* No card, no caption: the bar says the percentage and the count itself. */}
      <div style={{ marginTop: 10 }}>
        <ProgressBar value={done} total={total} unit="steps"
          title="Self-reported. Later, in-app systems (swap speed, perfect reps…) will add hard requirements to each step." />
      </div>

      {ROADMAP.map(phase => (
        <section key={phase.id} style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 4 }}>{phase.name}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{phase.blurb}</p>

          {phase.levels.map(level => (
            <LevelCard
              key={level.id}
              level={level}
              requirements={evaluateLevel(level.id, reqContext)}
              progress={progress}
              editingId={editingId}
              draft={draft}
              onToggle={toggleDone}
              onOpenEditor={openEditor}
              onDraftChange={setDraft}
              onSave={saveNote}
              onCancel={cancelEditor}
              playlistUrl={progress[level.id]?.playlistUrl ?? ''}
              onSetPlaylist={setPlaylist}
              watched={watched}
              onToggleWatched={toggleWatched}
            />
          ))}

          <div className="card" style={{ marginTop: 12, background: 'var(--bg)' }}>
            <h3 style={{ marginTop: 0 }}>
              {phase.name.split(' ')[0]} mistakes
            </h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {phase.mistakes.map((m, i) => (
                <li key={i} className="muted" style={{ marginBottom: 4 }}>{m}</li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      <div className="card" style={{ marginTop: 24, background: 'var(--bg)' }}>
        <h3 style={{ marginTop: 0 }}>{PRACTICE_FRAMEWORK.title}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{PRACTICE_FRAMEWORK.intro}</p>
        <div className="col">
          {PRACTICE_FRAMEWORK.steps.map(step => (
            <div key={step.key} className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{
                fontWeight: 800,
                fontSize: 18,
                color: 'var(--accent)',
                minWidth: 24,
              }}>{step.key}</div>
              <div>
                <strong>{step.label}:</strong> <span className="muted">{step.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LevelCard({
  level,
  requirements,
  progress,
  editingId,
  draft,
  onToggle,
  onOpenEditor,
  onDraftChange,
  onSave,
  onCancel,
  playlistUrl,
  onSetPlaylist,
  watched,
  onToggleWatched,
}: {
  level: RoadmapLevel;
  /** Computed, never user-toggled — see data/roadmapRequirements.ts. */
  requirements: RequirementResult[];
  progress: Record<string, { done?: boolean; note?: string }>;
  editingId: string | null;
  draft: string;
  onToggle: (id: string) => void;
  onOpenEditor: (id: string) => void;
  onDraftChange: (v: string) => void;
  onSave: (id: string) => void;
  onCancel: () => void;
  playlistUrl: string;
  onSetPlaylist: (levelId: string, url: string) => void;
  watched: Record<string, boolean>;
  onToggleWatched: (videoId: string) => void;
}) {
  const doneCount = level.items.filter(i => progress[i.id]?.done).length;
  const metCount = requirements.filter(r => r.met).length;
  // Requirement id → the chord-change step it came from, so a swap target can show
  // its grid while the other targets (chords owned, songs saved) stay plain rows.
  const stepById = useMemo(() => new Map(stepsFor(level.id).map(s => [s.id, s])), [level.id]);
  const [editingPlaylist, setEditingPlaylist] = useState(false);
  const [playlistDraft, setPlaylistDraft] = useState('');

  function openPlaylistEditor() {
    setPlaylistDraft(playlistUrl);
    setEditingPlaylist(true);
  }
  function savePlaylist() {
    onSetPlaylist(level.id, normalizeUrl(playlistDraft));
    setEditingPlaylist(false);
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{level.name}</h3>
      </div>

      {/* The level's own progress: the steps you tick off AND the targets the app
          verifies, in the same element as the roadmap total. */}
      <div style={{ marginTop: 8 }}>
        <ProgressBar
          value={doneCount + metCount}
          total={level.items.length + requirements.length}
          height={18}
          right={requirements.length > 0
            ? `${doneCount}/${level.items.length} steps · ${metCount}/${requirements.length} targets`
            : `${doneCount} / ${level.items.length} steps`}
          title={`${level.name}: steps ticked off plus targets the app has verified`} />
      </div>

      {editingPlaylist && (
        <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
          <input
            type="url"
            autoFocus
            value={playlistDraft}
            onChange={e => setPlaylistDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') savePlaylist(); if (e.key === 'Escape') setEditingPlaylist(false); }}
            placeholder="https://youtube.com/playlist?list=…"
            style={{
              flex: 1,
              padding: '6px 10px',
              border: '1px solid var(--line)',
              borderRadius: 8,
              fontFamily: 'inherit',
              fontSize: 14,
            }}
          />
          <button className="button primary" onClick={savePlaylist} style={{ flexShrink: 0 }}>Save</button>
          {playlistUrl && (
            <button className="button danger" onClick={() => { onSetPlaylist(level.id, ''); setEditingPlaylist(false); }} style={{ flexShrink: 0 }}>Remove</button>
          )}
          <button className="button" onClick={() => setEditingPlaylist(false)} style={{ flexShrink: 0 }}>Cancel</button>
        </div>
      )}

      {level.note && (
        <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontStyle: 'italic' }}>{level.note}</p>
      )}

      <div className="col" style={{ marginTop: 10, gap: 6 }}>
        {level.items.map(item => {
          const entry = progress[item.id];
          const isDone = !!entry?.done;
          const note = entry?.note ?? '';
          const isEditing = editingId === item.id;
          return (
            <div key={item.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <label className="toggle" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => onToggle(item.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{
                    color: isDone ? 'var(--muted)' : 'var(--ink)',
                    textDecoration: isDone ? 'line-through' : 'none',
                  }}>
                    {item.text}
                  </span>
                </label>
                <div className="spacer" />
                {/* The pencil means "change what's there"; an empty note gets the
                    add-a-note mark instead. */}
                {note ? (
                  <EditButton
                    onClick={() => (isEditing ? onCancel() : onOpenEditor(item.id))}
                    active={isEditing}
                    dot
                    title="Edit note"
                    label="Edit note"
                    style={{ flexShrink: 0 }} />
                ) : (
                  <IconButton
                    onClick={() => (isEditing ? onCancel() : onOpenEditor(item.id))}
                    active={isEditing}
                    title="Add a note"
                    label="Add a note"
                    style={{ flexShrink: 0 }}>
                    <IconAddNote />
                  </IconButton>
                )}
              </div>

              {isEditing ? (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    rows={3}
                    autoFocus
                    value={draft}
                    onChange={e => onDraftChange(e.target.value)}
                    placeholder="Lessons learned working on this step…"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 10px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      fontFamily: 'inherit',
                      fontSize: 14,
                      resize: 'vertical',
                    }}
                  />
                  <div className="footer-bar" style={{ marginTop: 8 }}>
                    <button className="button primary" onClick={() => onSave(item.id)}>Save note</button>
                    <button className="button" onClick={onCancel}>Cancel</button>
                  </div>
                </div>
              ) : (
                note && (
                  <p className="muted" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0 30px' }}>
                    {note}
                  </p>
                )
              )}

              <ItemVideos
                groupings={[
                  { label: 'JustinGuitar videos', videos: ROADMAP_VIDEOS[item.id] },
                  { label: 'More videos', videos: EXTRA_VIDEOS[item.id] },
                ]}
                watched={watched}
                onToggleWatched={onToggleWatched}
              />
            </div>
          );
        })}
      </div>

      {requirements.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}
            title="Measured by the app from your repertoire, calibration, swap records and songs — you can't tick these off by hand">
            Targets
          </div>
          <div className="col" style={{ gap: 6 }}>
            {requirements.map(r => (
              <div key={r.id}>
                <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'nowrap' }}>
                  {/* Disabled on purpose: the app decides these, not the user. */}
                  <input type="checkbox" checked={r.met} disabled readOnly
                    style={{ marginTop: 2, accentColor: 'var(--good)' }} />
                  <span style={{ color: r.met ? 'var(--muted)' : 'var(--ink)', fontSize: 14 }}>
                    {r.label}
                  </span>
                  <div className="spacer" />
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {r.value}/{r.total}
                  </span>
                </div>
                {/* What's missing sits under the target it belongs to. */}
                {!r.met && (
                  <p className="muted" style={{ margin: '2px 0 0 30px', fontSize: 12 }}>{r.detail}</p>
                )}
                {/* Chord-change steps show their whole grid: every change, yours or not. */}
                {stepById.get(r.id) && (
                  <TransitionGrid targets={stepById.get(r.id)!.targets} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <VideoSection
        videos={ROADMAP_VIDEOS[level.id]}
        watched={watched}
        onToggleWatched={onToggleWatched}
        label={`More ${level.name.split(' —')[0]} videos`}
        note="Fit this level, but not a single step above."
        actions={!editingPlaylist && (
          playlistUrl ? (
            <>
              <a href={playlistUrl} target="_blank" rel="noopener noreferrer" className="button"
                style={{ textDecoration: 'none', padding: '3px 8px', fontSize: 13 }}>
                <IconPlay style={{ color: 'var(--accent)' }} /> Playlist
              </a>
              <EditButton onClick={openPlaylistEditor} title="Edit playlist link" label="Edit playlist link" />
            </>
          ) : (
            <button className="button" onClick={openPlaylistEditor} title="Link a YouTube playlist"
              style={{ padding: '3px 8px', fontSize: 13 }}>
              <IconAdd size={13} /> <YouTubeMark size={14} /> Playlist
            </button>
          )
        )}
      />
    </div>
  );
}

type Grouping = { label: string; videos?: { n?: number; id: string; title: string; channel?: string }[] };

// Per-bullet video groupings. The toggle buttons sit on ONE horizontal row
// directly under the bullet; the open grouping's list appears below, full width.
function ItemVideos({
  groupings,
  watched,
  onToggleWatched,
}: {
  groupings: Grouping[];
  watched: Record<string, boolean>;
  onToggleWatched: (videoId: string) => void;
}) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const available = groupings.filter(g => g.videos && g.videos.length > 0);
  if (available.length === 0) return null;

  const open = available.find(g => g.label === openLabel);

  return (
    <div style={{ marginTop: 4, marginLeft: 30 }}>
      <div className="row" style={{ gap: 6 }}>
        {available.map(g => {
          const videos = g.videos!;
          const watchedCount = videos.filter(v => watched[v.id]).length;
          const isOpen = g.label === openLabel;
          return (
            <button
              key={g.label}
              className="button"
              onClick={() => setOpenLabel(o => (o === g.label ? null : g.label))}
              style={{ padding: '3px 8px', fontSize: 13 }}
            >
              <IconPlay style={{ color: 'var(--accent)' }} /> {g.label}
              <span className="muted" style={{ marginLeft: 6 }}>
                {watchedCount}/{videos.length} {isOpen ? <IconExpanded size={13} /> : <IconCollapsed size={13} />}
              </span>
            </button>
          );
        })}
      </div>
      {open && <VideoList videos={open.videos!} watched={watched} onToggleWatched={onToggleWatched} />}
    </div>
  );
}

// The level-fallback grouping: a single expandable section spanning the card,
// separated by a top border. `videos` may be undefined — renders nothing.
function VideoSection({
  videos,
  watched,
  onToggleWatched,
  label,
  note,
  actions,
}: {
  videos?: { n?: number; id: string; title: string; channel?: string }[];
  watched: Record<string, boolean>;
  onToggleWatched: (videoId: string) => void;
  label: string;
  note?: string;
  /** Sits beside the toggle — this row is where a level's watchable material lives,
      so its playlist link belongs here rather than up in the level's title row. */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasVideos = !!videos && videos.length > 0;
  if (!hasVideos && !actions) return null;

  const watchedCount = hasVideos ? videos!.filter(v => watched[v.id]).length : 0;

  return (
    <div className="row" style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 8, gap: 6 }}>
      {hasVideos && (
        <button
          className="button"
          onClick={() => setOpen(o => !o)}
          style={{ padding: '3px 8px', fontSize: 13 }}
        >
          <IconPlay style={{ color: 'var(--accent)' }} /> {label}
          <span className="muted" style={{ marginLeft: 6 }}>
            {watchedCount}/{videos!.length} {open ? <IconExpanded size={13} /> : <IconCollapsed size={13} />}
          </span>
        </button>
      )}
      {actions}
      {open && hasVideos && (
        <div style={{ flexBasis: '100%' }}>
          <VideoList videos={videos!} watched={watched} onToggleWatched={onToggleWatched} note={note} />
        </div>
      )}
    </div>
  );
}

// The list of numbered video links with per-video watched checkmarks.
function VideoList({
  videos,
  watched,
  onToggleWatched,
  note,
}: {
  videos: { n?: number; id: string; title: string; channel?: string }[];
  watched: Record<string, boolean>;
  onToggleWatched: (videoId: string) => void;
  note?: string;
}) {
  return (
    <div className="col" style={{ gap: 2, marginTop: 6 }}>
      {note && (
        <p className="muted" style={{ margin: '0 0 4px', fontSize: 12, fontStyle: 'italic' }}>{note}</p>
      )}
      {videos.map(v => {
        const isWatched = !!watched[v.id];
        return (
          <div key={v.id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 8 }}>
            <input
              type="checkbox"
              checked={isWatched}
              onChange={() => onToggleWatched(v.id)}
              title={isWatched ? 'Watched' : 'Mark as watched'}
              style={{ marginTop: 4, flexShrink: 0 }}
            />
            {v.n != null && (
              <span
                title="Position in the full JustinGuitar course"
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
            )}
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
  );
}

// Store links with an explicit scheme so <a href> treats them as absolute URLs
// (a bare "youtube.com/…" would otherwise resolve relative to the app).
function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}
