import { useEffect } from 'react';

type Props = {
  count: number;
  label?: string;
  onTap: () => void;
  disabled?: boolean;
  keyboard?: boolean;
  small?: boolean;
};

export function TapCounter({ count, label, onTap, disabled, keyboard = true, small = false }: Props) {
  useEffect(() => {
    if (!keyboard || disabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onTap();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTap, keyboard, disabled]);

  return (
    <button
      className={`tap-zone ${small ? 'small' : ''}`}
      onClick={() => !disabled && onTap()}
      disabled={disabled}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div>{count}</div>
        {label && <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.85 }}>{label}</div>}
      </div>
    </button>
  );
}
