// Administrator sign-in (5A) with Firebase Authentication: Google (popup) as
// the main way, email and password as the alternative. The app never sees or
// stores a password; Firebase keeps the session in the browser (default
// persistence). Who is an administrator is decided by users/{uid} (see
// firebase.js) — never by anything in this file.
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  onIdTokenChanged,
  signOut,
} from "firebase/auth";
import { db } from "../firebase.js";

export const auth = getAuth(db.app);
auth.languageCode = "el"; // Firebase's own emails and screens in Greek

/** Calls back with the Firebase user (or null) on sign-in, sign-out and
 * whenever the ID token is refreshed (e.g. after email verification).
 * Returns the unsubscribe function. */
export function watchAuth(callback) {
  return onIdTokenChanged(auth, callback);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return await signInWithPopup(auth, provider);
}

export async function signInWithEmail(email, password) {
  return await signInWithEmailAndPassword(auth, email.trim(), password);
}

/** Creates the account and sends the verification email right away. */
export async function signUpWithEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(cred.user);
  return cred;
}

export async function resendVerification() {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

/** "Το επιβεβαίωσα": reloads the user and forces a fresh ID token, so both
 * the app and the Firestore rules see email_verified = true. */
export async function refreshVerification() {
  const user = auth.currentUser;
  if (!user) return;
  await user.reload();
  await user.getIdToken(true);
}

export async function signOutUser() {
  await signOut(auth);
}

/** Greek message for a Firebase Authentication error. */
export function authErrorMessage(err) {
  const code = (err && err.code) || "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/invalid-login-credentials":
      return "Λάθος email ή κωδικός.";
    case "auth/user-not-found":
      return "Δεν υπάρχει λογαριασμός με αυτό το email.";
    case "auth/invalid-email":
      return "Το email δεν είναι έγκυρο.";
    case "auth/missing-password":
      return "Γράψε τον κωδικό.";
    case "auth/weak-password":
      return "Ο κωδικός είναι πολύ αδύναμος — χρειάζονται τουλάχιστον 6 χαρακτήρες.";
    // The same email may already have an account made the other way (Google
    // or email); accounts are not linked, so the user signs in that way.
    case "auth/email-already-in-use":
    case "auth/account-exists-with-different-credential":
    case "auth/credential-already-in-use":
      return "Υπάρχει ήδη λογαριασμός με αυτό το email. Συνδέσου με τον τρόπο που χρησιμοποίησες την πρώτη φορά.";
    case "auth/popup-blocked":
      return "Ο browser μπλόκαρε το αναδυόμενο παράθυρο της Google. Επίτρεψέ το για αυτή τη σελίδα ή συνδέσου με email.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Η σύνδεση με Google ακυρώθηκε.";
    case "auth/unauthorized-domain":
      return "Η σύνδεση με Google δεν επιτρέπεται από αυτή τη διεύθυνση. Συνδέσου με email.";
    case "auth/operation-not-allowed":
      return "Αυτός ο τρόπος σύνδεσης δεν είναι ενεργός.";
    case "auth/too-many-requests":
      return "Πάρα πολλές προσπάθειες. Περίμενε λίγο και δοκίμασε ξανά.";
    case "auth/network-request-failed":
      return "Δεν υπάρχει σύνδεση με το διαδίκτυο. Δοκίμασε ξανά.";
    case "auth/user-disabled":
      return "Ο λογαριασμός έχει απενεργοποιηθεί.";
    default:
      return "Η ενέργεια δεν ολοκληρώθηκε. Δοκίμασε ξανά.";
  }
}
