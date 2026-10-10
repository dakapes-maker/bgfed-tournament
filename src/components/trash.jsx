import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";

import { normalizeName } from "../lib/persons.js";
import { formatDate } from "../lib/utils.js";

export function MoveToTrashControl({ confirming, onStart, onCancel, onConfirm, isOfficial, name, playersCount, matchesCount, busy }) {
  const [typed, setTyped] = useState("");
  const [recompute, setRecompute] = useState(true);
  useEffect(() => {
    if (!confirming) setTyped("");
  }, [confirming]);
  const label = name || "Untitled";
  const nameOk = !isOfficial || normalizeName(typed) === normalizeName(label);

  if (!confirming) {
    return (
      <div className="delete-control">
        <button className="btn-ghost" onClick={onStart}>
          <Trash2 size={13} /> Μετακίνηση στον κάδο
        </button>
      </div>
    );
  }
  return (
    <div className="delete-confirm" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <span>
        <strong>Μετακίνηση στον κάδο:</strong> «{label}» ({playersCount} παίκτες, {matchesCount} αγώνες). Δεν διαγράφεται: μένει αποθηκευμένο και μπορεί να επανέλθει από τον Κάδο.
      </span>
      {isOfficial && (
        <>
          <span>
            Είναι <strong>επίσημο</strong> τουρνουά. Θα αφαιρεθεί από τα Στατιστικά και, με το Recompute, από τη Βαθμολογία και το ELO. Για επιβεβαίωση πληκτρολόγησε ακριβώς το όνομά του:
          </span>
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={label} />
        </>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" checked={recompute} onChange={(e) => setRecompute(e.target.checked)} />
        Μετά, Recompute του ELO και της Βαθμολογίας (~20 δευτερόλεπτα)
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>Άκυρο</button>
        <button className="btn-primary" disabled={!nameOk || busy} onClick={() => onConfirm(recompute)}>
          {busy ? "Μετακίνηση…" : "Μετακίνηση στον κάδο"}
        </button>
      </div>
    </div>
  );
}

export function TrashRow({ entry, busy, action, onAction, onRestore, onPurge, onUnofficial }) {
  const [recompute, setRecompute] = useState(true);
  return (
    <div className="card" style={{ marginBottom: 12, padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>
            {entry.name}
            {entry.isOfficial ? (
              <span className="status-chip done" style={{ marginLeft: 8 }}>Επίσημο</span>
            ) : (
              <span className="status-chip test" style={{ marginLeft: 8 }}>Test</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {formatDate(entry.date)} · {entry.status}{entry.deletedAt ? ` · στον κάδο από ${formatDate(entry.deletedAt)}` : ""}
          </div>
        </div>
        {!action && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" disabled={busy} onClick={() => onAction("restore")}>Επαναφορά</button>
            {entry.isOfficial ? (
              <button className="btn-ghost" disabled={busy} onClick={() => onAction("unofficial")}>Σήμανση ως ανεπίσημο</button>
            ) : (
              <button className="btn-ghost" disabled={busy} onClick={() => onAction("purge")}>Οριστική διαγραφή</button>
            )}
          </div>
        )}
      </div>
      {action === "restore" && (
        <div className="delete-confirm" style={{ marginTop: 10, marginBottom: 0, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span>Το τουρνουά θα ξαναμπεί στον κατάλογο.</span>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={recompute} onChange={(e) => setRecompute(e.target.checked)} />
            Μετά, Recompute του ELO και της Βαθμολογίας
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" disabled={busy} onClick={() => onAction(null)}>Άκυρο</button>
            <button className="btn-primary" disabled={busy} onClick={() => onRestore(recompute)}>{busy ? "Επαναφορά…" : "Επαναφορά"}</button>
          </div>
        </div>
      )}
      {action === "unofficial" && (
        <div className="delete-confirm" style={{ marginTop: 10, marginBottom: 0, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span>Ένα επίσημο τουρνουά δεν διαγράφεται οριστικά. Αν το σημειώσεις ως ανεπίσημο, παύει να μετράει στη Βαθμολογία, στο ELO και στα Στατιστικά, και θα μπορείς να το διαγράψεις οριστικά από εδώ. <strong>Η αλλαγή επηρεάζει τα δεδομένα της Ομοσπονδίας.</strong></span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" disabled={busy} onClick={() => onAction(null)}>Άκυρο</button>
            <button className="btn-primary" disabled={busy} onClick={onUnofficial}>Σήμανση ως ανεπίσημο</button>
          </div>
        </div>
      )}
      {action === "purge" && (
        <div className="delete-confirm" style={{ marginTop: 10, marginBottom: 0, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span><strong>Οριστική διαγραφή.</strong> Δεν μπορεί να αναιρεθεί. Αν δεν είσαι σίγουρος/η, κάνε πρώτα Export All Data.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" disabled={busy} onClick={() => onAction(null)}>Άκυρο</button>
            <button className="btn-primary" disabled={busy} onClick={onPurge}>{busy ? "Διαγραφή…" : "Οριστική διαγραφή"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
