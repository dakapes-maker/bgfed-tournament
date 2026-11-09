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

        /* Σταθερή γραμμή τίτλων (2026-11-09.04):
           υπολογιστής (> 1100px) — κυλάει όλη η σελίδα και οι τίτλοι κολλάνε στην κορυφή της οθόνης
           (ο πίνακας χωράει, άρα το πλαίσιο δεν χρειάζεται δική του κύλιση)·
           κινητό/tablet — ο πίνακας κυλάει μέσα στο πλαίσιό του (και πλάγια). */
        .table-scroll .std-table thead { position: sticky; top: 0; z-index: 3; }
        .table-scroll .std-table thead th { background: var(--surface); box-shadow: inset 0 -1px 0 var(--border); }
        @media (min-width: 1101px) { .table-scroll { overflow: visible !important; } }
        @media (max-width: 1100px) { .table-scroll { max-height: calc(100vh - 210px); overflow: auto !important; } }

        /* Νέο τουρνουά (2026-11-09.04): ρυθμίσεις | παίκτες */
        .setup-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 20px; align-items: start; }
        .setup-col { margin-bottom: 0; }
        .setup-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; min-width: 0; }
        .setup-field label { margin: 0; }
        .setup-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .setup-dateline { margin: -6px 0 14px; font-size: 14px; color: var(--muted); }
        .setup-check { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 12px; cursor: pointer; font-size: 15px; }
        .setup-check input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }
        .setup-check strong { display: block; }
        .setup-check small { display: block; font-size: 13px; color: var(--muted); }
        .setup-players-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
        .setup-count { color: var(--ink); font-size: 18px; }
        .setup-add { gap: 10px; }
        .setup-paste-link { display: inline-block; margin: 8px 0 6px; font-size: 14px; font-weight: 600; }
        .setup-bulk { border: 1px dashed var(--border); border-radius: 10px; padding: 12px; background: var(--bg); margin-bottom: 8px; }
        .setup-list { border: 1px solid var(--border); border-radius: 12px; max-height: 440px; overflow-y: auto; margin-top: 8px; background: var(--surface); }
        .setup-row { display: flex; align-items: center; gap: 12px; padding: 0 12px; min-height: 46px; border-bottom: 1px solid var(--border); }
        .setup-row:last-child { border-bottom: none; }
        .setup-row-n { width: 24px; text-align: right; font-size: 13px; color: var(--muted); }
        .setup-row-name { flex: 1; min-width: 0; font-weight: 600; }
        .setup-tag { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
        .setup-tag.known { background: #E4F0EA; color: var(--win); }
        .setup-tag.new { background: #F6EBD3; color: #8A6A1F; }
        @keyframes setupFlash { from { background: #E4F0EA; } to { background: transparent; } }
        .setup-row.just-added { animation: setupFlash 2.5s ease-out; }
        .setup-start { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
        .start-confirm { width: 540px; }
        .start-summary { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; padding: 12px 16px; background: var(--bg); border-radius: 10px; font-size: 15px; }
        .start-summary dt { color: var(--muted); }
        .start-summary dd { margin: 0; }
        .start-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
        @media (max-width: 900px) { .setup-grid { grid-template-columns: 1fr; } }

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
        /* Αρχική (2026-11-09.05) */
        .home-header { max-width: 1240px; margin: 0 auto; }
        .home-eyebrow { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
        .home-title { font-size: 42px; max-width: 900px; }
        .home-sub { margin: 10px 0 0; font-size: 17px; color: var(--muted); max-width: 680px; }
        .content.home { max-width: 1240px; }
        .home-top { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 20px; margin-bottom: 20px; align-items: stretch; }
        .home-hero { background: var(--ink); color: var(--surface); border-radius: 18px; padding: 26px 30px; display: flex; flex-direction: column; gap: 16px; }
        .home-hero-tag { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
        .home-hero-tag.live { color: #6FD3A8; }
        .home-hero-tag.live .nav-live { background: #6FD3A8; }
        .home-hero-tag.recent { color: #E9C77A; }
        .home-hero-tag.next { color: #E9B8B0; }
        .home-hero-title { margin: 0; font-family: 'Literata', Georgia, serif; font-size: 30px; font-weight: 600; line-height: 1.15; color: var(--surface); }
        .home-hero-meta { margin: 4px 0 0; color: #CFC6B8; }
        .home-progress-label { display: flex; justify-content: space-between; font-size: 14px; color: #CFC6B8; margin-bottom: 6px; }
        .home-progress-label strong { color: var(--surface); }
        .home-progress-bar { height: 8px; background: #3A342F; border-radius: 999px; overflow: hidden; }
        .home-progress-bar span { display: block; height: 8px; background: #6FD3A8; }
        .home-next { display: flex; gap: 22px; align-items: center; flex-wrap: wrap; }
        .home-date { background: var(--accent); border-radius: 14px; width: 104px; padding: 12px 0; text-align: center; display: flex; flex-direction: column; flex-shrink: 0; }
        .home-date-top { font-size: 13px; font-weight: 700; text-transform: uppercase; color: #F3D9D4; }
        .home-date-day { font-family: 'Literata', Georgia, serif; font-size: 46px; font-weight: 700; line-height: 1.05; }
        .home-facts { border-top: 1px solid #3A342F; padding-top: 14px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .home-fact-label, .home-fact-sub { display: block; font-size: 13px; color: #CFC6B8; }
        .home-fact-value { display: block; border: none; background: none; padding: 2px 0; font: inherit; font-weight: 700; color: var(--surface); text-align: left; cursor: pointer; }
        .home-podium { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: end; }
        .home-podium-step { border: none; border-radius: 12px; padding: 14px; text-align: center; background: #2A2521; color: var(--surface); font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
        .home-podium-step.p1 { background: var(--accent); padding: 20px 14px; order: 2; }
        .home-podium-step.p2 { order: 1; }
        .home-podium-step.p3 { order: 3; }
        .home-podium-place, .home-podium-detail { font-size: 13px; color: #E2D8CC; }
        .home-podium-name { font-weight: 700; }
        .home-podium-step.p1 .home-podium-name { font-family: 'Literata', Georgia, serif; font-size: 20px; }
        .home-hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: auto; }
        .home-btn { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 20px; border-radius: 999px; font: inherit; font-weight: 700; cursor: pointer; border: none; }
        .home-btn.light { background: var(--surface); color: var(--ink); }
        .home-btn.ghost { background: transparent; color: var(--surface); border: 1px solid #5A524B; font-weight: 600; }
        .home-btn.accent { background: var(--accent); color: var(--surface); }
        .home-card { margin-bottom: 0; display: flex; flex-direction: column; }
        .home-card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .home-up-row { display: flex; gap: 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
        .home-up-date { width: 46px; text-align: center; flex-shrink: 0; display: flex; flex-direction: column; }
        .home-up-date span { font-size: 12px; font-weight: 700; color: var(--accent); text-transform: uppercase; }
        .home-up-date strong { font-family: 'Literata', Georgia, serif; font-size: 24px; line-height: 1; }
        .home-up-text { display: flex; flex-direction: column; min-width: 0; }
        .home-more { margin-top: auto; padding-top: 12px; align-self: flex-start; font-weight: 600; }
        .home-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-bottom: 20px; }
        .home-pills { margin: 8px 0 4px; }
        .home-rule { margin: 4px 0 6px; }
        .home-row { display: flex; align-items: center; gap: 12px; min-height: 46px; border-top: 1px solid var(--border); }
        .home-rank { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; background: var(--accent-soft); color: var(--ink); flex-shrink: 0; }
        .home-rank.zone { background: var(--win); color: #fff; }
        .home-rank.round { border-radius: 50%; }
        .home-rank.round.first { background: var(--accent); color: var(--surface); }
        .home-row-name { flex: 1; min-width: 0; border: none; background: none; padding: 0; font: inherit; font-weight: 600; color: var(--ink); text-align: left; cursor: pointer; display: flex; flex-direction: column; }
        .home-row-name:hover { color: var(--accent); }
        .home-club { font-weight: 400; }
        .home-row-value { font-family: 'Literata', Georgia, serif; font-weight: 700; font-size: 19px; }
        .home-foot { margin: 8px 0 0; font-size: 12px; }
        .home-result { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 10px 0; border: none; border-top: 1px solid var(--border); background: none; font: inherit; color: var(--ink); text-align: left; cursor: pointer; }
        .home-result:hover strong { color: var(--accent); }
        .home-winner { color: var(--ink); }
        .home-elo-box { display: flex; gap: 20px; align-items: center; justify-content: space-between; flex-wrap: wrap; background: var(--accent-soft); border-radius: 16px; padding: 22px 26px; margin-bottom: 20px; }
        .home-elo-box p { margin: 6px 0 0; color: #4A433E; max-width: 720px; }
        .home-admin { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 14px; margin-bottom: 18px; }
        .home-admin-label { font-weight: 700; color: var(--accent); margin-right: 6px; }
        .home-support { text-align: center; font-size: 13px; color: var(--muted); margin-top: 6px; }
        @media (max-width: 1000px) {
          .home-top, .home-cards { grid-template-columns: 1fr; }
        }
        @media (max-width: 600px) {
          .home-title { font-size: 26px; }
          .home-sub { display: none; }
          .home-hero { padding: 20px; }
          .home-hero-title { font-size: 22px; }
          .home-facts { grid-template-columns: 1fr; gap: 8px; }
          .home-date { width: 80px; }
          .home-date-day { font-size: 34px; }
          .home-upcoming .home-up-row:nth-of-type(n+4) { display: none; }
        }
`;
