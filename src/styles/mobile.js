// Κανόνες εμφάνισης για στενές οθόνες (κινητό, tablet όρθιο).
// Μπαίνουν στο τέλος του <style> του App.jsx, ώστε να υπερισχύουν των
// γενικών κανόνων. Πάνω από τα 900px η εμφάνιση μένει όπως ήταν.
export const MOBILE_MENU_MAX = 900;

export const MOBILE_CSS = `
        /* Πάνω μπάρα: κουμπιά (υπολογιστής) ή μενού ☰ (στενή οθόνη) */
        .topbar { position: relative; gap: 10px; }
        .brand { min-width: 0; flex-wrap: wrap; }
        .topbar-right { display: flex; align-items: center; gap: 14px; }
        .topbar-nav { display: contents; }
        .topbar-burger { display: none; position: relative; align-items: center; justify-content: center; width: 40px; height: 40px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--ink); padding: 0; }
        .topbar-dot { position: absolute; top: -2px; right: -6px; width: 8px; height: 8px; border-radius: 50%; background: #c0392b; border: 1.5px solid var(--card-bg, #fff); }
        .topbar-burger .topbar-dot { top: 4px; right: 4px; }
        .topbar-panel, .topbar-scrim { display: none; }

        @media (max-width: ${MOBILE_MENU_MAX}px) {
          .topbar-nav { display: none; }
          .topbar-burger { display: inline-flex; }
          .topbar-build { display: none; }
          .account-email { display: none; }
          .topbar-right { gap: 8px; flex-shrink: 0; }
          .topbar-scrim.open { display: block; position: fixed; inset: 0; z-index: 140; background: rgba(0,0,0,0.15); }
          .topbar-panel.open { display: block; position: absolute; top: 100%; left: 0; right: 0; z-index: 150; background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: 0 10px 24px rgba(0,0,0,0.12); padding: 6px 0; max-height: calc(100vh - 70px); overflow-y: auto; }
          .topbar-panel-item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 0 20px; background: none; border: none; text-align: left; font-size: 16px; font-weight: 600; color: var(--ink); }
          .topbar-panel-item:hover, .topbar-panel-item:active { background: var(--accent-soft); color: var(--accent); }
          .topbar-panel-item .topbar-dot { position: static; display: inline-block; margin-left: -4px; }
          .topbar-panel-sep { height: 1px; background: var(--border); margin: 6px 0; }

          /* Πεδία 16px: κάτω από αυτό το iPhone κάνει zoom όταν πατάς στο πεδίο */
          .app input[type="text"], .app input[type="number"], .app input[type="date"], .app input[type="email"],
          .app input[type="password"], .app input[type="search"], .app input:not([type]), .app select, .app textarea { font-size: 16px; }

          /* Καρτέλες σελίδων: οριζόντια κύλιση αντί για σπάσιμο της σελίδας */
          .tabs { overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .tabs::-webkit-scrollbar { display: none; }
          .tab { white-space: nowrap; flex-shrink: 0; }
        }

        @media (max-width: 600px) {
          /* Κατάταξη τουρνουά (StandingsTable): Θέση και Παίκτης σταθερές
             αριστερά όσο κυλάει ο πίνακας· όλες οι στήλες μένουν ορατές. */
          .std-table th, .std-table td { padding: 7px 6px; }
          .std-table .std-sticky-rank { position: sticky; left: 0; z-index: 1; background: var(--surface); width: 40px; min-width: 40px; max-width: 40px; }
          .std-table .std-sticky-name { position: sticky; left: 40px; z-index: 1; background: var(--surface); min-width: 110px; max-width: 150px; white-space: normal; box-shadow: inset -1px 0 0 var(--border); }

          /* Κάρτα αγώνα (διαχειριστής): κουμπιά το ένα κάτω από το άλλο */
          .match-actions { flex-direction: column; gap: 8px; }
          .retire-row { flex-direction: column; align-items: stretch; gap: 4px; }
          .retire-row button { justify-content: flex-start; min-height: 40px; }

          .topbar { padding: 10px 14px; }
          .brand { font-size: 12px; }
          .header { padding: 18px 14px 0 14px; }
          .content { padding: 18px 14px 48px 14px; }
          h1 { font-size: 24px; }
        }
`;
