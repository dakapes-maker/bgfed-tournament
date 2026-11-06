import { useEffect, useState } from "react";
import { ArrowLeft, Globe, Menu, X } from "lucide-react";

/**
 * Πάνω μπάρα της εφαρμογής. Σε υπολογιστή τα κουμπιά πλοήγησης φαίνονται
 * στη σειρά· σε στενή οθόνη (βλ. styles/mobile.js) μπαίνουν σε μενού ☰.
 * Τα ίδια `items` τροφοδοτούν και τις δύο προβολές.
 *
 * items: [{ key, icon, label, onClick, dot? }]
 * right: ό,τι μένει πάντα ορατό στη μπάρα (σύνδεση / λογαριασμός).
 */
export function TopBar({ title, buildVersion, onBack, items, langLabel, onToggleLang, right }) {
  const [open, setOpen] = useState(false);
  const anyDot = items.some((it) => it.dot);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const choose = (fn) => { setOpen(false); fn(); };

  return (
    <div className="topbar">
      <div className="brand">
        {onBack && (
          <button className="btn-ghost" onClick={() => { setOpen(false); onBack(); }} style={{ marginRight: 4 }} aria-label="Πίσω">
            <ArrowLeft size={15} />
          </button>
        )}
        {title}
        <span className="topbar-build" style={{ fontFamily: "'Source Sans 3', sans-serif", fontWeight: 400, fontSize: 11, color: "var(--muted)", marginLeft: 10, letterSpacing: 0 }}>
          build {buildVersion}
        </span>
      </div>

      <div className="topbar-right">
        <div className="topbar-nav">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <button key={it.key} className="btn-ghost" onClick={it.onClick} style={it.dot !== undefined ? { position: "relative" } : undefined}>
                <Icon size={14} /> {it.label}
                {it.dot && <span className="topbar-dot" />}
              </button>
            );
          })}
          <button className="btn-ghost" onClick={onToggleLang} title="Switch language" style={{ fontWeight: 700, fontSize: 12, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 20 }}>
            {langLabel}
          </button>
        </div>
        {right}
        <button
          className="topbar-burger"
          onClick={() => setOpen((v) => !v)}
          aria-label="Μενού"
          aria-expanded={open}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
          {!open && anyDot && <span className="topbar-dot" />}
        </button>
      </div>

      <div className={"topbar-scrim" + (open ? " open" : "")} onClick={() => setOpen(false)} />
      <nav className={"topbar-panel" + (open ? " open" : "")} aria-hidden={!open}>
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button key={it.key} className="topbar-panel-item" onClick={() => choose(it.onClick)}>
              <Icon size={18} /> {it.label}
              {it.dot && <span className="topbar-dot" />}
            </button>
          );
        })}
        <div className="topbar-panel-sep" />
        <button className="topbar-panel-item" onClick={() => choose(onToggleLang)}>
          <Globe size={18} /> {langLabel === "EN" ? "English" : "Ελληνικά"}
        </button>
      </nav>
    </div>
  );
}
