// Build 2026-11-09.01 — run: node docs/tests/live-elo-2026-11-09.test.mjs
// Fake database with delays; reproduces the old race and checks the fix.
import { buildConsistencyReport } from "../../src/lib/consistency.js";
import { createSerialWriter } from "../../src/lib/liveSeason.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

console.log("1. Έλεγχος συνέπειας (κανόνας 12 ωρών)");
const now = Date.parse("2026-11-07T18:00:00Z");
function inputs({ status, liveAt, eloWins = 2, seasonWins = 3 }) {
  const index = [{ id: "t14", name: "Ημέρα 14", status, isOfficial: true }];
  const elo = { appliedTournaments: { t14: { name: "Ημέρα 14" } }, players: { a: { name: "A", games: 3, wins: eloWins } } };
  const seasons = { 2026: { players: { a: { name: "A", entries: { t14: { tournamentName: "Ημέρα 14", wins: seasonWins } } } }, live: liveAt ? { t14: liveAt } : undefined } };
  return { elo, seasons, index, display: new Map([["a", "A"]]), now };
}
let r = buildConsistencyReport(inputs({ status: "In progress", liveAt: "2026-11-07T17:55:00Z" }));
ok(!r.needsRecompute && r.liveInProgress.length === 1, "τουρνουά σε εξέλιξη (live πριν 5′): καμία ασυμφωνία, ενημερωτική γραμμή");
r = buildConsistencyReport(inputs({ status: "In progress", liveAt: "2026-11-07T04:00:00Z" }));
ok(r.needsRecompute && r.winsMismatch.length === 1, "ξεχασμένο τουρνουά (live πριν 14 ώρες): η σύγκριση γίνεται κανονικά");
r = buildConsistencyReport(inputs({ status: "Completed", liveAt: "2026-11-07T17:59:00Z" }));
ok(r.needsRecompute && r.winsMismatch.length === 1, "ολοκληρωμένο τουρνουά με ELO πίσω: η ασυμφωνία πιάνεται (πραγματικό λάθος)");
r = buildConsistencyReport(inputs({ status: "Completed", liveAt: "2026-11-07T17:59:00Z", eloWins: 3 }));
ok(!r.needsRecompute, "ολοκληρωμένο τουρνουά με σωστή ELO: καθαρό");

console.log("2. Κλείσιμο τουρνουά: «κούρσα» ELO / ελέγχου (ψεύτικη βάση, εγγραφή ELO 800 ms)");
function makeDb() { return { elo: { rounds: [] } }; }
async function loadElo(db) { await sleep(300); return structuredClone(db.elo); }
async function saveElo(db, e) { await sleep(500); db.elo = e; return true; }
const job = (db, n) => () => loadElo(db).then((e) => { e.rounds.push(n); return saveElo(db, e); });
// Παλιά ροή: η ELO του τελευταίου γύρου ξεκινά στο παρασκήνιο, το τουρνουά «τελειώνει» αμέσως
{ const db = makeDb(); db.elo.rounds = [1, 2, 3, 4];
  job(db, 5)(); // χωρίς αναμονή
  await sleep(50); const seen = structuredClone(db.elo);
  ok(seen.rounds.length === 4, "παλιά ροή: ο έλεγχος αμέσως μετά βλέπει ELO χωρίς τον 5ο γύρο (αναπαραγωγή του προβλήματος)");
  await sleep(1000); }
// Νέα ροή: σειριακή ουρά + αναμονή πριν το «τελείωσε»
{ const db = makeDb(); db.elo.rounds = [1, 2, 3, 4];
  const w = createSerialWriter({ delay: 0 });
  await w.now(job(db, 5));
  const seen = structuredClone(db.elo);
  ok(seen.rounds.join() === "1,2,3,4,5", "νέα ροή: όταν εμφανίζεται «τελείωσε», η ELO έχει ήδη τον 5ο γύρο"); }

console.log("3. Δύο κλεισίματα γύρων σχεδόν ταυτόχρονα (αργή σύνδεση)");
{ const db = makeDb();
  job(db, 1)(); await sleep(100); job(db, 2)(); await sleep(1500);
  ok(db.elo.rounds.join() !== "1,2", `παλιά ροή: χάνεται γύρος — η ELO έχει [${db.elo.rounds}] (αναπαραγωγή του ρίσκου)`); }
{ const db = makeDb(); const w = createSerialWriter({ delay: 0 });
  const a = w.now(job(db, 1)); await sleep(100); const b = w.now(job(db, 2)); await Promise.all([a, b]);
  ok(db.elo.rounds.join() === "1,2", `νέα ροή: και οι δύο γύροι γράφτηκαν [${db.elo.rounds}]`); }
{ const db = makeDb(); const w = createSerialWriter({ delay: 0 });
  const bad = w.now(() => Promise.reject(new Error("δίκτυο")));
  const good = w.now(job(db, 3));
  const [x, y] = await Promise.all([bad, good]);
  ok(x === false && y === true && db.elo.rounds.join() === "3", "μια αποτυχημένη εγγραφή δεν «κολλάει» την ουρά"); }

console.log(`\nΑποτέλεσμα: ${pass} επιτυχίες, ${fail} αποτυχίες`);
process.exit(fail ? 1 : 0);
