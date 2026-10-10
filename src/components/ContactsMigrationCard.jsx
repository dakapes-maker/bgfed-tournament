/** Διαχείριση → Παίκτες: «Μεταφορά στοιχείων επικοινωνίας» (5A). Preview,
 * then the move; needs an Export All Data of the last 24 hours. */
export function ContactsMigrationCard({ moved, preview, busy, exportFresh, onPreview, onApply, onCancel }) {
  return (
    <div className="control-sub-card">
      <strong>Στοιχεία επικοινωνίας</strong>
      {moved ? (
        <p style={{ margin: "6px 0 0 0", fontSize: 13, color: "var(--muted)" }}>
          ✓ Ιδιωτικά: email, τηλέφωνα, συνδρομές και εκπτώσεις βρίσκονται σε ιδιωτικό έγγραφο που διαβάζουν μόνο οι διαχειριστές.
        </p>
      ) : (
        <>
          <p style={{ margin: "6px 0 10px 0", fontSize: 13, color: "var(--muted)" }}>
            Σήμερα τα email, τα τηλέφωνα, οι συνδρομές και οι εκπτώσεις είναι μέσα στο δημόσιο μητρώο. Η μεταφορά τα βάζει σε ιδιωτικό έγγραφο
            (μόνο για διαχειριστές), επαληθεύει ότι γράφτηκαν σωστά, και μόνο τότε τα αφαιρεί από το δημόσιο μητρώο.
          </p>
          {!preview ? (
            <button className="btn-secondary" onClick={onPreview} disabled={busy}>
              Προεπισκόπηση μεταφοράς (δεν αλλάζει τίποτα)
            </button>
          ) : (
            <>
              <ul style={{ margin: "0 0 10px 0", paddingLeft: 20, fontSize: 14 }}>
                <li>Παίκτες: <strong>{preview.players}</strong></li>
                <li>Με email: <strong>{preview.withEmail}</strong></li>
                <li>Με τηλέφωνο: <strong>{preview.withPhone}</strong></li>
                <li>Με συνδρομές: <strong>{preview.withMembership}</strong></li>
                <li>Με έκπτωση: <strong>{preview.withDiscount}</strong></li>
              </ul>
              {!exportFresh && <p className="field-warning">Χρειάζεται πρώτα Export All Data (των τελευταίων 24 ωρών).</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn-secondary" onClick={onCancel} disabled={busy}>Άκυρο</button>
                <button className="btn-primary" onClick={onApply} disabled={busy || !exportFresh}>
                  {busy ? "Μεταφορά…" : "Μεταφορά στοιχείων επικοινωνίας"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
