import { useState } from "react";
import { X } from "lucide-react";
import { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, authErrorMessage } from "../lib/auth.js";

/** Administrator sign-in (5A): Google first, email and password as the
 * alternative (sign in, new account, forgotten password). */
export function LoginDialog({ onClose }) {
  const [mode, setMode] = useState("choose"); // choose | email
  const [tab, setTab] = useState("signin"); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const google = () => run(async () => {
    await signInWithGoogle();
    onClose();
  });

  function submit() {
    if (tab === "signin") {
      run(async () => {
        await signInWithEmail(email, password);
        onClose();
      });
    } else if (tab === "signup") {
      if (password !== password2) {
        setError("Οι δύο κωδικοί δεν είναι ίδιοι.");
        return;
      }
      run(async () => {
        await signUpWithEmail(email, password);
        onClose();
      });
    } else {
      run(async () => {
        await sendPasswordReset(email);
        setInfo("Αν υπάρχει λογαριασμός με αυτό το email, θα λάβεις σύνδεσμο για νέο κωδικό.");
      });
    }
  }

  const tabBtn = (id, label) => (
    <button
      type="button"
      className={`tab ${tab === id ? "active" : ""}`}
      onClick={() => { setTab(id); setError(""); setInfo(""); }}
    >
      {label}
    </button>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Σύνδεση διαχειριστή</p>
          <button className="btn-ghost" onClick={onClose} title="Κλείσιμο"><X size={15} /></button>
        </div>
        {mode === "choose" ? (
          <>
            <button className="btn-primary" style={{ width: "100%", marginBottom: 10 }} disabled={busy} onClick={google}>
              Σύνδεση με Google
            </button>
            <button className="btn-secondary" style={{ width: "100%" }} disabled={busy} onClick={() => { setMode("email"); setError(""); }}>
              Σύνδεση με email
            </button>
          </>
        ) : (
          <>
            <div className="tabs" style={{ marginBottom: 12 }}>
              {tabBtn("signin", "Σύνδεση")}
              {tabBtn("signup", "Νέος λογαριασμός")}
              {tabBtn("reset", "Ξέχασα τον κωδικό")}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <label>Email</label>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 10 }} autoFocus />
              {tab !== "reset" && (
                <>
                  <label>Κωδικός</label>
                  <input
                    type="password"
                    autoComplete={tab === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ marginBottom: 10 }}
                  />
                </>
              )}
              {tab === "signup" && (
                <>
                  <label>Επανάληψη κωδικού</label>
                  <input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} style={{ marginBottom: 10 }} />
                  <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 10px 0" }}>
                    Μετά την εγγραφή θα λάβεις email επιβεβαίωσης. Δικαιώματα διαχειριστή δίνει ο διαχειριστής της εφαρμογής.
                  </p>
                </>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                <button type="button" className="btn-ghost" onClick={() => { setMode("choose"); setError(""); setInfo(""); }}>← Πίσω</button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {tab === "signin" ? "Σύνδεση" : tab === "signup" ? "Δημιουργία λογαριασμού" : "Αποστολή συνδέσμου"}
                </button>
              </div>
            </form>
          </>
        )}
        {error && <p style={{ color: "var(--accent)", fontSize: 13, margin: "10px 0 0 0" }}>{error}</p>}
        {info && <p style={{ fontSize: 13, margin: "10px 0 0 0" }}>{info}</p>}
      </div>
    </div>
  );
}
