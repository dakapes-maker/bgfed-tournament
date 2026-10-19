/* Match lists (bgfed-matchlist/1): preview of the import, table of all the
 * matches (Διαχείριση → Εισαγωγές) and the player's matches (player card). */

const fmtYmd = (d) => {
  if (!d) return "—";
  const [y, m, dd] = String(d).split("-");
  return `${Number(dd)}/${Number(m)}/${y}`;
};

/** Every match of a list, in file order. nameOf(sourceName) → node. */
export function MatchlistTable({ matches, nameOf }) {
  return (
    <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto", marginTop: 8 }}>
      <table className="cal-table" data-testid="matchlist-table">
        <thead>
          <tr><th>#</th><th>Ημερομηνία</th><th>Αγώνας</th><th>Σκορ</th><th>Φάση</th><th>Σημείωση</th></tr>
        </thead>
        <tbody>
          {(matches || []).map((m, i) => {
            const wo = m.method === "walkover";
            return (
              <tr key={m.id ?? i} style={wo ? { color: "var(--muted)" } : undefined}>
                <td className="cal-note">{m.id}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {fmtYmd(m.date)}{m.time ? ` ${m.time}` : ""}
                  {m.dateAssumed && <span className="cal-note" title="Η ημερομηνία είναι εκτίμηση"> (εκτίμηση)</span>}
                </td>
                <td>
                  <strong>{nameOf(m.winner)}</strong> – {nameOf(m.winner === m.p1 ? m.p2 : m.p1)}
                  {wo && <span className="cal-note"> · χωρίς αγώνα (δεν μετράει)</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{m.score1 != null && m.score2 != null ? `${m.score1}–${m.score2}` : "—"}{m.matchLength ? <span className="cal-note"> /{m.matchLength}</span> : null}</td>
                <td className="cal-note">{m.label || ""}</td>
                <td className="cal-note">{m.note || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Preview of a match list before the import: competition (required), no
 * season — a match list has no standings. */
export function MatchlistPreview({ preview, competitions, target, onTarget, busy, onCancel, onConfirm }) {
  const { doc, problems, summary, replaceId, matching, fileName } = preview;
  const ready = !!target.competitionId && problems.length === 0;
  const sel = { width: "100%", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface, #fff)" };
  return (
    <div className="control-sub-card" data-testid="matchlist-preview">
      <strong>Προεπισκόπηση λίστας αγώνων: {doc?.name || fileName}</strong>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px 0" }}>
        Μόνο οι αγώνες, ο καθένας με τη δική του ημερομηνία: μετράνε στην ELO (κατατάξεις που περιέχουν τη διοργάνωση) και στα στατιστικά των παικτών — όχι σε Βαθμολογία, λίστα τουρνουά ή τίτλους.
        {matching ? " Με αποφάσεις αντιστοίχισης παικτών (θα ανοίξουν για έλεγχο μετά την εισαγωγή)." : ""}
      </p>
      {summary && (
        <dl className="details-list">
          <dt>Πηγή</dt><dd>{[doc.organiser, doc.sourceName].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Περίοδος</dt><dd>{fmtYmd(summary.dateFrom)} – {fmtYmd(summary.dateTo)}</dd>
          <dt>Παίκτες</dt><dd>{summary.players}</dd>
          <dt>Αγώνες</dt><dd>{summary.counted} μετράνε · {summary.walkovers} χωρίς αγώνα (δεν μετράνε)</dd>
          {summary.dateAssumed > 0 && (<><dt>Εκτιμώμενη ημερομηνία</dt><dd>{summary.dateAssumed} {summary.dateAssumed === 1 ? "εγγραφή" : "εγγραφές"}</dd></>)}
        </dl>
      )}
      {replaceId && <p className="field-warning">Θα αντικαταστήσει την υπάρχουσα λίστα με το ίδιο αναγνωριστικό ({doc.sourceId})· η αντιστοίχιση παικτών θα ξαναγίνει.</p>}
      <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 260 }}>
          <label>Διοργάνωση</label>
          <select value={target.competitionId} onChange={(e) => onTarget({ competitionId: e.target.value, seasonYear: "" })} style={sel}>
            <option value="">— επίλεξε —</option>
            {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <span className="cal-note" style={{ paddingBottom: 10 }}>Σεζόν δεν χρειάζεται (χωρίς βαθμολογία).</span>
      </div>
      {problems.length > 0 && (
        <div className="field-warning">
          ⚠ {problems.length === 1 ? "1 πρόβλημα" : `${problems.length} προβλήματα`} — η λίστα δεν μπορεί να εισαχθεί:
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>{problems.slice(0, 30).map((p, i) => <li key={i}>{p}</li>)}</ul>
          {problems.length > 30 && <div className="cal-note">… και άλλα {problems.length - 30}.</div>}
        </div>
      )}
      {summary && problems.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--win)", margin: "8px 0 0 0" }}>
          ✓ 0 προβλήματα: όλοι οι παίκτες είναι στη λίστα, ο νικητής είναι ένας από τους δύο, κάθε αγώνας που μετράει έχει ημερομηνία, τα id είναι μοναδικά.
        </p>
      )}
      {doc && Array.isArray(doc.matches) && doc.matches.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Όλοι οι αγώνες ({doc.matches.length}) — για έλεγχο</summary>
          <MatchlistTable matches={doc.matches} nameOf={(n) => n} />
        </details>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Άκυρο</button>
        <button className="btn-primary" onClick={onConfirm} disabled={busy || !ready}>
          {busy ? "Αποθήκευση…" : "Εισαγωγή"}
        </button>
        {!busy && !target.competitionId && <span className="cal-note">Επίλεξε διοργάνωση.</span>}
      </div>
    </div>
  );
}

/** Player card: the player's matches in the match lists, a section per list.
 * groups: playerMatchlistGroups(); nameOf(key, sourceName) → node. */
export function PlayerMatchlists({ groups, nameOf, competitionLabel }) {
  if (!groups || groups.length === 0) return null;
  return (
    <>
      {groups.map((g) => {
        const counted = g.rows.filter((r) => !r.walkover);
        const wins = counted.filter((r) => r.result === "win").length;
        return (
          <details key={g.id} className="ledger" style={{ marginTop: 14 }} data-testid="player-matchlist">
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              Αγώνες: {g.name} <span className="cal-note">({counted.length} αγώνες, {wins} νίκες{g.rows.length > counted.length ? ` · ${g.rows.length - counted.length} χωρίς αγώνα` : ""}{competitionLabel ? ` · ${competitionLabel(g.competitionId)}` : ""})</span>
            </summary>
            <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
              <table className="cal-table">
                <thead><tr><th>Ημερομηνία</th><th>Αντίπαλος</th><th>Αποτ.</th><th>Φάση</th></tr></thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={i} style={r.walkover ? { color: "var(--muted)" } : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtYmd(r.date)}</td>
                      <td>{nameOf(r.oppKey, r.oppName)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {r.walkover ? (r.result === "win" ? "Νίκη χωρίς αγώνα" : "Ήττα χωρίς αγώνα") : r.result === "win" ? "Νίκη" : "Ήττα"}
                        {!r.walkover && r.score ? <span className="cal-note"> {r.score}</span> : null}
                      </td>
                      <td className="cal-note">{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cal-note" style={{ margin: "6px 0 0 0" }}>Οι αγώνες «χωρίς αγώνα» καταγράφονται αλλά δεν μετράνε πουθενά.</p>
          </details>
        );
      })}
    </>
  );
}
