// Δοκιμές των κανόνων Firestore (5A) στον Emulator.
// Εκτέλεση (χρειάζεται firebase-tools και Java):
//   firebase emulators:exec --only firestore "npm run test:rules"
// ή με Emulator που ήδη τρέχει: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
let env;

const PUBLIC_DOCS = [
  ["meta", "registry"],
  ["meta", "elo"],
  ["meta", "rssFeed"],
  ["meta", "tournamentsIndex"],
  ["seasons", "2026"],
  ["tournaments", "t1"],
  ["tournaments", "imp-x"],
  ["tournaments", "sys-state"],
  ["tournaments", "sys-trash"],
  ["tournaments", "sys-imports"],
];
const CLOSED_DOCS = [
  ["private", "contacts"],
  ["meta", "adminPassword"],
  ["meta", "somethingElse"],
  ["other", "doc"],
];

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-bgfed-rules",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [c, id] of [...PUBLIC_DOCS, ...CLOSED_DOCS]) await setDoc(doc(db, c, id), { seed: true });
    await setDoc(doc(db, "users", "u-admin"), { email: "admin@example.com", role: "admin" });
    await setDoc(doc(db, "users", "u-unverified"), { email: "late@example.com", role: "admin" });
    await setDoc(doc(db, "users", "u-other"), { email: "other@example.com", role: "viewer" });
  });
});

after(async () => {
  await env.cleanup();
});

const personas = () => ({
  visitor: env.unauthenticatedContext().firestore(),
  signedInNotAdmin: env.authenticatedContext("u-none", { email: "none@example.com", email_verified: true }).firestore(),
  adminUnverified: env.authenticatedContext("u-unverified", { email: "late@example.com", email_verified: false }).firestore(),
  admin: env.authenticatedContext("u-admin", { email: "admin@example.com", email_verified: true }).firestore(),
});

for (const who of ["visitor", "signedInNotAdmin", "adminUnverified"]) {
  test(`${who}: διαβάζει όλα τα δημόσια, δεν γράφει πουθενά, δεν διαβάζει ιδιωτικά`, async () => {
    const db = personas()[who];
    for (const [c, id] of PUBLIC_DOCS) await assertSucceeds(getDoc(doc(db, c, id)));
    await assertSucceeds(getDocs(collection(db, "seasons")));
    for (const [c, id] of CLOSED_DOCS) await assertFails(getDoc(doc(db, c, id)));
    for (const [c, id] of [...PUBLIC_DOCS, ...CLOSED_DOCS]) {
      await assertFails(setDoc(doc(db, c, id), { x: 1 }));
      await assertFails(deleteDoc(doc(db, c, id)));
    }
    await assertFails(setDoc(doc(db, "users", "u-none"), { role: "admin" }));
    await assertFails(getDoc(doc(db, "users", "u-admin")));
  });
}

test("signedInNotAdmin: διαβάζει μόνο το δικό του users/{uid}", async () => {
  const db = env.authenticatedContext("u-other", { email: "other@example.com", email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(db, "users", "u-other")));
  await assertFails(getDoc(doc(db, "users", "u-admin")));
  await assertFails(setDoc(doc(db, "users", "u-other"), { role: "admin" }));
  await assertFails(getDocs(collection(db, "users")));
});

test("visitor: δεν διαβάζει κανένα users/{uid}", async () => {
  await assertFails(getDoc(doc(personas().visitor, "users", "u-admin")));
});

test("admin (επιβεβαιωμένο email): όλα εκτός από users και meta/adminPassword", async () => {
  const db = personas().admin;
  for (const [c, id] of PUBLIC_DOCS) {
    await assertSucceeds(getDoc(doc(db, c, id)));
    await assertSucceeds(setDoc(doc(db, c, id), { x: 1 }));
  }
  await assertSucceeds(deleteDoc(doc(db, "tournaments", "t1")));
  await assertSucceeds(getDoc(doc(db, "private", "contacts")));
  await assertSucceeds(setDoc(doc(db, "private", "contacts"), { version: 1, players: {} }));
  await assertSucceeds(getDoc(doc(db, "users", "u-admin")));
  await assertFails(setDoc(doc(db, "users", "u-admin"), { role: "admin" }));
  await assertFails(setDoc(doc(db, "users", "u-new"), { role: "admin" }));
  await assertFails(getDoc(doc(db, "users", "u-other")));
  await assertFails(getDoc(doc(db, "meta", "adminPassword")));
  await assertFails(setDoc(doc(db, "meta", "adminPassword"), { password: "x" }));
  await assertFails(getDoc(doc(db, "meta", "somethingElse")));
  await assertFails(setDoc(doc(db, "other", "doc"), { x: 1 }));
});
