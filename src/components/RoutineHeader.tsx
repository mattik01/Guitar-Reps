import type { ReactNode } from 'react';
import { BackLink } from './BackLink';

// The header every routine screen wears: one leave affordance (never styled as a
// button — it's navigation), the title, and the routine's live numbers on the
// right. Nothing else belongs up here.
export type RoutineHeaderProps = {
  title: ReactNode;
  backLabel: string;
  backTo?: string;          // link out…
  onBack?: () => void;      // …or an action (e.g. finish + log)
  backTitle?: string;
  stats?: ReactNode;        // muted, right-aligned
};

export function RoutineHeader({ title, backLabel, backTo, onBack, backTitle, stats }: RoutineHeaderProps) {
  return (
    <div className="row routine-header">
      <BackLink to={backTo} onClick={onBack} label={backLabel} title={backTitle} />
      <h1>{title}</h1>
      <div className="spacer" />
      {stats && <div className="muted">{stats}</div>}
    </div>
  );
}
