import { useMemo, useState } from 'react';
import { NODE_DEFINITIONS, CATEGORY_ORDER, CATEGORY_META, type Category } from '../nodeRegistry';
import { useWorkflowStore } from '../store/workflowStore';

const DRAG_TYPE = 'application/lumina-node';

const SPECIAL_HEADERS: Record<string, { color: string; swatch: string; label: string }> = {
  '★': { color: 'text-amber-400', swatch: 'bg-amber-400', label: 'Favorites' },
  '🕒': { color: 'text-cyan-400', swatch: 'bg-cyan-400', label: 'Recently used' },
};

export function NodeLibrary() {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const favorites = useWorkflowStore((s) => s.favorites);
  const recent = useWorkflowStore((s) => s.recent);
  const toggleFavorite = useWorkflowStore((s) => s.toggleFavorite);
  const addNode = useWorkflowStore((s) => s.addNode);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? NODE_DEFINITIONS.filter((d) => d.label.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.description.toLowerCase().includes(q))
      : NODE_DEFINITIONS;
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof NODE_DEFINITIONS>();
    if (!query) {
      const favDefs = favorites
        .map((t) => NODE_DEFINITIONS.find((d) => d.type === t))
        .filter((d): d is (typeof NODE_DEFINITIONS)[number] => !!d);
      if (favDefs.length) map.set('★', favDefs);

      const recentDefs = recent
        .filter((t) => !favorites.includes(t))
        .map((t) => NODE_DEFINITIONS.find((d) => d.type === t))
        .filter((d): d is (typeof NODE_DEFINITIONS)[number] => !!d)
        .slice(0, 8);
      if (recentDefs.length) map.set('🕒', recentDefs);
    }
    CATEGORY_ORDER.forEach((cat) => {
      const defs = filtered.filter((d) => d.category === cat);
      if (defs.length) map.set(cat, defs);
    });
    return map;
  }, [filtered, favorites, recent, query]);

  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData(DRAG_TYPE, type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="glass flex w-60 shrink-0 flex-col border-r border-line">
      <div className="p-3 pb-2">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">Node library</h3>
          <span className="text-[10px] text-faint">{NODE_DEFINITIONS.length} nodes</span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="w-full rounded-lg border border-line bg-ink px-2.5 py-1.5 text-xs text-inktext outline-none placeholder:text-faint focus:border-blue"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {query && !filtered.length ? (
          <p className="px-2 py-6 text-center text-xs text-faint">No nodes match “{query}”</p>
        ) : (
          [...grouped.entries()].map(([key, defs]) => {
            const isSpecial = key === '★' || key === '🕒';
            const meta = isSpecial ? SPECIAL_HEADERS[key] : CATEGORY_META[key as Category];
            const displayLabel = isSpecial ? SPECIAL_HEADERS[key].label : key;
            const isCollapsed = collapsed[key] ?? false;
            return (
              <div key={key} className="mb-2">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-elevated"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.swatch}`} />
                  <span className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${meta.color}`}>
                    {displayLabel}
                  </span>
                  <span className="text-[10px] text-faint">{isCollapsed ? '▸' : '▾'}</span>
                </button>
                {!isCollapsed && (
                  <div className="mt-1 space-y-0.5">
                    {defs.map((def) => (
                      <div
                        key={def.type}
                        draggable
                        onDragStart={(e) => onDragStart(e, def.type)}
                        onDoubleClick={() => addNode(def.type)}
                        className="group flex cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-all hover:border-line hover:bg-elevated hover:pl-2.5 active:cursor-grabbing"
                      >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[13px] transition-transform group-hover:scale-110 ${def.color}`}>
                          {def.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-inktext">{def.label}</span>
                          <span className="block truncate text-[10px] text-faint">{def.description}</span>
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(def.type);
                          }}
                          className={`shrink-0 text-xs opacity-0 transition-opacity group-hover:opacity-100 ${
                            favorites.includes(def.type) ? '!opacity-100 text-amber-400' : 'text-faint hover:text-amber-400'
                          }`}
                          title={favorites.includes(def.type) ? 'Unfavorite' : 'Favorite'}
                        >
                          ★
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        <p className="mt-3 rounded-lg border border-dashed border-line p-2 text-[10px] leading-relaxed text-faint">
          Drag onto the canvas, or double-click to add. Right-click a node for shortcuts.
        </p>
      </div>
    </aside>
  );
}
