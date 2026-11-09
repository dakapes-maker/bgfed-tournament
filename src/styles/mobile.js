// Κανόνες εμφάνισης για στενές οθόνες (κινητό, tablet όρθιο).
// Μπαίνουν στο τέλος του <style> του App.jsx, ώστε να υπερισχύουν των
// γενικών κανόνων. Πάνω από τα 900px η εμφάνιση μένει όπως ήταν.
export const MOBILE_MENU_MAX = 900;

export const MOBILE_CSS = `
        /* Η πάνω μπάρα και η κάτω μπάρα του κινητού: styles/nav.js (2026-11-09.02). */

        /* Κατάταξη ELO: πτυσσόμενο πλαίσιο «How this is calculated» */
        .elo-howto { flex: 1; min-width: 0; }
        .elo-howto > summary { cursor: pointer; }

        @media (max-width: ${MOBILE_MENU_MAX}px) {
          .account-email { display: none; }

          /* Πεδία 16px: κάτω από αυτό το iPhone κάνει zoom όταν πατάς στο πεδίο */
          .app input[type="text"], .app input[type="number"], .app input[type="date"], .app input[type="email"],
          .app input[type="password"], .app input[type="search"], .app input:not([type]), .app select, .app textarea { font-size: 16px !important; }

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

          /* Βαθμολογία: οι σταθερές στήλες κρατούν το χρώμα της ζώνης πρόκρισης */
          .std-table tr.qual-tier1 td { background: #00FFFF; }
          .std-table tr.qual-tier2 td { background: #FF00FF; }
          .std-table tr.qual-tier3 td { background: #00FF00; }
          /* Ανάπτυγμα παίκτη: μένει μέσα στην οθόνη όσο κι αν κύλησε ο πίνακας */
          .st-expand-inner { position: sticky; left: 14px; max-width: calc(100vw - 58px); }
          .st-entry { flex-wrap: wrap; gap: 2px 10px; }
          .st-entry .entry-breakdown { flex-wrap: wrap; gap: 4px 10px; }
          .qual-row { flex-wrap: wrap; white-space: normal; }

          /* Καρτέλα παίκτη */
          .pd-contact-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          .detail-tabs { overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
          .detail-tabs::-webkit-scrollbar { display: none; }
          .detail-tab { white-space: nowrap; flex-shrink: 0; }
          .history-row { flex-wrap: wrap; gap: 2px 10px; }

          /* Αρχείο τουρνουά: φίλτρα σε όλο το πλάτος, στοιχεία κάτω από το όνομα */
          .filters > * { flex: 1 1 100%; min-width: 0 !important; width: auto !important; }
          .archive-row { flex-direction: column; align-items: flex-start; gap: 4px; }
          .archive-meta { flex-wrap: wrap; gap: 4px 10px; }

          /* Ημερολόγιο: ο σύλλογος κάτω από τον τίτλο της αγωνιστικής */
          .cal-row { flex-wrap: wrap; row-gap: 6px; }
          .cal-row-text { flex-basis: calc(100% - 56px) !important; }
          .cal-club { margin-left: 56px; }

          /* Πίνακας Ελέγχου: κάρτες σε δύο στήλες */
          .dashboard-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
          .dashboard-card { padding: 14px; }
          .dashboard-card-title { font-size: 16px; }

          /* Κάρτα αγώνα (διαχειριστής): κουμπιά το ένα κάτω από το άλλο */
          .match-actions { flex-direction: column; gap: 8px; }
          .retire-row { flex-direction: column; align-items: stretch; gap: 4px; }
          .retire-row button { justify-content: flex-start; min-height: 40px; }

          .header { padding: 18px 14px 0 14px; }
          .content { padding: 18px 14px 48px 14px; }
          h1 { font-size: 24px; }
        }
`;
