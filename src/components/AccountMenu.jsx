import { useState } from "react";
import { LogOut, Copy, Check } from "lucide-react";

/** Signed-in user in the top bar: email and «Αποσύνδεση». */
export function AccountMenu({ email, onSignOut }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={email}>
        {email}
      </span>
      <button className="btn-ghost" onClick={onSignOut} title="Αποσύνδεση">
        <LogOut size={14} /> Αποσύνδεση
      </button>
    </span>
  );
}

/** Notice under the top bar for a signed-in user who is not (yet) an
 * administrator: email not verified, no rights (with the id to send to the
 * administrator), or rights that could not be checked. */
export function AccountNotice({ state, uid, onResend, onRefresh }) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (state === "unverified") {
    return (
      <div className="notice" style={{ margin: "12px 24px", flexWrap: "wrap", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 220 }}>Επιβεβαίωσε το email σου από τον σύνδεσμο που σου στείλαμε.{sent ? " Στάλθηκε ξανά." : ""}</span>
        <button className="btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await onResend(); setSent(true); } finally { setBusy(false); } }}>
          Αποστολή ξανά
        </button>
        <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}>
          Το επιβεβαίωσα
        </button>
      </div>
    );
  }
  if (state === "none") {
    return (
      <div className="notice" style={{ margin: "12px 24px", flexWrap: "wrap", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 220 }}>
          Δεν έχετε δικαιώματα διαχειριστή. Στείλτε αυτό το αναγνωριστικό στον διαχειριστή της εφαρμογής:{" "}
          <code style={{ userSelect: "all", fontWeight: 700 }} data-testid="account-uid">{uid}</code>
        </span>
        <button
          className="btn-secondary"
          onClick={() => {
            try {
              navigator.clipboard.writeText(uid).then(() => setCopied(true), () => {});
            } catch {
              /* copying is a convenience; the id stays selectable */
            }
          }}
        >
          {copied ? <><Check size={14} /> Αντιγράφηκε</> : <><Copy size={14} /> Αντιγραφή</>}
        </button>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="notice" style={{ margin: "12px 24px", flexWrap: "wrap", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 220 }}>Δεν ήταν δυνατός ο έλεγχος των δικαιωμάτων σας. Ελέγξτε τη σύνδεση και ανανεώστε τη σελίδα.</span>
      </div>
    );
  }
  return null;
}
