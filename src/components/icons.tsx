// The app's icon vocabulary — one named export per CONCEPT, so a screen never has to
// pick its own glyph for something another screen already names (a mic is a mic
// everywhere, "detection details" is always the microscope). Swapping the icon set is
// an edit to this file, not a hunt through every screen.
//
// Lucide, not emoji: emoji render in whatever the OS ships, ignore `currentColor`,
// and sit on a different baseline per platform. These inherit colour and align.
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Dices, Drum,
  ExternalLink, FileText, Guitar, HelpCircle, Download, ListMusic, ListPlus, Pointer,
  ScanSearch,
  Funnel, Metronome, Mic, Microscope, MessageSquarePlus, Pencil, Music, MoveVertical, PartyPopper, Play, Plus, Repeat, RotateCcw,
  SlidersHorizontal, Sparkles, Square, Target, Trash2, X,
  type LucideProps,
} from 'lucide-react';

// Default size + aria-hidden in one place: an icon next to a label is decoration, and
// the label (or the control's title/aria-label) is what gets read out.
type IconProps = Omit<LucideProps, 'ref'>;
const icon = (C: React.ComponentType<LucideProps>) =>
  ({ size = 15, ...rest }: IconProps) => <C size={size} aria-hidden {...rest} />;

// — actions ————————————————————————————————————————————————————————————
export const IconEdit = icon(Pencil);          // always via <EditButton>
// Writing a note that isn't there yet is NOT editing — the pencil is reserved for
// changing something that already exists (see EditButton).
export const IconAddNote = icon(MessageSquarePlus);
export const IconPlay = icon(Play);            // watch a video / open a playlist
export const IconStop = icon(Square);
export const IconAdd = icon(Plus);
export const IconImport = icon(Download);
export const IconRandom = icon(Dices);         // "give me a random chord / pair"
export const IconMetronome = icon(Metronome);  // tempo, wherever a tempo is set
export const IconRestore = icon(RotateCcw);    // undo back to the catalog original
export const IconRemove = icon(X);             // clear a field, dismiss a chip
export const IconDelete = icon(Trash2);        // destroy a saved thing, for good
export const IconExternal = icon(ExternalLink);
export const IconSheet = icon(FileText);
export const IconPlaylists = icon(ListMusic);  // membership count
export const IconAddToPlaylist = icon(ListPlus);

// — state / verdict ————————————————————————————————————————————————————
export const IconYes = icon(Check);
export const IconNo = icon(X);
export const IconWarn = icon(AlertTriangle);
export const IconClean = icon(Sparkles);       // cleanliness score
export const IconCelebrate = icon(PartyPopper);
export const IconTarget = icon(Target);        // calibration target
export const IconTest = icon(ScanSearch);      // "does the app recognise this?"

// — mic / detection ————————————————————————————————————————————————————
export const IconMic = icon(Mic);
export const IconDetails = icon(Microscope);   // "Detection details"
export const IconSensitivity = icon(SlidersHorizontal);
export const IconFilters = icon(Funnel);   // HP/LP audio filters (never the pencil — that's Edit)
export const IconStrum = icon(Guitar);
export const IconKnock = icon(Drum);

// — navigation ————————————————————————————————————————————————————————
export const IconBack = icon(ArrowLeft);
export const IconExpanded = icon(ChevronDown);
export const IconCollapsed = icon(ChevronRight);

// — routines / content ————————————————————————————————————————————————
export const IconQuiz = icon(HelpCircle);
export const IconSwap = icon(Repeat);
// The strumming hand's motion, down and up in time — the routine is a rhythmic,
// mechanical drill, not "some music happens here".
export const IconStrumming = icon(MoveVertical);
// One extended finger — fingerpicking is a single finger (or a single pick) at a time,
// which the horns hand read as the opposite of.
export const IconPicking = icon(Pointer);
export const IconGuitar = icon(Guitar);
export const IconNote = icon(Music);           // album-art placeholder

// — brand marks ————————————————————————————————————————————————————————
// Inline so they stay self-contained (no remote assets) and theme-independent:
// brand colours are the point of a logo, so these do NOT take currentColor.
export function YouTubeMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="#FF0000" d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5C0 8.4 0 12 0 12s0 3.6.5 5.5a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.5.5-5.5s0-3.6-.5-5.5z" />
      <path fill="#fff" d="M9.6 15.5 15.8 12 9.6 8.5z" />
    </svg>
  );
}

export function SpotifyMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill="#1DB954" />
      <g fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
        <path d="M6.1 8.7c3.7-1.1 7.8-.8 11.2 1" />
        <path d="M7.1 12c3-.9 6.4-.6 9.1.9" />
        <path d="M8.1 15.2c2.4-.7 5-.5 7.1.8" />
      </g>
    </svg>
  );
}
