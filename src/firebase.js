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
/* Generic helpers — every call is best-effort: on failure, reads return  */
/* null/[] and writes return false, mirroring the app's previous          */
/* window.storage-based behavior so the calling code needs no changes.    */
/* ---------------------------------------------------------------------- */

async function getDocData(collectionName, id) {
  try {
    const snap = await getDoc(doc(db, collectionName, id));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
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

export async function saveRegistry(data) {
  await setDocData("meta", "registry", data);
}

/* ---------------------------------------------------------------------- */
/* ELO ratings                                                            */
/* ---------------------------------------------------------------------- */

export async function loadElo() {
  const data = await getDocData("meta", "elo");
  return data || { players: {}, initialized: false };
}

export async function saveElo(data) {
  await setDocData("meta", "elo", data);
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

export async function saveFeedItems(items) {
  await setDocData("meta", "rssFeed", { items });
}

/* ---------------------------------------------------------------------- */
/* Tournament archive index                                               */
/* ---------------------------------------------------------------------- */

export async function loadIndex() {
  const data = await getDocData("meta", "tournamentsIndex");
  return data ? data.list : [];
}

export async function saveIndex(list) {
  try {
    await setDoc(doc(db, "meta", "tournamentsIndex"), { list });
  } catch {
    /* archive listing is best-effort */
  }
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

export async function saveSeason(year, data) {
  return await setDocData("seasons", seasonDocId(year), data);
}

export async function listSeasonYears() {
  const ids = await listDocIds("seasons");
  const years = ids.map((id) => parseInt(id, 10)).filter((y) => !isNaN(y));
  return years.sort((a, b) => b - a);
}
