import { useL } from "../config/langContext.js";
import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toLatinName } from "../lib/persons.js";

/** Accent- and case-insensitive form for matching («Πασιαλής» ~ «πασιαλης»). */
function fold(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Αναζήτηση παίκτη (build 2026-11-09.02): γράφεις λίγα γράμματα, βλέπεις
 * έως 8 προτάσεις από το μητρώο· Enter ή πάτημα ανοίγει την καρτέλα.
 * players: [{ key, name }] · onOpen(key) · autoFocus · onDone() (μετά την επιλογή)
 */
export function PlayerSearch({ players, onOpen, autoFocus = false, onDone, className = "" }) {
  const [q, setQ] = useState("");
  const L = useL();
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const blurTimer = useRef(null);

  const indexed = useMemo(() => (players || []).map((p) => ({ ...p, f: `${fold(p.name)} ${fold(toLatinName(p.name))}` })), [players]);
  const results = useMemo(() => {
    const tokens = fold(q).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return indexed
      .filter((p) => tokens.every((t) => p.f.includes(t)))
      .sort((a, b) => {
        const as = a.f.split(" ").some((w) => w.startsWith(tokens[0])) ? 0 : 1;
        const bs = b.f.split(" ").some((w) => w.startsWith(tokens[0])) ? 0 : 1;
        return as - bs || a.name.localeCompare(b.name, "el");
      })
      .slice(0, 8);
  }, [indexed, q]);

  function choose(p) {
    if (!p) return;
    setQ("");
    setOpen(false);
    onOpen(p.key);
    if (onDone) onDone();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[hi] || results[0]); }
    else if (e.key === "Escape") { setQ(""); setOpen(false); if (onDone) onDone(); }
  }

  return (
    <div className={"player-search " + className}>
      <label className="player-search-field">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">{L.searchLabel}</span>
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          placeholder={L.searchPlaceholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="player-search-list"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && q.trim() && (
        <ul className="player-search-list" id="player-search-list" role="listbox">
          {results.length === 0 && <li className="player-search-empty">{L.searchNone}</li>}
          {results.map((p, i) => (
            <li key={p.key} role="option" aria-selected={i === hi}>
              <button
                type="button"
                className={"player-search-item" + (i === hi ? " hi" : "")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
              >
                {L.pn ? L.pn(p.name) : p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
