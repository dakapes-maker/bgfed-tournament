export function ConsistencyReportView({ report, onClose }) {
  const cap = (arr, fmt) => {
    const shown = arr.slice(0, 12).map(fmt);
    return arr.length > 12 ? [...shown, `…και ${arr.length - 12} ακόμα`] : shown;
  };
  const findings = [];
  if (report.trackingMissing) findings.push({ level: "info", title: "Χρειάζεται ένα Recompute για να ξεκινήσει η καταγραφή προέλευσης", items: ["Δεν είναι σφάλμα."] });
  if (report.unknownKeys.length) findings.push({ level: "warn", title: "Ονόματα στο ELO / Βαθμολογία χωρίς πρόσωπο στο μητρώο", items: cap(report.unknownKeys, (x) => x.name) });
  if (report.nameStale.length) findings.push({ level: "warn", title: "Όνομα στο ELO / Βαθμολογία διαφορετικό από το μητρώο (θα διορθωθεί με Recompute)", items: cap(report.nameStale, (x) => `${x.from} → ${x.to}`) });
  const eloUnofficial = report.eloExtra.filter((x) => x.reason === "unofficial");
  const eloGone = report.eloExtra.filter((x) => x.reason === "missing");
  if (eloUnofficial.length) findings.push({ level: "warn", title: "Το ELO περιλαμβάνει δοκιμαστικά ή εκτός Premier League τουρνουά", items: cap(eloUnofficial, (x) => x.name) });
  if (eloGone.length) findings.push({ level: "warn", title: "Το ELO περιλαμβάνει τουρνουά που δεν υπάρχουν πια στον κατάλογο", items: cap(eloGone, (x) => x.name) });
  if (report.eloMissing.length) findings.push({ level: "warn", title: "Επίσημα τουρνουά που δεν έχουν περαστεί στο ELO", items: cap(report.eloMissing, (x) => x.name) });
  const seasonUnofficial = report.seasonExtra.filter((x) => x.reason === "unofficial");
  const seasonGone = report.seasonExtra.filter((x) => x.reason === "missing");
  if (seasonUnofficial.length) findings.push({ level: "warn", title: "Η Βαθμολογία περιλαμβάνει δοκιμαστικά ή εκτός Premier League τουρνουά", items: cap(seasonUnofficial, (x) => x.name) });
  if (seasonGone.length) findings.push({ level: "warn", title: "Η Βαθμολογία περιλαμβάνει τουρνουά που δεν υπάρχουν πια", items: cap(seasonGone, (x) => x.name) });
  if (report.seasonMissing.length) findings.push({ level: "warn", title: "Επίσημα τουρνουά που δεν έχουν περαστεί στη Βαθμολογία", items: cap(report.seasonMissing, (x) => x.name) });
  if (report.eloOnly.length) findings.push({ level: "warn", title: "Παίκτες στο ELO που δεν υπάρχουν στη Βαθμολογία", items: cap(report.eloOnly, (x) => `${x.name} (${x.games} αγώνες)`) });
  if (report.winsMismatch.length) findings.push({ level: "warn", title: "Παίκτες με διαφορετικές νίκες σε ELO και Βαθμολογία", items: cap(report.winsMismatch, (x) => `${x.name}: ELO ${x.elo} · Βαθμολογία ${x.season}`) });
  if (report.seasonOnly.length) findings.push({ level: "info", title: "Παίκτες στη Βαθμολογία χωρίς ELO (π.χ. μόνο bye ή Α.Α.)", items: cap(report.seasonOnly, (x) => x.name) });
  if ((report.seasonWrongYear || []).length) findings.push({ level: "warn", title: "Τουρνουά καταχωρημένα σε λάθος σεζόν (διορθώνεται με Recompute)", items: cap(report.seasonWrongYear, (x) => `${x.name}: στη σεζόν ${x.found.join(", ")}, ανήκει στη ${x.expected}`) });
  if ((report.dateSeasonMismatch || []).length) findings.push({ level: "warn", title: "Η σεζόν του τουρνουά δεν ταιριάζει με την ημερομηνία του (διορθώνεται από το tab «Στοιχεία», όχι με Recompute)", items: cap(report.dateSeasonMismatch, (x) => `${x.name}: σεζόν ${x.seasonYear}, η ημερομηνία ανήκει στη ${x.expected}`) });
  if (report.lookalikes.length) findings.push({ level: "warn", title: "Πιθανό ίδιο πρόσωπο με δύο γραφές (δεν διορθώνεται με Recompute)", items: cap(report.lookalikes, (g) => g.join("  ↔  ")) });
  const warns = findings.filter((f) => f.level === "warn").length;

  return (
    <div className="card" style={{ marginBottom: 20, padding: "14px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <strong>Έλεγχος συνέπειας</strong>
        <button className="btn-ghost" onClick={onClose}>Κλείσιμο</button>
      </div>
      {warns === 0 ? (
        <p style={{ margin: 0, color: "var(--win)" }}>✓ Το ELO και η Βαθμολογία ταιριάζουν με τα τουρνουά του καταλόγου.</p>
      ) : (
        <p style={{ margin: "0 0 8px 0" }}>⚠ {warns} {warns === 1 ? "εύρημα" : "ευρήματα"}. Τα περισσότερα διορθώνονται με Recompute· η διπλή γραφή ονόματος λύνεται με τα μόνιμα ID (επόμενο build).</p>
      )}
      {findings.map((f, i) => (
        <div key={i} style={{ margin: "10px 0 0 0" }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{f.level === "warn" ? "⚠ " : "ℹ "}{f.title}</div>
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, fontSize: 13, color: "var(--muted)" }}>
            {f.items.map((it, k) => <li key={k}>{it}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
