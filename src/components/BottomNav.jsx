import { useL } from "../config/langContext.js";
import { useEffect, useState } from "react";

/**
 * Κάτω μπάρα πλοήγησης στο κινητό (build 2026-11-09.02· ορατή μόνο σε
 * στενή οθόνη, βλ. styles/nav.js). Στη θέση του παλιού μενού ☰.
 * items: [{ key, label, icon, onClick, liveDot? }] · active · more: [{ key, label, icon, onClick, dot? }]
 */
export function BottomNav({ items, active, more, moreLabel, moreIcon: MoreIcon }) {
  const [open, setOpen] = useState(false);
  const L = useL();
  const moreDot = more.some((m) => m.dot);
  const moreActive = more.some((m) => m.key === active);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (fn) => { setOpen(false); fn(); };

  return (
    <>
      <nav className="bottom-nav" aria-label={L.navMain}>
        {items.map((it) => {
          const Icon = it.icon;
          const on = active === it.key && !open;
          return (
            <button key={it.key} type="button" className={"bottom-nav-item" + (on ? " active" : "")} aria-current={on ? "page" : undefined} onClick={() => go(it.onClick)}>
              <span className="bottom-nav-icon"><Icon size={22} aria-hidden="true" />{it.liveDot && <span className="nav-live bottom-nav-live" aria-label={L.tInProgress} />}</span>
              {it.label}
            </button>
          );
        })}
        <button type="button" className={"bottom-nav-item" + (open || moreActive ? " active" : "")} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="bottom-nav-icon"><MoreIcon size={22} aria-hidden="true" />{moreDot && <span className="topbar-dot bottom-nav-dot" />}</span>
          {moreLabel || L.navMore}
        </button>
      </nav>
      {open && <div className="more-sheet-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className="more-sheet" role="menu">
          {more.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.key} type="button" role="menuitem" className={"more-sheet-item" + (active === m.key ? " active" : "")} onClick={() => go(m.onClick)}>
                <Icon size={20} aria-hidden="true" /> {m.label}
                {m.dot && <span className="topbar-dot more-sheet-dot" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
