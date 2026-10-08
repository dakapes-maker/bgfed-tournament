import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
} from "firebase/firestore";

/* ---------------------------------------------------------------------- */
/* Firebase project config — from the Federation's own Firebase project.  */
/* This is a public identifier, not a secret; access is controlled by     */
/* Firestore security rules, not by hiding this value.                    */
/* ---------------------------------------------------------------------- */

const firebaseConfig = {
  apiKey: "AIzaSyBeaW3Ns7VbMH59PeuUinGBT1iypTbzzDw",
  authDomain: "bgfed-tournament-application.firebaseapp.com",
  projectId: "bgfed-tournament-application",
  storageBucket: "bgfed-tournament-application.firebasestorage.app",
  messagingSenderId: "153732165436",
  appId: "1:153732165436:web:5f92921160fff65097f839",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/* ---------------------------------------------------------------------- */
/* Generic helpers — on failure, reads return null/[] and EVERY write     */
/* returns false (true on success), so the caller can tell the admin.    */
/* The *Strict loaders throw instead, for start-up (see below).          */
/* ---------------------------------------------------------------------- */

async function getDocData(collectionName, id) {
  try {
    const snap = await getDoc(doc(db, collectionName, id));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

/** Strict read: returns the data, or null when the document truly does not
 * exist, but THROWS when the read itself failed (offline, timeout, rules).
 * Used at start-up, where "could not read" must never be mistaken for
 * "nothing stored yet" — otherwise the app would re-seed or re-initialise
 * and overwrite real data. */
async function getDocDataStrict(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? snap.data() : null;
}

async function setDocData(collectionName, id, data) {
  try {
    await setDoc(doc(db, collectionName, id), data);
    return true;
  } catch {
    return false;
  }
}

async function deleteDocData(collectionName, id) {
  try {
    await deleteDoc(doc(db, collectionName, id));
    return true;
  } catch {
    return false;
  }
}

async function listDocIds(collectionName) {
  try {
    const snap = await getDocs(collection(db, collectionName));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------- */
/* Admin password                                                         */
/* ---------------------------------------------------------------------- */

const DEFAULT_ADMIN_PASSWORD = "OEB2026"; // placeholder — change it via "Change password" once live

export async function loadAdminPassword() {
  const data = await getDocData("meta", "adminPassword");
  return data ? data.password : DEFAULT_ADMIN_PASSWORD;
}

export async function saveAdminPassword(password) {
  return await setDocData("meta", "adminPassword", { password });
}

/* ---------------------------------------------------------------------- */
/* Player registry                                                        */
/* ---------------------------------------------------------------------- */

export async function loadRegistry() {
  const data = await getDocData("meta", "registry");
  return data || { players: {} };
}

/** Same as loadRegistry, but throws if the read failed (see getDocDataStrict). */
export async function loadRegistryStrict() {
  const data = await getDocDataStrict("meta", "registry");
  return data || { players: {} };
}

/** Returns true on success, false on failure. */
export async function saveRegistry(data) {
  return await setDocData("meta", "registry", data);
}

/* ---------------------------------------------------------------------- */
/* ELO ratings                                                            */
/* ---------------------------------------------------------------------- */

export async function loadElo() {
  const data = await getDocData("meta", "elo");
  return data || { players: {}, initialized: false };
}

/** Same as loadElo, but throws if the read failed (see getDocDataStrict). */
export async function loadEloStrict() {
  const data = await getDocDataStrict("meta", "elo");
  return data || { players: {}, initialized: false };
}

/** Returns true on success, false on failure. */
export async function saveElo(data) {
  return await setDocData("meta", "elo", data);
}

/* ---------------------------------------------------------------------- */
/* RSS feed items — admin-approved recap summaries, read by the public    */
/* /api/feed serverless function to build an RSS feed for WordPress'      */
/* Feedzy plugin (or any other RSS reader) to pick up automatically.      */
/* ---------------------------------------------------------------------- */

export async function loadFeedItems() {
  const data = await getDocData("meta", "rssFeed");
  return data?.items || [];
}

/** Returns true on success, false on failure. */
export async function saveFeedItems(items) {
  return await setDocData("meta", "rssFeed", { items });
}

/* ---------------------------------------------------------------------- */
/* Tournament archive index                                               */
/* ---------------------------------------------------------------------- */

export async function loadIndex() {
  const data = await getDocData("meta", "tournamentsIndex");
  return data ? data.list : [];
}

/** Same as loadIndex, but throws if the read failed (see getDocDataStrict). */
export async function loadIndexStrict() {
  const data = await getDocDataStrict("meta", "tournamentsIndex");
  return data ? data.list : [];
}

/** Returns true on success, false on failure. */
export async function saveIndex(list) {
  return await setDocData("meta", "tournamentsIndex", { list });
}

/* ---------------------------------------------------------------------- */
/* Individual tournament data                                             */
/* ---------------------------------------------------------------------- */

export async function saveTournamentData(id, data) {
  return await setDocData("tournaments", id, data);
}

export async function fetchTournamentData(id) {
  return await getDocData("tournaments", id);
}

/** Same as fetchTournamentData, but throws if the read failed. */
export async function fetchTournamentDataStrict(id) {
  return await getDocDataStrict("tournaments", id);
}

export async function deleteTournamentData(id) {
  return await deleteDocData("tournaments", id);
}

/* ---------------------------------------------------------------------- */
/* Season standings                                                       */
/* ---------------------------------------------------------------------- */

function seasonDocId(year) {
  return String(year);
}

export async function loadSeason(year) {
  const data = await getDocData("seasons", seasonDocId(year));
  return data || { players: {} };
}

/** Same as loadSeason, but throws if the read failed (see getDocDataStrict). */
export async function loadSeasonStrict(year) {
  const data = await getDocDataStrict("seasons", seasonDocId(year));
  return data || { players: {} };
}

export async function saveSeason(year, data) {
  return await setDocData("seasons", seasonDocId(year), data);
}

export async function listSeasonYears() {
  const ids = await listDocIds("seasons");
  const years = ids.map((id) => parseInt(id, 10)).filter((y) => !isNaN(y));
  return years.sort((a, b) => b - a);
}

/** Same as listSeasonYears, but throws if the listing failed. */
export async function listSeasonYearsStrict() {
  const snap = await getDocs(collection(db, "seasons"));
  const years = snap.docs.map((d) => parseInt(d.id, 10)).filter((y) => !isNaN(y));
  return years.sort((a, b) => b - a);
}
