import type { NodeField } from '../nodeRegistry';

export function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: NodeField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const base =
    'w-full rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs text-inktext outline-none placeholder:text-faint focus:border-blue';

  if (field.type === 'toggle') {
    return (
      <button
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-line'}`}
        title="Toggle"
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${value ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    );
  }
  if (field.type === 'select') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={base}>
        {field.options?.map((o) => (
          <option key={o} value={o} className="bg-elevated">
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={field.placeholder}
        className={`${base} resize-none`}
      />
    );
  }
  if (field.type === 'slider') {
    const num = Number(value ?? field.min ?? 0);
    return (
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={field.step}
          value={num}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-blue-500"
        />
        <span className="w-10 text-right text-[11px] tabular-nums text-muted">{num}</span>
      </div>
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={Number(value ?? 0)}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={base}
      />
    );
  }
  return (
    <input
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={base}
    />
  );
}
