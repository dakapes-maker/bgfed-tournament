import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { can, currentPermissionUser } from "./lib/permissions.js";

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

/** Every write goes through the central permission check first — a defence
 * before the Firestore rules: a write the current user may not make is
 * reported as failed (false) without reaching the database. */
function writeAllowed(collectionName, id) {
  return can(currentPermissionUser(), "write", { collection: collectionName, id });
}

async function setDocData(collectionName, id, data) {
  if (!writeAllowed(collectionName, id)) return false;
  try {
    await setDoc(doc(db, collectionName, id), data);
    return true;
  } catch {
    return false;
  }
}

async function deleteDocData(collectionName, id) {
  if (!writeAllowed(collectionName, id)) return false;
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
/* Administrators (5A): users/{uid} = { email, role: "admin" }, edited only  */
/* in the Firebase console.                                                */
/* ---------------------------------------------------------------------- */

/** Strict: the user's own document in "users", or null when there is none;
 * THROWS when the read failed. */
export async function loadUserDocStrict(uid) {
  return await getDocDataStrict("users", uid);
}

/* ---------------------------------------------------------------------- */
/* Players' private contact details (5A): private/contacts =               */
/* { version: 1, players: { <personId>: { email, phone, membership,        */
/*   hasDiscount, discountAmount, needsInfo } } } — admins only.           */
/* ---------------------------------------------------------------------- */

/** Strict: the contacts document, or null when it does not exist yet;
 * THROWS when the read failed. */
export async function loadContactsStrict() {
  return await getDocDataStrict("private", "contacts");
}

/** Returns true on success, false on failure. */
export async function saveContacts(data) {
  return await setDocData("private", "contacts", data);
}

/* ---------------------------------------------------------------------- */
/* Player registry                                                        */
/* ---------------------------------------------------------------------- */

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

/* 5D: additional ELO rankings (beyond the main one in meta/elo) are stored
 * one document each in eloRankings/{id}; rebuilt only by their Recompute. */
export async function loadRankingElo(id) {
  const data = await getDocData("eloRankings", id);
  return data || { players: {} };
}

export async function saveRankingElo(id, data) {
  return await setDocData("eloRankings", id, data);
}

/* ---------------------------------------------------------------------- */
/* RSS feed items — admin-approved recap summaries, read by the public    */
/* /api/feed serverless function to build an RSS feed for WordPress'      */
/* Feedzy plugin (or any other RSS reader) to pick up automatically.      */
/* ---------------------------------------------------------------------- */

/** Same as loadFeedItems, but throws if the read failed (see getDocDataStrict). */
export async function loadFeedItemsStrict() {
  const data = await getDocDataStrict("meta", "rssFeed");
  return data?.items || [];
}

/** Returns true on success, false on failure. */
export async function saveFeedItems(items) {
  return await setDocData("meta", "rssFeed", { items });
}

/* ---------------------------------------------------------------------- */
/* Tournament archive index                                               */
/* ---------------------------------------------------------------------- */

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

/* Σ2: per-visit cache of tournaments that no longer change — finished
 * tournaments and imported ones. The statistics screens read every tournament;
 * with the cache each one is read from the database once per visit instead of
 * once per screen. Any save or delete of a tournament through this module
 * drops it from the cache; strict reads (Recompute) always go to the database
 * and refresh the cache. */
const TOURNAMENT_CACHE = new Map();
const cacheable = (id, data) => !!data && (data.phase === "finished" || String(id).startsWith("imp-"));

export async function saveTournamentData(id, data) {
  TOURNAMENT_CACHE.delete(id);
  return await setDocData("tournaments", id, data);
}

export async function fetchTournamentData(id) {
  // Copies in and out: callers may change the object they get back.
  if (TOURNAMENT_CACHE.has(id)) return structuredClone(TOURNAMENT_CACHE.get(id));
  const data = await getDocData("tournaments", id);
  if (cacheable(id, data)) TOURNAMENT_CACHE.set(id, structuredClone(data));
  return data;
}

/** Same as fetchTournamentData, but throws if the read failed. Always reads the database. */
export async function fetchTournamentDataStrict(id) {
  const data = await getDocDataStrict("tournaments", id);
  if (cacheable(id, data)) TOURNAMENT_CACHE.set(id, structuredClone(data));
  else TOURNAMENT_CACHE.delete(id);
  return data;
}

export async function deleteTournamentData(id) {
  TOURNAMENT_CACHE.delete(id);
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

/** Listens to a season's standings (2026-10-19, live Standings page):
 * onData(season) on every change, onError() if the listener fails (the
 * caller then falls back to a single read). Returns the unsubscribe. */
export function watchSeason(year, onData, onError) {
  return onSnapshot(
    doc(db, "seasons", seasonDocId(year)),
    (snap) => onData(snap.exists() ? { players: {}, ...snap.data() } : { players: {} }),
    () => onError()
  );
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
