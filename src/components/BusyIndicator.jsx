import React, { useEffect, useSyncExternalStore } from "react";
import { Hourglass } from "lucide-react";
import { busyFraction } from "../lib/busy.js";

/* Background work indicator (build 2026-11-16.01): a thin bar at the top of
 * the screen and a small box at the bottom right with an hourglass, what is
 * running and its progress. Visible wherever the page is scrolled. While it
 * runs, closing the tab asks for confirmation (an Export would be lost).
 * Admin screens only — the texts are Greek (no dictionary, see CLAUDE.md). */
export const BUSY_CSS = `
  .busy-bar { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 2000; background: var(--accent-soft); overflow: hidden; pointer-events: none; }
  .busy-bar-fill { height: 100%; background: var(--accent); transition: width .2s ease-out; }
  .busy-bar-indet { position: absolute; top: 0; bottom: 0; width: 30%; background: var(--accent); animation: busy-slide 1.1s ease-in-out infinite; }
  @keyframes busy-slide { 0% { left: -30%; } 100% { left: 100%; } }
  .busy-box { position: fixed; right: 16px; bottom: 16px; z-index: 2000; display: flex; align-items: center; gap: 10px; min-width: 220px; max-width: calc(100vw - 32px); background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 10px; padding: 10px 14px; box-shadow: 0 6px 20px rgba(0,0,0,.12); font-size: 13px; color: var(--ink); }
  .busy-box-icon { color: var(--accent); flex-shrink: 0; animation: busy-turn 1.6s ease-in-out infinite; }
  @keyframes busy-turn { 0%, 40% { transform: rotate(0deg); } 60%, 100% { transform: rotate(180deg); } }
  .busy-box-text { flex: 1; min-width: 0; }
  .busy-box-label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .busy-box-count { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .busy-box-track { height: 4px; border-radius: 2px; background: var(--accent-soft); margin-top: 6px; overflow: hidden; position: relative; }
  @media (max-width: 1100px) { .busy-box { bottom: 80px; } }
  @media (prefers-reduced-motion: reduce) { .busy-bar-indet, .busy-box-icon { animation: none; } .busy-bar-indet { left: 0; width: 100%; opacity: .5; } }
  @media print { .busy-bar, .busy-box { display: none; } }
`;

export default function BusyIndicator({ store }) {
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const active = !!s;

  useEffect(() => {
    if (!active) return undefined;
    const onLeave = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [active]);

  if (!s) return null;
  const f = busyFraction(s);
  const pct = f === null ? null : Math.round(f * 100);
  const bar = (cls) => (f === null ? <div className="busy-bar-indet" /> : <div className={cls} style={{ width: `${pct}%` }} />);
  return (
    <>
      <div className="busy-bar" role="presentation">{bar("busy-bar-fill")}</div>
      <div className="busy-box" role="status" aria-live="polite">
        <Hourglass size={18} className="busy-box-icon" aria-hidden="true" />
        <div className="busy-box-text">
          <div className="busy-box-label">{s.label}…</div>
          <div className="busy-box-count">{f === null ? "Σε εξέλιξη" : `${Math.min(s.done, s.total)} / ${s.total} · ${pct}%`}</div>
          <div className="busy-box-track">{bar("busy-bar-fill")}</div>
        </div>
      </div>
    </>
  );
}
