// Πλοήγηση (build 2026-11-09.02): πάνω μπάρα με links, αναζήτηση παίκτη,
// κάτω μπάρα στο κινητό. Μπαίνει στο τέλος του <style> του App.jsx, πριν
// από το MOBILE_CSS.
export const NAV_MAX = 1100; // κάτω από αυτό: κάτω μπάρα αντί για links

export const NAV_CSS = `
        .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

        .topbar { position: relative; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; justify-content: flex-start; background: var(--surface); padding: 10px 28px; }
        .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .brand-home { display: inline-flex; align-items: center; gap: 10px; border: none; background: none; padding: 0; cursor: pointer; color: var(--ink); text-align: left; }
        .brand-title { font-family: 'Literata', Georgia, serif; font-weight: 700; font-size: 17px; letter-spacing: 0; line-height: 1.15; }
        .topbar-back { padding: 6px; }
        .topbar-build { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 4px; }

        .topbar-links { display: flex; align-items: center; gap: 20px; flex: 1; flex-wrap: wrap; }
        .nav-link { position: relative; display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 12px 0; font: inherit; font-size: 15px; font-weight: 600; color: var(--ink); border-bottom: 2px solid transparent; cursor: pointer; }
        .nav-link:hover { color: var(--accent); }
        .nav-link.active { color: var(--accent); font-weight: 700; border-bottom-color: var(--accent); }
        .nav-live { width: 8px; height: 8px; border-radius: 50%; background: var(--win); display: inline-block; }
        .topbar-dot { position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #c0392b; border: 1.5px solid var(--surface); }
        .nav-dot { top: 6px; right: -10px; }

        .topbar-right { display: flex; align-items: center; gap: 10px; margin-left: auto; }
        .topbar-admin { height: 38px; padding: 0 12px; border: none; background: none; border-radius: 999px; font: inherit; font-size: 15px; font-weight: 600; color: var(--ink); cursor: pointer; }
        .topbar-admin:hover, .topbar-admin.active { color: var(--accent); }
        .topbar-admin.primary { background: var(--accent-soft); color: var(--accent); font-weight: 700; padding: 0 16px; }
        .topbar-lang { border: 1px solid var(--border) !important; border-radius: 999px !important; font-weight: 700 !important; font-size: 13px !important; padding: 4px 12px !important; }
        .topbar-search-btn { display: none; width: 42px; height: 42px; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--ink); padding: 0; }

        .player-search { position: relative; }
        .topbar-search { width: 210px; }
        .player-search-field { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--muted); box-sizing: border-box; }
        .player-search-field input { border: none !important; background: transparent !important; outline: none; font: inherit; font-size: 15px; color: var(--ink); width: 100%; min-width: 0; padding: 0 !important; box-shadow: none !important; }
        .player-search-field:focus-within { border-color: var(--accent); }
        .player-search-list { position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 240px; z-index: 160; list-style: none; margin: 0; padding: 6px 0; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 28px rgba(0,0,0,0.14); max-height: 360px; overflow-y: auto; }
        .player-search-item { display: block; width: 100%; text-align: left; border: none; background: none; padding: 10px 14px; font: inherit; font-size: 15px; color: var(--ink); cursor: pointer; }
        .player-search-item.hi, .player-search-item:hover { background: var(--accent-soft); color: var(--accent); }
        .player-search-empty { padding: 10px 14px; color: var(--muted); font-size: 14px; }

        .search-overlay { position: absolute; inset: 0; z-index: 170; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--surface); }
        .search-overlay .player-search { flex: 1; }
        .search-overlay-close { width: 44px; height: 44px; border: none; background: none; color: var(--ink); display: inline-flex; align-items: center; justify-content: center; }

        .bottom-nav, .more-sheet, .more-sheet-scrim { display: none; }

        @media (max-width: 1350px) {
          .topbar-build { display: none; }
          .topbar-links { gap: 16px; }
          .topbar-search { width: 170px; }
          .account-email { display: none; }
        }

        @media (max-width: ${NAV_MAX}px) {
          .topbar { flex-wrap: nowrap; gap: 8px; padding: 8px 12px 8px 14px; }
          .topbar-links, .topbar-search, .topbar-admin, .topbar-lang { display: none !important; }
          .topbar-search-btn { display: inline-flex; }
          .topbar-right { gap: 8px; flex-shrink: 0; }
          .brand-title { font-size: 15px; }
          .app { padding-bottom: calc(68px + env(safe-area-inset-bottom, 0px)); }

          .bottom-nav { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); position: fixed; left: 0; right: 0; bottom: 0; z-index: 150; background: var(--surface); border-top: 1px solid var(--border); padding: 6px 4px calc(8px + env(safe-area-inset-bottom, 0px)); }
          .bottom-nav-item { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 52px; border: none; background: none; font: inherit; font-size: 12px; font-weight: 600; color: #4A433E; cursor: pointer; }
          .bottom-nav-item.active { color: var(--accent); font-weight: 700; }
          .bottom-nav-icon { position: relative; display: inline-flex; }
          .bottom-nav-live { position: absolute; top: -2px; right: -6px; }
          .bottom-nav-dot { top: -2px; right: -6px; }

          .more-sheet-scrim { display: block; position: fixed; inset: 0; z-index: 151; background: rgba(0,0,0,0.25); }
          .more-sheet { display: block; position: fixed; left: 0; right: 0; bottom: calc(66px + env(safe-area-inset-bottom, 0px)); z-index: 152; background: var(--surface); border-top: 1px solid var(--border); border-radius: 16px 16px 0 0; box-shadow: 0 -10px 24px rgba(0,0,0,0.12); padding: 8px 0; max-height: 70vh; overflow-y: auto; }
          .more-sheet-item { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 50px; padding: 0 22px; border: none; background: none; font: inherit; font-size: 16px; font-weight: 600; color: var(--ink); text-align: left; cursor: pointer; }
          .more-sheet-item.active, .more-sheet-item:active { color: var(--accent); background: var(--accent-soft); }
          .more-sheet-dot { position: static; display: inline-block; }
        }
        @media print { .bottom-nav, .more-sheet, .more-sheet-scrim { display: none !important; } }
`;
