import { ArrowRight } from "lucide-react";
import { useL, dateLocale } from "../config/langContext.js";

function parts(ymd, loc) {
  const d = new Date(`${ymd}T12:00:00`);
  const clean = (s) => s.replace(/\.$/, "");
  return {
    day: String(d.getDate()).padStart(2, "0"),
    mon: clean(d.toLocaleDateString(loc, { month: "short" })),
    wd: clean(d.toLocaleDateString(loc, { weekday: "short" })),
  };
}

/**
 * Νέα αρχική (build 2026-11-09.05) — μόνο εμφάνιση· όλα τα δεδομένα έρχονται
 * έτοιμα από το App. hero: { kind: "live"|"recent"|"next", … }
 */
export function HomePage({ seasonLabel, hero, upcoming, standings, activeComp, onPickComp, eloTop, recent, onOpenTournament, onOpenPlayer, nav, children }) {
  const L = useL();
  const loc = dateLocale(L);
  const cur = standings.find((s) => s.id === activeComp) || standings[0];
  return (
    <>
      <div className="header home-header">
        <p className="eyebrow home-eyebrow">{seasonLabel}</p>
        <h1 className="home-title">{L.hTitle}</h1>
        <p className="home-sub">{L.hSub}</p>
        <div className="points-strip">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
          ))}
        </div>
      </div>
      <div className="content home">
        {children}

        <div className="home-top">
          <section className={`home-hero ${hero.kind}`}>
            {hero.kind === "live" && (
              <>
                <p className="home-hero-tag live"><span className="nav-live" /> {L.hLiveNow}</p>
                <h2 className="home-hero-title">{hero.name}</h2>
                <p className="home-hero-meta">{L.hRoundOf(hero.round, hero.totalRounds)} · {L.tPlayersN(hero.players)}</p>
                <div className="home-progress">
                  <div className="home-progress-label"><span>{L.tRoundMatches}</span><span><strong>{hero.done}</strong> {L.hOfDone(hero.total)}</span></div>
                  <div className="home-progress-bar"><span style={{ width: `${hero.total ? Math.round((hero.done / hero.total) * 100) : 0}%` }} /></div>
                </div>
                <div className="home-hero-actions">
                  <button className="home-btn light" onClick={() => onOpenTournament(hero.id)}>{L.hLiveMatches} <ArrowRight size={16} /></button>
                </div>
              </>
            )}
            {hero.kind === "recent" && (
              <>
                <p className="home-hero-tag recent">{L.hJustFinished}</p>
                <h2 className="home-hero-title">{hero.name}</h2>
                <p className="home-hero-meta">{hero.dateLabel}{hero.players ? ` · ${L.tPlayersN(hero.players)}` : ""}</p>
                <div className="home-podium">
                  {hero.podium.map((p) => (
                    <button key={p.place} className={`home-podium-step p${p.place}`} onClick={() => p.key && onOpenPlayer(p.key)}>
                      <span className="home-podium-place">{p.place === 1 ? L.hWinner : L.placeN(p.place)}</span>
                      <span className="home-podium-name">{p.name}</span>
                      {p.detail && <span className="home-podium-detail">{p.detail}</span>}
                    </button>
                  ))}
                </div>
                <div className="home-hero-actions">
                  <button className="home-btn light" onClick={() => onOpenTournament(hero.id)}>{L.hFullStandings} <ArrowRight size={16} /></button>
                  {hero.next && <button className="home-btn ghost" onClick={nav.calendar}>{L.calNext}: {hero.next}</button>}
                </div>
              </>
            )}
            {hero.kind === "next" && (
              <>
                <p className="home-hero-tag next">{L.hNextDay}</p>
                {hero.entry ? (
                  <div className="home-next">
                    <div className="home-date">
                      <span className="home-date-top">{parts(hero.entry.date, loc).wd} · {parts(hero.entry.date, loc).mon}</span>
                      <span className="home-date-day">{parts(hero.entry.date, loc).day}</span>
                    </div>
                    <div>
                      <h2 className="home-hero-title">{hero.entry.title}</h2>
                      <p className="home-hero-meta">{L.hInDays(hero.days)}</p>
                    </div>
                  </div>
                ) : (
                  <h2 className="home-hero-title">{L.hNoNext}</h2>
                )}
                {hero.facts.length > 0 && (
                  <div className="home-facts">
                    {hero.facts.map((f) => (
                      <div key={f.label}>
                        <span className="home-fact-label">{f.label}</span>
                        <button className="home-fact-value" onClick={() => f.key && onOpenPlayer(f.key)}>{f.value}</button>
                        {f.sub && <span className="home-fact-sub">{f.sub}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="home-hero-actions">
                  <button className="home-btn light" onClick={nav.calendar}>{L.navCalendar} <ArrowRight size={16} /></button>
                </div>
              </>
            )}
          </section>

          <section className="card home-card home-upcoming">
            <h2 className="profile-section-title">{L.calUpcoming}</h2>
            {upcoming.length === 0 && <p className="cal-note">{L.hNoUpcoming}</p>}
            {upcoming.map((u) => {
              const d = parts(u.date, loc);
              return (
                <div key={u.id} className="home-up-row">
                  <div className="home-up-date"><span>{d.mon}</span><strong>{d.day}</strong></div>
                  <div className="home-up-text"><strong>{u.title}</strong><span className="cal-note">{d.wd} {d.day}/{u.date.slice(5, 7)}</span></div>
                </div>
              );
            })}
            <button className="history-link home-more" onClick={nav.calendar}>{L.hAllCalendar} →</button>
          </section>
        </div>

        <div className="home-cards">
          <section className="card home-card">
            <div className="home-card-head"><h2 className="profile-section-title">{L.navSeasonShort}</h2>{cur && <span className="cal-note">{cur.seasonLabel}</span>}</div>
            {standings.length > 1 && (
              <div className="round-pills home-pills">
                {standings.map((s) => (
                  <button key={s.id} className={`round-pill ${cur && cur.id === s.id ? "active" : ""}`} onClick={() => onPickComp(s.id)}>{s.label}</button>
                ))}
              </div>
            )}
            {!cur && <p className="cal-note">{L.hNoStandings}</p>}
            {cur && <p className="cal-note home-rule">{cur.ruleLine}</p>}
            {cur && cur.rows === null && <p className="cal-note">{L.loading}</p>}
            {cur && cur.rows && cur.rows.length === 0 && <p className="cal-note">{L.hNoResults}</p>}
            {cur && cur.rows && cur.rows.map((r) => (
              <div key={r.key || r.name} className="home-row">
                <span className={`home-rank ${r.zone ? "zone" : ""}`}>{r.rank}</span>
                <button className="home-row-name" onClick={() => r.key && onOpenPlayer(r.key)}>{r.name}</button>
                <span className="home-row-value">{r.total}</span>
              </div>
            ))}
            {cur && cur.rows && cur.rows.length > 0 && <p className="cal-note home-foot">{L.hFullOrder}</p>}
            <button className="history-link home-more" onClick={() => nav.season(cur && cur.id)}>{L.hAllStandings} →</button>
          </section>

          <section className="card home-card">
            <div className="home-card-head"><h2 className="profile-section-title">{L.navEloShort}</h2><span className="cal-note">{L.hNationwide}</span></div>
            {eloTop.map((r) => (
              <div key={r.key} className="home-row">
                <span className={`home-rank round ${r.rank === 1 ? "first" : ""}`}>{r.rank}</span>
                <button className="home-row-name" onClick={() => onOpenPlayer(r.key)}>{r.name}{r.club && <span className="cal-note home-club">{r.club}</span>}</button>
                <span className="home-row-value">{r.rating}</span>
              </div>
            ))}
            <button className="history-link home-more" onClick={nav.elo}>{L.hAllRanking} →</button>
          </section>

          <section className="card home-card">
            <h2 className="profile-section-title">{L.hLatest}</h2>
            {recent.length === 0 && <p className="cal-note">{L.loading}</p>}
            {recent.map((t) => (
              <button key={t.id} className="home-result" onClick={() => onOpenTournament(t.id, t.imported)}>
                <strong>{t.name}</strong>
                <span className="cal-note">{t.dateLabel}{t.winner ? <> · {L.hWinner}: <b className="home-winner">{t.winner}</b></> : ""}</span>
              </button>
            ))}
            <button className="history-link home-more" onClick={nav.archive}>{L.hAllTournaments} →</button>
          </section>
        </div>

        <section className="home-elo-box">
          <div>
            <h2 className="profile-section-title" style={{ margin: 0 }}>{L.hEloHow}</h2>
            <p>{L.hEloHowText}</p>
          </div>
          <button className="home-btn accent" onClick={nav.elo}>{L.hLearnMore}</button>
        </section>

        <p className="home-support">{L.supportedBy}</p>
      </div>
    </>
  );
}
