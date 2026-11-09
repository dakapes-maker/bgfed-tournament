// Οθόνες της οπτικής ανανέωσης (build 2026-11-09.03): κεφαλίδα τουρνουά,
// κουκκίδες νικών, σταθερή γραμμή τίτλων στους πίνακες, προφίλ παίκτη.
// Μπαίνει στο τέλος του <style> του App.jsx, πριν από NAV_CSS/MOBILE_CSS.
export const VIEWS_CSS = `
        /* Κεφαλίδα τουρνουά */
        .t-header { display: flex; gap: 20px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; max-width: 1600px; margin: 0 auto; }
        .t-header-main { flex: 1; min-width: 260px; }
        .t-status { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        .t-status.live { color: var(--win); }
        .t-status.done { color: var(--muted); }
        .t-status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--win); }
        .t-meta { margin: 6px 0 0; color: var(--muted); font-size: 15px; }
        .t-counters { display: flex; gap: 12px; }
        .t-counter { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 18px; text-align: center; min-width: 120px; display: flex; flex-direction: column; gap: 2px; }
        .t-counter-label { font-size: 13px; color: var(--muted); }
        .t-counter-value { font-family: 'Literata', Georgia, serif; font-size: 26px; font-weight: 700; line-height: 1.1; }
        .t-counter-value small { font-size: 17px; color: var(--muted); font-weight: 600; }
        .t-counter-bar { display: block; height: 6px; background: var(--accent-soft); border-radius: 999px; margin-top: 4px; overflow: hidden; }
        .t-counter-bar span { display: block; height: 6px; background: var(--win); border-radius: 999px; }

        /* Κουκκίδες νικών (ρεκόρ πριν από τον γύρο) */
        .win-dots { display: inline-flex; gap: 3px; margin-left: 7px; vertical-align: middle; }
        .win-dot { width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; border: 1.5px solid #B08A2E; }
        .win-dot.w { background: #B08A2E; }
        .pairings-order-note { margin: 6px 0 10px; font-size: 13px; color: var(--muted); }

        /* Σταθερή γραμμή τίτλων: ο πίνακας κυλάει μέσα στο πλαίσιό του */
        .table-scroll { max-height: calc(100vh - 150px); overflow: auto !important; }
        .table-scroll .std-table thead { position: sticky; top: 0; z-index: 3; }
        .table-scroll .std-table thead th { background: var(--surface); box-shadow: inset 0 -1px 0 var(--border); }
        @media (max-width: 1100px) { .table-scroll { max-height: calc(100vh - 210px); } }

        /* Προφίλ παίκτη */
        .profile-head { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; max-width: 1180px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 24px 28px; }
        .profile-avatar { width: 84px; height: 84px; border-radius: 50%; background: var(--accent); color: var(--bg); display: flex; align-items: center; justify-content: center; font-family: 'Literata', Georgia, serif; font-size: 32px; font-weight: 700; flex-shrink: 0; }
        .profile-id { flex: 1; min-width: 220px; }
        .profile-id .eyebrow { margin: 0 0 2px; }
        .profile-figures { display: flex; gap: 28px; }
        .profile-figure { text-align: right; display: flex; flex-direction: column; }
        .profile-figure span { font-size: 13px; color: var(--muted); }
        .profile-figure strong { font-family: 'Literata', Georgia, serif; font-size: 46px; line-height: 1; font-weight: 700; }
        .profile-figure strong.accent { color: var(--accent); }
        .profile-figure small { font-size: 13px; color: var(--muted); }
        .profile-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
        .profile-tile { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 18px; }
        .profile-tile-label { font-size: 13px; color: var(--muted); }
        .profile-tile-value { font-family: 'Literata', Georgia, serif; font-size: 28px; font-weight: 700; line-height: 1.2; }
        .profile-tile-sub { font-size: 13px; color: var(--muted); }
        .profile-bar { height: 7px; background: var(--accent-soft); border-radius: 999px; margin: 4px 0 2px; overflow: hidden; }
        .profile-bar span { display: block; height: 7px; border-radius: 999px; background: var(--accent); }
        .profile-bar.ink span { background: var(--ink); }
        .profile-section-title { font-family: 'Literata', Georgia, serif; font-size: 21px; font-weight: 600; margin: 0 0 10px; }
        .recent-table { width: 100%; border-collapse: collapse; font-size: 15px; }
        .recent-table th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted); padding: 4px 8px 8px 0; }
        .recent-table td { padding: 9px 8px 9px 0; border-top: 1px solid var(--border); vertical-align: top; }
        .recent-table .pos { color: var(--win); }
        .recent-table .neg { color: var(--loss); }
        .recent-res { display: inline-block; width: 24px; height: 24px; border-radius: 6px; text-align: center; line-height: 24px; font-weight: 700; font-size: 13px; }
        .recent-res.w { background: #E4F0EA; color: var(--win); }
        .recent-res.l { background: var(--accent-soft); color: var(--accent); }
        @media (max-width: 900px) {
          .profile-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .profile-figures { width: 100%; justify-content: flex-start; }
          .profile-figure { text-align: left; }
          .profile-figure strong { font-size: 38px; }
          .t-counters { width: 100%; }
          .t-counter { flex: 1; min-width: 0; }
        }
`;
