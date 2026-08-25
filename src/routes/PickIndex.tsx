import { Link } from 'react-router-dom';
import { RoutineHeader } from '../components/RoutineHeader';
import { LevelSections } from '../components/LevelSections';
import { Sparkline } from '../components/Sparkline';
import { PickTab } from '../components/PickTab';
import { libraryChordById, libraryPrimaryShape } from '../data/chordLibrary';
import { PICK_EXERCISES, PICK_KIND_LABEL, buildTab, type PickExercise } from '../data/pickPatterns';
import { levelClass } from '../data/roadmapPaint';
import { usePickRecords } from '../state/store';

// The picking ladder — this screen is the Quiz/Swap 'picking' phase, one level
// up: choose WHICH exercise, then its own screen chooses the chords and tempo.
//
// Grouped by roadmap level rather than by a difficulty number, because these are
// meant to become roadmap targets ("hold this at N bpm"). Levels with no
// exercises don't render, so the ladder shows one heading today and grows
// headings as it grows cards.

// The chord a card's sample tab is drawn over. G sounds all six strings, so a
// string-crossing pattern is fully visible on it — and a fixed chord keeps every
// card looking the same for everyone. Riffs ignore it and show their own notes.
const SAMPLE_SHAPE = libraryPrimaryShape(libraryChordById('G')!);
const SAMPLE_NOTES = 12;

export default function PickIndex() {
  const [records] = usePickRecords();

  return (
    <div>
      <RoutineHeader title="Picking" backLabel="Exercise" backTo="/exercise" />

      <LevelSections
        items={PICK_EXERCISES}
        levelOf={e => e.level}
        sortWithin={(a, b) => a.difficulty - b.difficulty}
        countNoun="exercise"
        renderCard={(e: PickExercise) => {
          const rec = records[e.id];
          const best = rec?.bestCleanBpm ?? 0;
          // The card's own performance ledger, the way a trained swap pair
          // carries its sparkline: only CLEAN runs plot, because only a clean
          // run says anything about tempo.
          const clean = (rec?.history ?? [])
            .filter(h => h.clean)
            .map(h => ({ count: h.bpm, at: h.at }));
          return (
            <Link key={e.id} to={`/routine/pick/${e.id}`}
              className={`card routine-card painted ${levelClass(e.level)}`} title={e.hint}>
              <h2>{e.name}</h2>
              {/* What the exercise LOOKS like, instead of a generic glyph. */}
              <PickTab compact maxNotes={SAMPLE_NOTES}
                notes={buildTab(e, [SAMPLE_SHAPE]).flat()}
                ariaLabel={`${e.name} sample`} />
              {/* Identity, not state: a fixed riff and a drill you choose the
                  chords for are different KINDS of thing. It stays NEUTRAL —
                  the card's ink is already spoken for by its roadmap level, and
                  two colour scales on one card read as one confused scale. */}
              <span className="kind-chip">{PICK_KIND_LABEL[e.kind]}</span>
              <div className="muted">
                {rec
                  ? <>best clean <strong>{best || '—'}</strong> · last {rec.lastBpm} · {rec.attempts}×</>
                  : 'Not played yet'}
              </div>
              {clean.length > 1 && (
                <div className="card-spark"><Sparkline history={clean} small /></div>
              )}
            </Link>
          );
        }}
      />
    </div>
  );
}
