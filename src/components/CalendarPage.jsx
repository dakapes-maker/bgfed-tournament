import React, { useMemo, useState } from "react";
import { buildCalendarView, calendarEntryTitle, todayYMD } from "../lib/calendar.js";
import { competitionsFrom } from "../lib/competitions.js";
import { clubsFrom, clubDisplay, clubColor } from "../lib/clubs.js";
import { seasonCompetitionId, seasonName } from "../lib/seasonRegistry.js";

/* Σ3: public calendar — every competition's upcoming (and, on request, past)
 * match days, from the season calendars already in the system document, so
 * it costs no database read. Grouped by month; each club has its colour. */

const MONTHS = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];
const WEEKDAYS = ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"];

export function CalendarPage({ sys, archive, onOpenTournament }) {
  const [clubFilter, setClubFilter] = useState([]); // empty = all clubs
  const [compFilter, setCompFilter] = useState("all");
  const [showPast, setShowPast] = useState(false);
  const comps = competitionsFrom(sys);

  const items = useMemo(() => {
    const out = [];
    Object.keys(sys?.seasonCalendars || {}).forEach((sid) => {
      const seasonId = Number(sid);
      if (!Number.isInteger(seasonId)) return;
      buildCalendarView(sys, seasonId, archive || []).forEach((e) => {
        const compId = e.competitionId || seasonCompetitionId(sys, seasonId);
        const comp = comps.find((c) => c.id === compId);
        out.push({
          ...e,
          seasonId,
          compId,
          compName: comp ? comp.name : compId,
          clubId: comp ? comp.ownerClubId : null,
          title: calendarEntryTitle(e, seasonId, comps, sys),
          seasonLabel: seasonName(sys, seasonId),
        });
      });
    });
    return out.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  }, [sys, archive, comps]);

  const today = todayYMD();
  const clubsInUse = clubsFrom(sys).filter((c) => items.some((i) => i.clubId === c.id));
  const compsInUse = comps.filter((c) => items.some((i) => i.compId === c.id));
  const visible = items.filter(
    (i) =>
      (showPast || i.effectiveDate >= today || i.status === "live") &&
      (clubFilter.length === 0 || clubFilter.includes(i.clubId)) &&
      (compFilter === "all" || i.compId === compFilter)
  );

  const groups = [];
  visible.forEach((i) => {
    const key = (i.effectiveDate || "").slice(0, 7);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push(i);
  });

  const toggleClub = (id) => setClubFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  return (
    <div className="calendar-page">
      <div className="card" style={{ padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)", marginRight: 4 }}>Σύλλογος:</span>
          {clubsInUse.map((c) => {
            const on = clubFilter.length === 0 || clubFilter.includes(c.id);
            const col = clubColor(sys, c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleClub(c.id)}
                style={{ border: `1.5px solid ${col}`, background: clubFilter.includes(c.id) ? col : "transparent", color: clubFilter.includes(c.id) ? "#fff" : col, opacity: on ? 1 : 0.45, borderRadius: 999, padding: "3px 11px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {c.name}
              </button>
            );
          })}
          {clubFilter.length > 0 && (
            <button className="btn-ghost" style={{ fontSize: 13, padding: "2px 6px" }} onClick={() => setClubFilter([])}>όλοι</button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginTop: 10 }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
            Διοργάνωση:
            <select value={compFilter} onChange={(e) => setCompFilter(e.target.value)} style={{ fontSize: 14, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}>
              <option value="all">Όλες</option>
              {compsInUse.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> και παλαιότερες
          </label>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="empty-state">Δεν υπάρχουν {showPast ? "" : "επερχόμενες "}αγωνιστικές για τα φίλτρα που επέλεξες.</div>
      )}

      {groups.map((g) => {
        const [y, m] = g.key.split("-").map(Number);
        return (
          <section key={g.key} style={{ marginBottom: 22 }}>
            <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--accent)", borderBottom: "2px solid var(--accent)", paddingBottom: 4, margin: "0 0 8px 0" }}>
              {MONTHS[m - 1]} {y}
            </h3>
            {g.rows.map((i) => {
              const [yy, mm, dd] = i.effectiveDate.split("-").map(Number);
              const wd = WEEKDAYS[new Date(yy, mm - 1, dd).getDay()];
              const col = clubColor(sys, i.clubId);
              const past = i.status === "done" || i.status === "missed";
              const canOpen = !!i.tournament && (i.status === "done" || i.status === "live");
              return (
                <div
                  key={`${i.seasonId}-${i.id}`}
                  onClick={canOpen ? () => onOpenTournament(i.tournament.id) : undefined}
                  style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 10px", margin: "4px 0", background: "var(--surface, #fff)", borderRadius: 8, borderLeft: `5px solid ${col}`, opacity: past ? 0.6 : 1, cursor: canOpen ? "pointer" : "default", boxShadow: "0 1px 0 var(--border)" }}
                >
                  <div style={{ width: 44, textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{wd}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{dd}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {i.title}
                      {i.status === "done" && <span style={{ color: "var(--win)", marginLeft: 6 }}>✓</span>}
                      {i.status === "live" && <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 12, fontWeight: 700 }}>● σε εξέλιξη</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      {i.compName} · σεζόν {i.seasonLabel}
                      {i.note ? ` · ${i.note}` : ""}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: col, border: `1px solid ${col}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                    {clubDisplay(sys, i.clubId, "—")}
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
