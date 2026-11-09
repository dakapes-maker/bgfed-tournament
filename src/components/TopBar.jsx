import { useL } from "../config/langContext.js";
import { useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { PlayerSearch } from "./PlayerSearch.jsx";

/** Το σήμα: μπορντό τετράγωνο με δύο τρίγωνα ταμπλό. */
export function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <rect x="1" y="1" width="34" height="34" rx="8" fill="var(--accent)" />
      <path d="M8 8 L13 22 L18 8 Z" fill="var(--bg)" />
      <path d="M18 28 L23 14 L28 28 Z" fill="var(--bg)" opacity="0.7" />
    </svg>
  );
}

/**
 * Πάνω μπάρα (build 2026-11-09.02). Υπολογιστής: σήμα + τίτλος, links με
 * κείμενο (η τρέχουσα σελίδα μπορντό με γραμμή), αναζήτηση παίκτη, για
 * διαχειριστή «Παίκτες» και «Διαχείριση», γλώσσα, σύνδεση/λογαριασμός.
 * Σε στενή οθόνη (styles/nav.js) τα links και η γλώσσα πάνε στην κάτω μπάρα
 * (BottomNav)· η αναζήτηση ανοίγει από τον φακό σε όλο το πλάτος.
 *
 * links / admin: [{ key, label, onClick, dot?, liveDot? }] · active · players: [{ key, name }]
 */
export function TopBar({ title, buildVersion, onBack, onHome, links, admin = [], active, langLabel, onToggleLang, right, players, onOpenPlayer }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const L = useL();

  return (
    <div className="topbar">
      <div className="brand">
        {onBack && (
          <button className="btn-ghost topbar-back" onClick={onBack} aria-label={L.navBack}>
            <ArrowLeft size={18} />
          </button>
        )}
        <button type="button" className="brand-home" onClick={onHome} aria-label={`${title} — ${L.navHome}`}>
          <BrandMark />
          <span className="brand-title">{title}</span>
        </button>
        <span className="topbar-build">build {buildVersion}</span>
      </div>

      <nav className="topbar-links" aria-label={L.navMain}>
        {links.map((it) => (
          <button
            key={it.key}
            type="button"
            className={"nav-link" + (active === it.key ? " active" : "")}
            aria-current={active === it.key ? "page" : undefined}
            onClick={it.onClick}
          >
            {it.label}
            {it.liveDot && <span className="nav-live" aria-label={L.tInProgress} />}
            {it.dot && <span className="topbar-dot nav-dot" />}
          </button>
        ))}
      </nav>

      <div className="topbar-right">
        <PlayerSearch players={players} onOpen={onOpenPlayer} className="topbar-search" />
        <button type="button" className="topbar-search-btn" aria-label={L.searchLabel} onClick={() => setSearchOpen(true)}>
          <Search size={20} />
        </button>
        {admin.map((it) => (
          <button
            key={it.key}
            type="button"
            className={"topbar-admin" + (it.primary ? " primary" : "") + (active === it.key ? " active" : "")}
            aria-current={active === it.key ? "page" : undefined}
            onClick={it.onClick}
          >
            {it.label}
          </button>
        ))}
        <button type="button" className="btn-ghost topbar-lang" onClick={onToggleLang} title="Switch language">
          {langLabel}
        </button>
        {right}
      </div>

      {searchOpen && (
        <div className="search-overlay">
          <PlayerSearch players={players} onOpen={onOpenPlayer} autoFocus onDone={() => setSearchOpen(false)} />
          <button type="button" className="search-overlay-close" aria-label={L.searchClose} onClick={() => setSearchOpen(false)}>
            <X size={22} />
          </button>
        </div>
      )}
    </div>
  );
}
