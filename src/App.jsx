import React, { useState, useRef, useEffect } from "react";
import {
  Trophy,
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  Download,
  Upload,
  RotateCcw,
  UserX,
  Info,
  Check,
  Dice5,
  Search,
  Eye,
  Pencil,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Users,
  Save,
  Award,
  Lock,
  LogOut,
} from "lucide-react";

import {
  loadAdminPassword,
  saveAdminPassword,
  loadRegistry,
  saveRegistry,
  loadElo,
  saveElo,
  loadIndex,
  saveIndex,
  saveTournamentData,
  fetchTournamentData,
  deleteTournamentData,
  loadSeason,
  saveSeason,
  listSeasonYears,
} from "./firebase.js";

/* ---------------------------------------------------------------------- */
/* Storage helpers                                                        */
/* ---------------------------------------------------------------------- */

const SEASON_BEST_OF = 12; // counts each player's best N results this season

// Tournament finance rules (per player, in euros)
const BUYIN_FULL = 40;
const POT_SHARE_PER_PLAYER = 32; // both tiers contribute the same amount to the prize pool
const FEDERATION_SHARE_PER_PLAYER = 6; // waived for board members
const VENUE_SHARE_PER_PLAYER = 2; // waived for board members
const RUNNER_UP_PRIZE = 60; // fixed payout per player one win short of a perfect score
const CUP_COST = 15; // deducted from a perfect-score winner's cash prize if they choose a cup

function computeTournamentFinance(players, totalRounds) {
  const active = players; // withdrawn players still paid to enter; finance is per entrant
  const totalPlayers = active.length;
  const discounted = active.filter((p) => p.hasDiscount);
  const regular = active.filter((p) => !p.hasDiscount);
  const discountedTotal = discounted.reduce((s, p) => s + (p.discountAmount ?? 32), 0);
  const totalCollected = discountedTotal + regular.length * BUYIN_FULL;
  const federationTotal = regular.length * FEDERATION_SHARE_PER_PLAYER;
  const venueTotal = regular.length * VENUE_SHARE_PER_PLAYER;
  // A discounted entrant's whole payment goes to the pot (that's the point of
  // the discount — no Federation/venue share); a full-price entrant's pot
  // share is the fixed 32€ regardless of the 40€ they paid in total.
  const prizePool = discountedTotal + regular.length * POT_SHARE_PER_PLAYER;

  // A player only qualifies for a final prize once they've actually played
  // out all their matches — reaching "4 wins" with a round still to go
  // doesn't yet mean "4/5", since they could still win it and become 5/5.
  const hasCompleted = (p) => p.matchLog.length >= totalRounds;
  const runnerUps = active.filter((p) => hasCompleted(p) && p.wins === totalRounds - 1);
  const perfects = active.filter((p) => hasCompleted(p) && p.wins === totalRounds);
  const runnerUpTotal = runnerUps.length * RUNNER_UP_PRIZE;
  const remainingForPerfects = prizePool - runnerUpTotal;
  const perfectShare = perfects.length > 0 ? remainingForPerfects / perfects.length : 0;
  const shortfall = remainingForPerfects < 0;

  return {
    totalPlayers, discounted, regular, totalCollected, federationTotal, venueTotal, prizePool,
    runnerUps, perfects, runnerUpTotal, remainingForPerfects, perfectShare, shortfall,
  };
}

/** A side bet's winner(s) are whichever participant(s) have the most wins —
 * byes and opponent-retirement wins count the same as any other win, since
 * that's just this tournament's existing win count. Ties split the pool
 * evenly. */
function computeSideBetResult(bet, playersById) {
  const participants = bet.participantIds.map((id) => playersById[id]).filter(Boolean);
  const pool = bet.amountPerPlayer * participants.length;
  if (participants.length === 0) return { pool, winners: [], share: 0 };
  const maxWins = Math.max(...participants.map((p) => p.wins));
  const winners = participants.filter((p) => p.wins === maxWins);
  const share = winners.length > 0 ? pool / winners.length : 0;
  return { pool, winners, share, maxWins };
}

/** The Calcutta pool is only paid out once the tournament winner(s) have
 * actually completed all their matches (same "hasCompleted" rule as the
 * official prize pool). A perfect-score winner who nobody bought just
 * doesn't get paid out — that portion of the pool isn't distributed. */
function computeCalcuttaResult(entries, players, totalRounds) {
  const pool = entries.reduce((s, e) => s + e.amount, 0);
  const hasCompleted = (p) => p.matchLog.length >= totalRounds;
  const winners = players.filter((p) => hasCompleted(p) && p.wins === totalRounds);
  const share = winners.length > 0 ? pool / winners.length : 0;
  const payouts = winners.map((w) => {
    const entry = entries.find((e) => e.playerId === w.id);
    return { player: w, buyer: entry ? entry.buyer : null, amount: entry ? share : 0, sold: !!entry };
  });
  return { pool, winners, share, payouts };
}


/* ---------------------------------------------------------------------- */
/* Admin access control                                                   */
/* ---------------------------------------------------------------------- */

const ADMIN_UNLOCK_LOCALSTORAGE_KEY = "bgfed-admin-unlocked";

// True specifically when this app was loaded inside an embed on the
// Federation's own site (bgfed.gr) — used to hide the Admin option there.
// NOTE: a plain "am I in any iframe?" check doesn't work here, because
// claude.ai's own artifact viewer already wraps the app in an iframe even
// on its "direct" public link — that check would hide Admin everywhere.
// Checking document.referrer for the specific embedding domain avoids that.
// This is a UX nicety only (avoids showing the button to random site
// visitors) — the real gate is still the password, so a missed edge case
// here is not a security hole.
function isEmbeddedOnFederationSite() {
  try {
    return /bgfed\.gr/i.test(document.referrer);
  } catch {
    return false;
  }
}






/* ---------------------------------------------------------------------- */
/* ELO rating (backgammon FIBS-style, match-length aware)                 */
/*                                                                        */
/* Win probability P and points-at-stake S are match-length aware:        */
/*   P(A beats B) = 1 / (1 + 10^(-(Ra-Rb) * sqrt(N) / 2000))               */
/*   S = ELO_K_BASE * sqrt(N)                                              */
/* where N = match length (points to win a single match).                 */
/* This shape (P scaled by sqrt(N)) is well-attested across independent    */
/* backgammon-Elo sources tracing to FIBS in the 1990s. The specific       */
/* constant below (ELO_K_BASE = 4) matches one documented implementation   */
/* of that family but is not verified against FIBS's original source —    */
/* treat it as a reasonable, sourced default rather than a guaranteed      */
/* historical constant. K is fixed for all players (no experience-based    */
/* acceleration), matching this project's current design choice.          */
/* ---------------------------------------------------------------------- */

// Bumped by hand on every code change sent in chat — compare this to what
// Claude states in its reply to confirm a "Publish" actually picked up the
// latest version, independent of claude.ai's own artifact-version UI.
const APP_BUILD_VERSION = "2026-09-20.4";

// Shown to everyone (admins and visitors) as a "What's New" popup the first
// time their browser sees a given build. Newest entry first. Keep entries
// short and feature-level — this is for testers, not a technical log.
// Standing overview of the app's main capabilities — always shown at the top
// of the "What's New" popup, above the build-by-build history, so a first-
// time visitor understands the whole tool at a glance. Update this whenever
// a major capability is added; keep it feature-level, not a build log.
const FEATURES_SUMMARY = [
  "Διοργάνωση τουρνουά Swiss-system, με αυτόματο ζευγάρωμα κάθε γύρου.",
  "Μητρώο παικτών με στοιχεία επικοινωνίας, συνδρομή και ιστορικό συμμετοχών.",
  "ELO rating για κάθε παίκτη, με γράφημα εξέλιξης και ιστορικό αγώνων.",
  "Πρόβλεψη νικητή (βάσει ELO) σε κάθε ζευγάρι πριν παιχτεί ο αγώνας.",
  "Season Standings — ετήσια κατάταξη με άθροισμα των καλύτερων εμφανίσεων.",
  "Διαχείριση Α.Α. (αποχώρηση παίκτη), με ρητή απόσυρση από το τουρνουά και ένδειξη διπλού Α.Α.",
  "Σημαία \"Official League Day\" και Recompute ELO/Standings από την αρχή, μόνο για επίσημες μέρες.",
  "Πλήρες Export / Import δεδομένων (backup) από το Dashboard.",
  "Ρόλοι Admin / Visitor με κωδικό πρόσβασης για διαχειριστή.",
];

const CHANGELOG = [
  {
    version: "2026-09-20.1 – .4",
    date: "2026-09-20",
    items: [
      "[.1] Το \"Χ αποχώρησε\" δεν αποκλείει πια αυτόματα τον παίκτη από τους επόμενους γύρους — μένει μόνο ένδειξη. Νέο κουμπί \"Απόσυρση / Επαναφορά\" στον πίνακα βαθμολογίας για ρητή απόσυρση. Νέα επιλογή \"Και οι δύο αποχώρησαν\" για διπλό Α.Α.",
      "[.2] Το κουμπί ενημερώσεων δείχνει τώρα και μόνιμη σύνοψη όλων των βασικών λειτουργιών της εφαρμογής.",
      "[.3] Το κουμπί μετονομάστηκε σε \"Changelog\", έγινε πιο ευδιάκριτο, και δείχνει κόκκινη κουκκίδα όταν υπάρχει κάτι νέο.",
      "[.4] Διόρθωση: σε ματς που κρίθηκε με Α.Α., το ματς μετράει στο σύνολο αγώνων του χαμένου αλλά όχι του νικητή.",
    ],
  },
];

const WHATS_NEW_SEEN_KEY = "bgfed_whatsnew_seen_build";

const ELO_INITIAL = 1500;
const ELO_K_BASE = 4;

function eloWinProbability(ratingA, ratingB, matchLength) {
  const D = ratingA - ratingB;
  return 1 / (1 + Math.pow(10, (-D * Math.sqrt(matchLength)) / 2000));
}

function eloPointsAtStake(matchLength) {
  return ELO_K_BASE * Math.sqrt(matchLength);
}



function ensureEloPlayer(elo, name) {
  const key = normalizeName(name);
  if (!elo.players[key]) elo.players[key] = { name, rating: ELO_INITIAL, games: 0, experience: 0 };
  if (elo.players[key].experience === undefined) elo.players[key].experience = 0;
  elo.players[key].name = name;
  return key;
}

/** Applies one batch of simultaneous matches (e.g. one Swiss round) to the
 * ELO state in place. Each match: { w: winnerName, l: loserName, ret: bool }.
 * Retirement-decided matches (ret: true) are excluded entirely, per the
 * project's rule that a walkover isn't a real backgammon result. */
function applyEloRoundBatch(elo, roundMatches, matchLength) {
  const S = eloPointsAtStake(matchLength);
  const deltas = {};
  roundMatches.forEach((m) => {
    if (m.ret) return;
    const wKey = ensureEloPlayer(elo, m.w);
    const lKey = ensureEloPlayer(elo, m.l);
    const Pw = eloWinProbability(elo.players[wKey].rating, elo.players[lKey].rating, matchLength);
    const delta = (1 - Pw) * S;
    deltas[wKey] = (deltas[wKey] || 0) + delta;
    deltas[lKey] = (deltas[lKey] || 0) - delta;
    elo.players[wKey].games += 1;
    elo.players[lKey].games += 1;
    elo.players[wKey].experience += matchLength;
    elo.players[lKey].experience += matchLength;
  });
  Object.entries(deltas).forEach(([key, d]) => {
    elo.players[key].rating += d;
  });
}





function normalizeName(name) {
  return name.trim().toLowerCase();
}

const GREEK_DIGRAPHS = [
  ["ου", "ou"], ["αι", "e"], ["ει", "i"], ["οι", "i"],
  ["γγ", "ng"], ["γκ", "g"], ["μπ", "b"], ["ντ", "d"],
  ["τσ", "ts"], ["τζ", "tz"], ["θ", "th"], ["χ", "ch"], ["ψ", "ps"],
];
const GREEK_SINGLE = {
  "α":"a","β":"v","γ":"g","δ":"d","ε":"e","ζ":"z","η":"i","ι":"i",
  "κ":"k","λ":"l","μ":"m","ν":"n","ξ":"x","ο":"o","π":"p","ρ":"r",
  "σ":"s","ς":"s","τ":"t","υ":"i","φ":"f","ω":"o",
};

function hasGreekLetters(s) {
  return /[Α-Ωα-ωΆΈΉΊΌΎΏάέήίόύώΪΫϊϋΐΰ]/.test(s);
}

function toGreeklish(name) {
  // Only transliterates Greek characters; anything else (e.g. a foreign
  // guest player's Latin name) passes through unchanged.
  return name
    .split(/(\s+)/)
    .map((word) => {
      if (!hasGreekLetters(word)) return word;
      // strip Greek tonos/diaeresis marks before mapping base letters
      let w = word
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      GREEK_DIGRAPHS.forEach(([gr, la]) => {
        w = w.split(gr).join(la);
      });
      let out = "";
      for (const ch of w) out += GREEK_SINGLE[ch] ?? ch;
      // capitalize each resulting word for readability
      return out.charAt(0).toUpperCase() + out.slice(1);
    })
    .join("");
}

function formatNameForDisplay(name, mode) {
  if (mode === "upper") {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  if (mode === "greeklish") return toGreeklish(name);
  return name;
}

async function pushSeasonUpdate(year, tournamentId, tournamentName, date, playersList) {
  const season = await loadSeason(year);
  playersList.forEach((p) => {
    const key = normalizeName(p.name);
    if (!season.players[key]) season.players[key] = { name: p.name, entries: {} };
    season.players[key].name = p.name; // keep latest casing/spelling
    const wins = p.matchLog.filter((m) => m.method === "normal" && m.result === "win").length;
    const aa = p.matchLog.filter((m) => m.method === "retirement_win").length;
    const bye = p.matchLog.filter((m) => m.method === "bye").length;
    // Retirement wins don't count toward the winner's matches-played total
    // (they get the standings point, but the match itself doesn't "count"
    // for them); a retirement loss, a double retirement, and every normal
    // match do count, for whoever played them.
    const matches = p.matchLog.filter((m) => m.method !== "bye" && m.method !== "retirement_win").length;
    // Matches actually decided on the board — excludes bye AND any match
    // ended by a retirement, whether won or lost. Used for the win % only.
    const normalMatches = p.matchLog.filter((m) => m.method === "normal").length;
    season.players[key].entries[tournamentId] = {
      tournamentName, date, points: p.wins, wins, aa, bye, matches, normalMatches,
    };
  });
  const ok = await saveSeason(year, season);
  return ok;
}

function computeSeasonStandings(season, bestOf) {
  return Object.values(season.players)
    .map((p) => {
      const entries = Object.entries(p.entries).map(([tid, e]) => ({ tournamentId: tid, ...e }));
      const sorted = [...entries].sort((a, b) => b.points - a.points);
      const counted = sorted.slice(0, bestOf);
      const countedIds = new Set(counted.map((e) => e.tournamentId));
      const total = counted.reduce((s, e) => s + e.points, 0);
      const sumAll = entries.reduce((s, e) => s + e.points, 0);
      const normalWinsOnly = entries.reduce((s, e) => s + (e.wins ?? e.points ?? 0), 0);
      const totalMatches = entries.reduce((s, e) => s + (e.matches ?? 0), 0);
      // % counts only results actually decided on the board: retirements
      // (A.A.) and byes are excluded from both sides, not just byes —
      // neither one demonstrates anything about how the game was played.
      const normalMatchesOnly = entries.reduce((s, e) => s + (e.normalMatches ?? e.matches ?? 0), 0);
      const pct = normalMatchesOnly > 0 ? Math.round((normalWinsOnly / normalMatchesOnly) * 1000) / 10 : null;
      return { name: p.name, entries: sorted, countedIds, total, sumAll, totalWins: normalWinsOnly, totalMatches, pct, eventsPlayed: entries.length };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "en"));
}





const SEED_PLAYERS = 
[
  {
    "name": "Ζωίδης Τηλέμαχος",
    "club": "ΟΠΑΧ",
    "email": "bloarootz@yahoo.gr",
    "phone": ""
  },
  {
    "name": "Κοκκίνης Πολυχρόνης",
    "club": "ΟΠΑΧ",
    "email": "polyxroniskokkinis@gmail.com",
    "phone": "694 646 3957"
  },
  {
    "name": "Χατζέλης Τάκης",
    "club": "ΕΟΜ",
    "email": "takisx18@gmail.com",
    "phone": ""
  },
  {
    "name": "Κατωγιαννάκης Στέφανος",
    "club": "ΕΟΜ",
    "email": "eletrote@otenet.gr",
    "phone": ""
  },
  {
    "name": "Σακκαλής Τάκης",
    "club": "ΕΟΜ",
    "email": "psakkalis@aua.gr",
    "phone": ""
  },
  {
    "name": "Πασιαλής Γιάννης",
    "club": "ΟΠΑΧ",
    "email": "dakapes@gmail.com",
    "phone": ""
  },
  {
    "name": "Χρηστίδης Χάρης",
    "club": "ΕΟΜ",
    "email": "haris.christidis@gmail.com",
    "phone": ""
  },
  {
    "name": "Καλοφωλιάς Παναγιώτης",
    "club": "ΕΟΜ",
    "email": "panjk52@gmail.com",
    "phone": ""
  },
  {
    "name": "Καλλίρης Ανδρέας",
    "club": "ΕΟΜ",
    "email": "akalliris@hotmail.com",
    "phone": ""
  },
  {
    "name": "Λουμίδης Σωτήρης",
    "club": "ΣΑΚΑ",
    "email": "sotiris.loumidis@loumidisfoods.com",
    "phone": ""
  },
  {
    "name": "Ζούβελος Νίκος",
    "club": "ΣΑΚΑ",
    "email": "n.zouvelos@gmail.com",
    "phone": ""
  },
  {
    "name": "Σοφός Σπύρος",
    "club": "ΕΟΜ",
    "email": "spsofos@gmail.com",
    "phone": ""
  },
  {
    "name": "Παπουτσής Γιάννης",
    "club": "ΟΠΑΧ",
    "email": "manowar1000@yahoo.com",
    "phone": ""
  },
  {
    "name": "Χατζηιωάννου Έλενα",
    "club": "ΕΟΜ",
    "email": "elchatz@otenet.gr",
    "phone": ""
  },
  {
    "name": "Λιάπης Νίκος",
    "club": "ΕΟΜ",
    "email": "nickliapis82@gmail.com",
    "phone": ""
  },
  {
    "name": "Μανωλιός Μιχάλης",
    "club": "ΕΟΜ",
    "email": "mmanolios@gmail.com",
    "phone": ""
  },
  {
    "name": "Χιωτίνης Κώστας",
    "club": "ΕΟΜ",
    "email": "costas4@otenet.gr",
    "phone": ""
  },
  {
    "name": "Ατματζίδης Γιάννης",
    "club": "ΕΟΜ",
    "email": "giannis_atm@hotmail.com",
    "phone": ""
  },
  {
    "name": "Αναστασίου Τάσος",
    "club": "ΕΟΜ",
    "email": "redmangr7@gmail.com",
    "phone": ""
  },
  {
    "name": "Μακρής Θανάσης",
    "club": "ΣΑΚΑ",
    "email": "than.g.makris@gmail.com",
    "phone": ""
  },
  {
    "name": "Σοφοκλέους Νίκος",
    "club": "ΕΟΜ",
    "email": "nicossophocleous@yahoo.gr",
    "phone": ""
  },
  {
    "name": "Χαρακλιάς Στέφανος",
    "club": "ΟΠΑΧ",
    "email": "stefharaklias@gmail.com",
    "phone": "693 652 4064"
  },
  {
    "name": "Μανιάς Άρης",
    "club": "ΣΑΚΑ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Τζάλλας Λεωνίδας",
    "club": "ΕΟΜ",
    "email": "m45land@gmail.com",
    "phone": ""
  },
  {
    "name": "Σαπάκος Γρηγόρης",
    "club": "ΕΟΜ",
    "email": "grisapakos@gmail.com",
    "phone": ""
  },
  {
    "name": "Καραμπλιάς Βαγγέλης",
    "club": "ΕΟΜ",
    "email": "e.karamplias@geodiktyo.gr",
    "phone": ""
  },
  {
    "name": "Προυκάκης Μιχάλης",
    "club": "ΣΑΚΑ",
    "email": "proukakis@hotmail.com",
    "phone": ""
  },
  {
    "name": "Βατανίδης Στάθης",
    "club": "ΕΟΜ",
    "email": "vatanidis@hotmail.com",
    "phone": ""
  },
  {
    "name": "Αποστολόπουλος Γιώργος",
    "club": "ΕΟΜ",
    "email": "yogi@hotmail.gr",
    "phone": ""
  },
  {
    "name": "Βράνιτς Μαριάννα",
    "club": "ΕΟΜ",
    "email": "vranimar2506@gmail.com",
    "phone": ""
  },
  {
    "name": "Χατζηβασιλείου Νίκος",
    "club": "ΕΟΜ",
    "email": "SECUDOOR3@GMAIL.COM",
    "phone": ""
  },
  {
    "name": "Ρουμελιώτης Μιχάλης",
    "club": "ΕΟΜ",
    "email": "michaelroum@hotmail.com",
    "phone": ""
  },
  {
    "name": "Μπερτάχος Νίκος",
    "club": "ΕΟΜ",
    "email": "nikolaosmpertachos65@gmail.com",
    "phone": ""
  },
  {
    "name": "Βουλγαράκης Σπύρος",
    "club": "ΕΟΜ",
    "email": "spiros.voulgarakis@yahoo.com",
    "phone": ""
  },
  {
    "name": "Τούκας Νίκος",
    "club": "ΕΟΜ",
    "email": "nikoshellas2012@gmail.com",
    "phone": ""
  },
  {
    "name": "Δημάκης Θοδωρής",
    "club": "ΕΟΜ",
    "email": "theodimakis@gmail.com",
    "phone": ""
  },
  {
    "name": "Καράογλου Γιάννης",
    "club": "ΕΟΜ",
    "email": "karaog10@otenet.gr",
    "phone": ""
  },
  {
    "name": "Μανιάτης Τάσος",
    "club": "ΕΟΜ",
    "email": "hellas.eu@hotmail.com",
    "phone": ""
  },
  {
    "name": "Γιαννάκος Νίκος",
    "club": "ΕΟΜ",
    "email": "nikos.giannak60@gmail.com",
    "phone": ""
  },
  {
    "name": "Κούκιαρης Ντίνος",
    "club": "ΕΟΜ",
    "email": "dinoskoukiaris@gmail.com",
    "phone": "694 536 0000"
  },
  {
    "name": "Χατζηνικολάου Νίκος",
    "club": "ΕΟΜ",
    "email": "NXAT16@GMAIL.COM",
    "phone": ""
  },
  {
    "name": "Πολυδώρου Θοδωρής",
    "club": "ΕΟΜ",
    "email": "m_alexandro56@yahoo.gr",
    "phone": ""
  },
  {
    "name": "Σέλελης Πέτρος",
    "club": "ΕΟΜ",
    "email": "selelis.petros@gmail.com",
    "phone": ""
  },
  {
    "name": "Κρητικός Ιγνάτιος",
    "club": "ΕΟΜ",
    "email": "natsiosk@hotmail.gr",
    "phone": ""
  },
  {
    "name": "Κισκήρας Φώτης",
    "club": "ΕΟΜ",
    "email": "fkiskiras@gmail.com",
    "phone": ""
  },
  {
    "name": "Διαμαντίδη Σοφία",
    "club": "ΕΟΜ",
    "email": "s.diamantidis@acg.edu",
    "phone": ""
  },
  {
    "name": "Διαμαντίδης Τόνυ",
    "club": "ΕΟΜ",
    "email": "tony@chemicalsafety.com",
    "phone": ""
  },
  {
    "name": "Μιχοπούλου Αναστασία",
    "club": "ΕΟΜ",
    "email": "",
    "phone": "694 811 4343"
  },
  {
    "name": "Βασιλειάδης Πάρης",
    "club": "ΕΟΜ",
    "email": "paris.vasiliadis1@gmail.com",
    "phone": "694 444 4069"
  },
  {
    "name": "Καλτσάς Ηλίας",
    "club": "ΕΟΜ",
    "email": "elias.barbarosa@gmail.com",
    "phone": ""
  },
  {
    "name": "Μαστροπέρρος Νίκος",
    "club": "ΕΟΜ",
    "email": "peronikos@yahoo.gr",
    "phone": "693 130 8581"
  },
  {
    "name": "Κάρλοβιτς Νίκος",
    "club": "ΕΟΜ",
    "email": "n.a.karlovits@gmail.com",
    "phone": ""
  },
  {
    "name": "Οικονόμου Παναγιώτης",
    "club": "ΕΟΜ",
    "email": "pan.oikonomou@gmail.com",
    "phone": ""
  },
  {
    "name": "Καραμπινάς Ανδρέας",
    "club": "ΕΟΜ",
    "email": "ankarabinas@gmail.com",
    "phone": "693 612 9219"
  },
  {
    "name": "Γυρτάτος Αλέξανδρος",
    "club": "ΕΟΜ",
    "email": "alexandrosgyr@gmail.com",
    "phone": ""
  },
  {
    "name": "Κιουλέ Βαγγέλης",
    "club": "ΕΟΜ",
    "email": "kioule1983@hotmail.com",
    "phone": ""
  },
  {
    "name": "Τσερλιάγκος Πλάτων",
    "club": "ΣΑΚΑ",
    "email": "platontserliagos@hotmail.com",
    "phone": ""
  },
  {
    "name": "Φωτιάδης Ιωάννης",
    "club": "ΕΟΜ",
    "email": "i019719@gmail.com",
    "phone": ""
  },
  {
    "name": "Διαμαντίδη Μάγκυ",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Γιαννακόπουλος Αργύριος",
    "club": "ΕΟΜ",
    "email": "vgiannakopoulos1@gmail.com",
    "phone": ""
  },
  {
    "name": "Γκιόκας Δημήτρης",
    "club": "ΕΟΜ",
    "email": "dimitris.gkiokas@gmail.com",
    "phone": ""
  },
  {
    "name": "Τζανέτης Βασίλης",
    "club": "ΕΟΜ",
    "email": "vasst75gr@gmail.com",
    "phone": ""
  },
  {
    "name": "Λαμπρινός Νίκος",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Μαραγκός Σωτήρης",
    "club": "ΕΟΜ",
    "email": "sotiris.maragos75@gmail.com",
    "phone": ""
  },
  {
    "name": "Μελισσίδου Ελένη",
    "club": "ΕΟΜ",
    "email": "elen-melissa@hotmail.com",
    "phone": ""
  },
  {
    "name": "Μπουρεξάκης Γιώργος",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Παπακώστας Νίκος",
    "club": "ΕΟΜ",
    "email": "njpapakostas@gmail.com",
    "phone": "690 604 4314"
  },
  {
    "name": "Βασιλείου Μιχάλης",
    "club": "ΕΟΜ",
    "email": "michalis.vasiliou@outlook.com",
    "phone": ""
  },
  {
    "name": "Ζωγράφου Αθηνά",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Τσομπάνος Σταύρος",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Γιακουμάκης Γιάννης",
    "club": "ΕΟΜ",
    "email": "giakoumakislaw63@gmail.com",
    "phone": ""
  },
  {
    "name": "Καλλέργη Δωροθέα",
    "club": "ΕΟΜ",
    "email": "dorella106@hotmail.com",
    "phone": ""
  },
  {
    "name": "Τριάντης Αντώνης",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  },
  {
    "name": "Αργειτάκος Αργύρης",
    "club": "ΕΟΜ",
    "email": "aargitakos@gmail.com",
    "phone": ""
  },
  {
    "name": "Γκανάς Γιώργος",
    "club": "ΕΟΜ",
    "email": "ganasales@gmail.com",
    "phone": ""
  },
  {
    "name": "Λοστάρος Γιώργος",
    "club": "ΕΟΜ",
    "email": "georgelostaros@gmail.com",
    "phone": ""
  },
  {
    "name": "Χατζηκωσταράς Βαγγέλης",
    "club": "ΕΟΜ",
    "email": "",
    "phone": ""
  }
]
;

const HISTORICAL_IMPORT_2026 = [{"name": "Ζωίδης Τηλέμαχος", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 2, "bye": 1, "aa": 0, "matches": 4, "points": 3}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "6": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "7": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "9": {"wins": 1, "bye": 1, "aa": 1, "matches": 3, "points": 3}, "10": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "11": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}}}, {"name": "Κοκκίνης Πολυχρόνης", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "3": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "4": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "8": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Χατζέλης Τάκης", "days": {"1": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "6": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}}}, {"name": "Κατωγιαννάκης Στέφανος", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "7": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Σακκαλής Τάκης", "days": {"1": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "4": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "5": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "11": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Πασιαλής Γιάννης", "days": {"1": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "6": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "7": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Χρηστίδης Χάρης", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "9": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Καλοφωλιάς Παναγιώτης", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "9": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Καλλίρης Ανδρέας", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Λουμίδης Σωτήρης", "days": {"1": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 1, "bye": 1, "aa": 1, "matches": 3, "points": 3}, "7": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "10": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "11": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Ζούβελος Νίκος", "days": {"1": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "2": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "4": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "5": {"wins": 0, "bye": 1, "aa": 0, "matches": 4, "points": 1}, "6": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "7": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "9": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "10": {"wins": 4, "bye": 1, "aa": 0, "matches": 4, "points": 5}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Σοφός Σπύρος", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "3": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "8": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "9": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "10": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Παπουτσής Γιάννης", "days": {"1": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "2": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "4": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "5": {"wins": 3, "bye": 1, "aa": 0, "matches": 4, "points": 4}, "6": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "8": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "9": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Χατζηιωάννου Έλενα", "days": {"1": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "2": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "6": {"wins": 0, "bye": 1, "aa": 1, "matches": 3, "points": 2}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Λιάπης Νίκος", "days": {"5": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "10": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Μανωλιός Μιχάλης", "days": {"2": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Χιωτίνης Κώστας", "days": {"2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Ατματζίδης Γιάννης", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "6": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "9": {"wins": 2, "bye": 1, "aa": 0, "matches": 4, "points": 3}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Αναστασίου Τάσος", "days": {"1": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "2": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Μακρής Θανάσης", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "3": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "6": {"wins": 0, "bye": 1, "aa": 0, "matches": 4, "points": 1}, "7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "8": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "9": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}, "10": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Σοφοκλέους Νίκος", "days": {"2": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "4": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "8": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "9": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Χαρακλιάς Στέφανος", "days": {"1": {"wins": 5, "bye": 0, "aa": 0, "matches": 5, "points": 5}, "2": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "9": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Μανιάς Άρης", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 3, "bye": 1, "aa": 0, "matches": 4, "points": 4}, "3": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "9": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Τζάλλας Λεωνίδας", "days": {"2": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "3": {"wins": 3, "bye": 0, "aa": 1, "matches": 4, "points": 4}, "4": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "5": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Σαπάκος Γρηγόρης", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "3": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "4": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "9": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Καραμπλιάς Βαγγέλης", "days": {"1": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "2": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "3": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "4": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "5": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}, "6": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "7": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "8": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "9": {"wins": 1, "bye": 0, "aa": 2, "matches": 3, "points": 3}, "10": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}, "11": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Προυκάκης Μιχάλης", "days": {"2": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Βατανίδης Στάθης", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "3": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "4": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "7": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "10": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Αποστολόπουλος Γιώργος", "days": {"5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "6": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "9": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "10": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Βράνιτς Μαριάννα", "days": {"1": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "9": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "10": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}}}, {"name": "Χατζηβασιλείου Νίκος", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "3": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "5": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "6": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Ρουμελιώτης Μιχάλης", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "3": {"wins": 0, "bye": 0, "aa": 2, "matches": 3, "points": 2}, "4": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Μπερτάχος Νίκος", "days": {"4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "5": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "7": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Βουλγαράκης Σπύρος", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "2": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "3": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "5": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "6": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Τούκας Νίκος", "days": {"2": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "3": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "4": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "7": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "9": {"wins": 1, "bye": 0, "aa": 2, "matches": 3, "points": 3}, "10": {"wins": 0, "bye": 0, "aa": 2, "matches": 3, "points": 2}}}, {"name": "Δημάκης Θοδωρής", "days": {"6": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "10": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Καράογλου Γιάννης", "days": {"5": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "6": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "8": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Μανιάτης Τάσος", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "10": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "11": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Γιαννάκος Νίκος", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "2": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "3": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "4": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "5": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "8": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Κούκιαρης Ντίνος", "days": {"5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "8": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "9": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Χατζηνικολάου Νίκος", "days": {"2": {"wins": 0, "bye": 1, "aa": 0, "matches": 4, "points": 1}, "3": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "4": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "5": {"wins": 0, "bye": 1, "aa": 0, "matches": 4, "points": 1}, "7": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}, "8": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "10": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Πολυδώρου Θοδωρής", "days": {"5": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "10": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Σέλελης Πέτρος", "days": {"2": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "4": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Κρητικός Ιγνάτιος", "days": {"3": {"wins": 2, "bye": 0, "aa": 1, "matches": 4, "points": 3}, "5": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "6": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}, "7": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Κισκήρας Φώτης", "days": {"8": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "9": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "10": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Διαμαντίδη Σοφία", "days": {"7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Διαμαντίδης Τόνυ", "days": {"7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "11": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Μιχοπούλου Αναστασία", "days": {"8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Βασιλειάδης Πάρης", "days": {"6": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Καλτσάς Ηλίας", "days": {"1": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Μαστροπέρρος Νίκος", "days": {"1": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}}}, {"name": "Κάρλοβιτς Νίκος", "days": {"8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "9": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Οικονόμου Παναγιώτης", "days": {"10": {"wins": 4, "bye": 0, "aa": 0, "matches": 5, "points": 4}, "11": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}}}, {"name": "Καραμπινάς Ανδρέας", "days": {"7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}, "8": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}}}, {"name": "Γυρτάτος Αλέξανδρος", "days": {"8": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Κιουλέ Βαγγέλης", "days": {"1": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Τσερλιάγκος Πλάτων", "days": {"7": {"wins": 3, "bye": 0, "aa": 0, "matches": 5, "points": 3}}}, {"name": "Φωτιάδης Ιωάννης", "days": {"10": {"wins": 2, "bye": 1, "aa": 0, "matches": 4, "points": 3}}}, {"name": "Διαμαντίδη Μάγκυ", "days": {"7": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "11": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}}}, {"name": "Γιαννακόπουλος Αργύριος", "days": {"4": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}, "8": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "10": {"wins": 0, "bye": 1, "aa": 0, "matches": 4, "points": 1}}}, {"name": "Γκιόκας Δημήτρης", "days": {"1": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Τζανέτης Βασίλης", "days": {"10": {"wins": 2, "bye": 0, "aa": 0, "matches": 5, "points": 2}}}, {"name": "Λαμπρινός Νίκος", "days": {"9": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Μαραγκός Σωτήρης", "days": {"9": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Μελισσίδου Ελένη", "days": {"5": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Μπουρεξάκης Γιώργος", "days": {"1": {"wins": 1, "bye": 0, "aa": 1, "matches": 4, "points": 2}}}, {"name": "Παπακώστας Νίκος", "days": {"5": {"wins": 1, "bye": 1, "aa": 0, "matches": 4, "points": 2}}}, {"name": "Βασιλείου Μιχάλης", "days": {"8": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Ζωγράφου Αθηνά", "days": {"9": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Τσομπάνος Σταύρος", "days": {"1": {"wins": 1, "bye": 0, "aa": 0, "matches": 5, "points": 1}}}, {"name": "Γιακουμάκης Γιάννης", "days": {"9": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}}}, {"name": "Καλλέργη Δωροθέα", "days": {"1": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "2": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "6": {"wins": 0, "bye": 1, "aa": 0, "matches": 3, "points": 1}}}, {"name": "Τριάντης Αντώνης", "days": {"9": {"wins": 0, "bye": 0, "aa": 1, "matches": 4, "points": 1}}}, {"name": "Αργειτάκος Αργύρης", "days": {"11": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}}}, {"name": "Γκανάς Γιώργος", "days": {"3": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "6": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "7": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "8": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}, "9": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}}}, {"name": "Λοστάρος Γιώργος", "days": {"1": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}}}, {"name": "Χατζηκωσταράς Βαγγέλης", "days": {"3": {"wins": 0, "bye": 0, "aa": 0, "matches": 5, "points": 0}}}];


const HISTORICAL_ELO_ROUNDS_2026 = [[{"w": "Καλοφωλιάς Παναγιώτης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Καλτσάς Ηλίας", "l": "Γκιόκας Δημήτρης", "ret": false}, {"w": "Τσομπάνος Σταύρος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Μαστροπέρρος Νίκος", "l": "Μπουρεξάκης Γιώργος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Λοστάρος Γιώργος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Καλλέργη Δωροθέα", "ret": false}, {"w": "Μανιάς Άρης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Κιουλέ Βαγγέλης", "l": "Ζωίδης Τηλέμαχος", "ret": false}], [{"w": "Βατανίδης Στάθης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Καλτσάς Ηλίας", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Τσομπάνος Σταύρος", "ret": false}, {"w": "Κιουλέ Βαγγέλης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Μαστροπέρρος Νίκος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Γκιόκας Δημήτρης", "l": "Μπουρεξάκης Γιώργος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Λοστάρος Γιώργος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Καλλέργη Δωροθέα", "ret": false}], [{"w": "Πασιαλής Γιάννης", "l": "Καλτσάς Ηλίας", "ret": false}, {"w": "Κιουλέ Βαγγέλης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Μαστροπέρρος Νίκος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Τσομπάνος Σταύρος", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Γκιόκας Δημήτρης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Καλλέργη Δωροθέα", "l": "Λοστάρος Γιώργος", "ret": true}, {"w": "Μακρής Θανάσης", "l": "Μπουρεξάκης Γιώργος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Ρουμελιώτης Μιχάλης", "ret": false}], [{"w": "Χαρακλιάς Στέφανος", "l": "Κιουλέ Βαγγέλης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Μαστροπέρρος Νίκος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Καλτσάς Ηλίας", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Καλλέργη Δωροθέα", "ret": true}, {"w": "Σαπάκος Γρηγόρης", "l": "Τσομπάνος Σταύρος", "ret": false}, {"w": "Γκιόκας Δημήτρης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Μπουρεξάκης Γιώργος", "l": "Λοστάρος Γιώργος", "ret": true}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Αναστασίου Τάσος", "ret": false}], [{"w": "Πασιαλής Γιάννης", "l": "Μαστροπέρρος Νίκος", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Καλτσάς Ηλίας", "l": "Κιουλέ Βαγγέλης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Γιαννάκος Νίκος", "ret": true}, {"w": "Μακρής Θανάσης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Γκιόκας Δημήτρης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Μπουρεξάκης Γιώργος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Τσομπάνος Σταύρος", "ret": true}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Καλλέργη Δωροθέα", "ret": true}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Λοστάρος Γιώργος", "ret": true}], [{"w": "Προυκάκης Μιχάλης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Καλλέργη Δωροθέα", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Ζούβελος Νίκος", "ret": false}], [{"w": "Βουλγαράκης Σπύρος", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Καλλέργη Δωροθέα", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Καραμπλιάς Βαγγέλης", "ret": false}], [{"w": "Τούκας Νίκος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Σέλελης Πέτρος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}], [{"w": "Ρουμελιώτης Μιχάλης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Μανιάς Άρης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Βουλγαράκης Σπύρος", "ret": true}, {"w": "Σακκαλής Τάκης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Καλλέργη Δωροθέα", "ret": true}, {"w": "Καλλίρης Ανδρέας", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Καραμπλιάς Βαγγέλης", "ret": false}], [{"w": "Ατματζίδης Γιάννης", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Μανιάς Άρης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Γιαννάκος Νίκος", "ret": true}, {"w": "Χαρακλιάς Στέφανος", "l": "Βατανίδης Στάθης", "ret": true}, {"w": "Πασιαλής Γιάννης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Τζάλλας Λεωνίδας", "ret": true}, {"w": "Σέλελης Πέτρος", "l": "Καλλέργη Δωροθέα", "ret": true}, {"w": "Ζούβελος Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": true}], [{"w": "Τζάλλας Λεωνίδας", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Χατζηνικολάου Νίκος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Χατζηκωσταράς Βαγγέλης", "ret": false}, {"w": "Γκανάς Γιώργος", "l": "Ζωίδης Τηλέμαχος", "ret": false}], [{"w": "Ατματζίδης Γιάννης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Χατζηνικολάου Νίκος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Χατζηκωσταράς Βαγγέλης", "ret": true}, {"w": "Σοφός Σπύρος", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Γιαννάκος Νίκος", "ret": false}], [{"w": "Χατζέλης Τάκης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Κρητικός Ιγνάτιος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Χατζηκωσταράς Βαγγέλης", "ret": true}, {"w": "Ζωίδης Τηλέμαχος", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Γιαννάκος Νίκος", "ret": true}, {"w": "Μανιάς Άρης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}], [{"w": "Κατωγιαννάκης Στέφανος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Μανιάς Άρης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Λουμίδης Σωτήρης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Γιαννάκος Νίκος", "ret": true}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Χατζηκωσταράς Βαγγέλης", "ret": true}], [{"w": "Χρηστίδης Χάρης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Καραμπλιάς Βαγγέλης", "ret": true}, {"w": "Τούκας Νίκος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Χατζηκωσταράς Βαγγέλης", "ret": true}], [{"w": "Σέλελης Πέτρος", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Γιαννακόπουλος Αργύριος", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Ζούβελος Νίκος", "ret": false}], [{"w": "Ρουμελιώτης Μιχάλης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Γιαννακόπουλος Αργύριος", "ret": false}, {"w": "Σέλελης Πέτρος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χατζηιωάννου Έλενα", "ret": false}], [{"w": "Κοκκίνης Πολυχρόνης", "l": "Ρουμελιώτης Μιχάλης", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Σέλελης Πέτρος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Γιαννακόπουλος Αργύριος", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Τούκας Νίκος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Τζάλλας Λεωνίδας", "ret": false}], [{"w": "Σέλελης Πέτρος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Γιαννακόπουλος Αργύριος", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Τούκας Νίκος", "ret": true}], [{"w": "Κοκκίνης Πολυχρόνης", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Ρουμελιώτης Μιχάλης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Γιαννακόπουλος Αργύριος", "ret": true}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Χατζηνικολάου Νίκος", "l": "Τούκας Νίκος", "ret": true}], [{"w": "Καλοφωλιάς Παναγιώτης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Μελισσίδου Ελένη", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Παπακώστας Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Χατζηβασιλείου Νίκος", "ret": false}], [{"w": "Κατωγιαννάκης Στέφανος", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Πολυδώρου Θοδωρής", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Μελισσίδου Ελένη", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Χατζηνικολάου Νίκος", "ret": false}], [{"w": "Λιάπης Νίκος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Παπακώστας Νίκος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Μελισσίδου Ελένη", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Ζούβελος Νίκος", "ret": true}], [{"w": "Ζωίδης Τηλέμαχος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Παπακώστας Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Πολυδώρου Θοδωρής", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Γιαννάκος Νίκος", "ret": true}, {"w": "Χαρακλιάς Στέφανος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Μελισσίδου Ελένη", "l": "Ζούβελος Νίκος", "ret": true}], [{"w": "Καλοφωλιάς Παναγιώτης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Παπακώστας Νίκος", "ret": true}, {"w": "Χαρακλιάς Στέφανος", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χατζηβασιλείου Νίκος", "ret": true}, {"w": "Σοφός Σπύρος", "l": "Βουλγαράκης Σπύρος", "ret": true}, {"w": "Μακρής Θανάσης", "l": "Γιαννάκος Νίκος", "ret": true}, {"w": "Μελισσίδου Ελένη", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Χατζηνικολάου Νίκος", "ret": false}], [{"w": "Χρηστίδης Χάρης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Βασιλειάδης Πάρης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Τζάλλας Λεωνίδας", "ret": false}], [{"w": "Κοκκίνης Πολυχρόνης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Δημάκης Θοδωρής", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Μανιάς Άρης", "l": "Καλλέργη Δωροθέα", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Βασιλειάδης Πάρης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Βουλγαράκης Σπύρος", "ret": false}], [{"w": "Χατζέλης Τάκης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Βασιλειάδης Πάρης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Καλλέργη Δωροθέα", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Βράνιτς Μαριάννα", "l": "Ατματζίδης Γιάννης", "ret": true}], [{"w": "Χατζέλης Τάκης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Βασιλειάδης Πάρης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Μανιάς Άρης", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Καλλέργη Δωροθέα", "l": "Βράνιτς Μαριάννα", "ret": true}, {"w": "Ζωίδης Τηλέμαχος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Χαρακλιάς Στέφανος", "l": "Ατματζίδης Γιάννης", "ret": true}], [{"w": "Σοφοκλέους Νίκος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Βασιλειάδης Πάρης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Δημάκης Θοδωρής", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Μανιάς Άρης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Καλλέργη Δωροθέα", "ret": true}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Βουλγαράκης Σπύρος", "ret": true}, {"w": "Πασιαλής Γιάννης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Βράνιτς Μαριάννα", "ret": true}, {"w": "Χατζηιωάννου Έλενα", "l": "Ατματζίδης Γιάννης", "ret": true}], [{"w": "Τσερλιάγκος Πλάτων", "l": "Τούκας Νίκος", "ret": false}, {"w": "Διαμαντίδη Σοφία", "l": "Μανιάς Άρης", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Καραμπινάς Ανδρέας", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Διαμαντίδη Μάγκυ", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Διαμαντίδης Τόνυ", "ret": false}], [{"w": "Λιάπης Νίκος", "l": "Καραμπινάς Ανδρέας", "ret": false}, {"w": "Διαμαντίδη Σοφία", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Τσερλιάγκος Πλάτων", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Διαμαντίδης Τόνυ", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Σέλελης Πέτρος", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Τούκας Νίκος", "l": "Βατανίδης Στάθης", "ret": false}], [{"w": "Χιωτίνης Κώστας", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Διαμαντίδη Σοφία", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Καραμπινάς Ανδρέας", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Σέλελης Πέτρος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Τσερλιάγκος Πλάτων", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Διαμαντίδης Τόνυ", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Μανιάς Άρης", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Αναστασίου Τάσος", "ret": true}, {"w": "Καλλίρης Ανδρέας", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Κρητικός Ιγνάτιος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Χατζηνικολάου Νίκος", "l": "Γκανάς Γιώργος", "ret": true}], [{"w": "Μανωλιός Μιχάλης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Διαμαντίδης Τόνυ", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Τσερλιάγκος Πλάτων", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Διαμαντίδη Σοφία", "ret": false}, {"w": "Καραμπινάς Ανδρέας", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Τούκας Νίκος", "ret": true}, {"w": "Χατζέλης Τάκης", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Διαμαντίδη Μάγκυ", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Αναστασίου Τάσος", "ret": true}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Βατανίδης Στάθης", "ret": false}], [{"w": "Σοφός Σπύρος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Τσερλιάγκος Πλάτων", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Μανιάς Άρης", "ret": false}, {"w": "Διαμαντίδης Τόνυ", "l": "Σέλελης Πέτρος", "ret": false}, {"w": "Καραμπινάς Ανδρέας", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Διαμαντίδη Σοφία", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Κρητικός Ιγνάτιος", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Τούκας Νίκος", "ret": true}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Καραμπλιάς Βαγγέλης", "ret": true}, {"w": "Κούκιαρης Ντίνος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Γκανάς Γιώργος", "ret": false}], [{"w": "Σαπάκος Γρηγόρης", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Μιχοπούλου Αναστασία", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Βασιλείου Μιχάλης", "ret": false}, {"w": "Κάρλοβιτς Νίκος", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Γιαννακόπουλος Αργύριος", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Γυρτάτος Αλέξανδρος", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Καραμπινάς Ανδρέας", "ret": false}], [{"w": "Παπουτσής Γιάννης", "l": "Δημάκης Θοδωρής", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Κάρλοβιτς Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Γυρτάτος Αλέξανδρος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Βασιλείου Μιχάλης", "l": "Καραμπινάς Ανδρέας", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Κισκήρας Φώτης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Γιαννακόπουλος Αργύριος", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Μιχοπούλου Αναστασία", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Γιαννάκος Νίκος", "l": "Αποστολόπουλος Γιώργος", "ret": false}], [{"w": "Καλοφωλιάς Παναγιώτης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Βουλγαράκης Σπύρος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Γυρτάτος Αλέξανδρος", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Βασιλείου Μιχάλης", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Μιχοπούλου Αναστασία", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κάρλοβιτς Νίκος", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Τζάλλας Λεωνίδας", "l": "Καραμπινάς Ανδρέας", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Γιαννακόπουλος Αργύριος", "ret": false}], [{"w": "Παπουτσής Γιάννης", "l": "Γυρτάτος Αλέξανδρος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Κάρλοβιτς Νίκος", "ret": false}, {"w": "Μιχοπούλου Αναστασία", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Κισκήρας Φώτης", "ret": true}, {"w": "Τζάλλας Λεωνίδας", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Μανιάς Άρης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Βασιλείου Μιχάλης", "ret": true}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Γιαννακόπουλος Αργύριος", "ret": true}, {"w": "Χατζηνικολάου Νίκος", "l": "Καραμπινάς Ανδρέας", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Γκανάς Γιώργος", "ret": true}], [{"w": "Παπουτσής Γιάννης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Γυρτάτος Αλέξανδρος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Μιχοπούλου Αναστασία", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κάρλοβιτς Νίκος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Κισκήρας Φώτης", "ret": true}, {"w": "Χατζέλης Τάκης", "l": "Γιαννάκος Νίκος", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Γκανάς Γιώργος", "l": "Βασιλείου Μιχάλης", "ret": false}, {"w": "Καραμπινάς Ανδρέας", "l": "Γιαννακόπουλος Αργύριος", "ret": false}], [{"w": "Παπουτσής Γιάννης", "l": "Ζωγράφου Αθηνά", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Μαραγκός Σωτήρης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Λαμπρινός Νίκος", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Γκανάς Γιώργος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Τούκας Νίκος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Μιχοπούλου Αναστασία", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Γιακουμάκης Γιάννης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Κάρλοβιτς Νίκος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Μανιάς Άρης", "l": "Τριάντης Αντώνης", "ret": false}], [{"w": "Προυκάκης Μιχάλης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Μιχοπούλου Αναστασία", "ret": false}, {"w": "Κισκήρας Φώτης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Λαμπρινός Νίκος", "ret": false}, {"w": "Ζωγράφου Αθηνά", "l": "Γιακουμάκης Γιάννης", "ret": false}, {"w": "Μαραγκός Σωτήρης", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Κάρλοβιτς Νίκος", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Τριάντης Αντώνης", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Τζάλλας Λεωνίδας", "ret": false}], [{"w": "Καλλίρης Ανδρέας", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Παπουτσής Γιάννης", "ret": true}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Μανιάς Άρης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Κάρλοβιτς Νίκος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Μαραγκός Σωτήρης", "l": "Ζωγράφου Αθηνά", "ret": false}, {"w": "Τριάντης Αντώνης", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Μιχοπούλου Αναστασία", "l": "Λαμπρινός Νίκος", "ret": false}, {"w": "Τζάλλας Λεωνίδας", "l": "Γιακουμάκης Γιάννης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Μακρής Θανάσης", "ret": false}], [{"w": "Ζούβελος Νίκος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Σαπάκος Γρηγόρης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Μαραγκός Σωτήρης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Κισκήρας Φώτης", "l": "Κάρλοβιτς Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Τριάντης Αντώνης", "ret": true}, {"w": "Χιωτίνης Κώστας", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Μιχοπούλου Αναστασία", "l": "Παπουτσής Γιάννης", "ret": true}, {"w": "Τούκας Νίκος", "l": "Ζωγράφου Αθηνά", "ret": true}, {"w": "Σοφοκλέους Νίκος", "l": "Μανιάς Άρης", "ret": false}, {"w": "Κούκιαρης Ντίνος", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Γκανάς Γιώργος", "ret": true}, {"w": "Λαμπρινός Νίκος", "l": "Γιακουμάκης Γιάννης", "ret": false}], [{"w": "Καλλίρης Ανδρέας", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Βράνιτς Μαριάννα", "ret": true}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Μιχοπούλου Αναστασία", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Κούκιαρης Ντίνος", "ret": false}, {"w": "Σαπάκος Γρηγόρης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Μαραγκός Σωτήρης", "ret": true}, {"w": "Σοφός Σπύρος", "l": "Τζάλλας Λεωνίδας", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Κάρλοβιτς Νίκος", "ret": false}, {"w": "Λαμπρινός Νίκος", "l": "Τριάντης Αντώνης", "ret": true}, {"w": "Γιακουμάκης Γιάννης", "l": "Παπουτσής Γιάννης", "ret": true}, {"w": "Μανιάς Άρης", "l": "Ζωγράφου Αθηνά", "ret": true}], [{"w": "Βουλγαράκης Σπύρος", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Κισκήρας Φώτης", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Τζανέτης Βασίλης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Γιαννακόπουλος Αργύριος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Τούκας Νίκος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Οικονόμου Παναγιώτης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Φωτιάδης Ιωάννης", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Πολυδώρου Θοδωρής", "ret": false}], [{"w": "Αναστασίου Τάσος", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Οικονόμου Παναγιώτης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Τζανέτης Βασίλης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Χατζέλης Τάκης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Χατζηνικολάου Νίκος", "l": "Βράνιτς Μαριάννα", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Γιαννακόπουλος Αργύριος", "ret": true}, {"w": "Πολυδώρου Θοδωρής", "l": "Τούκας Νίκος", "ret": false}], [{"w": "Μανιάτης Τάσος", "l": "Οικονόμου Παναγιώτης", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Χατζηνικολάου Νίκος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Τζανέτης Βασίλης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Φωτιάδης Ιωάννης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Αποστολόπουλος Γιώργος", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Τούκας Νίκος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Γιαννακόπουλος Αργύριος", "ret": true}], [{"w": "Ζούβελος Νίκος", "l": "Δημάκης Θοδωρής", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Αναστασίου Τάσος", "l": "Πολυδώρου Θοδωρής", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Φωτιάδης Ιωάννης", "ret": false}, {"w": "Οικονόμου Παναγιώτης", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Τζανέτης Βασίλης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Βουλγαράκης Σπύρος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Βατανίδης Στάθης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Χατζηβασιλείου Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Γιαννακόπουλος Αργύριος", "ret": false}], [{"w": "Ζούβελος Νίκος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Οικονόμου Παναγιώτης", "l": "Αναστασίου Τάσος", "ret": false}, {"w": "Δημάκης Θοδωρής", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Φωτιάδης Ιωάννης", "l": "Βατανίδης Στάθης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Τζανέτης Βασίλης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Βράνιτς Μαριάννα", "l": "Χατζηβασιλείου Νίκος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Πολυδώρου Θοδωρής", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Χατζηνικολάου Νίκος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Αποστολόπουλος Γιώργος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Τούκας Νίκος", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Βουλγαράκης Σπύρος", "ret": false}], [{"w": "Καράογλου Γιάννης", "l": "Διαμαντίδης Τόνυ", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Διαμαντίδη Σοφία", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Οικονόμου Παναγιώτης", "ret": false}, {"w": "Κισκήρας Φώτης", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Χιωτίνης Κώστας", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Κοκκίνης Πολυχρόνης", "ret": false}, {"w": "Χρηστίδης Χάρης", "l": "Αργειτάκος Αργύρης", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Μανωλιός Μιχάλης", "ret": false}], [{"w": "Χιωτίνης Κώστας", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Καράογλου Γιάννης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Κατωγιαννάκης Στέφανος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Σοφοκλέους Νίκος", "l": "Πολυδώρου Θοδωρής", "ret": false}, {"w": "Ζούβελος Νίκος", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Σακκαλής Τάκης", "ret": false}, {"w": "Μανιάς Άρης", "l": "Αργειτάκος Αργύρης", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Καραμπλιάς Βαγγέλης", "l": "Διαμαντίδη Σοφία", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Οικονόμου Παναγιώτης", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Ζωίδης Τηλέμαχος", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Διαμαντίδης Τόνυ", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Μακρής Θανάσης", "ret": false}], [{"w": "Χιωτίνης Κώστας", "l": "Μανιάς Άρης", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Χατζέλης Τάκης", "l": "Μπερτάχος Νίκος", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Μανωλιός Μιχάλης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Ατματζίδης Γιάννης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Καλοφωλιάς Παναγιώτης", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Διαμαντίδης Τόνυ", "ret": false}, {"w": "Σοφός Σπύρος", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Διαμαντίδη Σοφία", "l": "Αργειτάκος Αργύρης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Οικονόμου Παναγιώτης", "ret": false}], [{"w": "Χατζέλης Τάκης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Παπουτσής Γιάννης", "l": "Λουμίδης Σωτήρης", "ret": false}, {"w": "Πασιαλής Γιάννης", "l": "Μανιάς Άρης", "ret": false}, {"w": "Λιάπης Νίκος", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Πολυδώρου Θοδωρής", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Προυκάκης Μιχάλης", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Μανωλιός Μιχάλης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Καλλίρης Ανδρέας", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Καραμπλιάς Βαγγέλης", "ret": false}, {"w": "Κισκήρας Φώτης", "l": "Σοφός Σπύρος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Μανιάτης Τάσος", "ret": false}, {"w": "Διαμαντίδη Σοφία", "l": "Χατζηιωάννου Έλενα", "ret": false}, {"w": "Χαρακλιάς Στέφανος", "l": "Χρηστίδης Χάρης", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Διαμαντίδη Μάγκυ", "ret": false}, {"w": "Μακρής Θανάσης", "l": "Οικονόμου Παναγιώτης", "ret": false}, {"w": "Διαμαντίδης Τόνυ", "l": "Αργειτάκος Αργύρης", "ret": false}], [{"w": "Χατζέλης Τάκης", "l": "Παπουτσής Γιάννης", "ret": false}, {"w": "Σακκαλής Τάκης", "l": "Χιωτίνης Κώστας", "ret": false}, {"w": "Λουμίδης Σωτήρης", "l": "Λιάπης Νίκος", "ret": false}, {"w": "Μπερτάχος Νίκος", "l": "Πολυδώρου Θοδωρής", "ret": false}, {"w": "Κοκκίνης Πολυχρόνης", "l": "Πασιαλής Γιάννης", "ret": false}, {"w": "Κατωγιαννάκης Στέφανος", "l": "Κισκήρας Φώτης", "ret": false}, {"w": "Ατματζίδης Γιάννης", "l": "Χαρακλιάς Στέφανος", "ret": false}, {"w": "Καλοφωλιάς Παναγιώτης", "l": "Σοφοκλέους Νίκος", "ret": false}, {"w": "Ζωίδης Τηλέμαχος", "l": "Μανιάς Άρης", "ret": true}, {"w": "Μανωλιός Μιχάλης", "l": "Ζούβελος Νίκος", "ret": false}, {"w": "Προυκάκης Μιχάλης", "l": "Διαμαντίδη Σοφία", "ret": false}, {"w": "Καλλίρης Ανδρέας", "l": "Καράογλου Γιάννης", "ret": false}, {"w": "Μανιάτης Τάσος", "l": "Καραμπλιάς Βαγγέλης", "ret": true}, {"w": "Σοφός Σπύρος", "l": "Χρηστίδης Χάρης", "ret": true}, {"w": "Διαμαντίδης Τόνυ", "l": "Μακρής Θανάσης", "ret": false}, {"w": "Χατζηιωάννου Έλενα", "l": "Οικονόμου Παναγιώτης", "ret": false}, {"w": "Διαμαντίδη Μάγκυ", "l": "Αργειτάκος Αργύρης", "ret": true}]];


const HISTORICAL_TOURNAMENTS_2026 = {"1": {"tournamentId": "hist-day1", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 1", "createdAt": "2025-09-27T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Καλοφωλιάς Παναγιώτης", "wins": 2, "opponents": ["p2", "p5", "p35", "p36", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "loss"}]}, {"id": "p2", "name": "Χατζηιωάννου Έλενα", "wins": 1, "opponents": ["p1", "p24", "p5", "p7", "p34"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "loss"}]}, {"id": "p3", "name": "Χατζηβασιλείου Νίκος", "wins": 2, "opponents": ["p4", "p29", "p21", "p23", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "loss"}]}, {"id": "p4", "name": "Μανιάτης Τάσος", "wins": 3, "opponents": ["p3", "p16", "p12", "p22", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p6", "p1", "p2", "p18", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Αναστασίου Τάσος", "wins": 1, "opponents": ["p5", "p12", "p13", "p34", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "retirement_win", "result": "win"}]}, {"id": "p7", "name": "Γκιόκας Δημήτρης", "wins": 2, "opponents": ["p8", "p17", "p20", "p2", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p8", "name": "Καλτσάς Ηλίας", "wins": 4, "opponents": ["p7", "p11", "p28", "p16", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p35", "method": "normal", "result": "win"}]}, {"id": "p9", "name": "Τσομπάνος Σταύρος", "wins": 1, "opponents": ["p10", "p25", "p31", "p32", "p12"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p12", "method": "retirement_loss", "result": "loss"}]}, {"id": "p10", "name": "Ατματζίδης Γιάννης", "wins": 2, "opponents": ["p9", "p13", "p32", "p26", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Λουμίδης Σωτήρης", "wins": 3, "opponents": ["p12", "p8", "p25", "p29", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p29", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "win"}]}, {"id": "p12", "name": "Βράνιτς Μαριάννα", "wins": 2, "opponents": ["p11", "p6", "p4", "p15", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p9", "method": "retirement_win", "result": "win"}]}, {"id": "p13", "name": "Καλλίρης Ανδρέας", "wins": 2, "opponents": ["p14", "p10", "p6", "p21", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p32", "method": "normal", "result": "loss"}]}, {"id": "p14", "name": "Κατωγιαννάκης Στέφανος", "wins": 2, "opponents": ["p13", "p30", "p36", "p19", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "win"}]}, {"id": "p15", "name": "Μακρής Θανάσης", "wins": 3, "opponents": ["p16", "p19", "p17", "p12", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}, {"id": "p16", "name": "Γιαννάκος Νίκος", "wins": 2, "opponents": ["p15", "p4", "p33", "p8", "p22"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p22", "method": "retirement_loss", "result": "loss"}]}, {"id": "p17", "name": "Μπουρεξάκης Γιώργος", "wins": 2, "opponents": ["p18", "p7", "p15", "p27", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "win"}]}, {"id": "p18", "name": "Μαστροπέρρος Νίκος", "wins": 4, "opponents": ["p17", "p22", "p30", "p5", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "loss"}]}, {"id": "p19", "name": "Χρηστίδης Χάρης", "wins": 3, "opponents": ["p20", "p15", "p23", "p14", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Κοκκίνης Πολυχρόνης", "wins": 3, "opponents": ["p19", "p28", "p7", "p24", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Καραμπλιάς Βαγγέλης", "wins": 2, "opponents": ["p22", "p27", "p3", "p13", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p29", "method": "retirement_win", "result": "win"}]}, {"id": "p22", "name": "Παπουτσής Γιάννης", "wins": 3, "opponents": ["p21", "p18", "p26", "p4", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p16", "method": "retirement_win", "result": "win"}]}, {"id": "p23", "name": "Ζούβελος Νίκος", "wins": 4, "opponents": ["p24", "p33", "p19", "p3", "p36"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p36", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Βουλγαράκης Σπύρος", "wins": 3, "opponents": ["p23", "p2", "p34", "p20", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p25", "name": "Χαρακλιάς Στέφανος", "wins": 5, "opponents": ["p26", "p9", "p11", "p35", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p26", "name": "Χατζέλης Τάκης", "wins": 1, "opponents": ["p25", "p32", "p22", "p10", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "loss"}]}, {"id": "p27", "name": "Λοστάρος Γιώργος", "wins": 0, "opponents": ["p28", "p21", "p29", "p17", "p6"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p29", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "retirement_loss", "result": "loss"}]}, {"id": "p28", "name": "Πασιαλής Γιάννης", "wins": 5, "opponents": ["p27", "p20", "p8", "p33", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "win"}]}, {"id": "p29", "name": "Καλλέργη Δωροθέα", "wins": 1, "opponents": ["p30", "p3", "p27", "p11", "p21"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p27", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p11", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p21", "method": "retirement_loss", "result": "loss"}]}, {"id": "p30", "name": "Βατανίδης Στάθης", "wins": 2, "opponents": ["p29", "p14", "p18", "p31", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Μανιάς Άρης", "wins": 3, "opponents": ["p32", "p35", "p9", "p30", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "loss"}]}, {"id": "p32", "name": "Σαπάκος Γρηγόρης", "wins": 3, "opponents": ["p31", "p26", "p10", "p9", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "win"}]}, {"id": "p33", "name": "Σακκαλής Τάκης", "wins": 4, "opponents": ["p34", "p23", "p16", "p28", "p31"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "win"}]}, {"id": "p34", "name": "Ρουμελιώτης Μιχάλης", "wins": 2, "opponents": ["p33", "p36", "p24", "p6", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "win"}]}, {"id": "p35", "name": "Κιουλέ Βαγγέλης", "wins": 3, "opponents": ["p36", "p31", "p1", "p25", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "loss"}]}, {"id": "p36", "name": "Ζωίδης Τηλέμαχος", "wins": 3, "opponents": ["p35", "p34", "p14", "p1", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p7", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p9", "loserId": "p10", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p11", "loserId": "p12", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p13", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p19", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p25", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p27", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p31", "loserId": "p32", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}, {"p1": "p35", "p2": "p36", "result": {"winnerId": "p35", "loserId": "p36", "method": "normal"}}], "bye": null}, {"round": 2, "pairs": [{"p1": "p14", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p14", "method": "normal"}}, {"p1": "p1", "p2": "p5", "result": {"winnerId": "p1", "loserId": "p5", "method": "normal"}}, {"p1": "p11", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p11", "method": "normal"}}, {"p1": "p25", "p2": "p9", "result": {"winnerId": "p25", "loserId": "p9", "method": "normal"}}, {"p1": "p31", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p31", "method": "normal"}}, {"p1": "p23", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p23", "method": "normal"}}, {"p1": "p16", "p2": "p4", "result": {"winnerId": "p16", "loserId": "p4", "method": "normal"}}, {"p1": "p28", "p2": "p20", "result": {"winnerId": "p28", "loserId": "p20", "method": "normal"}}, {"p1": "p22", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p22", "method": "normal"}}, {"p1": "p15", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p15", "method": "normal"}}, {"p1": "p7", "p2": "p17", "result": {"winnerId": "p7", "loserId": "p17", "method": "normal"}}, {"p1": "p21", "p2": "p27", "result": {"winnerId": "p21", "loserId": "p27", "method": "normal"}}, {"p1": "p12", "p2": "p6", "result": {"winnerId": "p12", "loserId": "p6", "method": "normal"}}, {"p1": "p24", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p24", "method": "normal"}}, {"p1": "p26", "p2": "p32", "result": {"winnerId": "p26", "loserId": "p32", "method": "normal"}}, {"p1": "p13", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p13", "method": "normal"}}, {"p1": "p34", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p34", "method": "normal"}}, {"p1": "p29", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p29", "method": "normal"}}], "bye": null}, {"round": 3, "pairs": [{"p1": "p8", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p8", "method": "normal"}}, {"p1": "p1", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p1", "method": "normal"}}, {"p1": "p18", "p2": "p30", "result": {"winnerId": "p18", "loserId": "p30", "method": "normal"}}, {"p1": "p33", "p2": "p16", "result": {"winnerId": "p33", "loserId": "p16", "method": "normal"}}, {"p1": "p25", "p2": "p11", "result": {"winnerId": "p25", "loserId": "p11", "method": "normal"}}, {"p1": "p3", "p2": "p21", "result": {"winnerId": "p3", "loserId": "p21", "method": "normal"}}, {"p1": "p31", "p2": "p9", "result": {"winnerId": "p31", "loserId": "p9", "method": "normal"}}, {"p1": "p4", "p2": "p12", "result": {"winnerId": "p4", "loserId": "p12", "method": "normal"}}, {"p1": "p20", "p2": "p7", "result": {"winnerId": "p20", "loserId": "p7", "method": "normal"}}, {"p1": "p36", "p2": "p14", "result": {"winnerId": "p36", "loserId": "p14", "method": "normal"}}, {"p1": "p2", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p2", "method": "normal"}}, {"p1": "p23", "p2": "p19", "result": {"winnerId": "p23", "loserId": "p19", "method": "normal"}}, {"p1": "p22", "p2": "p26", "result": {"winnerId": "p22", "loserId": "p26", "method": "normal"}}, {"p1": "p10", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p10", "method": "normal"}}, {"p1": "p29", "p2": "p27", "result": {"winnerId": "p29", "loserId": "p27", "method": "retirement"}}, {"p1": "p15", "p2": "p17", "result": {"winnerId": "p15", "loserId": "p17", "method": "normal"}}, {"p1": "p13", "p2": "p6", "result": {"winnerId": "p13", "loserId": "p6", "method": "normal"}}, {"p1": "p34", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p34", "method": "normal"}}], "bye": null}, {"round": 4, "pairs": [{"p1": "p35", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p35", "method": "normal"}}, {"p1": "p28", "p2": "p33", "result": {"winnerId": "p28", "loserId": "p33", "method": "normal"}}, {"p1": "p18", "p2": "p5", "result": {"winnerId": "p18", "loserId": "p5", "method": "normal"}}, {"p1": "p22", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p22", "method": "normal"}}, {"p1": "p23", "p2": "p3", "result": {"winnerId": "p23", "loserId": "p3", "method": "normal"}}, {"p1": "p16", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p16", "method": "normal"}}, {"p1": "p36", "p2": "p1", "result": {"winnerId": "p36", "loserId": "p1", "method": "normal"}}, {"p1": "p31", "p2": "p30", "result": {"winnerId": "p31", "loserId": "p30", "method": "normal"}}, {"p1": "p20", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p20", "method": "normal"}}, {"p1": "p15", "p2": "p12", "result": {"winnerId": "p15", "loserId": "p12", "method": "normal"}}, {"p1": "p19", "p2": "p14", "result": {"winnerId": "p19", "loserId": "p14", "method": "normal"}}, {"p1": "p21", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p21", "method": "normal"}}, {"p1": "p26", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p26", "method": "normal"}}, {"p1": "p11", "p2": "p29", "result": {"winnerId": "p11", "loserId": "p29", "method": "retirement"}}, {"p1": "p32", "p2": "p9", "result": {"winnerId": "p32", "loserId": "p9", "method": "normal"}}, {"p1": "p7", "p2": "p2", "result": {"winnerId": "p7", "loserId": "p2", "method": "normal"}}, {"p1": "p17", "p2": "p27", "result": {"winnerId": "p17", "loserId": "p27", "method": "retirement"}}, {"p1": "p34", "p2": "p6", "result": {"winnerId": "p34", "loserId": "p6", "method": "normal"}}], "bye": null}, {"round": 5, "pairs": [{"p1": "p28", "p2": "p18", "result": {"winnerId": "p28", "loserId": "p18", "method": "normal"}}, {"p1": "p25", "p2": "p4", "result": {"winnerId": "p25", "loserId": "p4", "method": "normal"}}, {"p1": "p8", "p2": "p35", "result": {"winnerId": "p8", "loserId": "p35", "method": "normal"}}, {"p1": "p23", "p2": "p36", "result": {"winnerId": "p23", "loserId": "p36", "method": "normal"}}, {"p1": "p33", "p2": "p31", "result": {"winnerId": "p33", "loserId": "p31", "method": "normal"}}, {"p1": "p32", "p2": "p13", "result": {"winnerId": "p32", "loserId": "p13", "method": "normal"}}, {"p1": "p24", "p2": "p10", "result": {"winnerId": "p24", "loserId": "p10", "method": "normal"}}, {"p1": "p22", "p2": "p16", "result": {"winnerId": "p22", "loserId": "p16", "method": "retirement"}}, {"p1": "p30", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p30", "method": "normal"}}, {"p1": "p3", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p3", "method": "normal"}}, {"p1": "p7", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p7", "method": "normal"}}, {"p1": "p5", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p5", "method": "normal"}}, {"p1": "p1", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p1", "method": "normal"}}, {"p1": "p2", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p2", "method": "normal"}}, {"p1": "p12", "p2": "p9", "result": {"winnerId": "p12", "loserId": "p9", "method": "retirement"}}, {"p1": "p29", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p29", "method": "retirement"}}, {"p1": "p26", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p26", "method": "normal"}}, {"p1": "p6", "p2": "p27", "result": {"winnerId": "p6", "loserId": "p27", "method": "retirement"}}], "bye": null}]}, "2": {"tournamentId": "hist-day2", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 2", "createdAt": "2025-10-18T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Προυκάκης Μιχάλης", "wins": 2, "opponents": ["p2", "p27", "p35", "p6", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p2", "name": "Σαπάκος Γρηγόρης", "wins": 3, "opponents": ["p1", "p32", "p24", "p34", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p18", "method": "retirement_win", "result": "win"}]}, {"id": "p3", "name": "Σέλελης Πέτρος", "wins": 2, "opponents": ["p4", "p33", "p29", "p19", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "retirement_win", "result": "win"}]}, {"id": "p4", "name": "Ατματζίδης Γιάννης", "wins": 5, "opponents": ["p3", "p23", "p22", "p11", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "win"}]}, {"id": "p5", "name": "Βουλγαράκης Σπύρος", "wins": 2, "opponents": ["p6", "p35", "p11", "p27", "p34"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Καλλέργη Δωροθέα", "wins": 1, "opponents": ["p5", "p14", "p1", "p3"], "hadBye": true, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": null, "method": "bye", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "retirement_loss", "result": "loss"}]}, {"id": "p7", "name": "Χατζηνικολάου Νίκος", "wins": 1, "opponents": ["p8", "p17", "p18", "p14"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": null, "method": "bye", "result": "win"}]}, {"id": "p8", "name": "Βατανίδης Στάθης", "wins": 2, "opponents": ["p7", "p34", "p25", "p35", "p24"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p24", "method": "retirement_loss", "result": "loss"}]}, {"id": "p9", "name": "Χατζέλης Τάκης", "wins": 3, "opponents": ["p10", "p29", "p12", "p28", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p35", "method": "normal", "result": "win"}]}, {"id": "p10", "name": "Μακρής Θανάσης", "wins": 3, "opponents": ["p9", "p30", "p14", "p16", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Τούκας Νίκος", "wins": 4, "opponents": ["p12", "p16", "p5", "p4", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "win"}]}, {"id": "p12", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p11", "p19", "p9", "p33", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "loss"}]}, {"id": "p13", "name": "Κατωγιαννάκης Στέφανος", "wins": 3, "opponents": ["p14", "p20", "p27", "p26", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "loss"}]}, {"id": "p14", "name": "Καλλίρης Ανδρέας", "wins": 3, "opponents": ["p13", "p6", "p10", "p7", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "win"}]}, {"id": "p15", "name": "Σοφοκλέους Νίκος", "wins": 2, "opponents": ["p16", "p24", "p21", "p17", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p32", "method": "retirement_win", "result": "win"}]}, {"id": "p16", "name": "Χιωτίνης Κώστας", "wins": 3, "opponents": ["p15", "p11", "p17", "p10", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Λουμίδης Σωτήρης", "wins": 3, "opponents": ["p18", "p7", "p16", "p15", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "win"}]}, {"id": "p18", "name": "Γιαννάκος Νίκος", "wins": 2, "opponents": ["p17", "p26", "p7", "p25", "p2"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p2", "method": "retirement_loss", "result": "loss"}]}, {"id": "p19", "name": "Πασιαλής Γιάννης", "wins": 3, "opponents": ["p20", "p12", "p32", "p3", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Χρηστίδης Χάρης", "wins": 3, "opponents": ["p19", "p13", "p31", "p22", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p21", "name": "Καραμπλιάς Βαγγέλης", "wins": 0, "opponents": ["p22", "p25", "p15", "p32", "p33"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p33", "method": "retirement_loss", "result": "loss"}]}, {"id": "p22", "name": "Κοκκίνης Πολυχρόνης", "wins": 2, "opponents": ["p21", "p31", "p4", "p20", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "loss"}]}, {"id": "p23", "name": "Αναστασίου Τάσος", "wins": 4, "opponents": ["p24", "p4", "p34", "p30", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Χαρακλιάς Στέφανος", "wins": 3, "opponents": ["p23", "p15", "p2", "p31", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "retirement_win", "result": "win"}]}, {"id": "p25", "name": "Χατζηιωάννου Έλενα", "wins": 4, "opponents": ["p26", "p21", "p8", "p18", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "win"}]}, {"id": "p26", "name": "Ρουμελιώτης Μιχάλης", "wins": 4, "opponents": ["p25", "p18", "p30", "p13", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "loss"}]}, {"id": "p27", "name": "Μανωλιός Μιχάλης", "wins": 3, "opponents": ["p28", "p1", "p13", "p5", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p5", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "loss"}]}, {"id": "p28", "name": "Μανιάς Άρης", "wins": 4, "opponents": ["p27", "p33", "p9", "p10"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": null, "method": "bye", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p29", "name": "Καλοφωλιάς Παναγιώτης", "wins": 2, "opponents": ["p30", "p9", "p3", "p31"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": null, "method": "bye", "result": "win"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "win"}]}, {"id": "p30", "name": "Παπουτσής Γιάννης", "wins": 2, "opponents": ["p29", "p10", "p26", "p23", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Χατζηβασιλείου Νίκος", "wins": 1, "opponents": ["p32", "p22", "p20", "p24", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p29", "method": "normal", "result": "loss"}]}, {"id": "p32", "name": "Τζάλλας Λεωνίδας", "wins": 1, "opponents": ["p31", "p2", "p19", "p21", "p15"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p15", "method": "retirement_loss", "result": "loss"}]}, {"id": "p33", "name": "Ζούβελος Νίκος", "wins": 2, "opponents": ["p34", "p3", "p28", "p12", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p21", "method": "retirement_win", "result": "win"}]}, {"id": "p34", "name": "Σακκαλής Τάκης", "wins": 3, "opponents": ["p33", "p8", "p23", "p2", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p35", "name": "Ζωίδης Τηλέμαχος", "wins": 3, "opponents": ["p5", "p1", "p8", "p9"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": null, "method": "bye", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "loss"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p7", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p9", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p11", "loserId": "p12", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p13", "loserId": "p14", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p19", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p25", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p31", "loserId": "p32", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p33", "method": "normal"}}], "bye": "p35"}, {"round": 2, "pairs": [{"p1": "p35", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p35", "method": "normal"}}, {"p1": "p26", "p2": "p18", "result": {"winnerId": "p26", "loserId": "p18", "method": "normal"}}, {"p1": "p13", "p2": "p20", "result": {"winnerId": "p13", "loserId": "p20", "method": "normal"}}, {"p1": "p22", "p2": "p31", "result": {"winnerId": "p22", "loserId": "p31", "method": "normal"}}, {"p1": "p4", "p2": "p23", "result": {"winnerId": "p4", "loserId": "p23", "method": "normal"}}, {"p1": "p30", "p2": "p10", "result": {"winnerId": "p30", "loserId": "p10", "method": "normal"}}, {"p1": "p34", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p34", "method": "normal"}}, {"p1": "p11", "p2": "p16", "result": {"winnerId": "p11", "loserId": "p16", "method": "normal"}}, {"p1": "p27", "p2": "p1", "result": {"winnerId": "p27", "loserId": "p1", "method": "normal"}}, {"p1": "p2", "p2": "p32", "result": {"winnerId": "p2", "loserId": "p32", "method": "normal"}}, {"p1": "p9", "p2": "p29", "result": {"winnerId": "p9", "loserId": "p29", "method": "normal"}}, {"p1": "p6", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p6", "method": "normal"}}, {"p1": "p3", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p3", "method": "normal"}}, {"p1": "p19", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p19", "method": "normal"}}, {"p1": "p17", "p2": "p7", "result": {"winnerId": "p17", "loserId": "p7", "method": "normal"}}, {"p1": "p15", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p15", "method": "normal"}}, {"p1": "p21", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p21", "method": "normal"}}], "bye": "p28"}, {"round": 3, "pairs": [{"p1": "p5", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p5", "method": "normal"}}, {"p1": "p26", "p2": "p30", "result": {"winnerId": "p26", "loserId": "p30", "method": "normal"}}, {"p1": "p13", "p2": "p27", "result": {"winnerId": "p13", "loserId": "p27", "method": "normal"}}, {"p1": "p22", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p22", "method": "normal"}}, {"p1": "p8", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p8", "method": "normal"}}, {"p1": "p2", "p2": "p24", "result": {"winnerId": "p2", "loserId": "p24", "method": "normal"}}, {"p1": "p31", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p31", "method": "normal"}}, {"p1": "p16", "p2": "p17", "result": {"winnerId": "p16", "loserId": "p17", "method": "normal"}}, {"p1": "p9", "p2": "p12", "result": {"winnerId": "p9", "loserId": "p12", "method": "normal"}}, {"p1": "p14", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p14", "method": "normal"}}, {"p1": "p35", "p2": "p1", "result": {"winnerId": "p35", "loserId": "p1", "method": "normal"}}, {"p1": "p34", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p34", "method": "normal"}}, {"p1": "p33", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p33", "method": "normal"}}, {"p1": "p18", "p2": "p7", "result": {"winnerId": "p18", "loserId": "p7", "method": "normal"}}, {"p1": "p32", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p32", "method": "normal"}}, {"p1": "p15", "p2": "p21", "result": {"winnerId": "p15", "loserId": "p21", "method": "normal"}}, {"p1": "p3", "p2": "p29", "result": {"winnerId": "p3", "loserId": "p29", "method": "normal"}}], "bye": "p6"}, {"round": 4, "pairs": [{"p1": "p13", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p13", "method": "normal"}}, {"p1": "p11", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p11", "method": "normal"}}, {"p1": "p28", "p2": "p9", "result": {"winnerId": "p28", "loserId": "p9", "method": "normal"}}, {"p1": "p25", "p2": "p18", "result": {"winnerId": "p25", "loserId": "p18", "method": "normal"}}, {"p1": "p20", "p2": "p22", "result": {"winnerId": "p20", "loserId": "p22", "method": "normal"}}, {"p1": "p30", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p30", "method": "normal"}}, {"p1": "p10", "p2": "p16", "result": {"winnerId": "p10", "loserId": "p16", "method": "normal"}}, {"p1": "p35", "p2": "p8", "result": {"winnerId": "p35", "loserId": "p8", "method": "normal"}}, {"p1": "p5", "p2": "p27", "result": {"winnerId": "p27", "loserId": "p5", "method": "retirement"}}, {"p1": "p2", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p2", "method": "normal"}}, {"p1": "p33", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p33", "method": "normal"}}, {"p1": "p24", "p2": "p31", "result": {"winnerId": "p24", "loserId": "p31", "method": "normal"}}, {"p1": "p19", "p2": "p3", "result": {"winnerId": "p19", "loserId": "p3", "method": "normal"}}, {"p1": "p17", "p2": "p15", "result": {"winnerId": "p17", "loserId": "p15", "method": "normal"}}, {"p1": "p6", "p2": "p1", "result": {"winnerId": "p1", "loserId": "p6", "method": "retirement"}}, {"p1": "p14", "p2": "p7", "result": {"winnerId": "p14", "loserId": "p7", "method": "normal"}}, {"p1": "p21", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p21", "method": "normal"}}], "bye": "p29"}, {"round": 5, "pairs": [{"p1": "p26", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p26", "method": "normal"}}, {"p1": "p25", "p2": "p13", "result": {"winnerId": "p25", "loserId": "p13", "method": "normal"}}, {"p1": "p10", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p10", "method": "normal"}}, {"p1": "p23", "p2": "p20", "result": {"winnerId": "p23", "loserId": "p20", "method": "normal"}}, {"p1": "p11", "p2": "p27", "result": {"winnerId": "p11", "loserId": "p27", "method": "normal"}}, {"p1": "p35", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p35", "method": "normal"}}, {"p1": "p2", "p2": "p18", "result": {"winnerId": "p2", "loserId": "p18", "method": "retirement"}}, {"p1": "p8", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p8", "method": "retirement"}}, {"p1": "p30", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p30", "method": "normal"}}, {"p1": "p1", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p1", "method": "normal"}}, {"p1": "p22", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p22", "method": "normal"}}, {"p1": "p14", "p2": "p12", "result": {"winnerId": "p14", "loserId": "p12", "method": "normal"}}, {"p1": "p5", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p5", "method": "normal"}}, {"p1": "p31", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p31", "method": "normal"}}, {"p1": "p32", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p32", "method": "retirement"}}, {"p1": "p3", "p2": "p6", "result": {"winnerId": "p3", "loserId": "p6", "method": "retirement"}}, {"p1": "p33", "p2": "p21", "result": {"winnerId": "p33", "loserId": "p21", "method": "retirement"}}], "bye": "p7"}]}, "3": {"tournamentId": "hist-day3", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 3", "createdAt": "2025-11-08T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Μανιάς Άρης", "wins": 1, "opponents": ["p2", "p17", "p16", "p6", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "loss"}]}, {"id": "p2", "name": "Τζάλλας Λεωνίδας", "wins": 4, "opponents": ["p1", "p26", "p27", "p7", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p27", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "win"}]}, {"id": "p3", "name": "Κοκκίνης Πολυχρόνης", "wins": 3, "opponents": ["p4", "p12", "p21", "p27", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "win"}]}, {"id": "p4", "name": "Τούκας Νίκος", "wins": 2, "opponents": ["p3", "p5", "p12", "p11", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "win"}]}, {"id": "p5", "name": "Ρουμελιώτης Μιχάλης", "wins": 2, "opponents": ["p6", "p4", "p28", "p25", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p25", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "retirement_win", "result": "win"}]}, {"id": "p6", "name": "Χατζηιωάννου Έλενα", "wins": 3, "opponents": ["p5", "p14", "p19", "p1", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "win"}]}, {"id": "p7", "name": "Χατζηνικολάου Νίκος", "wins": 2, "opponents": ["p8", "p19", "p24", "p2", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "loss"}]}, {"id": "p8", "name": "Βουλγαράκης Σπύρος", "wins": 1, "opponents": ["p7", "p11", "p20", "p28", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "loss"}]}, {"id": "p9", "name": "Ατματζίδης Γιάννης", "wins": 3, "opponents": ["p10", "p18", "p14", "p20", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p10", "name": "Γιαννάκος Νίκος", "wins": 1, "opponents": ["p9", "p21", "p11", "p16", "p25"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p11", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p16", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p25", "method": "retirement_win", "result": "win"}]}, {"id": "p11", "name": "Λουμίδης Σωτήρης", "wins": 3, "opponents": ["p12", "p8", "p10", "p4", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p10", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "win"}]}, {"id": "p12", "name": "Χρηστίδης Χάρης", "wins": 5, "opponents": ["p11", "p3", "p4", "p22", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "win"}]}, {"id": "p13", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p14", "p28", "p18", "p17", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "retirement_win", "result": "win"}]}, {"id": "p14", "name": "Κατωγιαννάκης Στέφανος", "wins": 4, "opponents": ["p13", "p6", "p9", "p24", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "loss"}]}, {"id": "p15", "name": "Χατζηβασιλείου Νίκος", "wins": 2, "opponents": ["p16", "p24", "p25", "p26", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p25", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "loss"}]}, {"id": "p16", "name": "Καραμπλιάς Βαγγέλης", "wins": 1, "opponents": ["p15", "p23", "p1", "p10", "p5"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p5", "method": "retirement_loss", "result": "loss"}]}, {"id": "p17", "name": "Καλοφωλιάς Παναγιώτης", "wins": 3, "opponents": ["p18", "p1", "p23", "p13", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "win"}]}, {"id": "p18", "name": "Σαπάκος Γρηγόρης", "wins": 2, "opponents": ["p17", "p9", "p13", "p23", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p19", "name": "Σακκαλής Τάκης", "wins": 2, "opponents": ["p20", "p7", "p6", "p21", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "loss"}]}, {"id": "p20", "name": "Κρητικός Ιγνάτιος", "wins": 3, "opponents": ["p19", "p25", "p8", "p9", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p25", "method": "retirement_win", "result": "win"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Μακρής Θανάσης", "wins": 3, "opponents": ["p22", "p10", "p3", "p19", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "loss"}]}, {"id": "p22", "name": "Χατζέλης Τάκης", "wins": 3, "opponents": ["p21", "p27", "p26", "p12", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "loss"}]}, {"id": "p23", "name": "Βατανίδης Στάθης", "wins": 4, "opponents": ["p24", "p16", "p17", "p18", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Πασιαλής Γιάννης", "wins": 3, "opponents": ["p23", "p15", "p7", "p14", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "loss"}]}, {"id": "p25", "name": "Χατζηκωσταράς Βαγγέλης", "wins": 0, "opponents": ["p26", "p20", "p15", "p5", "p10"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p20", "method": "retirement_loss", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p5", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "retirement_loss", "result": "loss"}]}, {"id": "p26", "name": "Καλλίρης Ανδρέας", "wins": 4, "opponents": ["p25", "p2", "p22", "p15", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "win"}]}, {"id": "p27", "name": "Γκανάς Γιώργος", "wins": 1, "opponents": ["p28", "p22", "p2", "p3", "p13"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p2", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p3", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p13", "method": "retirement_loss", "result": "loss"}]}, {"id": "p28", "name": "Ζωίδης Τηλέμαχος", "wins": 3, "opponents": ["p27", "p13", "p5", "p8", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p1", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p3", "loserId": "p4", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p5", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p9", "loserId": "p10", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p13", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p15", "loserId": "p16", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p19", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p23", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p25", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}], "bye": null}, {"round": 2, "pairs": [{"p1": "p9", "p2": "p18", "result": {"winnerId": "p9", "loserId": "p18", "method": "normal"}}, {"p1": "p22", "p2": "p27", "result": {"winnerId": "p22", "loserId": "p27", "method": "normal"}}, {"p1": "p2", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p2", "method": "normal"}}, {"p1": "p14", "p2": "p6", "result": {"winnerId": "p14", "loserId": "p6", "method": "normal"}}, {"p1": "p15", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p15", "method": "normal"}}, {"p1": "p7", "p2": "p19", "result": {"winnerId": "p7", "loserId": "p19", "method": "normal"}}, {"p1": "p3", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p3", "method": "normal"}}, {"p1": "p17", "p2": "p1", "result": {"winnerId": "p17", "loserId": "p1", "method": "normal"}}, {"p1": "p5", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p5", "method": "normal"}}, {"p1": "p25", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p25", "method": "retirement"}}, {"p1": "p13", "p2": "p28", "result": {"winnerId": "p13", "loserId": "p28", "method": "normal"}}, {"p1": "p8", "p2": "p11", "result": {"winnerId": "p8", "loserId": "p11", "method": "normal"}}, {"p1": "p16", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p16", "method": "normal"}}, {"p1": "p10", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p10", "method": "normal"}}], "bye": null}, {"round": 3, "pairs": [{"p1": "p22", "p2": "p26", "result": {"winnerId": "p22", "loserId": "p26", "method": "normal"}}, {"p1": "p24", "p2": "p7", "result": {"winnerId": "p24", "loserId": "p7", "method": "normal"}}, {"p1": "p14", "p2": "p9", "result": {"winnerId": "p14", "loserId": "p9", "method": "normal"}}, {"p1": "p12", "p2": "p4", "result": {"winnerId": "p12", "loserId": "p4", "method": "normal"}}, {"p1": "p19", "p2": "p6", "result": {"winnerId": "p19", "loserId": "p6", "method": "normal"}}, {"p1": "p2", "p2": "p27", "result": {"winnerId": "p2", "loserId": "p27", "method": "retirement"}}, {"p1": "p8", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p8", "method": "normal"}}, {"p1": "p13", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p13", "method": "normal"}}, {"p1": "p17", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p17", "method": "normal"}}, {"p1": "p3", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p3", "method": "normal"}}, {"p1": "p15", "p2": "p25", "result": {"winnerId": "p15", "loserId": "p25", "method": "retirement"}}, {"p1": "p28", "p2": "p5", "result": {"winnerId": "p28", "loserId": "p5", "method": "normal"}}, {"p1": "p10", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p10", "method": "retirement"}}, {"p1": "p16", "p2": "p1", "result": {"winnerId": "p1", "loserId": "p16", "method": "normal"}}], "bye": null}, {"round": 4, "pairs": [{"p1": "p14", "p2": "p24", "result": {"winnerId": "p14", "loserId": "p24", "method": "normal"}}, {"p1": "p12", "p2": "p22", "result": {"winnerId": "p12", "loserId": "p22", "method": "normal"}}, {"p1": "p26", "p2": "p15", "result": {"winnerId": "p26", "loserId": "p15", "method": "normal"}}, {"p1": "p23", "p2": "p18", "result": {"winnerId": "p23", "loserId": "p18", "method": "normal"}}, {"p1": "p20", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p20", "method": "normal"}}, {"p1": "p19", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p19", "method": "normal"}}, {"p1": "p2", "p2": "p7", "result": {"winnerId": "p2", "loserId": "p7", "method": "normal"}}, {"p1": "p8", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p8", "method": "normal"}}, {"p1": "p6", "p2": "p1", "result": {"winnerId": "p6", "loserId": "p1", "method": "normal"}}, {"p1": "p17", "p2": "p13", "result": {"winnerId": "p17", "loserId": "p13", "method": "normal"}}, {"p1": "p27", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p27", "method": "retirement"}}, {"p1": "p11", "p2": "p4", "result": {"winnerId": "p11", "loserId": "p4", "method": "normal"}}, {"p1": "p10", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p10", "method": "retirement"}}, {"p1": "p5", "p2": "p25", "result": {"winnerId": "p5", "loserId": "p25", "method": "retirement"}}], "bye": null}, {"round": 5, "pairs": [{"p1": "p14", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p14", "method": "normal"}}, {"p1": "p26", "p2": "p21", "result": {"winnerId": "p26", "loserId": "p21", "method": "normal"}}, {"p1": "p2", "p2": "p24", "result": {"winnerId": "p2", "loserId": "p24", "method": "normal"}}, {"p1": "p23", "p2": "p9", "result": {"winnerId": "p23", "loserId": "p9", "method": "normal"}}, {"p1": "p22", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p22", "method": "normal"}}, {"p1": "p20", "p2": "p18", "result": {"winnerId": "p20", "loserId": "p18", "method": "normal"}}, {"p1": "p6", "p2": "p7", "result": {"winnerId": "p6", "loserId": "p7", "method": "normal"}}, {"p1": "p11", "p2": "p19", "result": {"winnerId": "p11", "loserId": "p19", "method": "normal"}}, {"p1": "p15", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p15", "method": "normal"}}, {"p1": "p3", "p2": "p1", "result": {"winnerId": "p3", "loserId": "p1", "method": "normal"}}, {"p1": "p27", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p27", "method": "retirement"}}, {"p1": "p16", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p16", "method": "retirement"}}, {"p1": "p8", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p8", "method": "normal"}}, {"p1": "p10", "p2": "p25", "result": {"winnerId": "p10", "loserId": "p25", "method": "retirement"}}], "bye": null}]}, "4": {"tournamentId": "hist-day4", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 4", "createdAt": "2025-11-29T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Χατζηιωάννου Έλενα", "wins": 2, "opponents": ["p2", "p21", "p9", "p15", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "win"}]}, {"id": "p2", "name": "Σέλελης Πέτρος", "wins": 4, "opponents": ["p1", "p23", "p22", "p20", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "loss"}]}, {"id": "p3", "name": "Χιωτίνης Κώστας", "wins": 3, "opponents": ["p4", "p25", "p15", "p28", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p4", "name": "Χαρακλιάς Στέφανος", "wins": 3, "opponents": ["p3", "p7", "p18", "p26", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p6", "p22", "p29", "p21", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Ζωίδης Τηλέμαχος", "wins": 2, "opponents": ["p5", "p18", "p17", "p16", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p7", "name": "Γιαννακόπουλος Αργύριος", "wins": 2, "opponents": ["p8", "p4", "p21", "p13", "p29"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p29", "method": "retirement_loss", "result": "loss"}]}, {"id": "p8", "name": "Σοφοκλέους Νίκος", "wins": 4, "opponents": ["p7", "p24", "p10", "p29", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "win"}]}, {"id": "p9", "name": "Τούκας Νίκος", "wins": 0, "opponents": ["p10", "p12", "p1", "p25", "p24"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p25", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p24", "method": "retirement_loss", "result": "loss"}]}, {"id": "p10", "name": "Παπουτσής Γιάννης", "wins": 1, "opponents": ["p9", "p20", "p8", "p23", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Ρουμελιώτης Μιχάλης", "wins": 4, "opponents": ["p12", "p28", "p26", "p19", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "win"}]}, {"id": "p12", "name": "Λουμίδης Σωτήρης", "wins": 2, "opponents": ["p11", "p9", "p13", "p27", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "win"}]}, {"id": "p13", "name": "Σακκαλής Τάκης", "wins": 4, "opponents": ["p14", "p27", "p12", "p7", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p14", "name": "Γιαννάκος Νίκος", "wins": 3, "opponents": ["p13", "p15", "p20", "p30", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "loss"}]}, {"id": "p15", "name": "Ατματζίδης Γιάννης", "wins": 2, "opponents": ["p16", "p14", "p3", "p1", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "loss"}]}, {"id": "p16", "name": "Μπερτάχος Νίκος", "wins": 2, "opponents": ["p15", "p19", "p30", "p6", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p17", "name": "Τζάλλας Λεωνίδας", "wins": 1, "opponents": ["p18", "p29", "p6", "p24", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "loss"}]}, {"id": "p18", "name": "Καραμπλιάς Βαγγέλης", "wins": 4, "opponents": ["p17", "p6", "p4", "p22", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "win"}]}, {"id": "p19", "name": "Βατανίδης Στάθης", "wins": 1, "opponents": ["p20", "p16", "p24", "p11", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "loss"}]}, {"id": "p20", "name": "Καλλίρης Ανδρέας", "wins": 3, "opponents": ["p19", "p10", "p14", "p2", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "loss"}]}, {"id": "p21", "name": "Αναστασίου Τάσος", "wins": 2, "opponents": ["p22", "p1", "p7", "p5", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "win"}]}, {"id": "p22", "name": "Χρηστίδης Χάρης", "wins": 3, "opponents": ["p21", "p5", "p2", "p18", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "win"}]}, {"id": "p23", "name": "Χατζέλης Τάκης", "wins": 3, "opponents": ["p24", "p2", "p28", "p10", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Χατζηνικολάου Νίκος", "wins": 1, "opponents": ["p23", "p8", "p19", "p17", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p9", "method": "retirement_win", "result": "win"}]}, {"id": "p25", "name": "Σαπάκος Γρηγόρης", "wins": 1, "opponents": ["p26", "p3", "p27", "p9", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p9", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "loss"}]}, {"id": "p26", "name": "Κοκκίνης Πολυχρόνης", "wins": 5, "opponents": ["p25", "p30", "p11", "p4", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "win"}]}, {"id": "p27", "name": "Βράνιτς Μαριάννα", "wins": 2, "opponents": ["p28", "p13", "p25", "p12", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "loss"}]}, {"id": "p28", "name": "Καλοφωλιάς Παναγιώτης", "wins": 3, "opponents": ["p27", "p11", "p23", "p3", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "loss"}]}, {"id": "p29", "name": "Ζούβελος Νίκος", "wins": 3, "opponents": ["p30", "p17", "p5", "p8", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p7", "method": "retirement_win", "result": "win"}]}, {"id": "p30", "name": "Κατωγιαννάκης Στέφανος", "wins": 3, "opponents": ["p29", "p26", "p16", "p14", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p1", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p9", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p11", "loserId": "p12", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p13", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p15", "loserId": "p16", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p19", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p25", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p27", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}], "bye": null}, {"round": 2, "pairs": [{"p1": "p11", "p2": "p28", "result": {"winnerId": "p11", "loserId": "p28", "method": "normal"}}, {"p1": "p22", "p2": "p5", "result": {"winnerId": "p22", "loserId": "p5", "method": "normal"}}, {"p1": "p30", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p30", "method": "normal"}}, {"p1": "p15", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p15", "method": "normal"}}, {"p1": "p4", "p2": "p7", "result": {"winnerId": "p4", "loserId": "p7", "method": "normal"}}, {"p1": "p2", "p2": "p23", "result": {"winnerId": "p2", "loserId": "p23", "method": "normal"}}, {"p1": "p10", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p10", "method": "normal"}}, {"p1": "p18", "p2": "p6", "result": {"winnerId": "p18", "loserId": "p6", "method": "normal"}}, {"p1": "p24", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p25", "method": "normal"}}, {"p1": "p16", "p2": "p19", "result": {"winnerId": "p16", "loserId": "p19", "method": "normal"}}, {"p1": "p27", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p27", "method": "normal"}}, {"p1": "p9", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p9", "method": "normal"}}, {"p1": "p17", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p17", "method": "normal"}}, {"p1": "p21", "p2": "p1", "result": {"winnerId": "p21", "loserId": "p1", "method": "normal"}}], "bye": null}, {"round": 3, "pairs": [{"p1": "p26", "p2": "p11", "result": {"winnerId": "p26", "loserId": "p11", "method": "normal"}}, {"p1": "p18", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p18", "method": "normal"}}, {"p1": "p14", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p14", "method": "normal"}}, {"p1": "p2", "p2": "p22", "result": {"winnerId": "p2", "loserId": "p22", "method": "normal"}}, {"p1": "p12", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p12", "method": "normal"}}, {"p1": "p28", "p2": "p23", "result": {"winnerId": "p28", "loserId": "p23", "method": "normal"}}, {"p1": "p5", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p5", "method": "normal"}}, {"p1": "p8", "p2": "p10", "result": {"winnerId": "p8", "loserId": "p10", "method": "normal"}}, {"p1": "p7", "p2": "p21", "result": {"winnerId": "p7", "loserId": "p21", "method": "normal"}}, {"p1": "p30", "p2": "p16", "result": {"winnerId": "p30", "loserId": "p16", "method": "normal"}}, {"p1": "p15", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p15", "method": "normal"}}, {"p1": "p27", "p2": "p25", "result": {"winnerId": "p27", "loserId": "p25", "method": "normal"}}, {"p1": "p1", "p2": "p9", "result": {"winnerId": "p1", "loserId": "p9", "method": "normal"}}, {"p1": "p19", "p2": "p24", "result": {"winnerId": "p19", "loserId": "p24", "method": "normal"}}, {"p1": "p6", "p2": "p17", "result": {"winnerId": "p6", "loserId": "p17", "method": "normal"}}], "bye": null}, {"round": 4, "pairs": [{"p1": "p2", "p2": "p20", "result": {"winnerId": "p2", "loserId": "p20", "method": "normal"}}, {"p1": "p4", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p4", "method": "normal"}}, {"p1": "p3", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p3", "method": "normal"}}, {"p1": "p8", "p2": "p29", "result": {"winnerId": "p8", "loserId": "p29", "method": "normal"}}, {"p1": "p18", "p2": "p22", "result": {"winnerId": "p18", "loserId": "p22", "method": "normal"}}, {"p1": "p14", "p2": "p30", "result": {"winnerId": "p14", "loserId": "p30", "method": "normal"}}, {"p1": "p7", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p7", "method": "normal"}}, {"p1": "p11", "p2": "p19", "result": {"winnerId": "p11", "loserId": "p19", "method": "normal"}}, {"p1": "p27", "p2": "p12", "result": {"winnerId": "p27", "loserId": "p12", "method": "normal"}}, {"p1": "p6", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p6", "method": "normal"}}, {"p1": "p1", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p1", "method": "normal"}}, {"p1": "p23", "p2": "p10", "result": {"winnerId": "p23", "loserId": "p10", "method": "normal"}}, {"p1": "p5", "p2": "p21", "result": {"winnerId": "p5", "loserId": "p21", "method": "normal"}}, {"p1": "p17", "p2": "p24", "result": {"winnerId": "p17", "loserId": "p24", "method": "normal"}}, {"p1": "p9", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p9", "method": "retirement"}}], "bye": null}, {"round": 5, "pairs": [{"p1": "p26", "p2": "p2", "result": {"winnerId": "p26", "loserId": "p2", "method": "normal"}}, {"p1": "p4", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p4", "method": "normal"}}, {"p1": "p14", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p14", "method": "normal"}}, {"p1": "p20", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p20", "method": "normal"}}, {"p1": "p28", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p28", "method": "normal"}}, {"p1": "p3", "p2": "p5", "result": {"winnerId": "p3", "loserId": "p5", "method": "normal"}}, {"p1": "p29", "p2": "p7", "result": {"winnerId": "p29", "loserId": "p7", "method": "retirement"}}, {"p1": "p30", "p2": "p27", "result": {"winnerId": "p30", "loserId": "p27", "method": "normal"}}, {"p1": "p23", "p2": "p16", "result": {"winnerId": "p23", "loserId": "p16", "method": "normal"}}, {"p1": "p15", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p15", "method": "normal"}}, {"p1": "p10", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p10", "method": "normal"}}, {"p1": "p17", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p17", "method": "normal"}}, {"p1": "p12", "p2": "p25", "result": {"winnerId": "p12", "loserId": "p25", "method": "normal"}}, {"p1": "p1", "p2": "p19", "result": {"winnerId": "p1", "loserId": "p19", "method": "normal"}}, {"p1": "p24", "p2": "p9", "result": {"winnerId": "p24", "loserId": "p9", "method": "retirement"}}], "bye": null}]}, "5": {"tournamentId": "hist-day5", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 5", "createdAt": "2026-01-10T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Λουμίδης Σωτήρης", "wins": 2, "opponents": ["p2", "p34", "p15", "p6", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "win"}]}, {"id": "p2", "name": "Καλοφωλιάς Παναγιώτης", "wins": 5, "opponents": ["p1", "p24", "p18", "p39", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p39", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}, {"id": "p3", "name": "Μελισσίδου Ελένη", "wins": 2, "opponents": ["p4", "p17", "p10", "p8", "p31"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "win"}]}, {"id": "p4", "name": "Κούκιαρης Ντίνος", "wins": 2, "opponents": ["p3", "p9", "p21", "p12", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Πολυδώρου Θοδωρής", "wins": 3, "opponents": ["p6", "p12", "p36", "p18", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "win"}]}, {"id": "p6", "name": "Βουλγαράκης Σπύρος", "wins": 1, "opponents": ["p5", "p8", "p22", "p1", "p28"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "retirement_loss", "result": "loss"}]}, {"id": "p7", "name": "Κρητικός Ιγνάτιος", "wins": 2, "opponents": ["p8", "p21", "p9", "p25", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "loss"}]}, {"id": "p8", "name": "Ζούβελος Νίκος", "wins": 1, "opponents": ["p7", "p6", "p38", "p3"], "hadBye": true, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p38", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p3", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": null, "method": "bye", "result": "win"}]}, {"id": "p9", "name": "Σακκαλής Τάκης", "wins": 3, "opponents": ["p10", "p4", "p7", "p14", "p38"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p38", "method": "retirement_win", "result": "win"}]}, {"id": "p10", "name": "Καράογλου Γιάννης", "wins": 3, "opponents": ["p9", "p29", "p3", "p36", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p36", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p11", "name": "Πασιαλής Γιάννης", "wins": 4, "opponents": ["p12", "p15", "p31", "p37", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "win"}]}, {"id": "p12", "name": "Λιάπης Νίκος", "wins": 5, "opponents": ["p11", "p5", "p25", "p4", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "win"}]}, {"id": "p13", "name": "Αναστασίου Τάσος", "wins": 3, "opponents": ["p14", "p37", "p30", "p17", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "loss"}]}, {"id": "p14", "name": "Χατζηνικολάου Νίκος", "wins": 1, "opponents": ["p13", "p28", "p9", "p1"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": null, "method": "bye", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "loss"}]}, {"id": "p15", "name": "Αποστολόπουλος Γιώργος", "wins": 3, "opponents": ["p16", "p11", "p1", "p34", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "win"}]}, {"id": "p16", "name": "Χατζέλης Τάκης", "wins": 4, "opponents": ["p15", "p31", "p39", "p19", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p39", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Προυκάκης Μιχάλης", "wins": 2, "opponents": ["p18", "p3", "p24", "p13", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "loss"}]}, {"id": "p18", "name": "Χρηστίδης Χάρης", "wins": 3, "opponents": ["p17", "p36", "p2", "p5", "p39"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p39", "method": "normal", "result": "loss"}]}, {"id": "p19", "name": "Μανιάς Άρης", "wins": 2, "opponents": ["p20", "p25", "p34", "p16", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "loss"}]}, {"id": "p20", "name": "Χατζηιωάννου Έλενα", "wins": 3, "opponents": ["p19", "p23", "p29", "p22", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p35", "method": "retirement_win", "result": "win"}]}, {"id": "p21", "name": "Κατωγιαννάκης Στέφανος", "wins": 3, "opponents": ["p22", "p7", "p4", "p30", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "loss"}]}, {"id": "p22", "name": "Σαπάκος Γρηγόρης", "wins": 3, "opponents": ["p21", "p32", "p6", "p20", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "loss"}]}, {"id": "p23", "name": "Σοφοκλέους Νίκος", "wins": 2, "opponents": ["p24", "p20", "p32", "p31", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p29", "method": "normal", "result": "loss"}]}, {"id": "p24", "name": "Χαρακλιάς Στέφανος", "wins": 3, "opponents": ["p23", "p2", "p17", "p38", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "win"}]}, {"id": "p25", "name": "Βατανίδης Στάθης", "wins": 3, "opponents": ["p26", "p19", "p12", "p7", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p26", "name": "Μακρής Θανάσης", "wins": 2, "opponents": ["p25", "p38", "p27", "p29", "p36"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p36", "method": "retirement_win", "result": "win"}]}, {"id": "p27", "name": "Τζάλλας Λεωνίδας", "wins": 4, "opponents": ["p28", "p30", "p26", "p35", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "win"}]}, {"id": "p28", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p27", "p14", "p37", "p33", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p37", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "retirement_win", "result": "win"}]}, {"id": "p29", "name": "Κοκκίνης Πολυχρόνης", "wins": 3, "opponents": ["p30", "p10", "p20", "p26", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "win"}]}, {"id": "p30", "name": "Ζωίδης Τηλέμαχος", "wins": 4, "opponents": ["p29", "p27", "p13", "p21", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Ατματζίδης Γιάννης", "wins": 1, "opponents": ["p32", "p16", "p11", "p23", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "loss"}]}, {"id": "p32", "name": "Καραμπλιάς Βαγγέλης", "wins": 2, "opponents": ["p31", "p22", "p23", "p34"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": null, "method": "bye", "result": "win"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "win"}]}, {"id": "p33", "name": "Καλλίρης Ανδρέας", "wins": 2, "opponents": ["p34", "p39", "p35", "p28", "p37"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p39", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p37", "method": "normal", "result": "loss"}]}, {"id": "p34", "name": "Μπερτάχος Νίκος", "wins": 1, "opponents": ["p33", "p1", "p19", "p15", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p32", "method": "normal", "result": "loss"}]}, {"id": "p35", "name": "Παπακώστας Νίκος", "wins": 2, "opponents": ["p36", "p33", "p27", "p20"], "hadBye": true, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": null, "method": "bye", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p20", "method": "retirement_loss", "result": "loss"}]}, {"id": "p36", "name": "Γιαννάκος Νίκος", "wins": 1, "opponents": ["p35", "p18", "p5", "p10", "p26"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p26", "method": "retirement_loss", "result": "loss"}]}, {"id": "p37", "name": "Χιωτίνης Κώστας", "wins": 3, "opponents": ["p38", "p13", "p28", "p11", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "win"}]}, {"id": "p38", "name": "Χατζηβασιλείου Νίκος", "wins": 1, "opponents": ["p37", "p26", "p8", "p24", "p9"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p37", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p9", "method": "retirement_loss", "result": "loss"}]}, {"id": "p39", "name": "Παπουτσής Γιάννης", "wins": 4, "opponents": ["p33", "p16", "p2", "p18"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": null, "method": "bye", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p1", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p9", "loserId": "p10", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p13", "loserId": "p14", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p19", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p21", "loserId": "p22", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p23", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p25", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p31", "loserId": "p32", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}, {"p1": "p35", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p35", "method": "normal"}}, {"p1": "p37", "p2": "p38", "result": {"winnerId": "p37", "loserId": "p38", "method": "normal"}}], "bye": "p39"}, {"round": 2, "pairs": [{"p1": "p7", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p7", "method": "normal"}}, {"p1": "p25", "p2": "p19", "result": {"winnerId": "p25", "loserId": "p19", "method": "normal"}}, {"p1": "p33", "p2": "p39", "result": {"winnerId": "p39", "loserId": "p33", "method": "normal"}}, {"p1": "p24", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p24", "method": "normal"}}, {"p1": "p31", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p31", "method": "normal"}}, {"p1": "p30", "p2": "p27", "result": {"winnerId": "p30", "loserId": "p27", "method": "normal"}}, {"p1": "p37", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p37", "method": "normal"}}, {"p1": "p5", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p5", "method": "normal"}}, {"p1": "p4", "p2": "p9", "result": {"winnerId": "p4", "loserId": "p9", "method": "normal"}}, {"p1": "p36", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p36", "method": "normal"}}, {"p1": "p3", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p3", "method": "normal"}}, {"p1": "p10", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p10", "method": "normal"}}, {"p1": "p32", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p32", "method": "normal"}}, {"p1": "p11", "p2": "p15", "result": {"winnerId": "p11", "loserId": "p15", "method": "normal"}}, {"p1": "p6", "p2": "p8", "result": {"winnerId": "p6", "loserId": "p8", "method": "normal"}}, {"p1": "p20", "p2": "p23", "result": {"winnerId": "p20", "loserId": "p23", "method": "normal"}}, {"p1": "p26", "p2": "p38", "result": {"winnerId": "p26", "loserId": "p38", "method": "normal"}}, {"p1": "p1", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p1", "method": "normal"}}, {"p1": "p28", "p2": "p14", "result": {"winnerId": "p28", "loserId": "p14", "method": "normal"}}], "bye": "p35"}, {"round": 3, "pairs": [{"p1": "p12", "p2": "p25", "result": {"winnerId": "p12", "loserId": "p25", "method": "normal"}}, {"p1": "p4", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p4", "method": "normal"}}, {"p1": "p30", "p2": "p13", "result": {"winnerId": "p30", "loserId": "p13", "method": "normal"}}, {"p1": "p39", "p2": "p16", "result": {"winnerId": "p39", "loserId": "p16", "method": "normal"}}, {"p1": "p18", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p18", "method": "normal"}}, {"p1": "p34", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p34", "method": "normal"}}, {"p1": "p33", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p33", "method": "normal"}}, {"p1": "p29", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p29", "method": "normal"}}, {"p1": "p7", "p2": "p9", "result": {"winnerId": "p7", "loserId": "p9", "method": "normal"}}, {"p1": "p17", "p2": "p24", "result": {"winnerId": "p17", "loserId": "p24", "method": "normal"}}, {"p1": "p31", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p31", "method": "normal"}}, {"p1": "p26", "p2": "p27", "result": {"winnerId": "p27", "loserId": "p26", "method": "normal"}}, {"p1": "p36", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p36", "method": "normal"}}, {"p1": "p37", "p2": "p28", "result": {"winnerId": "p37", "loserId": "p28", "method": "normal"}}, {"p1": "p6", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p6", "method": "normal"}}, {"p1": "p15", "p2": "p1", "result": {"winnerId": "p15", "loserId": "p1", "method": "normal"}}, {"p1": "p23", "p2": "p32", "result": {"winnerId": "p23", "loserId": "p32", "method": "normal"}}, {"p1": "p3", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p3", "method": "normal"}}, {"p1": "p38", "p2": "p8", "result": {"winnerId": "p38", "loserId": "p8", "method": "retirement"}}], "bye": "p14"}, {"round": 4, "pairs": [{"p1": "p21", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p21", "method": "normal"}}, {"p1": "p39", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p39", "method": "normal"}}, {"p1": "p12", "p2": "p4", "result": {"winnerId": "p12", "loserId": "p4", "method": "normal"}}, {"p1": "p20", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p20", "method": "normal"}}, {"p1": "p19", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p19", "method": "normal"}}, {"p1": "p37", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p37", "method": "normal"}}, {"p1": "p17", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p17", "method": "normal"}}, {"p1": "p7", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p7", "method": "normal"}}, {"p1": "p27", "p2": "p35", "result": {"winnerId": "p27", "loserId": "p35", "method": "normal"}}, {"p1": "p18", "p2": "p5", "result": {"winnerId": "p18", "loserId": "p5", "method": "normal"}}, {"p1": "p36", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p36", "method": "retirement"}}, {"p1": "p24", "p2": "p38", "result": {"winnerId": "p24", "loserId": "p38", "method": "normal"}}, {"p1": "p33", "p2": "p28", "result": {"winnerId": "p33", "loserId": "p28", "method": "normal"}}, {"p1": "p14", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p14", "method": "normal"}}, {"p1": "p29", "p2": "p26", "result": {"winnerId": "p29", "loserId": "p26", "method": "normal"}}, {"p1": "p15", "p2": "p34", "result": {"winnerId": "p15", "loserId": "p34", "method": "normal"}}, {"p1": "p23", "p2": "p31", "result": {"winnerId": "p23", "loserId": "p31", "method": "normal"}}, {"p1": "p6", "p2": "p1", "result": {"winnerId": "p1", "loserId": "p6", "method": "normal"}}, {"p1": "p8", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p8", "method": "retirement"}}], "bye": "p32"}, {"round": 5, "pairs": [{"p1": "p30", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p30", "method": "normal"}}, {"p1": "p12", "p2": "p21", "result": {"winnerId": "p12", "loserId": "p21", "method": "normal"}}, {"p1": "p11", "p2": "p22", "result": {"winnerId": "p11", "loserId": "p22", "method": "normal"}}, {"p1": "p27", "p2": "p13", "result": {"winnerId": "p27", "loserId": "p13", "method": "normal"}}, {"p1": "p16", "p2": "p25", "result": {"winnerId": "p16", "loserId": "p25", "method": "normal"}}, {"p1": "p39", "p2": "p18", "result": {"winnerId": "p39", "loserId": "p18", "method": "normal"}}, {"p1": "p5", "p2": "p7", "result": {"winnerId": "p5", "loserId": "p7", "method": "normal"}}, {"p1": "p35", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p35", "method": "retirement"}}, {"p1": "p19", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p19", "method": "normal"}}, {"p1": "p23", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p23", "method": "normal"}}, {"p1": "p10", "p2": "p4", "result": {"winnerId": "p10", "loserId": "p4", "method": "normal"}}, {"p1": "p15", "p2": "p17", "result": {"winnerId": "p15", "loserId": "p17", "method": "normal"}}, {"p1": "p33", "p2": "p37", "result": {"winnerId": "p37", "loserId": "p33", "method": "normal"}}, {"p1": "p9", "p2": "p38", "result": {"winnerId": "p9", "loserId": "p38", "method": "retirement"}}, {"p1": "p6", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p6", "method": "retirement"}}, {"p1": "p26", "p2": "p36", "result": {"winnerId": "p26", "loserId": "p36", "method": "retirement"}}, {"p1": "p3", "p2": "p31", "result": {"winnerId": "p3", "loserId": "p31", "method": "normal"}}, {"p1": "p32", "p2": "p34", "result": {"winnerId": "p32", "loserId": "p34", "method": "normal"}}, {"p1": "p1", "p2": "p14", "result": {"winnerId": "p1", "loserId": "p14", "method": "normal"}}], "bye": "p8"}]}, "6": {"tournamentId": "hist-day6", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 6", "createdAt": "2026-02-14T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Χρηστίδης Χάρης", "wins": 3, "opponents": ["p2", "p19", "p23", "p25", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "loss"}]}, {"id": "p2", "name": "Χατζηβασιλείου Νίκος", "wins": 2, "opponents": ["p1", "p22", "p20", "p24", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p26", "method": "retirement_win", "result": "win"}]}, {"id": "p3", "name": "Βουλγαράκης Σπύρος", "wins": 1, "opponents": ["p4", "p8", "p18", "p36", "p34"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p34", "method": "retirement_loss", "result": "loss"}]}, {"id": "p4", "name": "Βατανίδης Στάθης", "wins": 2, "opponents": ["p3", "p21", "p19", "p34", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Δημάκης Θοδωρής", "wins": 3, "opponents": ["p6", "p35", "p14", "p16", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Καράογλου Γιάννης", "wins": 4, "opponents": ["p5", "p32", "p9", "p21", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "win"}]}, {"id": "p7", "name": "Λιάπης Νίκος", "wins": 3, "opponents": ["p8", "p25", "p29", "p10", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "loss"}]}, {"id": "p8", "name": "Προυκάκης Μιχάλης", "wins": 4, "opponents": ["p7", "p3", "p37", "p28", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p9", "name": "Λουμίδης Σωτήρης", "wins": 3, "opponents": ["p10", "p6", "p27", "p4"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": null, "method": "bye", "result": "win"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p10", "name": "Μανιάς Άρης", "wins": 2, "opponents": ["p9", "p37", "p16", "p7", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Μακρής Θανάσης", "wins": 1, "opponents": ["p12", "p36", "p22", "p33"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": null, "method": "bye", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "loss"}]}, {"id": "p12", "name": "Κατωγιαννάκης Στέφανος", "wins": 4, "opponents": ["p11", "p13", "p17", "p23", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "win"}]}, {"id": "p13", "name": "Καλοφωλιάς Παναγιώτης", "wins": 3, "opponents": ["p14", "p12", "p31", "p30", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "win"}]}, {"id": "p14", "name": "Σακκαλής Τάκης", "wins": 3, "opponents": ["p13", "p15", "p5", "p19", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "win"}]}, {"id": "p15", "name": "Χαρακλιάς Στέφανος", "wins": 1, "opponents": ["p16", "p14", "p34", "p32", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p32", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p16", "name": "Κοκκίνης Πολυχρόνης", "wins": 4, "opponents": ["p15", "p33", "p10", "p5", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p35", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Μανωλιός Μιχάλης", "wins": 3, "opponents": ["p18", "p31", "p12", "p20", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "loss"}]}, {"id": "p18", "name": "Χατζηιωάννου Έλενα", "wins": 2, "opponents": ["p17", "p20", "p3", "p32"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": null, "method": "bye", "result": "win"}, {"round": 5, "opponentId": "p32", "method": "retirement_win", "result": "win"}]}, {"id": "p19", "name": "Σοφός Σπύρος", "wins": 3, "opponents": ["p20", "p1", "p4", "p14", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Καλλίρης Ανδρέας", "wins": 3, "opponents": ["p19", "p18", "p2", "p17", "p31"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Παπουτσής Γιάννης", "wins": 2, "opponents": ["p22", "p4", "p35", "p6", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "loss"}]}, {"id": "p22", "name": "Κρητικός Ιγνάτιος", "wins": 2, "opponents": ["p21", "p2", "p27", "p11", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p27", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "loss"}]}, {"id": "p23", "name": "Σοφοκλέους Νίκος", "wins": 5, "opponents": ["p24", "p27", "p1", "p12", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p29", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Ζούβελος Νίκος", "wins": 3, "opponents": ["p23", "p34", "p28", "p2", "p37"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p37", "method": "retirement_win", "result": "win"}]}, {"id": "p25", "name": "Καραμπλιάς Βαγγέλης", "wins": 2, "opponents": ["p26", "p7", "p33", "p1", "p36"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p36", "method": "normal", "result": "loss"}]}, {"id": "p26", "name": "Βράνιτς Μαριάννα", "wins": 1, "opponents": ["p25", "p30", "p32", "p37", "p2"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p32", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p37", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p2", "method": "retirement_loss", "result": "loss"}]}, {"id": "p27", "name": "Γκανάς Γιώργος", "wins": 1, "opponents": ["p28", "p23", "p22", "p9"], "hadBye": true, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p22", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p9", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": null, "method": "bye", "result": "win"}]}, {"id": "p28", "name": "Αναστασίου Τάσος", "wins": 3, "opponents": ["p27", "p29", "p24", "p8", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p29", "name": "Χατζέλης Τάκης", "wins": 4, "opponents": ["p30", "p28", "p7", "p35", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p30", "name": "Βασιλειάδης Πάρης", "wins": 4, "opponents": ["p29", "p26", "p36", "p13", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "win"}]}, {"id": "p31", "name": "Ζωίδης Τηλέμαχος", "wins": 2, "opponents": ["p32", "p17", "p13", "p33", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p32", "name": "Ατματζίδης Γιάννης", "wins": 0, "opponents": ["p31", "p6", "p26", "p15", "p18"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p26", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p18", "method": "retirement_loss", "result": "loss"}]}, {"id": "p33", "name": "Πασιαλής Γιάννης", "wins": 2, "opponents": ["p34", "p16", "p25", "p31", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "win"}]}, {"id": "p34", "name": "Αποστολόπουλος Γιώργος", "wins": 2, "opponents": ["p33", "p24", "p15", "p4", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "retirement_win", "result": "win"}]}, {"id": "p35", "name": "Χιωτίνης Κώστας", "wins": 3, "opponents": ["p36", "p5", "p21", "p29", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p36", "name": "Τζάλλας Λεωνίδας", "wins": 3, "opponents": ["p35", "p11", "p30", "p3", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "win"}]}, {"id": "p37", "name": "Καλλέργη Δωροθέα", "wins": 2, "opponents": ["p10", "p8", "p26", "p24"], "hadBye": true, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": null, "method": "bye", "result": "win"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p26", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "retirement_loss", "result": "loss"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p9", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p13", "loserId": "p14", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p17", "loserId": "p18", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p19", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p21", "loserId": "p22", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p25", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p27", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p29", "loserId": "p30", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p31", "loserId": "p32", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}, {"p1": "p35", "p2": "p36", "result": {"winnerId": "p35", "loserId": "p36", "method": "normal"}}], "bye": "p37"}, {"round": 2, "pairs": [{"p1": "p16", "p2": "p33", "result": {"winnerId": "p16", "loserId": "p33", "method": "normal"}}, {"p1": "p21", "p2": "p4", "result": {"winnerId": "p21", "loserId": "p4", "method": "normal"}}, {"p1": "p19", "p2": "p1", "result": {"winnerId": "p1", "loserId": "p19", "method": "normal"}}, {"p1": "p17", "p2": "p31", "result": {"winnerId": "p17", "loserId": "p31", "method": "normal"}}, {"p1": "p12", "p2": "p13", "result": {"winnerId": "p12", "loserId": "p13", "method": "normal"}}, {"p1": "p25", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p25", "method": "normal"}}, {"p1": "p5", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p5", "method": "normal"}}, {"p1": "p29", "p2": "p28", "result": {"winnerId": "p29", "loserId": "p28", "method": "normal"}}, {"p1": "p37", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p37", "method": "normal"}}, {"p1": "p23", "p2": "p27", "result": {"winnerId": "p23", "loserId": "p27", "method": "normal"}}, {"p1": "p32", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p32", "method": "normal"}}, {"p1": "p2", "p2": "p22", "result": {"winnerId": "p2", "loserId": "p22", "method": "normal"}}, {"p1": "p26", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p26", "method": "normal"}}, {"p1": "p14", "p2": "p15", "result": {"winnerId": "p14", "loserId": "p15", "method": "normal"}}, {"p1": "p36", "p2": "p11", "result": {"winnerId": "p36", "loserId": "p11", "method": "normal"}}, {"p1": "p18", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p18", "method": "normal"}}, {"p1": "p24", "p2": "p34", "result": {"winnerId": "p24", "loserId": "p34", "method": "normal"}}, {"p1": "p3", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p3", "method": "normal"}}], "bye": "p9"}, {"round": 3, "pairs": [{"p1": "p29", "p2": "p7", "result": {"winnerId": "p29", "loserId": "p7", "method": "normal"}}, {"p1": "p21", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p1", "result": {"winnerId": "p23", "loserId": "p1", "method": "normal"}}, {"p1": "p10", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p10", "method": "normal"}}, {"p1": "p12", "p2": "p17", "result": {"winnerId": "p12", "loserId": "p17", "method": "normal"}}, {"p1": "p36", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p36", "method": "normal"}}, {"p1": "p33", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p33", "method": "normal"}}, {"p1": "p19", "p2": "p4", "result": {"winnerId": "p19", "loserId": "p4", "method": "normal"}}, {"p1": "p5", "p2": "p14", "result": {"winnerId": "p5", "loserId": "p14", "method": "normal"}}, {"p1": "p24", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p24", "method": "normal"}}, {"p1": "p37", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p37", "method": "normal"}}, {"p1": "p31", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p31", "method": "normal"}}, {"p1": "p6", "p2": "p9", "result": {"winnerId": "p6", "loserId": "p9", "method": "normal"}}, {"p1": "p20", "p2": "p2", "result": {"winnerId": "p20", "loserId": "p2", "method": "normal"}}, {"p1": "p34", "p2": "p15", "result": {"winnerId": "p34", "loserId": "p15", "method": "normal"}}, {"p1": "p18", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p18", "method": "normal"}}, {"p1": "p27", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p27", "method": "retirement"}}, {"p1": "p26", "p2": "p32", "result": {"winnerId": "p26", "loserId": "p32", "method": "retirement"}}], "bye": "p11"}, {"round": 4, "pairs": [{"p1": "p35", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p35", "method": "normal"}}, {"p1": "p12", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p12", "method": "normal"}}, {"p1": "p16", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p16", "method": "normal"}}, {"p1": "p28", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p28", "method": "normal"}}, {"p1": "p6", "p2": "p21", "result": {"winnerId": "p6", "loserId": "p21", "method": "normal"}}, {"p1": "p25", "p2": "p1", "result": {"winnerId": "p1", "loserId": "p25", "method": "normal"}}, {"p1": "p13", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p13", "method": "normal"}}, {"p1": "p7", "p2": "p10", "result": {"winnerId": "p7", "loserId": "p10", "method": "normal"}}, {"p1": "p17", "p2": "p20", "result": {"winnerId": "p17", "loserId": "p20", "method": "normal"}}, {"p1": "p19", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p19", "method": "normal"}}, {"p1": "p3", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p3", "method": "normal"}}, {"p1": "p4", "p2": "p34", "result": {"winnerId": "p4", "loserId": "p34", "method": "normal"}}, {"p1": "p2", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p2", "method": "normal"}}, {"p1": "p22", "p2": "p11", "result": {"winnerId": "p22", "loserId": "p11", "method": "normal"}}, {"p1": "p37", "p2": "p26", "result": {"winnerId": "p37", "loserId": "p26", "method": "retirement"}}, {"p1": "p33", "p2": "p31", "result": {"winnerId": "p31", "loserId": "p33", "method": "normal"}}, {"p1": "p9", "p2": "p27", "result": {"winnerId": "p9", "loserId": "p27", "method": "retirement"}}, {"p1": "p32", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p32", "method": "retirement"}}], "bye": "p18"}, {"round": 5, "pairs": [{"p1": "p29", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p29", "method": "normal"}}, {"p1": "p6", "p2": "p17", "result": {"winnerId": "p6", "loserId": "p17", "method": "normal"}}, {"p1": "p12", "p2": "p7", "result": {"winnerId": "p12", "loserId": "p7", "method": "normal"}}, {"p1": "p1", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p1", "method": "normal"}}, {"p1": "p8", "p2": "p5", "result": {"winnerId": "p8", "loserId": "p5", "method": "normal"}}, {"p1": "p16", "p2": "p35", "result": {"winnerId": "p16", "loserId": "p35", "method": "normal"}}, {"p1": "p10", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p10", "method": "normal"}}, {"p1": "p9", "p2": "p4", "result": {"winnerId": "p9", "loserId": "p4", "method": "normal"}}, {"p1": "p25", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p25", "method": "normal"}}, {"p1": "p20", "p2": "p31", "result": {"winnerId": "p20", "loserId": "p31", "method": "normal"}}, {"p1": "p37", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p37", "method": "retirement"}}, {"p1": "p22", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p22", "method": "normal"}}, {"p1": "p14", "p2": "p21", "result": {"winnerId": "p14", "loserId": "p21", "method": "normal"}}, {"p1": "p19", "p2": "p15", "result": {"winnerId": "p19", "loserId": "p15", "method": "normal"}}, {"p1": "p34", "p2": "p3", "result": {"winnerId": "p34", "loserId": "p3", "method": "retirement"}}, {"p1": "p11", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p11", "method": "normal"}}, {"p1": "p2", "p2": "p26", "result": {"winnerId": "p2", "loserId": "p26", "method": "retirement"}}, {"p1": "p18", "p2": "p32", "result": {"winnerId": "p18", "loserId": "p32", "method": "retirement"}}], "bye": "p27"}]}, "7": {"tournamentId": "hist-day7", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 7", "createdAt": "2026-03-14T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Τούκας Νίκος", "wins": 1, "opponents": ["p2", "p28", "p5", "p25", "p31"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p25", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p31", "method": "retirement_loss", "result": "loss"}]}, {"id": "p2", "name": "Τσερλιάγκος Πλάτων", "wins": 3, "opponents": ["p1", "p16", "p17", "p5", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "loss"}]}, {"id": "p3", "name": "Μανιάς Άρης", "wins": 3, "opponents": ["p4", "p12", "p13", "p36", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "loss"}]}, {"id": "p4", "name": "Διαμαντίδη Σοφία", "wins": 3, "opponents": ["p3", "p5", "p7", "p22", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "win"}]}, {"id": "p5", "name": "Μακρής Θανάσης", "wins": 2, "opponents": ["p6", "p4", "p1", "p2", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Αναστασίου Τάσος", "wins": 1, "opponents": ["p5", "p20", "p21", "p26", "p12"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p26", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "win"}]}, {"id": "p7", "name": "Μανωλιός Μιχάλης", "wins": 4, "opponents": ["p8", "p13", "p4", "p11", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p8", "name": "Σέλελης Πέτρος", "wins": 2, "opponents": ["p7", "p34", "p33", "p9", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p35", "method": "normal", "result": "loss"}]}, {"id": "p9", "name": "Καλοφωλιάς Παναγιώτης", "wins": 3, "opponents": ["p10", "p25", "p11", "p8", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "loss"}]}, {"id": "p10", "name": "Μανιάτης Τάσος", "wins": 2, "opponents": ["p9", "p23", "p14", "p19", "p34"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "win"}]}, {"id": "p11", "name": "Χιωτίνης Κώστας", "wins": 4, "opponents": ["p12", "p21", "p9", "p7", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "win"}]}, {"id": "p12", "name": "Γκανάς Γιώργος", "wins": 0, "opponents": ["p11", "p3", "p34", "p17", "p6"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "loss"}]}, {"id": "p13", "name": "Προυκάκης Μιχάλης", "wins": 3, "opponents": ["p14", "p7", "p3", "p34", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "win"}]}, {"id": "p14", "name": "Σακκαλής Τάκης", "wins": 4, "opponents": ["p13", "p26", "p10", "p35", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "win"}]}, {"id": "p15", "name": "Κρητικός Ιγνάτιος", "wins": 1, "opponents": ["p16", "p35", "p28", "p30", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p32", "method": "normal", "result": "loss"}]}, {"id": "p16", "name": "Σοφός Σπύρος", "wins": 5, "opponents": ["p15", "p2", "p32", "p24", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Ζούβελος Νίκος", "wins": 2, "opponents": ["p18", "p36", "p2", "p12", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p12", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "loss"}]}, {"id": "p18", "name": "Κατωγιαννάκης Στέφανος", "wins": 2, "opponents": ["p17", "p29", "p31", "p28", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p26", "method": "retirement_win", "result": "win"}]}, {"id": "p19", "name": "Καραμπινάς Ανδρέας", "wins": 3, "opponents": ["p20", "p27", "p22", "p10", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Λουμίδης Σωτήρης", "wins": 4, "opponents": ["p19", "p6", "p30", "p27", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Τζάλλας Λεωνίδας", "wins": 3, "opponents": ["p22", "p11", "p6", "p32", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p6", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p22", "name": "Ζωίδης Τηλέμαχος", "wins": 4, "opponents": ["p21", "p31", "p19", "p4", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "win"}]}, {"id": "p23", "name": "Κοκκίνης Πολυχρόνης", "wins": 2, "opponents": ["p24", "p10", "p26", "p31", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "loss"}]}, {"id": "p24", "name": "Πασιαλής Γιάννης", "wins": 4, "opponents": ["p23", "p33", "p36", "p16", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "win"}]}, {"id": "p25", "name": "Μπερτάχος Νίκος", "wins": 3, "opponents": ["p26", "p9", "p27", "p1", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p1", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "win"}]}, {"id": "p26", "name": "Καραμπλιάς Βαγγέλης", "wins": 1, "opponents": ["p25", "p14", "p23", "p6", "p18"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p18", "method": "retirement_loss", "result": "loss"}]}, {"id": "p27", "name": "Λιάπης Νίκος", "wins": 3, "opponents": ["p28", "p19", "p25", "p20", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "loss"}]}, {"id": "p28", "name": "Βατανίδης Στάθης", "wins": 0, "opponents": ["p27", "p1", "p15", "p18", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p29", "method": "normal", "result": "loss"}]}, {"id": "p29", "name": "Κούκιαρης Ντίνος", "wins": 2, "opponents": ["p30", "p18", "p35", "p33", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "win"}]}, {"id": "p30", "name": "Διαμαντίδη Μάγκυ", "wins": 2, "opponents": ["p29", "p32", "p20", "p15", "p36"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p36", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Καλλίρης Ανδρέας", "wins": 2, "opponents": ["p32", "p22", "p18", "p23", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p1", "method": "retirement_win", "result": "win"}]}, {"id": "p32", "name": "Βράνιτς Μαριάννα", "wins": 3, "opponents": ["p31", "p30", "p16", "p21", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "win"}]}, {"id": "p33", "name": "Χατζέλης Τάκης", "wins": 2, "opponents": ["p34", "p24", "p8", "p29", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "loss"}]}, {"id": "p34", "name": "Χατζηνικολάου Νίκος", "wins": 1, "opponents": ["p33", "p8", "p12", "p13", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p12", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "loss"}]}, {"id": "p35", "name": "Διαμαντίδης Τόνυ", "wins": 3, "opponents": ["p36", "p15", "p29", "p14", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "win"}]}, {"id": "p36", "name": "Αποστολόπουλος Γιώργος", "wins": 3, "opponents": ["p35", "p17", "p24", "p3", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p1", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p9", "loserId": "p10", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p11", "loserId": "p12", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p13", "loserId": "p14", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p17", "loserId": "p18", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p19", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p21", "loserId": "p22", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p23", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p25", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p31", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}, {"p1": "p35", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p35", "method": "normal"}}], "bye": null}, {"round": 2, "pairs": [{"p1": "p19", "p2": "p27", "result": {"winnerId": "p27", "loserId": "p19", "method": "normal"}}, {"p1": "p5", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p5", "method": "normal"}}, {"p1": "p17", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p17", "method": "normal"}}, {"p1": "p30", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p30", "method": "normal"}}, {"p1": "p24", "p2": "p33", "result": {"winnerId": "p24", "loserId": "p33", "method": "normal"}}, {"p1": "p21", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p21", "method": "normal"}}, {"p1": "p2", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p2", "method": "normal"}}, {"p1": "p25", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p25", "method": "normal"}}, {"p1": "p13", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p13", "method": "normal"}}, {"p1": "p12", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p12", "method": "normal"}}, {"p1": "p6", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p6", "method": "normal"}}, {"p1": "p31", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p31", "method": "normal"}}, {"p1": "p15", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p15", "method": "normal"}}, {"p1": "p8", "p2": "p34", "result": {"winnerId": "p8", "loserId": "p34", "method": "normal"}}, {"p1": "p14", "p2": "p26", "result": {"winnerId": "p14", "loserId": "p26", "method": "normal"}}, {"p1": "p10", "p2": "p23", "result": {"winnerId": "p10", "loserId": "p23", "method": "normal"}}, {"p1": "p29", "p2": "p18", "result": {"winnerId": "p29", "loserId": "p18", "method": "normal"}}, {"p1": "p1", "p2": "p28", "result": {"winnerId": "p1", "loserId": "p28", "method": "normal"}}], "bye": null}, {"round": 3, "pairs": [{"p1": "p9", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p9", "method": "normal"}}, {"p1": "p16", "p2": "p32", "result": {"winnerId": "p16", "loserId": "p32", "method": "normal"}}, {"p1": "p24", "p2": "p36", "result": {"winnerId": "p24", "loserId": "p36", "method": "normal"}}, {"p1": "p4", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p4", "method": "normal"}}, {"p1": "p27", "p2": "p25", "result": {"winnerId": "p27", "loserId": "p25", "method": "normal"}}, {"p1": "p19", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p19", "method": "normal"}}, {"p1": "p10", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p10", "method": "normal"}}, {"p1": "p20", "p2": "p30", "result": {"winnerId": "p20", "loserId": "p30", "method": "normal"}}, {"p1": "p8", "p2": "p33", "result": {"winnerId": "p8", "loserId": "p33", "method": "normal"}}, {"p1": "p2", "p2": "p17", "result": {"winnerId": "p2", "loserId": "p17", "method": "normal"}}, {"p1": "p5", "p2": "p1", "result": {"winnerId": "p5", "loserId": "p1", "method": "normal"}}, {"p1": "p29", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p29", "method": "normal"}}, {"p1": "p13", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p13", "method": "normal"}}, {"p1": "p21", "p2": "p6", "result": {"winnerId": "p21", "loserId": "p6", "method": "retirement"}}, {"p1": "p18", "p2": "p31", "result": {"winnerId": "p31", "loserId": "p18", "method": "normal"}}, {"p1": "p26", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p26", "method": "normal"}}, {"p1": "p15", "p2": "p28", "result": {"winnerId": "p15", "loserId": "p28", "method": "normal"}}, {"p1": "p12", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p12", "method": "retirement"}}], "bye": null}, {"round": 4, "pairs": [{"p1": "p11", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p11", "method": "normal"}}, {"p1": "p16", "p2": "p24", "result": {"winnerId": "p16", "loserId": "p24", "method": "normal"}}, {"p1": "p27", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p27", "method": "normal"}}, {"p1": "p35", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p35", "method": "normal"}}, {"p1": "p32", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p32", "method": "normal"}}, {"p1": "p8", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p8", "method": "normal"}}, {"p1": "p2", "p2": "p5", "result": {"winnerId": "p2", "loserId": "p5", "method": "normal"}}, {"p1": "p36", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p36", "method": "normal"}}, {"p1": "p22", "p2": "p4", "result": {"winnerId": "p22", "loserId": "p4", "method": "normal"}}, {"p1": "p10", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p10", "method": "normal"}}, {"p1": "p25", "p2": "p1", "result": {"winnerId": "p25", "loserId": "p1", "method": "retirement"}}, {"p1": "p29", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p29", "method": "normal"}}, {"p1": "p15", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p15", "method": "normal"}}, {"p1": "p13", "p2": "p34", "result": {"winnerId": "p13", "loserId": "p34", "method": "normal"}}, {"p1": "p31", "p2": "p23", "result": {"winnerId": "p23", "loserId": "p31", "method": "normal"}}, {"p1": "p17", "p2": "p12", "result": {"winnerId": "p17", "loserId": "p12", "method": "retirement"}}, {"p1": "p6", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p6", "method": "retirement"}}, {"p1": "p18", "p2": "p28", "result": {"winnerId": "p18", "loserId": "p28", "method": "normal"}}], "bye": null}, {"round": 5, "pairs": [{"p1": "p7", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p7", "method": "normal"}}, {"p1": "p9", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p9", "method": "normal"}}, {"p1": "p20", "p2": "p21", "result": {"winnerId": "p20", "loserId": "p21", "method": "normal"}}, {"p1": "p22", "p2": "p2", "result": {"winnerId": "p22", "loserId": "p2", "method": "normal"}}, {"p1": "p27", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p27", "method": "normal"}}, {"p1": "p11", "p2": "p3", "result": {"winnerId": "p11", "loserId": "p3", "method": "normal"}}, {"p1": "p35", "p2": "p8", "result": {"winnerId": "p35", "loserId": "p8", "method": "normal"}}, {"p1": "p5", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p5", "method": "normal"}}, {"p1": "p17", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p17", "method": "normal"}}, {"p1": "p13", "p2": "p23", "result": {"winnerId": "p13", "loserId": "p23", "method": "normal"}}, {"p1": "p36", "p2": "p30", "result": {"winnerId": "p36", "loserId": "p30", "method": "normal"}}, {"p1": "p4", "p2": "p33", "result": {"winnerId": "p4", "loserId": "p33", "method": "normal"}}, {"p1": "p32", "p2": "p15", "result": {"winnerId": "p32", "loserId": "p15", "method": "normal"}}, {"p1": "p34", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p34", "method": "normal"}}, {"p1": "p31", "p2": "p1", "result": {"winnerId": "p31", "loserId": "p1", "method": "retirement"}}, {"p1": "p18", "p2": "p26", "result": {"winnerId": "p18", "loserId": "p26", "method": "retirement"}}, {"p1": "p29", "p2": "p28", "result": {"winnerId": "p29", "loserId": "p28", "method": "normal"}}, {"p1": "p12", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p12", "method": "normal"}}], "bye": null}]}, "8": {"tournamentId": "hist-day8", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 8", "createdAt": "2026-03-28T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Σαπάκος Γρηγόρης", "wins": 4, "opponents": ["p2", "p14", "p25", "p15", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p2", "name": "Βράνιτς Μαριάννα", "wins": 1, "opponents": ["p1", "p31", "p19", "p17", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p31", "method": "retirement_win", "result": "win"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "loss"}]}, {"id": "p3", "name": "Σοφοκλέους Νίκος", "wins": 4, "opponents": ["p4", "p40", "p36", "p12", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p40", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "win"}]}, {"id": "p4", "name": "Μιχοπούλου Αναστασία", "wins": 3, "opponents": ["p3", "p34", "p28", "p16", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Χατζηνικολάου Νίκος", "wins": 1, "opponents": ["p6", "p11", "p37", "p41", "p34"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p37", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p41", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Ζωίδης Τηλέμαχος", "wins": 4, "opponents": ["p5", "p36", "p14", "p22", "p42"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p42", "method": "normal", "result": "loss"}]}, {"id": "p7", "name": "Καλοφωλιάς Παναγιώτης", "wins": 5, "opponents": ["p8", "p17", "p40", "p18", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p40", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "win"}]}, {"id": "p8", "name": "Πασιαλής Γιάννης", "wins": 2, "opponents": ["p7", "p19", "p13", "p25", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "loss"}]}, {"id": "p9", "name": "Βασιλείου Μιχάλης", "wins": 1, "opponents": ["p10", "p41", "p22", "p37", "p31"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p41", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p37", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "loss"}]}, {"id": "p10", "name": "Δημάκης Θοδωρής", "wins": 4, "opponents": ["p9", "p42", "p21", "p26", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p42", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "win"}]}, {"id": "p11", "name": "Κισκήρας Φώτης", "wins": 1, "opponents": ["p12", "p5", "p24", "p23", "p36"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p23", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p36", "method": "retirement_loss", "result": "loss"}]}, {"id": "p12", "name": "Κάρλοβιτς Νίκος", "wins": 3, "opponents": ["p11", "p30", "p23", "p3", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "win"}]}, {"id": "p13", "name": "Γιαννακόπουλος Αργύριος", "wins": 0, "opponents": ["p14", "p24", "p8", "p34", "p41"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p34", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p41", "method": "normal", "result": "loss"}]}, {"id": "p14", "name": "Βατανίδης Στάθης", "wins": 2, "opponents": ["p13", "p1", "p6", "p32", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p29", "method": "normal", "result": "loss"}]}, {"id": "p15", "name": "Χατζέλης Τάκης", "wins": 2, "opponents": ["p16", "p39", "p34", "p1", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p39", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "win"}]}, {"id": "p16", "name": "Λιάπης Νίκος", "wins": 3, "opponents": ["p15", "p22", "p38", "p4", "p37"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p37", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Τζάλλας Λεωνίδας", "wins": 3, "opponents": ["p18", "p7", "p41", "p2", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p41", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "win"}]}, {"id": "p18", "name": "Βουλγαράκης Σπύρος", "wins": 3, "opponents": ["p17", "p38", "p20", "p7", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "loss"}]}, {"id": "p19", "name": "Καλλίρης Ανδρέας", "wins": 3, "opponents": ["p20", "p8", "p2", "p40", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p40", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Μανωλιός Μιχάλης", "wins": 4, "opponents": ["p19", "p27", "p18", "p30", "p40"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p40", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Γιαννάκος Νίκος", "wins": 1, "opponents": ["p22", "p35", "p10", "p28", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "loss"}]}, {"id": "p22", "name": "Χατζηιωάννου Έλενα", "wins": 3, "opponents": ["p21", "p16", "p9", "p6", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p32", "method": "normal", "result": "loss"}]}, {"id": "p23", "name": "Κούκιαρης Ντίνος", "wins": 3, "opponents": ["p24", "p32", "p12", "p11", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p11", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Καράογλου Γιάννης", "wins": 2, "opponents": ["p23", "p13", "p11", "p27", "p39"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p39", "method": "normal", "result": "loss"}]}, {"id": "p25", "name": "Μπερτάχος Νίκος", "wins": 2, "opponents": ["p26", "p37", "p1", "p8", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "win"}]}, {"id": "p26", "name": "Σακκαλής Τάκης", "wins": 2, "opponents": ["p25", "p33", "p39", "p10", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p39", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "loss"}]}, {"id": "p27", "name": "Καραμπλιάς Βαγγέλης", "wins": 3, "opponents": ["p28", "p20", "p31", "p24", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "loss"}]}, {"id": "p28", "name": "Μανιάς Άρης", "wins": 2, "opponents": ["p27", "p29", "p4", "p21", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p29", "name": "Χατζηβασιλείου Νίκος", "wins": 3, "opponents": ["p30", "p28", "p35", "p36", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "win"}]}, {"id": "p30", "name": "Κατωγιαννάκης Στέφανος", "wins": 2, "opponents": ["p29", "p12", "p33", "p20", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Γκανάς Γιώργος", "wins": 1, "opponents": ["p32", "p2", "p27", "p35", "p9"], "hadBye": false, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "retirement_loss", "result": "loss"}, {"round": 3, "opponentId": "p27", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p35", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "win"}]}, {"id": "p32", "name": "Χρηστίδης Χάρης", "wins": 4, "opponents": ["p31", "p23", "p42", "p14", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p42", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "win"}]}, {"id": "p33", "name": "Γυρτάτος Αλέξανδρος", "wins": 3, "opponents": ["p34", "p26", "p30", "p42", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p42", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "loss"}]}, {"id": "p34", "name": "Κοκκίνης Πολυχρόνης", "wins": 2, "opponents": ["p33", "p4", "p15", "p13", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p13", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p35", "name": "Αποστολόπουλος Γιώργος", "wins": 1, "opponents": ["p36", "p21", "p29", "p31", "p38"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p38", "method": "normal", "result": "loss"}]}, {"id": "p36", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p35", "p6", "p3", "p29", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p11", "method": "retirement_win", "result": "win"}]}, {"id": "p37", "name": "Λουμίδης Σωτήρης", "wins": 2, "opponents": ["p38", "p25", "p5", "p9", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p38", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p38", "name": "Μακρής Θανάσης", "wins": 2, "opponents": ["p37", "p18", "p16", "p39", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p39", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p35", "method": "normal", "result": "win"}]}, {"id": "p39", "name": "Χιωτίνης Κώστας", "wins": 3, "opponents": ["p40", "p15", "p26", "p38", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p40", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "win"}]}, {"id": "p40", "name": "Αναστασίου Τάσος", "wins": 3, "opponents": ["p39", "p3", "p7", "p19", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p39", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p41", "name": "Καραμπινάς Ανδρέας", "wins": 1, "opponents": ["p42", "p9", "p17", "p5", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p42", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "win"}]}, {"id": "p42", "name": "Παπουτσής Γιάννης", "wins": 5, "opponents": ["p41", "p10", "p32", "p33", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p41", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p3", "loserId": "p4", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p5", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p9", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p13", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p19", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p25", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p31", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}, {"p1": "p35", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p35", "method": "normal"}}, {"p1": "p37", "p2": "p38", "result": {"winnerId": "p38", "loserId": "p37", "method": "normal"}}, {"p1": "p39", "p2": "p40", "result": {"winnerId": "p40", "loserId": "p39", "method": "normal"}}, {"p1": "p41", "p2": "p42", "result": {"winnerId": "p42", "loserId": "p41", "method": "normal"}}], "bye": null}, {"round": 2, "pairs": [{"p1": "p42", "p2": "p10", "result": {"winnerId": "p42", "loserId": "p10", "method": "normal"}}, {"p1": "p12", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p12", "method": "normal"}}, {"p1": "p36", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p36", "method": "normal"}}, {"p1": "p27", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p27", "method": "normal"}}, {"p1": "p38", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p38", "method": "normal"}}, {"p1": "p40", "p2": "p3", "result": {"winnerId": "p40", "loserId": "p3", "method": "normal"}}, {"p1": "p16", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p16", "method": "normal"}}, {"p1": "p33", "p2": "p26", "result": {"winnerId": "p33", "loserId": "p26", "method": "normal"}}, {"p1": "p32", "p2": "p23", "result": {"winnerId": "p32", "loserId": "p23", "method": "normal"}}, {"p1": "p1", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p1", "method": "normal"}}, {"p1": "p7", "p2": "p17", "result": {"winnerId": "p7", "loserId": "p17", "method": "normal"}}, {"p1": "p31", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p31", "method": "retirement"}}, {"p1": "p9", "p2": "p41", "result": {"winnerId": "p9", "loserId": "p41", "method": "normal"}}, {"p1": "p8", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p8", "method": "normal"}}, {"p1": "p5", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p5", "method": "normal"}}, {"p1": "p15", "p2": "p39", "result": {"winnerId": "p39", "loserId": "p15", "method": "normal"}}, {"p1": "p28", "p2": "p29", "result": {"winnerId": "p28", "loserId": "p29", "method": "normal"}}, {"p1": "p24", "p2": "p13", "result": {"winnerId": "p24", "loserId": "p13", "method": "normal"}}, {"p1": "p25", "p2": "p37", "result": {"winnerId": "p25", "loserId": "p37", "method": "normal"}}, {"p1": "p34", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p34", "method": "normal"}}, {"p1": "p21", "p2": "p35", "result": {"winnerId": "p21", "loserId": "p35", "method": "normal"}}], "bye": null}, {"round": 3, "pairs": [{"p1": "p7", "p2": "p40", "result": {"winnerId": "p7", "loserId": "p40", "method": "normal"}}, {"p1": "p6", "p2": "p14", "result": {"winnerId": "p6", "loserId": "p14", "method": "normal"}}, {"p1": "p42", "p2": "p32", "result": {"winnerId": "p42", "loserId": "p32", "method": "normal"}}, {"p1": "p18", "p2": "p20", "result": {"winnerId": "p18", "loserId": "p20", "method": "normal"}}, {"p1": "p30", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p30", "method": "normal"}}, {"p1": "p22", "p2": "p9", "result": {"winnerId": "p22", "loserId": "p9", "method": "normal"}}, {"p1": "p3", "p2": "p36", "result": {"winnerId": "p3", "loserId": "p36", "method": "normal"}}, {"p1": "p39", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p39", "method": "normal"}}, {"p1": "p1", "p2": "p25", "result": {"winnerId": "p1", "loserId": "p25", "method": "normal"}}, {"p1": "p4", "p2": "p28", "result": {"winnerId": "p4", "loserId": "p28", "method": "normal"}}, {"p1": "p23", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p23", "method": "normal"}}, {"p1": "p16", "p2": "p38", "result": {"winnerId": "p16", "loserId": "p38", "method": "normal"}}, {"p1": "p19", "p2": "p2", "result": {"winnerId": "p19", "loserId": "p2", "method": "normal"}}, {"p1": "p24", "p2": "p11", "result": {"winnerId": "p24", "loserId": "p11", "method": "normal"}}, {"p1": "p21", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p21", "method": "normal"}}, {"p1": "p27", "p2": "p31", "result": {"winnerId": "p27", "loserId": "p31", "method": "retirement"}}, {"p1": "p41", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p41", "method": "normal"}}, {"p1": "p29", "p2": "p35", "result": {"winnerId": "p29", "loserId": "p35", "method": "normal"}}, {"p1": "p5", "p2": "p37", "result": {"winnerId": "p37", "loserId": "p5", "method": "normal"}}, {"p1": "p34", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p34", "method": "normal"}}, {"p1": "p13", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p13", "method": "normal"}}], "bye": null}, {"round": 4, "pairs": [{"p1": "p33", "p2": "p42", "result": {"winnerId": "p42", "loserId": "p33", "method": "normal"}}, {"p1": "p18", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p18", "method": "normal"}}, {"p1": "p6", "p2": "p22", "result": {"winnerId": "p6", "loserId": "p22", "method": "normal"}}, {"p1": "p20", "p2": "p30", "result": {"winnerId": "p20", "loserId": "p30", "method": "normal"}}, {"p1": "p19", "p2": "p40", "result": {"winnerId": "p40", "loserId": "p19", "method": "normal"}}, {"p1": "p10", "p2": "p26", "result": {"winnerId": "p10", "loserId": "p26", "method": "normal"}}, {"p1": "p3", "p2": "p12", "result": {"winnerId": "p3", "loserId": "p12", "method": "normal"}}, {"p1": "p4", "p2": "p16", "result": {"winnerId": "p4", "loserId": "p16", "method": "normal"}}, {"p1": "p14", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p14", "method": "normal"}}, {"p1": "p27", "p2": "p24", "result": {"winnerId": "p27", "loserId": "p24", "method": "normal"}}, {"p1": "p1", "p2": "p15", "result": {"winnerId": "p1", "loserId": "p15", "method": "normal"}}, {"p1": "p23", "p2": "p11", "result": {"winnerId": "p23", "loserId": "p11", "method": "retirement"}}, {"p1": "p17", "p2": "p2", "result": {"winnerId": "p17", "loserId": "p2", "method": "normal"}}, {"p1": "p29", "p2": "p36", "result": {"winnerId": "p29", "loserId": "p36", "method": "normal"}}, {"p1": "p8", "p2": "p25", "result": {"winnerId": "p8", "loserId": "p25", "method": "normal"}}, {"p1": "p28", "p2": "p21", "result": {"winnerId": "p28", "loserId": "p21", "method": "normal"}}, {"p1": "p38", "p2": "p39", "result": {"winnerId": "p39", "loserId": "p38", "method": "normal"}}, {"p1": "p37", "p2": "p9", "result": {"winnerId": "p37", "loserId": "p9", "method": "retirement"}}, {"p1": "p13", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p13", "method": "retirement"}}, {"p1": "p41", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p41", "method": "normal"}}, {"p1": "p31", "p2": "p35", "result": {"winnerId": "p35", "loserId": "p31", "method": "retirement"}}], "bye": null}, {"round": 5, "pairs": [{"p1": "p6", "p2": "p42", "result": {"winnerId": "p42", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p27", "result": {"winnerId": "p7", "loserId": "p27", "method": "normal"}}, {"p1": "p3", "p2": "p18", "result": {"winnerId": "p3", "loserId": "p18", "method": "normal"}}, {"p1": "p40", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p40", "method": "normal"}}, {"p1": "p33", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p33", "method": "normal"}}, {"p1": "p22", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p22", "method": "normal"}}, {"p1": "p1", "p2": "p4", "result": {"winnerId": "p1", "loserId": "p4", "method": "normal"}}, {"p1": "p14", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p14", "method": "normal"}}, {"p1": "p17", "p2": "p8", "result": {"winnerId": "p17", "loserId": "p8", "method": "normal"}}, {"p1": "p23", "p2": "p28", "result": {"winnerId": "p23", "loserId": "p28", "method": "normal"}}, {"p1": "p12", "p2": "p26", "result": {"winnerId": "p12", "loserId": "p26", "method": "normal"}}, {"p1": "p16", "p2": "p37", "result": {"winnerId": "p16", "loserId": "p37", "method": "normal"}}, {"p1": "p19", "p2": "p30", "result": {"winnerId": "p19", "loserId": "p30", "method": "normal"}}, {"p1": "p39", "p2": "p24", "result": {"winnerId": "p39", "loserId": "p24", "method": "normal"}}, {"p1": "p5", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p5", "method": "normal"}}, {"p1": "p38", "p2": "p35", "result": {"winnerId": "p38", "loserId": "p35", "method": "normal"}}, {"p1": "p11", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p11", "method": "retirement"}}, {"p1": "p15", "p2": "p21", "result": {"winnerId": "p15", "loserId": "p21", "method": "normal"}}, {"p1": "p25", "p2": "p2", "result": {"winnerId": "p25", "loserId": "p2", "method": "normal"}}, {"p1": "p9", "p2": "p31", "result": {"winnerId": "p31", "loserId": "p9", "method": "normal"}}, {"p1": "p41", "p2": "p13", "result": {"winnerId": "p41", "loserId": "p13", "method": "normal"}}], "bye": null}]}, "9": {"tournamentId": "hist-day9", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 9", "createdAt": "2026-04-25T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Παπουτσής Γιάννης", "wins": 1, "opponents": ["p2", "p33", "p15", "p30", "p32"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p30", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p32", "method": "retirement_loss", "result": "loss"}]}, {"id": "p2", "name": "Ζωγράφου Αθηνά", "wins": 1, "opponents": ["p1", "p32", "p11", "p28", "p37"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p28", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p37", "method": "retirement_loss", "result": "loss"}]}, {"id": "p3", "name": "Χαρακλιάς Στέφανος", "wins": 4, "opponents": ["p4", "p12", "p7", "p31", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p4", "name": "Καλοφωλιάς Παναγιώτης", "wins": 2, "opponents": ["p3", "p30", "p39", "p5", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p39", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Χατζέλης Τάκης", "wins": 3, "opponents": ["p6", "p13", "p16", "p4", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "loss"}]}, {"id": "p6", "name": "Τζάλλας Λεωνίδας", "wins": 1, "opponents": ["p5", "p15", "p32", "p35", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p35", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "loss"}]}, {"id": "p7", "name": "Καλλίρης Ανδρέας", "wins": 5, "opponents": ["p8", "p27", "p3", "p23", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "win"}]}, {"id": "p8", "name": "Αναστασίου Τάσος", "wins": 3, "opponents": ["p7", "p38", "p12", "p19", "p35"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p19", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p35", "method": "normal", "result": "win"}]}, {"id": "p9", "name": "Κούκιαρης Ντίνος", "wins": 2, "opponents": ["p10", "p21", "p27", "p17", "p36"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p36", "method": "normal", "result": "loss"}]}, {"id": "p10", "name": "Σακκαλής Τάκης", "wins": 3, "opponents": ["p9", "p31", "p33", "p13", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Μαραγκός Σωτήρης", "wins": 2, "opponents": ["p12", "p19", "p2", "p22", "p15"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p19", "method": "retirement_win", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "retirement_loss", "result": "loss"}]}, {"id": "p12", "name": "Πασιαλής Γιάννης", "wins": 3, "opponents": ["p11", "p3", "p8", "p36", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "loss"}]}, {"id": "p13", "name": "Ζούβελος Νίκος", "wins": 4, "opponents": ["p14", "p5", "p20", "p10", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "loss"}]}, {"id": "p14", "name": "Λαμπρινός Νίκος", "wins": 2, "opponents": ["p13", "p17", "p30", "p32", "p38"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p38", "method": "retirement_win", "result": "win"}]}, {"id": "p15", "name": "Καραμπλιάς Βαγγέλης", "wins": 3, "opponents": ["p16", "p6", "p1", "p25", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p1", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p11", "method": "retirement_win", "result": "win"}]}, {"id": "p16", "name": "Σοφοκλέους Νίκος", "wins": 2, "opponents": ["p15", "p20", "p5", "p37", "p31"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "loss"}]}, {"id": "p17", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p18", "p14", "p29", "p9", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "win"}]}, {"id": "p18", "name": "Κατωγιαννάκης Στέφανος", "wins": 3, "opponents": ["p17", "p23", "p37", "p24", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}, {"id": "p19", "name": "Γκανάς Γιώργος", "wins": 1, "opponents": ["p20", "p11", "p38", "p8"], "hadBye": true, "withdrawn": true, "withdrawnRound": 4, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "retirement_loss", "result": "loss"}, {"round": 3, "opponentId": "p38", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": null, "method": "bye", "result": "win"}]}, {"id": "p20", "name": "Χρηστίδης Χάρης", "wins": 4, "opponents": ["p19", "p16", "p13", "p27", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Μακρής Θανάσης", "wins": 2, "opponents": ["p22", "p9", "p28", "p34"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": null, "method": "bye", "result": "win"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "win"}]}, {"id": "p22", "name": "Προυκάκης Μιχάλης", "wins": 4, "opponents": ["p21", "p37", "p25", "p11", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p37", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "win"}]}, {"id": "p23", "name": "Κοκκίνης Πολυχρόνης", "wins": 3, "opponents": ["p24", "p18", "p36", "p7", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p36", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "loss"}]}, {"id": "p24", "name": "Ατματζίδης Γιάννης", "wins": 3, "opponents": ["p23", "p26", "p18", "p20"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": null, "method": "bye", "result": "win"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p25", "name": "Λιάπης Νίκος", "wins": 5, "opponents": ["p26", "p29", "p22", "p15", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "win"}]}, {"id": "p26", "name": "Κισκήρας Φώτης", "wins": 2, "opponents": ["p25", "p28", "p24", "p34", "p39"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p39", "method": "normal", "result": "loss"}]}, {"id": "p27", "name": "Χατζηιωάννου Έλενα", "wins": 3, "opponents": ["p28", "p7", "p9", "p20", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p28", "name": "Τούκας Νίκος", "wins": 3, "opponents": ["p27", "p26", "p21", "p2", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p2", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p29", "method": "retirement_win", "result": "win"}]}, {"id": "p29", "name": "Βράνιτς Μαριάννα", "wins": 2, "opponents": ["p30", "p25", "p17", "p33", "p28"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "retirement_loss", "result": "loss"}]}, {"id": "p30", "name": "Μιχοπούλου Αναστασία", "wins": 2, "opponents": ["p29", "p4", "p14", "p1", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Σαπάκος Γρηγόρης", "wins": 3, "opponents": ["p32", "p10", "p34", "p3", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "win"}]}, {"id": "p32", "name": "Γιακουμάκης Γιάννης", "wins": 1, "opponents": ["p31", "p2", "p6", "p14", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p1", "method": "retirement_win", "result": "win"}]}, {"id": "p33", "name": "Αποστολόπουλος Γιώργος", "wins": 4, "opponents": ["p34", "p1", "p10", "p29", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "win"}]}, {"id": "p34", "name": "Κάρλοβιτς Νίκος", "wins": 1, "opponents": ["p33", "p35", "p31", "p26", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "loss"}]}, {"id": "p35", "name": "Χιωτίνης Κώστας", "wins": 2, "opponents": ["p36", "p34", "p6", "p8"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": null, "method": "bye", "result": "win"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "loss"}]}, {"id": "p36", "name": "Μανωλιός Μιχάλης", "wins": 3, "opponents": ["p35", "p39", "p23", "p12", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p35", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p39", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "win"}]}, {"id": "p37", "name": "Μανιάς Άρης", "wins": 2, "opponents": ["p38", "p22", "p18", "p16", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p38", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p2", "method": "retirement_win", "result": "win"}]}, {"id": "p38", "name": "Τριάντης Αντώνης", "wins": 1, "opponents": ["p37", "p8", "p19", "p39", "p14"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p37", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p19", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p39", "method": "retirement_loss", "result": "loss"}, {"round": 5, "opponentId": "p14", "method": "retirement_loss", "result": "loss"}]}, {"id": "p39", "name": "Ζωίδης Τηλέμαχος", "wins": 3, "opponents": ["p36", "p4", "p38", "p26"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": null, "method": "bye", "result": "win"}, {"round": 2, "opponentId": "p36", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p38", "method": "retirement_win", "result": "win"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p3", "loserId": "p4", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p5", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p9", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p13", "loserId": "p14", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p15", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p19", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p25", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p29", "loserId": "p30", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p31", "loserId": "p32", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}, {"p1": "p35", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p35", "method": "normal"}}, {"p1": "p37", "p2": "p38", "result": {"winnerId": "p37", "loserId": "p38", "method": "normal"}}], "bye": "p39"}, {"round": 2, "pairs": [{"p1": "p37", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p37", "method": "normal"}}, {"p1": "p31", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p31", "method": "normal"}}, {"p1": "p39", "p2": "p36", "result": {"winnerId": "p36", "loserId": "p39", "method": "normal"}}, {"p1": "p33", "p2": "p1", "result": {"winnerId": "p33", "loserId": "p1", "method": "normal"}}, {"p1": "p13", "p2": "p5", "result": {"winnerId": "p13", "loserId": "p5", "method": "normal"}}, {"p1": "p7", "p2": "p27", "result": {"winnerId": "p7", "loserId": "p27", "method": "normal"}}, {"p1": "p20", "p2": "p16", "result": {"winnerId": "p20", "loserId": "p16", "method": "normal"}}, {"p1": "p23", "p2": "p18", "result": {"winnerId": "p23", "loserId": "p18", "method": "normal"}}, {"p1": "p12", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p12", "method": "normal"}}, {"p1": "p29", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p29", "method": "normal"}}, {"p1": "p21", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p21", "method": "normal"}}, {"p1": "p30", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p30", "method": "normal"}}, {"p1": "p26", "p2": "p28", "result": {"winnerId": "p26", "loserId": "p28", "method": "normal"}}, {"p1": "p14", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p14", "method": "normal"}}, {"p1": "p2", "p2": "p32", "result": {"winnerId": "p2", "loserId": "p32", "method": "normal"}}, {"p1": "p11", "p2": "p19", "result": {"winnerId": "p11", "loserId": "p19", "method": "retirement"}}, {"p1": "p35", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p35", "method": "normal"}}, {"p1": "p8", "p2": "p38", "result": {"winnerId": "p8", "loserId": "p38", "method": "normal"}}, {"p1": "p15", "p2": "p6", "result": {"winnerId": "p15", "loserId": "p6", "method": "normal"}}], "bye": "p24"}, {"round": 3, "pairs": [{"p1": "p3", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p3", "method": "normal"}}, {"p1": "p33", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p33", "method": "normal"}}, {"p1": "p23", "p2": "p36", "result": {"winnerId": "p23", "loserId": "p36", "method": "normal"}}, {"p1": "p25", "p2": "p22", "result": {"winnerId": "p25", "loserId": "p22", "method": "normal"}}, {"p1": "p13", "p2": "p20", "result": {"winnerId": "p13", "loserId": "p20", "method": "normal"}}, {"p1": "p15", "p2": "p1", "result": {"winnerId": "p15", "loserId": "p1", "method": "retirement"}}, {"p1": "p37", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p37", "method": "normal"}}, {"p1": "p12", "p2": "p8", "result": {"winnerId": "p12", "loserId": "p8", "method": "normal"}}, {"p1": "p5", "p2": "p16", "result": {"winnerId": "p5", "loserId": "p16", "method": "normal"}}, {"p1": "p4", "p2": "p39", "result": {"winnerId": "p4", "loserId": "p39", "method": "normal"}}, {"p1": "p17", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p17", "method": "normal"}}, {"p1": "p34", "p2": "p31", "result": {"winnerId": "p31", "loserId": "p34", "method": "normal"}}, {"p1": "p27", "p2": "p9", "result": {"winnerId": "p27", "loserId": "p9", "method": "normal"}}, {"p1": "p26", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p26", "method": "normal"}}, {"p1": "p2", "p2": "p11", "result": {"winnerId": "p11", "loserId": "p2", "method": "normal"}}, {"p1": "p19", "p2": "p38", "result": {"winnerId": "p38", "loserId": "p19", "method": "retirement"}}, {"p1": "p14", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p14", "method": "normal"}}, {"p1": "p6", "p2": "p32", "result": {"winnerId": "p6", "loserId": "p32", "method": "normal"}}, {"p1": "p21", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p21", "method": "normal"}}], "bye": "p35"}, {"round": 4, "pairs": [{"p1": "p10", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p10", "method": "normal"}}, {"p1": "p23", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p23", "method": "normal"}}, {"p1": "p25", "p2": "p15", "result": {"winnerId": "p25", "loserId": "p15", "method": "normal"}}, {"p1": "p20", "p2": "p27", "result": {"winnerId": "p20", "loserId": "p27", "method": "normal"}}, {"p1": "p36", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p36", "method": "normal"}}, {"p1": "p33", "p2": "p29", "result": {"winnerId": "p33", "loserId": "p29", "method": "normal"}}, {"p1": "p3", "p2": "p31", "result": {"winnerId": "p3", "loserId": "p31", "method": "normal"}}, {"p1": "p4", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p4", "method": "normal"}}, {"p1": "p22", "p2": "p11", "result": {"winnerId": "p22", "loserId": "p11", "method": "normal"}}, {"p1": "p24", "p2": "p18", "result": {"winnerId": "p24", "loserId": "p18", "method": "normal"}}, {"p1": "p26", "p2": "p34", "result": {"winnerId": "p26", "loserId": "p34", "method": "normal"}}, {"p1": "p39", "p2": "p38", "result": {"winnerId": "p39", "loserId": "p38", "method": "retirement"}}, {"p1": "p35", "p2": "p6", "result": {"winnerId": "p35", "loserId": "p6", "method": "normal"}}, {"p1": "p30", "p2": "p1", "result": {"winnerId": "p30", "loserId": "p1", "method": "retirement"}}, {"p1": "p2", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p2", "method": "retirement"}}, {"p1": "p16", "p2": "p37", "result": {"winnerId": "p16", "loserId": "p37", "method": "normal"}}, {"p1": "p9", "p2": "p17", "result": {"winnerId": "p9", "loserId": "p17", "method": "normal"}}, {"p1": "p8", "p2": "p19", "result": {"winnerId": "p8", "loserId": "p19", "method": "retirement"}}, {"p1": "p14", "p2": "p32", "result": {"winnerId": "p14", "loserId": "p32", "method": "normal"}}], "bye": "p21"}, {"round": 5, "pairs": [{"p1": "p13", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p13", "method": "normal"}}, {"p1": "p25", "p2": "p5", "result": {"winnerId": "p25", "loserId": "p5", "method": "normal"}}, {"p1": "p33", "p2": "p23", "result": {"winnerId": "p33", "loserId": "p23", "method": "normal"}}, {"p1": "p22", "p2": "p12", "result": {"winnerId": "p22", "loserId": "p12", "method": "normal"}}, {"p1": "p24", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p24", "method": "normal"}}, {"p1": "p10", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p10", "method": "normal"}}, {"p1": "p26", "p2": "p39", "result": {"winnerId": "p39", "loserId": "p26", "method": "normal"}}, {"p1": "p29", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p29", "method": "retirement"}}, {"p1": "p18", "p2": "p30", "result": {"winnerId": "p18", "loserId": "p30", "method": "normal"}}, {"p1": "p35", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p35", "method": "normal"}}, {"p1": "p36", "p2": "p9", "result": {"winnerId": "p36", "loserId": "p9", "method": "normal"}}, {"p1": "p16", "p2": "p31", "result": {"winnerId": "p31", "loserId": "p16", "method": "normal"}}, {"p1": "p4", "p2": "p27", "result": {"winnerId": "p27", "loserId": "p4", "method": "normal"}}, {"p1": "p11", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p11", "method": "retirement"}}, {"p1": "p17", "p2": "p6", "result": {"winnerId": "p17", "loserId": "p6", "method": "normal"}}, {"p1": "p21", "p2": "p34", "result": {"winnerId": "p21", "loserId": "p34", "method": "normal"}}, {"p1": "p38", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p38", "method": "retirement"}}, {"p1": "p1", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p1", "method": "retirement"}}, {"p1": "p37", "p2": "p2", "result": {"winnerId": "p37", "loserId": "p2", "method": "retirement"}}], "bye": "p19"}]}, "10": {"tournamentId": "hist-day10", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 10", "createdAt": "2026-05-17T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Βουλγαράκης Σπύρος", "wins": 1, "opponents": ["p2", "p29", "p18", "p21", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p2", "name": "Παπουτσής Γιάννης", "wins": 3, "opponents": ["p1", "p13", "p32", "p7", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "win"}]}, {"id": "p3", "name": "Δημάκης Θοδωρής", "wins": 4, "opponents": ["p4", "p10", "p19", "p33", "p28"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "normal", "result": "win"}]}, {"id": "p4", "name": "Χατζηνικολάου Νίκος", "wins": 2, "opponents": ["p3", "p21", "p27", "p28", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "loss"}]}, {"id": "p5", "name": "Χατζηιωάννου Έλενα", "wins": 2, "opponents": ["p6", "p11", "p12", "p8", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "retirement_win", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "win"}]}, {"id": "p6", "name": "Πασιαλής Γιάννης", "wins": 3, "opponents": ["p5", "p24", "p31", "p19", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p32", "method": "normal", "result": "win"}]}, {"id": "p7", "name": "Κισκήρας Φώτης", "wins": 1, "opponents": ["p8", "p14", "p26", "p2", "p5"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p5", "method": "normal", "result": "loss"}]}, {"id": "p8", "name": "Κοκκίνης Πολυχρόνης", "wins": 3, "opponents": ["p7", "p22", "p20", "p5", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p25", "method": "normal", "result": "win"}]}, {"id": "p9", "name": "Τζανέτης Βασίλης", "wins": 2, "opponents": ["p10", "p23", "p30", "p25", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "loss"}]}, {"id": "p10", "name": "Χατζηβασιλείου Νίκος", "wins": 2, "opponents": ["p9", "p3", "p15", "p31", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p21", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Γιαννακόπουλος Αργύριος", "wins": 1, "opponents": ["p12", "p5", "p21", "p16"], "hadBye": true, "withdrawn": true, "withdrawnRound": 3, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p5", "method": "retirement_loss", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "retirement_loss", "result": "loss"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": null, "method": "bye", "result": "win"}]}, {"id": "p12", "name": "Αποστολόπουλος Γιώργος", "wins": 2, "opponents": ["p11", "p19", "p5", "p24", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "loss"}]}, {"id": "p13", "name": "Χατζέλης Τάκης", "wins": 3, "opponents": ["p14", "p2", "p16", "p30", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p9", "method": "normal", "result": "win"}]}, {"id": "p14", "name": "Μανωλιός Μιχάλης", "wins": 4, "opponents": ["p13", "p7", "p17", "p22", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "loss"}]}, {"id": "p15", "name": "Κατωγιαννάκης Στέφανος", "wins": 3, "opponents": ["p16", "p17", "p10", "p27", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "win"}]}, {"id": "p16", "name": "Τούκας Νίκος", "wins": 2, "opponents": ["p15", "p32", "p13", "p11", "p31"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Ατματζίδης Γιάννης", "wins": 3, "opponents": ["p18", "p15", "p14", "p26", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p18", "name": "Βατανίδης Στάθης", "wins": 2, "opponents": ["p17", "p28", "p1", "p23", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p26", "method": "normal", "result": "loss"}]}, {"id": "p19", "name": "Ζωίδης Τηλέμαχος", "wins": 4, "opponents": ["p20", "p12", "p3", "p6", "p17"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p17", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Λιάπης Νίκος", "wins": 2, "opponents": ["p19", "p30", "p8", "p1"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": null, "method": "bye", "result": "win"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Βράνιτς Μαριάννα", "wins": 3, "opponents": ["p22", "p4", "p11", "p1", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p11", "method": "retirement_win", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p22", "name": "Μανιάτης Τάσος", "wins": 4, "opponents": ["p21", "p8", "p24", "p14", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "win"}]}, {"id": "p23", "name": "Καραμπλιάς Βαγγέλης", "wins": 2, "opponents": ["p24", "p9", "p18", "p30"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": null, "method": "bye", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Οικονόμου Παναγιώτης", "wins": 4, "opponents": ["p23", "p6", "p22", "p12", "p29"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p29", "method": "normal", "result": "win"}]}, {"id": "p25", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p26", "p27", "p28", "p9", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "loss"}]}, {"id": "p26", "name": "Φωτιάδης Ιωάννης", "wins": 3, "opponents": ["p25", "p7", "p17", "p18"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": null, "method": "bye", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "win"}]}, {"id": "p27", "name": "Μακρής Θανάσης", "wins": 3, "opponents": ["p28", "p25", "p4", "p15", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "loss"}]}, {"id": "p28", "name": "Χρηστίδης Χάρης", "wins": 3, "opponents": ["p27", "p18", "p25", "p4", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "loss"}]}, {"id": "p29", "name": "Αναστασίου Τάσος", "wins": 3, "opponents": ["p30", "p1", "p33", "p32", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "loss"}]}, {"id": "p30", "name": "Σακκαλής Τάκης", "wins": 1, "opponents": ["p29", "p20", "p9", "p13", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p31", "name": "Λουμίδης Σωτήρης", "wins": 1, "opponents": ["p32", "p33", "p6", "p10", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p32", "name": "Πολυδώρου Θοδωρής", "wins": 2, "opponents": ["p31", "p16", "p2", "p29", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "loss"}]}, {"id": "p33", "name": "Ζούβελος Νίκος", "wins": 5, "opponents": ["p31", "p29", "p3", "p14"], "hadBye": true, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": null, "method": "bye", "result": "win"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p3", "loserId": "p4", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p5", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p7", "loserId": "p8", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p10", "loserId": "p9", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p13", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p15", "loserId": "p16", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p17", "loserId": "p18", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p19", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p23", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p25", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p29", "loserId": "p30", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p31", "loserId": "p32", "method": "normal"}}], "bye": "p33"}, {"round": 2, "pairs": [{"p1": "p29", "p2": "p1", "result": {"winnerId": "p29", "loserId": "p1", "method": "normal"}}, {"p1": "p17", "p2": "p15", "result": {"winnerId": "p17", "loserId": "p15", "method": "normal"}}, {"p1": "p14", "p2": "p7", "result": {"winnerId": "p14", "loserId": "p7", "method": "normal"}}, {"p1": "p33", "p2": "p31", "result": {"winnerId": "p33", "loserId": "p31", "method": "normal"}}, {"p1": "p10", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p10", "method": "normal"}}, {"p1": "p19", "p2": "p12", "result": {"winnerId": "p19", "loserId": "p12", "method": "normal"}}, {"p1": "p27", "p2": "p25", "result": {"winnerId": "p27", "loserId": "p25", "method": "normal"}}, {"p1": "p24", "p2": "p6", "result": {"winnerId": "p24", "loserId": "p6", "method": "normal"}}, {"p1": "p22", "p2": "p8", "result": {"winnerId": "p22", "loserId": "p8", "method": "normal"}}, {"p1": "p20", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p20", "method": "normal"}}, {"p1": "p23", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p23", "method": "normal"}}, {"p1": "p13", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p13", "method": "normal"}}, {"p1": "p28", "p2": "p18", "result": {"winnerId": "p28", "loserId": "p18", "method": "normal"}}, {"p1": "p21", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p21", "method": "normal"}}, {"p1": "p11", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p11", "method": "retirement"}}, {"p1": "p32", "p2": "p16", "result": {"winnerId": "p32", "loserId": "p16", "method": "normal"}}], "bye": "p26"}, {"round": 3, "pairs": [{"p1": "p24", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p24", "method": "normal"}}, {"p1": "p14", "p2": "p17", "result": {"winnerId": "p14", "loserId": "p17", "method": "normal"}}, {"p1": "p29", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p29", "method": "normal"}}, {"p1": "p19", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p19", "method": "normal"}}, {"p1": "p27", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p27", "method": "normal"}}, {"p1": "p30", "p2": "p9", "result": {"winnerId": "p9", "loserId": "p30", "method": "normal"}}, {"p1": "p6", "p2": "p31", "result": {"winnerId": "p6", "loserId": "p31", "method": "normal"}}, {"p1": "p26", "p2": "p7", "result": {"winnerId": "p26", "loserId": "p7", "method": "normal"}}, {"p1": "p12", "p2": "p5", "result": {"winnerId": "p12", "loserId": "p5", "method": "normal"}}, {"p1": "p28", "p2": "p25", "result": {"winnerId": "p28", "loserId": "p25", "method": "normal"}}, {"p1": "p15", "p2": "p10", "result": {"winnerId": "p15", "loserId": "p10", "method": "normal"}}, {"p1": "p32", "p2": "p2", "result": {"winnerId": "p32", "loserId": "p2", "method": "normal"}}, {"p1": "p1", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p1", "method": "normal"}}, {"p1": "p13", "p2": "p16", "result": {"winnerId": "p13", "loserId": "p16", "method": "normal"}}, {"p1": "p20", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p11", "result": {"winnerId": "p21", "loserId": "p11", "method": "retirement"}}], "bye": "p23"}, {"round": 4, "pairs": [{"p1": "p3", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p3", "method": "normal"}}, {"p1": "p22", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p22", "method": "normal"}}, {"p1": "p27", "p2": "p15", "result": {"winnerId": "p27", "loserId": "p15", "method": "normal"}}, {"p1": "p29", "p2": "p32", "result": {"winnerId": "p29", "loserId": "p32", "method": "normal"}}, {"p1": "p26", "p2": "p17", "result": {"winnerId": "p17", "loserId": "p26", "method": "normal"}}, {"p1": "p24", "p2": "p12", "result": {"winnerId": "p24", "loserId": "p12", "method": "normal"}}, {"p1": "p6", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p6", "method": "normal"}}, {"p1": "p4", "p2": "p28", "result": {"winnerId": "p28", "loserId": "p4", "method": "normal"}}, {"p1": "p9", "p2": "p25", "result": {"winnerId": "p25", "loserId": "p9", "method": "normal"}}, {"p1": "p5", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p5", "method": "normal"}}, {"p1": "p1", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p1", "method": "normal"}}, {"p1": "p13", "p2": "p30", "result": {"winnerId": "p13", "loserId": "p30", "method": "normal"}}, {"p1": "p23", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p23", "method": "normal"}}, {"p1": "p10", "p2": "p31", "result": {"winnerId": "p10", "loserId": "p31", "method": "normal"}}, {"p1": "p2", "p2": "p7", "result": {"winnerId": "p2", "loserId": "p7", "method": "normal"}}, {"p1": "p11", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p11", "method": "normal"}}], "bye": "p20"}, {"round": 5, "pairs": [{"p1": "p14", "p2": "p33", "result": {"winnerId": "p33", "loserId": "p14", "method": "normal"}}, {"p1": "p24", "p2": "p29", "result": {"winnerId": "p24", "loserId": "p29", "method": "normal"}}, {"p1": "p28", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p28", "method": "normal"}}, {"p1": "p27", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p27", "method": "normal"}}, {"p1": "p19", "p2": "p17", "result": {"winnerId": "p19", "loserId": "p17", "method": "normal"}}, {"p1": "p26", "p2": "p18", "result": {"winnerId": "p26", "loserId": "p18", "method": "normal"}}, {"p1": "p13", "p2": "p9", "result": {"winnerId": "p13", "loserId": "p9", "method": "normal"}}, {"p1": "p25", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p25", "method": "normal"}}, {"p1": "p21", "p2": "p10", "result": {"winnerId": "p21", "loserId": "p10", "method": "normal"}}, {"p1": "p32", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p32", "method": "normal"}}, {"p1": "p4", "p2": "p2", "result": {"winnerId": "p2", "loserId": "p4", "method": "normal"}}, {"p1": "p12", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p12", "method": "normal"}}, {"p1": "p23", "p2": "p30", "result": {"winnerId": "p23", "loserId": "p30", "method": "normal"}}, {"p1": "p5", "p2": "p7", "result": {"winnerId": "p5", "loserId": "p7", "method": "normal"}}, {"p1": "p31", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p31", "method": "normal"}}, {"p1": "p1", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p1", "method": "normal"}}], "bye": "p11"}]}, "11": {"tournamentId": "hist-day11", "tournamentName": "Backgammon Premier League 2026 - Ημέρα 11", "createdAt": "2026-06-13T00:00:00.000Z", "seasonYear": 2026, "totalRounds": 5, "matchLength": 7, "phase": "finished", "round": 5, "currentPairings": null, "liveStandingsEnabled": false, "players": [{"id": "p1", "name": "Καράογλου Γιάννης", "wins": 2, "opponents": ["p2", "p22", "p32", "p27", "p20"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p22", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p20", "method": "normal", "result": "loss"}]}, {"id": "p2", "name": "Διαμαντίδης Τόνυ", "wins": 2, "opponents": ["p1", "p16", "p8", "p25", "p11"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p11", "method": "normal", "result": "win"}]}, {"id": "p3", "name": "Διαμαντίδη Σοφία", "wins": 2, "opponents": ["p4", "p21", "p25", "p23", "p16"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p21", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p16", "method": "normal", "result": "loss"}]}, {"id": "p4", "name": "Κατωγιαννάκης Στέφανος", "wins": 4, "opponents": ["p3", "p15", "p31", "p6", "p12"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p12", "method": "normal", "result": "win"}]}, {"id": "p5", "name": "Μανιάτης Τάσος", "wins": 2, "opponents": ["p6", "p11", "p22", "p31", "p21"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p21", "method": "retirement_win", "result": "win"}]}, {"id": "p6", "name": "Σοφοκλέους Νίκος", "wins": 2, "opponents": ["p5", "p27", "p34", "p4", "p31"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p27", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p31", "method": "normal", "result": "loss"}]}, {"id": "p7", "name": "Ατματζίδης Γιάννης", "wins": 3, "opponents": ["p8", "p10", "p16", "p21", "p13"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p16", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p13", "method": "normal", "result": "win"}]}, {"id": "p8", "name": "Πασιαλής Γιάννης", "wins": 3, "opponents": ["p7", "p18", "p2", "p9", "p24"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p24", "method": "normal", "result": "loss"}]}, {"id": "p9", "name": "Μανιάς Άρης", "wins": 2, "opponents": ["p10", "p25", "p14", "p8", "p28"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p8", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p28", "method": "retirement_loss", "result": "loss"}]}, {"id": "p10", "name": "Οικονόμου Παναγιώτης", "wins": 0, "opponents": ["p9", "p7", "p13", "p11", "p23"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p11", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p23", "method": "normal", "result": "loss"}]}, {"id": "p11", "name": "Μακρής Θανάσης", "wins": 1, "opponents": ["p12", "p5", "p28", "p10", "p2"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p5", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p2", "method": "normal", "result": "loss"}]}, {"id": "p12", "name": "Κισκήρας Φώτης", "wins": 2, "opponents": ["p11", "p32", "p24", "p29", "p4"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p4", "method": "normal", "result": "loss"}]}, {"id": "p13", "name": "Χαρακλιάς Στέφανος", "wins": 2, "opponents": ["p14", "p34", "p10", "p26", "p7"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p34", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p10", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p7", "method": "normal", "result": "loss"}]}, {"id": "p14", "name": "Χιωτίνης Κώστας", "wins": 3, "opponents": ["p13", "p23", "p9", "p30", "p33"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p9", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p33", "method": "normal", "result": "loss"}]}, {"id": "p15", "name": "Παπουτσής Γιάννης", "wins": 4, "opponents": ["p16", "p4", "p18", "p32", "p30"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p4", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p32", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p30", "method": "normal", "result": "loss"}]}, {"id": "p16", "name": "Προυκάκης Μιχάλης", "wins": 3, "opponents": ["p15", "p2", "p7", "p24", "p3"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p2", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p7", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p3", "method": "normal", "result": "win"}]}, {"id": "p17", "name": "Διαμαντίδη Μάγκυ", "wins": 1, "opponents": ["p18", "p24", "p29", "p28", "p25"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p18", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p24", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p29", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p28", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p25", "method": "retirement_win", "result": "win"}]}, {"id": "p18", "name": "Ζούβελος Νίκος", "wins": 2, "opponents": ["p17", "p8", "p15", "p22", "p34"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p8", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p34", "method": "normal", "result": "loss"}]}, {"id": "p19", "name": "Μπερτάχος Νίκος", "wins": 4, "opponents": ["p20", "p33", "p30", "p34", "p27"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p33", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p27", "method": "normal", "result": "win"}]}, {"id": "p20", "name": "Καλλίρης Ανδρέας", "wins": 3, "opponents": ["p19", "p29", "p26", "p33", "p1"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p1", "method": "normal", "result": "win"}]}, {"id": "p21", "name": "Καραμπλιάς Βαγγέλης", "wins": 1, "opponents": ["p22", "p3", "p27", "p7", "p5"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p22", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p3", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p7", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p5", "method": "retirement_loss", "result": "loss"}]}, {"id": "p22", "name": "Λιάπης Νίκος", "wins": 3, "opponents": ["p21", "p1", "p5", "p18", "p32"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p1", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p18", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p32", "method": "normal", "result": "loss"}]}, {"id": "p23", "name": "Χατζηιωάννου Έλενα", "wins": 2, "opponents": ["p24", "p14", "p33", "p3", "p10"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p24", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p14", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p10", "method": "normal", "result": "win"}]}, {"id": "p24", "name": "Κοκκίνης Πολυχρόνης", "wins": 4, "opponents": ["p23", "p17", "p12", "p16", "p8"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p23", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p16", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p8", "method": "normal", "result": "win"}]}, {"id": "p25", "name": "Αργειτάκος Αργύρης", "wins": 0, "opponents": ["p26", "p9", "p3", "p2", "p17"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p26", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p9", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p3", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p2", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p17", "method": "retirement_loss", "result": "loss"}]}, {"id": "p26", "name": "Χρηστίδης Χάρης", "wins": 1, "opponents": ["p25", "p30", "p20", "p13", "p29"], "hadBye": false, "withdrawn": true, "withdrawnRound": 5, "matchLog": [{"round": 1, "opponentId": "p25", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p13", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p29", "method": "retirement_loss", "result": "loss"}]}, {"id": "p27", "name": "Πολυδώρου Θοδωρής", "wins": 3, "opponents": ["p28", "p6", "p21", "p1", "p19"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p6", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p21", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p19", "method": "normal", "result": "loss"}]}, {"id": "p28", "name": "Ζωίδης Τηλέμαχος", "wins": 3, "opponents": ["p27", "p31", "p11", "p17", "p9"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p27", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p31", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p11", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p9", "method": "retirement_win", "result": "win"}]}, {"id": "p29", "name": "Σοφός Σπύρος", "wins": 2, "opponents": ["p30", "p20", "p17", "p12", "p26"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p30", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p20", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p17", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p12", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p26", "method": "retirement_win", "result": "win"}]}, {"id": "p30", "name": "Χατζέλης Τάκης", "wins": 5, "opponents": ["p29", "p26", "p19", "p14", "p15"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p29", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p26", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p19", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p14", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p15", "method": "normal", "result": "win"}]}, {"id": "p31", "name": "Καλοφωλιάς Παναγιώτης", "wins": 3, "opponents": ["p32", "p28", "p4", "p5", "p6"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p32", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p28", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p4", "method": "normal", "result": "loss"}, {"round": 4, "opponentId": "p5", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p6", "method": "normal", "result": "win"}]}, {"id": "p32", "name": "Λουμίδης Σωτήρης", "wins": 4, "opponents": ["p31", "p12", "p1", "p15", "p22"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p31", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p12", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p1", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p15", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p22", "method": "normal", "result": "win"}]}, {"id": "p33", "name": "Σακκαλής Τάκης", "wins": 4, "opponents": ["p34", "p19", "p23", "p20", "p14"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p34", "method": "normal", "result": "win"}, {"round": 2, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 3, "opponentId": "p23", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p20", "method": "normal", "result": "win"}, {"round": 5, "opponentId": "p14", "method": "normal", "result": "win"}]}, {"id": "p34", "name": "Μανωλιός Μιχάλης", "wins": 3, "opponents": ["p33", "p13", "p6", "p19", "p18"], "hadBye": false, "withdrawn": false, "withdrawnRound": null, "matchLog": [{"round": 1, "opponentId": "p33", "method": "normal", "result": "loss"}, {"round": 2, "opponentId": "p13", "method": "normal", "result": "win"}, {"round": 3, "opponentId": "p6", "method": "normal", "result": "win"}, {"round": 4, "opponentId": "p19", "method": "normal", "result": "loss"}, {"round": 5, "opponentId": "p18", "method": "normal", "result": "win"}]}], "history": [{"round": 1, "pairs": [{"p1": "p1", "p2": "p2", "result": {"winnerId": "p1", "loserId": "p2", "method": "normal"}}, {"p1": "p3", "p2": "p4", "result": {"winnerId": "p4", "loserId": "p3", "method": "normal"}}, {"p1": "p5", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p5", "method": "normal"}}, {"p1": "p7", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p7", "method": "normal"}}, {"p1": "p9", "p2": "p10", "result": {"winnerId": "p9", "loserId": "p10", "method": "normal"}}, {"p1": "p11", "p2": "p12", "result": {"winnerId": "p12", "loserId": "p11", "method": "normal"}}, {"p1": "p13", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p13", "method": "normal"}}, {"p1": "p15", "p2": "p16", "result": {"winnerId": "p15", "loserId": "p16", "method": "normal"}}, {"p1": "p17", "p2": "p18", "result": {"winnerId": "p18", "loserId": "p17", "method": "normal"}}, {"p1": "p19", "p2": "p20", "result": {"winnerId": "p19", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p21", "method": "normal"}}, {"p1": "p23", "p2": "p24", "result": {"winnerId": "p23", "loserId": "p24", "method": "normal"}}, {"p1": "p25", "p2": "p26", "result": {"winnerId": "p26", "loserId": "p25", "method": "normal"}}, {"p1": "p27", "p2": "p28", "result": {"winnerId": "p27", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p31", "method": "normal"}}, {"p1": "p33", "p2": "p34", "result": {"winnerId": "p33", "loserId": "p34", "method": "normal"}}], "bye": null}, {"round": 2, "pairs": [{"p1": "p23", "p2": "p14", "result": {"winnerId": "p14", "loserId": "p23", "method": "normal"}}, {"p1": "p1", "p2": "p22", "result": {"winnerId": "p1", "loserId": "p22", "method": "normal"}}, {"p1": "p15", "p2": "p4", "result": {"winnerId": "p15", "loserId": "p4", "method": "normal"}}, {"p1": "p12", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p12", "method": "normal"}}, {"p1": "p26", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p6", "result": {"winnerId": "p6", "loserId": "p27", "method": "normal"}}, {"p1": "p18", "p2": "p8", "result": {"winnerId": "p18", "loserId": "p8", "method": "normal"}}, {"p1": "p33", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p33", "method": "normal"}}, {"p1": "p9", "p2": "p25", "result": {"winnerId": "p9", "loserId": "p25", "method": "normal"}}, {"p1": "p13", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p13", "method": "normal"}}, {"p1": "p3", "p2": "p21", "result": {"winnerId": "p21", "loserId": "p3", "method": "normal"}}, {"p1": "p10", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p10", "method": "normal"}}, {"p1": "p31", "p2": "p28", "result": {"winnerId": "p31", "loserId": "p28", "method": "normal"}}, {"p1": "p29", "p2": "p20", "result": {"winnerId": "p20", "loserId": "p29", "method": "normal"}}, {"p1": "p16", "p2": "p2", "result": {"winnerId": "p16", "loserId": "p2", "method": "normal"}}, {"p1": "p24", "p2": "p17", "result": {"winnerId": "p24", "loserId": "p17", "method": "normal"}}, {"p1": "p11", "p2": "p5", "result": {"winnerId": "p5", "loserId": "p11", "method": "normal"}}], "bye": null}, {"round": 3, "pairs": [{"p1": "p14", "p2": "p9", "result": {"winnerId": "p14", "loserId": "p9", "method": "normal"}}, {"p1": "p18", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p18", "method": "normal"}}, {"p1": "p19", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p19", "method": "normal"}}, {"p1": "p1", "p2": "p32", "result": {"winnerId": "p32", "loserId": "p1", "method": "normal"}}, {"p1": "p6", "p2": "p34", "result": {"winnerId": "p34", "loserId": "p6", "method": "normal"}}, {"p1": "p7", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p7", "method": "normal"}}, {"p1": "p4", "p2": "p31", "result": {"winnerId": "p4", "loserId": "p31", "method": "normal"}}, {"p1": "p20", "p2": "p26", "result": {"winnerId": "p20", "loserId": "p26", "method": "normal"}}, {"p1": "p27", "p2": "p21", "result": {"winnerId": "p27", "loserId": "p21", "method": "normal"}}, {"p1": "p22", "p2": "p5", "result": {"winnerId": "p22", "loserId": "p5", "method": "normal"}}, {"p1": "p24", "p2": "p12", "result": {"winnerId": "p24", "loserId": "p12", "method": "normal"}}, {"p1": "p33", "p2": "p23", "result": {"winnerId": "p33", "loserId": "p23", "method": "normal"}}, {"p1": "p8", "p2": "p2", "result": {"winnerId": "p8", "loserId": "p2", "method": "normal"}}, {"p1": "p17", "p2": "p29", "result": {"winnerId": "p29", "loserId": "p17", "method": "normal"}}, {"p1": "p25", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p25", "method": "normal"}}, {"p1": "p28", "p2": "p11", "result": {"winnerId": "p28", "loserId": "p11", "method": "normal"}}, {"p1": "p10", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p10", "method": "normal"}}], "bye": null}, {"round": 4, "pairs": [{"p1": "p14", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p14", "method": "normal"}}, {"p1": "p32", "p2": "p15", "result": {"winnerId": "p15", "loserId": "p32", "method": "normal"}}, {"p1": "p9", "p2": "p8", "result": {"winnerId": "p8", "loserId": "p9", "method": "normal"}}, {"p1": "p18", "p2": "p22", "result": {"winnerId": "p22", "loserId": "p18", "method": "normal"}}, {"p1": "p4", "p2": "p6", "result": {"winnerId": "p4", "loserId": "p6", "method": "normal"}}, {"p1": "p27", "p2": "p1", "result": {"winnerId": "p27", "loserId": "p1", "method": "normal"}}, {"p1": "p16", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p16", "method": "normal"}}, {"p1": "p34", "p2": "p19", "result": {"winnerId": "p19", "loserId": "p34", "method": "normal"}}, {"p1": "p33", "p2": "p20", "result": {"winnerId": "p33", "loserId": "p20", "method": "normal"}}, {"p1": "p21", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p21", "method": "normal"}}, {"p1": "p12", "p2": "p29", "result": {"winnerId": "p12", "loserId": "p29", "method": "normal"}}, {"p1": "p31", "p2": "p5", "result": {"winnerId": "p31", "loserId": "p5", "method": "normal"}}, {"p1": "p23", "p2": "p3", "result": {"winnerId": "p3", "loserId": "p23", "method": "normal"}}, {"p1": "p26", "p2": "p13", "result": {"winnerId": "p13", "loserId": "p26", "method": "normal"}}, {"p1": "p28", "p2": "p17", "result": {"winnerId": "p28", "loserId": "p17", "method": "normal"}}, {"p1": "p11", "p2": "p10", "result": {"winnerId": "p11", "loserId": "p10", "method": "normal"}}, {"p1": "p2", "p2": "p25", "result": {"winnerId": "p2", "loserId": "p25", "method": "normal"}}], "bye": null}, {"round": 5, "pairs": [{"p1": "p15", "p2": "p30", "result": {"winnerId": "p30", "loserId": "p15", "method": "normal"}}, {"p1": "p33", "p2": "p14", "result": {"winnerId": "p33", "loserId": "p14", "method": "normal"}}, {"p1": "p32", "p2": "p22", "result": {"winnerId": "p32", "loserId": "p22", "method": "normal"}}, {"p1": "p19", "p2": "p27", "result": {"winnerId": "p19", "loserId": "p27", "method": "normal"}}, {"p1": "p8", "p2": "p24", "result": {"winnerId": "p24", "loserId": "p8", "method": "normal"}}, {"p1": "p4", "p2": "p12", "result": {"winnerId": "p4", "loserId": "p12", "method": "normal"}}, {"p1": "p13", "p2": "p7", "result": {"winnerId": "p7", "loserId": "p13", "method": "normal"}}, {"p1": "p31", "p2": "p6", "result": {"winnerId": "p31", "loserId": "p6", "method": "normal"}}, {"p1": "p28", "p2": "p9", "result": {"winnerId": "p28", "loserId": "p9", "method": "retirement"}}, {"p1": "p34", "p2": "p18", "result": {"winnerId": "p34", "loserId": "p18", "method": "normal"}}, {"p1": "p3", "p2": "p16", "result": {"winnerId": "p16", "loserId": "p3", "method": "normal"}}, {"p1": "p20", "p2": "p1", "result": {"winnerId": "p20", "loserId": "p1", "method": "normal"}}, {"p1": "p5", "p2": "p21", "result": {"winnerId": "p5", "loserId": "p21", "method": "retirement"}}, {"p1": "p29", "p2": "p26", "result": {"winnerId": "p29", "loserId": "p26", "method": "retirement"}}, {"p1": "p2", "p2": "p11", "result": {"winnerId": "p2", "loserId": "p11", "method": "normal"}}, {"p1": "p23", "p2": "p10", "result": {"winnerId": "p23", "loserId": "p10", "method": "normal"}}, {"p1": "p17", "p2": "p25", "result": {"winnerId": "p17", "loserId": "p25", "method": "retirement"}}], "bye": null}]}};


/* ---------------------------------------------------------------------- */
/* Pairing / scoring helpers                                              */
/* ---------------------------------------------------------------------- */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleWithinScoreGroups(sortedDesc) {
  const result = [];
  let i = 0;
  while (i < sortedDesc.length) {
    let j = i;
    while (j < sortedDesc.length && sortedDesc[j].wins === sortedDesc[i].wins) j++;
    result.push(...shuffle(sortedDesc.slice(i, j)));
    i = j;
  }
  return result;
}

/**
 * Round 1: fully random. Round 2+: players ordered by score (ties shuffled),
 * then greedily paired with the nearest not-yet-played opponent. Simplified
 * vs. full FIDE Swiss (no backtracking) — adequate for club-size fields.
 * Forced rematches (rare) are flagged via rematchCount.
 */
function generatePairings(players, roundNumber) {
  const active = players.filter((p) => !p.excludedFromTournament);
  let pool = [...active];
  let bye = null;

  if (pool.length % 2 === 1) {
    const ascByWins = [...pool].sort((a, b) => a.wins - b.wins);
    bye = ascByWins.find((p) => !p.hadBye) || ascByWins[0];
    pool = pool.filter((p) => p.id !== bye.id);
  }

  const order =
    roundNumber === 1
      ? shuffle(pool)
      : shuffleWithinScoreGroups([...pool].sort((a, b) => b.wins - a.wins));

  const remaining = [...order];
  const pairs = [];
  let rematchCount = 0;

  while (remaining.length > 0) {
    const p = remaining.shift();
    let idx = remaining.findIndex((q) => !p.opponents.includes(q.id));
    if (idx === -1) {
      idx = 0;
      rematchCount++;
    }
    const opp = remaining.splice(idx, 1)[0];
    pairs.push({ p1: p.id, p2: opp.id, result: null });
  }

  return { pairs, bye: bye ? bye.id : null, rematchCount };
}

/** Rebuilds every player's wins/opponents/matchLog/withdrawn state from
 * scratch by replaying the tournament's history in round order. Used both
 * to let any past round's result stay editable (recompute after a fix)
 * and to power "redraw this round" (revert one round back). Static fields
 * (name, hasDiscount, discountAmount, wantsCup) are preserved from
 * basePlayers; only the round-derived fields are reset and replayed. */
function replayPlayersFromHistory(basePlayers, history) {
  const byId = {};
  basePlayers.forEach((p) => {
    byId[p.id] = { ...p, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, matchLog: [] };
  });
  const sorted = [...history].sort((a, b) => a.round - b.round);
  sorted.forEach((entry) => {
    entry.pairs.forEach((pr) => {
      if (!pr.result) return;
      const { winnerId, loserId, method } = pr.result;
      if (method === "double_retirement") {
        const a = byId[pr.p1];
        const b = byId[pr.p2];
        if (!a || !b) return;
        a.opponents.push(pr.p2);
        b.opponents.push(pr.p1);
        a.matchLog.push({ round: entry.round, opponentId: pr.p2, method: "double_retirement", result: "loss" });
        b.matchLog.push({ round: entry.round, opponentId: pr.p1, method: "double_retirement", result: "loss" });
        a.withdrawn = true; a.withdrawnRound = entry.round;
        b.withdrawn = true; b.withdrawnRound = entry.round;
        return;
      }
      const w = byId[winnerId];
      const l = byId[loserId];
      if (!w || !l) return;
      w.wins += 1;
      w.opponents.push(loserId);
      l.opponents.push(winnerId);
      const winMethod = method === "retirement" ? "retirement_win" : "normal";
      const loseMethod = method === "retirement" ? "retirement_loss" : "normal";
      w.matchLog.push({ round: entry.round, opponentId: loserId, method: winMethod, result: "win" });
      l.matchLog.push({ round: entry.round, opponentId: winnerId, method: loseMethod, result: "loss" });
      if (method === "retirement") {
        l.withdrawn = true;
        l.withdrawnRound = entry.round;
      }
    });
    if (entry.bye && byId[entry.bye]) {
      const b = byId[entry.bye];
      b.wins += 1;
      b.hadBye = true;
      b.matchLog.push({ round: entry.round, opponentId: null, method: "bye", result: "win" });
    }
  });
  return Object.values(byId);
}

function computeBuchholz(players) {
  const finalWins = {};
  players.forEach((p) => (finalWins[p.id] = p.wins));
  const buchholz = {};
  players.forEach((p) => {
    let total = 0;
    p.matchLog.forEach((m) => {
      if (m.method === "bye") total += finalWins[p.id];
      else total += finalWins[m.opponentId] || 0;
    });
    buchholz[p.id] = total;
  });
  return buchholz;
}

function sortStandings(players, buchholz) {
  return [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const bb = buchholz ? buchholz[b.id] || 0 : 0;
    const ba = buchholz ? buchholz[a.id] || 0 : 0;
    if (bb !== ba) return bb - ba;
    return a.name.localeCompare(b.name, "en");
  });
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ---------------------------------------------------------------------- */
/* Component                                                              */
/* ---------------------------------------------------------------------- */

export default function TournamentManager() {
  const idRef = useRef(0);
  const fileInputRef = useRef(null);
  const fullBackupInputRef = useRef(null);
  const makeId = () => {
    idRef.current += 1;
    return `p${idRef.current}`;
  };

  const inIframe = useRef(isEmbeddedOnFederationSite()).current;
  const initiallyUnlocked = useRef(
    !inIframe &&
      (() => {
        try {
          return window.localStorage.getItem(ADMIN_UNLOCK_LOCALSTORAGE_KEY) === "true";
        } catch {
          return false;
        }
      })()
  ).current;
  const [deviceUnlocked, setDeviceUnlocked] = useState(initiallyUnlocked);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [hasUnseenUpdate, setHasUnseenUpdate] = useState(false);
  const [role, setRole] = useState(initiallyUnlocked ? "admin" : "visitor"); // admin | visitor
  const isAdmin = role === "admin";
  const [adminPasswordPrompt, setAdminPasswordPrompt] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePwCurrent, setChangePwCurrent] = useState("");
  const [changePwNew, setChangePwNew] = useState("");
  const [changePwError, setChangePwError] = useState("");

  async function submitAdminPassword() {
    const stored = await loadAdminPassword();
    if (adminPasswordInput === stored) {
      setRole("admin");
      setAdminPasswordPrompt(false);
      setAdminPasswordInput("");
      setAdminPasswordError("");
      try {
        window.localStorage.setItem(ADMIN_UNLOCK_LOCALSTORAGE_KEY, "true");
      } catch {
        /* best-effort */
      }
      setDeviceUnlocked(true);
    } else {
      setAdminPasswordError("Wrong password.");
    }
  }

  function logoutAdmin() {
    setRole("visitor");
    setDeviceUnlocked(false);
    try {
      window.localStorage.removeItem(ADMIN_UNLOCK_LOCALSTORAGE_KEY);
    } catch {
      /* best-effort */
    }
  }

  async function submitChangePassword() {
    const stored = await loadAdminPassword();
    if (changePwCurrent !== stored) {
      setChangePwError("Current password is wrong.");
      return;
    }
    if (!changePwNew.trim()) {
      setChangePwError("New password can't be empty.");
      return;
    }
    await saveAdminPassword(changePwNew.trim());
    setShowChangePassword(false);
    setChangePwCurrent("");
    setChangePwNew("");
    setChangePwError("");
    showToast("Password changed.");
  }

  const [phase, setPhase] = useState("dashboard"); // dashboard | archive | setup | tournament | finished | season | players | elo
  const [tournamentId, setTournamentId] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [tournamentName, setTournamentName] = useState("");
  const [totalRounds, setTotalRounds] = useState(5);
  const [matchLength, setMatchLength] = useState(7);
  const [sideBets, setSideBets] = useState([]);
  const [calcuttaEntries, setCalcuttaEntries] = useState([]);
  const [defaultSideBetAmount, setDefaultSideBetAmount] = useState(40);
  const [addToSideBet, setAddToSideBet] = useState(false);
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRedraw, setConfirmingRedraw] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [liveStandingsEnabled, setLiveStandingsEnabled] = useState(false);
  const [isOfficial, setIsOfficial] = useState(false); // Official League day — only these count in "Recompute from scratch"
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(1);
  const [currentPairings, setCurrentPairings] = useState(null);
  const [history, setHistory] = useState([]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [randomCount, setRandomCount] = useState(10);
  const [view, setView] = useState("pairings");
  const [selectedRound, setSelectedRound] = useState(1);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  function showToast(message) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2500);
  }

  const [archive, setArchive] = useState([]);
  const [searchName, setSearchName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showAllArchive, setShowAllArchive] = useState(false);

  const [seasonBrowseYear, setSeasonBrowseYear] = useState(new Date().getFullYear());
  const [seasonYearsAvailable, setSeasonYearsAvailable] = useState([]);
  const [seasonData, setSeasonData] = useState({ players: {} });
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  const [registry, setRegistry] = useState({ players: {} });
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [registrySearch, setRegistrySearch] = useState("");
  const [expandedRegistryPlayer, setExpandedRegistryPlayer] = useState(null);
  const [contactDraft, setContactDraft] = useState(null);
  const [confirmingDeletePlayer, setConfirmingDeletePlayer] = useState(null);
  const [playerHistoryCache, setPlayerHistoryCache] = useState({});
  const [playerMatchStatsCache, setPlayerMatchStatsCache] = useState({});
  const [playerDetailTab, setPlayerDetailTab] = useState("contact"); // contact | stats
  const [eloTimeline, setEloTimeline] = useState(null); // null = not computed yet
  const [eloTimelineLoading, setEloTimelineLoading] = useState(false);
  const [confirmingRecompute, setConfirmingRecompute] = useState(false);
  const [newMembershipYear, setNewMembershipYear] = useState(new Date().getFullYear());
  const [nameDisplayMode, setNameDisplayMode] = useState("normal"); // normal | upper | greeklish
  const [eloData, setEloData] = useState({ players: {} });

  // Show the "What's New" popup once per browser per build — pure
  // localStorage, no Firestore round-trip, works for admins and visitors.
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(WHATS_NEW_SEEN_KEY);
      if (seen !== APP_BUILD_VERSION) {
        setShowWhatsNew(true);
        setHasUnseenUpdate(true);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — just skip silently.
    }
  }, []);

  function dismissWhatsNew() {
    setShowWhatsNew(false);
    setHasUnseenUpdate(false);
    try {
      window.localStorage.setItem(WHATS_NEW_SEEN_KEY, APP_BUILD_VERSION);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    async function init() {
      let index = await loadIndex();

      const registryData = await loadRegistry();
      if (Object.keys(registryData.players || {}).length === 0) {
        const seeded = { players: {} };
        SEED_PLAYERS.forEach((p) => {
          seeded.players[normalizeName(p.name)] = {
            name: p.name, club: p.club, email: p.email, phone: p.phone, membership: [], needsInfo: false, hasDiscount: false, discountAmount: 32,
          };
        });
        setRegistry(seeded);
        await saveRegistry(seeded);
      } else {
        setRegistry(registryData);
      }
      setRegistryLoaded(true);

      const season = await loadSeason(2026);
      const alreadyImported = Object.values(season.players || {}).some((p) =>
        Object.keys(p.entries || {}).some((id) => id.startsWith("hist-day"))
      );
      if (!alreadyImported) {
        await importHistoricalSeason2026();
      }

      const elo = await loadElo();
      if (!elo.initialized) {
        HISTORICAL_ELO_ROUNDS_2026.forEach((roundMatches) => {
          applyEloRoundBatch(elo, roundMatches, 7); // all 11 historical days used 7-point matches
        });
        elo.initialized = true;
        await saveElo(elo);
      }

      const days = Object.values(HISTORICAL_TOURNAMENTS_2026);
      // Sequential, not Promise.all: avoids firing many concurrent storage
      // writes at once (which risks silent failures/rate limiting). Always
      // re-saves every one of the 11 (idempotent, static data, cheap) rather
      // than trusting a single sample check — a partial failure on one day
      // must never leave the rest silently broken.
      let allOk = true;
      for (const t of days) {
        const result = await saveTournamentData(t.tournamentId, {
          tournamentName: t.tournamentName,
          totalRounds: t.totalRounds,
          matchLength: t.matchLength,
          seasonYear: t.seasonYear,
          liveStandingsEnabled: t.liveStandingsEnabled,
          isOfficial: true,
          phase: t.phase,
          players: t.players,
          round: t.round,
          currentPairings: t.currentPairings,
          history: t.history,
          createdAt: t.createdAt,
        });
        if (!result) allOk = false;
      }
      const newIndexEntries = days.map((t) => ({
        id: t.tournamentId,
        name: t.tournamentName,
        date: t.createdAt,
        status: "Completed",
        totalRounds: t.totalRounds,
        isOfficial: true,
      }));
      index = [...index.filter((t) => !t.id.startsWith("hist-day")), ...newIndexEntries];
      await saveIndex(index);
      if (!allOk) {
        setNotice("Some historical tournaments failed to save — try reloading the app.");
      }

      setArchive(index);
    }
    init();
  }, []);

  useEffect(() => {
    if (phase === "tournament") setSelectedRound(round);
    if (phase === "finished") setSelectedRound(totalRounds);
  }, [phase, round, totalRounds]);

  useEffect(() => {
    loadElo().then(setEloData);
  }, []);

  useEffect(() => {
    if (!expandedRegistryPlayer || !registry.players[expandedRegistryPlayer]) {
      setContactDraft(null);
      return;
    }
    const p = registry.players[expandedRegistryPlayer];
    setContactDraft({ name: p.name, club: p.club, email: p.email, phone: p.phone, hasDiscount: !!p.hasDiscount, discountAmount: p.discountAmount ?? 32 });
  }, [expandedRegistryPlayer]);

  useEffect(() => {
    if (phase !== "season") return;
    listSeasonYears().then((years) => {
      const withCurrent = years.includes(seasonBrowseYear) ? years : [seasonBrowseYear, ...years];
      setSeasonYearsAvailable(withCurrent);
    });
    loadSeason(seasonBrowseYear).then(setSeasonData);
  }, [phase, seasonBrowseYear]);

  /* ---- archive persistence ---- */

  function currentSnapshot() {
    return { tournamentName, totalRounds, matchLength, seasonYear, liveStandingsEnabled, isOfficial, sideBets, calcuttaEntries, phase, players, round, currentPairings, history, createdAt };
  }

  async function persistCurrent(nextPhase, nextRound, nextPlayers, nextPairings, nextHistory, nextSideBets = sideBets, nextCalcuttaEntries = calcuttaEntries) {
    if (!tournamentId) return;
    const snapshot = {
      tournamentName,
      totalRounds,
      matchLength,
      seasonYear,
      liveStandingsEnabled,
      isOfficial,
      sideBets: nextSideBets,
      calcuttaEntries: nextCalcuttaEntries,
      phase: nextPhase,
      players: nextPlayers,
      round: nextRound,
      currentPairings: nextPairings,
      history: nextHistory,
      createdAt,
    };
    await saveTournamentData(tournamentId, snapshot);
    setArchive((prev) => {
      const next = prev.filter((t) => t.id !== tournamentId);
      next.push({
        id: tournamentId,
        name: tournamentName || "Untitled",
        date: createdAt,
        status: nextPhase === "finished" ? "Completed" : "In progress",
        totalRounds,
        isOfficial,
      });
      saveIndex(next);
      return next;
    });
  }

  /* ---- setup phase ---- */

  function goToNewTournament() {
    setTournamentId(`t${Date.now()}`);
    setCreatedAt(new Date().toISOString());
    setTournamentName("");
    setTotalRounds(5);
    setMatchLength(7);
    setSideBets([]);
    setCalcuttaEntries([]);
    setSeasonYear(new Date().getFullYear());
    setLiveStandingsEnabled(false);
    setIsOfficial(false);
    setPlayers([]);
    setRound(1);
    setCurrentPairings(null);
    setHistory([]);
    setNotice("");
    setPhase("setup");
    setConfirmingDelete(false);
  }

  function findRegistryMatch(typedName) {
    const norm = normalizeName(typedName);
    if (registry.players[norm]) return registry.players[norm];
    const tokens = norm.split(/\s+/).filter(Boolean);
    let best = null;
    let bestScore = 0;
    Object.values(registry.players).forEach((p) => {
      const pTokens = normalizeName(p.name).split(/\s+/).filter(Boolean);
      const overlap = tokens.filter((t) => pTokens.includes(t)).length;
      const score = overlap / Math.max(tokens.length, pTokens.length, 1);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    });
    return bestScore >= 0.5 ? best : null;
  }

  function addPlayer() {
    const typed = newPlayerName.trim();
    if (!typed) return;
    const match = findRegistryMatch(typed);
    let canonicalName = typed;
    let isDiscounted = false;
    let discountAmt = 32;
    if (match) {
      canonicalName = match.name;
      isDiscounted = !!match.hasDiscount;
      discountAmt = match.discountAmount ?? 32;
    }
    const alreadyIn = players.some((p) => p.name.toLowerCase() === canonicalName.toLowerCase());
    if (alreadyIn) {
      setNotice(`${canonicalName} is already in this tournament.`);
      return;
    }
    if (!match) {
      const key = normalizeName(typed);
      persistRegistry({
        players: { ...registry.players, [key]: { name: typed, club: "", email: "", phone: "", membership: [], needsInfo: true, hasDiscount: false, discountAmount: 32 } },
      });
    }
    const newId = makeId();
    setPlayers((prev) => [
      ...prev,
      { id: newId, name: canonicalName, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, excludedFromTournament: false, matchLog: [], hasDiscount: isDiscounted, discountAmount: discountAmt, wantsCup: false },
    ]);
    if (addToSideBet) {
      setSideBets((prev) => {
        const existing = prev.find((b) => b.id === "default-sidebet");
        if (existing) {
          return prev.map((b) => (b.id === "default-sidebet" ? { ...b, participantIds: [...b.participantIds, newId] } : b));
        }
        return [...prev, { id: "default-sidebet", label: "Side bet", amountPerPlayer: defaultSideBetAmount, participantIds: [newId] }];
      });
    }
    setNewPlayerName("");
  }

  function removePlayer(id) {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }

  function toggleDiscount(id) {
    const updated = players.map((p) => (p.id === id ? { ...p, hasDiscount: !p.hasDiscount } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function updatePlayerDiscountAmount(id, amount) {
    const updated = players.map((p) => (p.id === id ? { ...p, discountAmount: amount } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function toggleWantsCup(id) {
    const updated = players.map((p) => (p.id === id ? { ...p, wantsCup: !p.wantsCup } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  // Explicit, admin-driven exclusion from future pairings — deliberately
  // separate from "retired in a match" (withdrawn/withdrawnRound), which is
  // set automatically and is purely informational. A player who retires in
  // one round is NOT auto-excluded from the next; the admin decides here.
  function toggleExclusion(id) {
    const updated = players.map((p) => (p.id === id ? { ...p, excludedFromTournament: !p.excludedFromTournament } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function toggleIsOfficial() {
    const next = !isOfficial;
    setIsOfficial(next);
    if (!tournamentId) return;
    saveTournamentData(tournamentId, { ...currentSnapshot(), isOfficial: next });
    setArchive((prev) => {
      const updated = prev.map((t) => (t.id === tournamentId ? { ...t, isOfficial: next } : t));
      saveIndex(updated);
      return updated;
    });
  }

  /* ---- side bets ---- */

  function addSideBet(label, amountPerPlayer) {
    const bet = { id: `sb${Date.now()}`, label: label || "Side bet", amountPerPlayer, participantIds: [] };
    const updated = [...sideBets, bet];
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  function removeSideBet(betId) {
    const updated = sideBets.filter((b) => b.id !== betId);
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  function toggleSideBetParticipant(betId, playerId) {
    const updated = sideBets.map((b) => {
      if (b.id !== betId) return b;
      const inBet = b.participantIds.includes(playerId);
      return { ...b, participantIds: inBet ? b.participantIds.filter((id) => id !== playerId) : [...b.participantIds, playerId] };
    });
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  function updateSideBetAmount(betId, amount) {
    const updated = sideBets.map((b) => (b.id === betId ? { ...b, amountPerPlayer: amount } : b));
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  /* ---- calcutta ---- */

  function addCalcuttaEntry(playerId, buyer, amount) {
    if (!playerId || !buyer.trim()) return;
    if (calcuttaEntries.some((e) => e.playerId === playerId)) return; // one buyer per player
    const updated = [...calcuttaEntries, { id: `cc${Date.now()}`, playerId, buyer: buyer.trim(), amount }];
    setCalcuttaEntries(updated);
    persistCurrent(phase, round, players, currentPairings, history, sideBets, updated);
  }

  function removeCalcuttaEntry(entryId) {
    const updated = calcuttaEntries.filter((e) => e.id !== entryId);
    setCalcuttaEntries(updated);
    persistCurrent(phase, round, players, currentPairings, history, sideBets, updated);
  }

  function addPlayersBulk() {
    const tokens = bulkText
      .split(/[\n,\t]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !/^\d+$/.test(t));
    if (tokens.length === 0) return;

    const registryAdditions = {};
    const resolvedPlayers = [];
    tokens.forEach((typed) => {
      const match = findRegistryMatch(typed) || registryAdditions[normalizeName(typed)];
      if (match) {
        resolvedPlayers.push({ name: match.name, hasDiscount: !!match.hasDiscount, discountAmount: match.discountAmount ?? 32 });
      } else {
        const key = normalizeName(typed);
        registryAdditions[key] = { name: typed, club: "", email: "", phone: "", membership: [], needsInfo: true, hasDiscount: false, discountAmount: 32 };
        resolvedPlayers.push({ name: typed, hasDiscount: false, discountAmount: 32 });
      }
    });

    if (Object.keys(registryAdditions).length > 0) {
      persistRegistry({ players: { ...registry.players, ...registryAdditions } });
    }

    setPlayers((prev) => {
      const existingNames = new Set(prev.map((p) => p.name.toLowerCase()));
      const additions = [];
      resolvedPlayers.forEach(({ name, hasDiscount, discountAmount }) => {
        const key = name.toLowerCase();
        if (existingNames.has(key)) return;
        existingNames.add(key);
        additions.push({
          id: makeId(), name, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, excludedFromTournament: false, matchLog: [], hasDiscount, discountAmount: discountAmount ?? 32, wantsCup: false,
        });
      });
      return [...prev, ...additions];
    });
    setBulkText("");
  }

  function addRandomPlayers() {
    const existingNames = new Set(players.map((p) => p.name.toLowerCase()));
    const available = Object.values(registry.players || {}).filter((p) => !existingNames.has(p.name.toLowerCase()));
    const picked = shuffle(available).slice(0, randomCount);
    if (picked.length === 0) return;
    setPlayers((prev) => [
      ...prev,
      ...picked.map((p) => ({
        id: makeId(), name: p.name, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, matchLog: [],
        hasDiscount: !!p.hasDiscount, discountAmount: p.discountAmount ?? 32, wantsCup: false,
      })),
    ]);
    if (picked.length < randomCount) {
      setNotice(`Only ${picked.length} registry players were available to add.`);
    }
  }

  function toggleDefaultSideBetForPlayer(playerId) {
    setSideBets((prev) => {
      const existing = prev.find((b) => b.id === "default-sidebet");
      if (!existing) {
        return [...prev, { id: "default-sidebet", label: "Side bet", amountPerPlayer: defaultSideBetAmount, participantIds: [playerId] }];
      }
      const inBet = existing.participantIds.includes(playerId);
      return prev.map((b) =>
        b.id === "default-sidebet"
          ? { ...b, participantIds: inBet ? b.participantIds.filter((id) => id !== playerId) : [...b.participantIds, playerId] }
          : b
      );
    });
  }

  function startTournament() {
    if (players.length < 3) return;
    const pairing = generatePairings(players, 1);
    setCurrentPairings(pairing);
    setRound(1);
    setPhase("tournament");
    setView("pairings");
    persistCurrent("tournament", 1, players, pairing, []);
  }

  /* ---- tournament phase ---- */

  function setResult(pairIndex, winnerId, loserId, method) {
    setCurrentPairings((prev) => {
      const pairs = prev.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: { winnerId, loserId, method } } : pr));
      return { ...prev, pairs };
    });
  }

  function clearResult(pairIndex) {
    setCurrentPairings((prev) => {
      const pairs = prev.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: null } : pr));
      return { ...prev, pairs };
    });
  }

  function setHistoricalResult(roundNumber, pairIndex, winnerId, loserId, method) {
    const updatedHistory = history.map((entry) =>
      entry.round !== roundNumber
        ? entry
        : { ...entry, pairs: entry.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: { winnerId, loserId, method } } : pr)) }
    );
    const recomputed = replayPlayersFromHistory(players, updatedHistory);
    setHistory(updatedHistory);
    setPlayers(recomputed);
    persistCurrent(phase, round, recomputed, currentPairings, updatedHistory);
  }

  function clearHistoricalResult(roundNumber, pairIndex) {
    const updatedHistory = history.map((entry) =>
      entry.round !== roundNumber
        ? entry
        : { ...entry, pairs: entry.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: null } : pr)) }
    );
    const recomputed = replayPlayersFromHistory(players, updatedHistory);
    setHistory(updatedHistory);
    setPlayers(recomputed);
    persistCurrent(phase, round, recomputed, currentPairings, updatedHistory);
  }

  /** Redraws the live round. For round 1, that means deleting the round
   * entirely and dropping back to Setup so the roster can be adjusted
   * (add/remove players) before pressing "Start Tournament" again. For any
   * later round, it reverts one step: pops the last finalized round back off
   * history, restores it (with whatever results it already had) as the live,
   * editable round, and discards the current round's pairing — so a mistake
   * spotted in that prior round can be fixed and the next round re-drawn clean. */
  function redrawCurrentRound() {
    if (round === 1) {
      setCurrentPairings(null);
      setPhase("setup");
      persistCurrent("setup", 1, players, null, []);
      return;
    }
    const lastEntry = history[history.length - 1];
    if (!lastEntry) return;
    const remainingHistory = history.slice(0, -1);
    const recomputed = replayPlayersFromHistory(players, remainingHistory);
    const restoredPairing = { pairs: lastEntry.pairs, bye: lastEntry.bye, rematchCount: 0 };
    setHistory(remainingHistory);
    setPlayers(recomputed);
    setRound(lastEntry.round);
    setCurrentPairings(restoredPairing);
    persistCurrent(phase, lastEntry.round, recomputed, restoredPairing, remainingHistory);
  }

  const roundComplete = currentPairings && currentPairings.pairs.every((pr) => pr.result !== null);

  // TODO: TESTING ONLY — remove this function and its button before the real/production version.
  function randomizeRoundResults() {
    if (!currentPairings) return;
    const updatedPairs = currentPairings.pairs.map((pr) => {
      if (pr.result) return pr;
      const winnerId = Math.random() < 0.5 ? pr.p1 : pr.p2;
      const loserId = winnerId === pr.p1 ? pr.p2 : pr.p1;
      return { ...pr, result: { winnerId, loserId, method: "normal" } };
    });
    setCurrentPairings({ ...currentPairings, pairs: updatedPairs });
  }

  async function finalizeRoundAndAdvance(updateSeason) {
    if (!roundComplete) return;
    const byId = {};
    players.forEach((p) => (byId[p.id] = { ...p, opponents: [...p.opponents], matchLog: [...p.matchLog] }));

    currentPairings.pairs.forEach((pr) => {
      const { winnerId, loserId, method } = pr.result;
      if (method === "double_retirement") {
        const a = byId[pr.p1];
        const b = byId[pr.p2];
        a.opponents.push(pr.p2);
        b.opponents.push(pr.p1);
        a.matchLog.push({ round, opponentId: pr.p2, method: "double_retirement", result: "loss" });
        b.matchLog.push({ round, opponentId: pr.p1, method: "double_retirement", result: "loss" });
        a.withdrawn = true; a.withdrawnRound = round;
        b.withdrawn = true; b.withdrawnRound = round;
        return;
      }
      const w = byId[winnerId];
      const l = byId[loserId];
      w.wins += 1;
      w.opponents.push(loserId);
      l.opponents.push(winnerId);
      const winMethod = method === "retirement" ? "retirement_win" : "normal";
      const loseMethod = method === "retirement" ? "retirement_loss" : "normal";
      w.matchLog.push({ round, opponentId: loserId, method: winMethod, result: "win" });
      l.matchLog.push({ round, opponentId: winnerId, method: loseMethod, result: "loss" });
      if (method === "retirement") {
        l.withdrawn = true;
        l.withdrawnRound = round;
      }
    });

    if (currentPairings.bye) {
      const b = byId[currentPairings.bye];
      b.wins += 1;
      b.hadBye = true;
      b.matchLog.push({ round, opponentId: null, method: "bye", result: "win" });
    }

    const updatedPlayers = players.map((p) => byId[p.id]);
    const newHistory = [...history, { round, pairs: currentPairings.pairs, bye: currentPairings.bye }];

    setPlayers(updatedPlayers);
    setHistory(newHistory);

    const eloRoundMatches = currentPairings.pairs.map((pr) => ({
      w: byId[pr.result.winnerId].name,
      l: byId[pr.result.loserId].name,
      ret: pr.result.method === "retirement",
    }));
    loadElo().then((elo) => {
      applyEloRoundBatch(elo, eloRoundMatches, matchLength);
      saveElo(elo);
    });

    // Retries once on failure — saveSeason now honestly reports success/failure
    // instead of silently swallowing a storage hiccup, so we can tell the
    // person plainly if the season really didn't update.
    async function pushSeasonUpdateWithRetry() {
      let ok = await pushSeasonUpdate(seasonYear, tournamentId, tournamentName || "Untitled", createdAt, updatedPlayers);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 800));
        ok = await pushSeasonUpdate(seasonYear, tournamentId, tournamentName || "Untitled", createdAt, updatedPlayers);
      }
      return ok;
    }

    let noticeMsg =
      currentPairings.rematchCount > 0
        ? `Note: ${currentPairings.rematchCount} forced rematch due to limited pairing options.`
        : "";

    if (round >= totalRounds) {
      setPhase("finished");
      setCurrentPairings(null);
      await persistCurrent("finished", round, updatedPlayers, null, newHistory);
      if (updateSeason) {
        const seasonOk = await pushSeasonUpdateWithRetry();
        if (seasonOk) {
          showToast("Η βαθμολογία ενημερώθηκε.");
        } else {
          noticeMsg = [
            noticeMsg,
            "Warning: couldn't save to Season Standings after two tries. Mark this tournament \"Official League day\" (if it should count) and use \"Recompute ELO & Season Standings from scratch\" on the ELO page to pick it up.",
          ].filter(Boolean).join(" ");
        }
      } else {
        noticeMsg = [noticeMsg, "Tournament finished (Season Standings not updated, as requested)."].filter(Boolean).join(" ");
      }
    } else {
      const nextRound = round + 1;
      const nextPairing = generatePairings(updatedPlayers, nextRound);
      setRound(nextRound);
      setCurrentPairings(nextPairing);
      await persistCurrent("tournament", nextRound, updatedPlayers, nextPairing, newHistory);
      if (liveStandingsEnabled) {
        const seasonOk = await pushSeasonUpdateWithRetry();
        noticeMsg = [
          noticeMsg,
          seasonOk
            ? "Live season standings updated."
            : "Warning: couldn't save live Season Standings after two tries.",
        ].filter(Boolean).join(" ");
      }
    }
    setNotice(noticeMsg);
  }

  /* ---- file persistence (local download / upload) ---- */

  function exportJSON() {
    const data = currentSnapshot();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (tournamentName || "tournament").replace(/[^\w-]+/g, "_");
    a.download = `${safe}_gyros${round}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportAllData() {
    const registryData = await loadRegistry();
    const eloData2 = await loadElo();
    const index = await loadIndex();
    const years = await listSeasonYears();
    const seasons = {};
    for (const y of years) {
      seasons[y] = await loadSeason(y);
    }
    const tournaments = {};
    for (const t of index) {
      tournaments[t.id] = await fetchTournamentData(t.id);
    }
    const fullBackup = {
      exportedAt: new Date().toISOString(),
      registry: registryData,
      elo: eloData2,
      archiveIndex: index,
      seasons,
      tournaments,
    };
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `bgfed_full_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Full backup downloaded.");
  }

  /** Restores every store (registry, ELO, archive index, all seasons, all
   * tournaments) from a file produced by "Export All Data". Overwrites
   * whatever is currently in storage — use right after Unpublish+Publish
   * (which starts from empty storage) to bring real data back. */
  function importAllData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.registry || !data.elo || !data.archiveIndex) {
          setNotice("That doesn't look like a full backup file.");
          return;
        }
        await saveRegistry(data.registry);
        await saveElo(data.elo);
        await saveIndex(data.archiveIndex);
        for (const [year, season] of Object.entries(data.seasons || {})) {
          await saveSeason(Number(year), season);
        }
        for (const [id, tData] of Object.entries(data.tournaments || {})) {
          if (tData) await saveTournamentData(id, tData);
        }
        setRegistry(data.registry);
        setEloData(data.elo);
        setArchive(data.archiveIndex);
        setEloTimeline(null);
        setPlayerMatchStatsCache({});
        showToast("Full backup restored.");
      } catch {
        setNotice("That file wasn't valid, or wasn't a full backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setTournamentId(`t${Date.now()}`);
        setCreatedAt(data.createdAt || new Date().toISOString());
        setTournamentName(data.tournamentName || "");
        setTotalRounds(data.totalRounds || 5);
        setMatchLength(data.matchLength || 7);
        setSideBets(data.sideBets || []);
        setCalcuttaEntries(data.calcuttaEntries || []);
        setSeasonYear(data.seasonYear || new Date().getFullYear());
        setLiveStandingsEnabled(!!data.liveStandingsEnabled);
        setIsOfficial(!!data.isOfficial);
        setPhase(data.phase || "setup");
        setPlayers(data.players || []);
        setRound(data.round || 1);
        setCurrentPairings(data.currentPairings || null);
        setHistory(data.history || []);
        setNotice("Tournament file loaded.");
      } catch {
        setNotice("That file wasn't valid.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  /* ---- archive navigation ---- */

  async function openArchived(id) {
    const data = await fetchTournamentData(id);
    if (!data) {
      setNotice("This tournament could not be loaded.");
      return;
    }
    setTournamentId(id);
    setCreatedAt(data.createdAt || null);
    setTournamentName(data.tournamentName || "");
    setTotalRounds(data.totalRounds || 5);
    setMatchLength(data.matchLength || 7);
    setSideBets(data.sideBets || []);
    setCalcuttaEntries(data.calcuttaEntries || []);
    setSeasonYear(data.seasonYear || new Date().getFullYear());
    setLiveStandingsEnabled(!!data.liveStandingsEnabled);
    setIsOfficial(!!data.isOfficial);
    setPlayers(data.players || []);
    setRound(data.round || 1);
    setCurrentPairings(data.currentPairings || null);
    setHistory(data.history || []);
    setPhase(data.phase || "finished");
    setView("standings");
    setConfirmingDelete(false);
  }

  function goHome() {
    setPhase("dashboard");
    setNotice("");
    setConfirmingDelete(false);
  }

  function goToArchive() {
    setPhase("archive");
    setNotice("");
    setConfirmingDelete(false);
  }

  async function confirmDeleteTournament() {
    if (!tournamentId) return;
    await deleteTournamentData(tournamentId);
    const nextIndex = archive.filter((t) => t.id !== tournamentId);
    setArchive(nextIndex);
    await saveIndex(nextIndex);
    setConfirmingDelete(false);
    setNotice("Tournament deleted.");
    goToArchive();
  }

  /* ---- player registry ---- */

  function persistRegistry(next) {
    setRegistry(next);
    saveRegistry(next);
  }

  function addRegistryPlayer() {
    let suffix = 1;
    let key = normalizeName("New Player");
    while (registry.players[key]) {
      suffix += 1;
      key = normalizeName(`New Player ${suffix}`);
    }
    const name = suffix === 1 ? "New Player" : `New Player ${suffix}`;
    const next = {
      players: {
        ...registry.players,
        [key]: { name, club: "", email: "", phone: "", membership: [], needsInfo: true, hasDiscount: false, discountAmount: 32 },
      },
    };
    persistRegistry(next);
    setExpandedRegistryPlayer(key);
    loadPlayerTournamentHistory(name);
  }

  function saveContactDraft(key) {
    const player = registry.players[key];
    if (!player || !contactDraft) return;
    const newName = (contactDraft.name || "").trim();
    if (!newName) {
      showToast("Player needs a name before saving.");
      return;
    }
    const newKey = normalizeName(newName);
    const stillNeedsInfo = contactDraft.email.trim() || contactDraft.phone.trim() ? false : player.needsInfo;
    const updated = { ...player, ...contactDraft, name: newName, needsInfo: stillNeedsInfo };
    const nextPlayers = { ...registry.players };
    if (newKey !== key) delete nextPlayers[key];
    nextPlayers[newKey] = updated;
    persistRegistry({ players: nextPlayers });
    if (newKey !== key) setExpandedRegistryPlayer(newKey);
    showToast(`${newName} saved.`);
  }

  function deleteRegistryPlayer(key) {
    const player = registry.players[key];
    if (!player) return;
    const nextPlayers = { ...registry.players };
    delete nextPlayers[key];
    persistRegistry({ players: nextPlayers });
    setExpandedRegistryPlayer(null);
    setConfirmingDeletePlayer(null);
    showToast(`${player.name} removed from the registry.`);
  }

  function addMembershipRow(key, year) {
    const player = registry.players[key];
    if (!player) return;
    const exists = player.membership.some((m) => m.year === year);
    if (exists) return;
    const nextMembership = [...player.membership, { year, member: true, dues: true }].sort((a, b) => b.year - a.year);
    const next = { players: { ...registry.players, [key]: { ...player, membership: nextMembership } } };
    persistRegistry(next);
  }

  function updateMembershipRow(key, year, field, value) {
    const player = registry.players[key];
    if (!player) return;
    const nextMembership = player.membership.map((m) => (m.year === year ? { ...m, [field]: value } : m));
    const next = { players: { ...registry.players, [key]: { ...player, membership: nextMembership } } };
    persistRegistry(next);
  }

  function removeMembershipRow(key, year) {
    const player = registry.players[key];
    if (!player) return;
    const nextMembership = player.membership.filter((m) => m.year !== year);
    const next = { players: { ...registry.players, [key]: { ...player, membership: nextMembership } } };
    persistRegistry(next);
  }

  async function loadPlayerTournamentHistory(name) {
    const key = normalizeName(name);
    const years = await listSeasonYears();
    const rows = [];
    for (const year of years) {
      const season = await loadSeason(year);
      const entry = season.players[key];
      if (entry) {
        Object.values(entry.entries).forEach((e) => {
          rows.push({ year, tournamentName: e.tournamentName, date: e.date, points: e.points });
        });
      }
    }
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    setPlayerHistoryCache((prev) => ({ ...prev, [key]: rows }));
  }

  /** Replays every match chronologically (the 11 embedded historical days,
   * then any other archived tournament by date) into a fresh, throwaway ELO
   * state, snapshotting each participant's rating and cumulative win rate
   * after each day/tournament. Computed once, cached, and reused for every
   * player card — recomputing per player would repeat the same replay. */
  async function computeEloTimeline() {
    setEloTimelineLoading(true);
    const realDates = {
      1: "2025-09-27", 2: "2025-10-18", 3: "2025-11-08", 4: "2025-11-29",
      5: "2026-01-10", 6: "2026-02-14", 7: "2026-03-14", 8: "2026-03-28",
      9: "2026-04-25", 10: "2026-05-17", 11: "2026-06-13",
    };
    const working = { players: {} };
    const timeline = {};

    function snapshot(date, participantKeys) {
      participantKeys.forEach((key) => {
        const p = working.players[key];
        if (!p) return;
        if (!timeline[key]) timeline[key] = [];
        const wins = p.wins || 0;
        timeline[key].push({ date, rating: p.rating, winRate: p.games > 0 ? (wins / p.games) * 100 : 0 });
      });
    }

    for (let day = 1; day <= 11; day++) {
      const dayRounds = HISTORICAL_ELO_ROUNDS_2026.slice((day - 1) * 5, day * 5);
      const participants = new Set();
      dayRounds.forEach((roundMatches) => {
        applyEloRoundBatch(working, roundMatches, 7);
        roundMatches.forEach((m) => {
          if (m.ret) return;
          const wKey = normalizeName(m.w);
          working.players[wKey].wins = (working.players[wKey].wins || 0) + 1;
          participants.add(wKey);
          participants.add(normalizeName(m.l));
        });
      });
      snapshot(realDates[day], [...participants]);
    }

    const extraTournaments = archive.filter((t) => !t.id.startsWith("hist-day")).sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const t of extraTournaments) {
      const data = await fetchTournamentData(t.id);
      if (!data || !data.history || !data.players) continue;
      const participants = new Set();
      data.history.forEach((entry) => {
        const roundMatches = [];
        entry.pairs.forEach((pr) => {
          if (!pr.result) return;
          const w = data.players.find((p) => p.id === pr.result.winnerId);
          const l = data.players.find((p) => p.id === pr.result.loserId);
          if (!w || !l) return;
          roundMatches.push({ w: w.name, l: l.name, ret: pr.result.method === "retirement" });
        });
        applyEloRoundBatch(working, roundMatches, data.matchLength || 7);
        roundMatches.forEach((m) => {
          if (m.ret) return;
          const wKey = normalizeName(m.w);
          working.players[wKey].wins = (working.players[wKey].wins || 0) + 1;
          participants.add(wKey);
          participants.add(normalizeName(m.l));
        });
      });
      snapshot(t.date, [...participants]);
    }

    setEloTimeline(timeline);
    setEloTimelineLoading(false);
  }

  /** Rebuilds elo-ratings and season-standings:2026 entirely from scratch,
   * replaying every tournament flagged "Official" (isOfficial: true), in
   * chronological order, straight from its own stored history — the 11
   * League days are flagged this way by default. Any tournament NOT
   * flagged Official (e.g. a test) is skipped entirely, whether or not it
   * still exists in the archive — no need to delete it first. */
  async function recomputeEloAndSeasonFromScratch() {
    setNotice("Recomputing ELO and Season Standings from official League days…");
    const elo = { players: {}, initialized: true };
    const season = { players: {} };

    const officialTournaments = archive.filter((t) => t.isOfficial).sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const t of officialTournaments) {
      const data = await fetchTournamentData(t.id);
      if (!data || !data.history || !data.players) continue;
      data.history.forEach((entry) => {
        const roundMatches = [];
        entry.pairs.forEach((pr) => {
          if (!pr.result) return;
          const w = data.players.find((p) => p.id === pr.result.winnerId);
          const l = data.players.find((p) => p.id === pr.result.loserId);
          if (!w || !l) return;
          roundMatches.push({ w: w.name, l: l.name, ret: pr.result.method === "retirement" });
        });
        applyEloRoundBatch(elo, roundMatches, data.matchLength || 7);
      });
      if (data.phase === "finished") {
        data.players.forEach((p) => {
          const key = normalizeName(p.name);
          if (!season.players[key]) season.players[key] = { name: p.name, entries: {} };
          season.players[key].name = p.name;
          const wins = p.matchLog.filter((m) => m.method === "normal" && m.result === "win").length;
          const aa = p.matchLog.filter((m) => m.method === "retirement_win").length;
          const bye = p.matchLog.filter((m) => m.method === "bye").length;
          // Retirement wins don't count toward the winner's matches-played total
    // (they get the standings point, but the match itself doesn't "count"
    // for them); a retirement loss, a double retirement, and every normal
    // match do count, for whoever played them.
    const matches = p.matchLog.filter((m) => m.method !== "bye" && m.method !== "retirement_win").length;
          const normalMatches = p.matchLog.filter((m) => m.method === "normal").length;
          season.players[key].entries[t.id] = {
            tournamentName: data.tournamentName, date: data.createdAt, points: p.wins, wins, aa, bye, matches, normalMatches,
          };
        });
      }
    }

    await saveElo(elo);
    await saveSeason(2026, season);
    setEloData(elo);
    setEloTimeline(null);
    setPlayerMatchStatsCache({});
    if (seasonBrowseYear === 2026) setSeasonData(season);
    setNotice("");
    showToast("ELO and Season Standings recomputed from official League days.");
  }

  async function loadPlayerMatchStats(name) {
    const key = normalizeName(name);
    const myRating = eloData.players?.[key]?.rating ?? ELO_INITIAL;
    let vsStrongerW = 0, vsStrongerL = 0, vsWeakerW = 0, vsWeakerL = 0;
    for (const t of archive) {
      const data = await fetchTournamentData(t.id);
      if (!data || !data.players) continue;
      const me = data.players.find((p) => normalizeName(p.name) === key);
      if (!me || !me.matchLog) continue;
      me.matchLog.forEach((m) => {
        if (m.method === "bye" || !m.opponentId) return;
        const opp = data.players.find((p) => p.id === m.opponentId);
        if (!opp) return;
        const oppRating = eloData.players?.[normalizeName(opp.name)]?.rating ?? ELO_INITIAL;
        const isWin = m.result === "win";
        if (oppRating > myRating) {
          if (isWin) vsStrongerW += 1; else vsStrongerL += 1;
        } else {
          if (isWin) vsWeakerW += 1; else vsWeakerL += 1;
        }
      });
    }
    setPlayerMatchStatsCache((prev) => ({ ...prev, [key]: { vsStrongerW, vsStrongerL, vsWeakerW, vsWeakerL } }));
  }

  function openPlayerDetail(key) {
    setNotice("");
    setConfirmingDeletePlayer(null);
    setPlayerDetailTab("contact");
    setExpandedRegistryPlayer(key);
    setPhase("playerDetail");
    if (!playerHistoryCache[key]) {
      loadPlayerTournamentHistory(registry.players[key].name);
    }
    if (!playerMatchStatsCache[key]) {
      loadPlayerMatchStats(registry.players[key].name);
    }
    if (eloTimeline === null && !eloTimelineLoading) {
      computeEloTimeline();
    }
  }

  async function importHistoricalSeason2026() {
    const season = await loadSeason(2026);
    const realDates = {
      1: "2025-09-27", 2: "2025-10-18", 3: "2025-11-08", 4: "2025-11-29",
      5: "2026-01-10", 6: "2026-02-14", 7: "2026-03-14", 8: "2026-03-28",
      9: "2026-04-25", 10: "2026-05-17", 11: "2026-06-13",
    };
    HISTORICAL_IMPORT_2026.forEach((player) => {
      const key = normalizeName(player.name);
      if (!season.players[key]) season.players[key] = { name: player.name, entries: {} };
      season.players[key].name = player.name;
      Object.entries(player.days).forEach(([dayNum, d]) => {
        const tournamentId = `hist-day${dayNum}`;
        const date = new Date(realDates[dayNum] + "T00:00:00Z").toISOString();
        season.players[key].entries[tournamentId] = {
          tournamentName: `Backgammon Premier League 2026 - Ημέρα ${dayNum}`,
          date,
          points: d.points,
          wins: d.wins,
          bye: d.bye,
          aa: d.aa,
          matches: d.matches,
          // This pre-aggregated historical source doesn't track retirement
          // losses separately, so this is an approximation (only excludes
          // A.A. wins, not retirement losses). Running "Recompute ELO &
          // Season Standings from scratch" replaces it with the exact
          // figure, derived from each day's real match log.
          normalMatches: Math.max(d.matches - (d.aa || 0), 0),
        };
      });
    });
    await saveSeason(2026, season);
    if (seasonBrowseYear === 2026) setSeasonData(season);
    setNotice(`Imported ${HISTORICAL_IMPORT_2026.length} players across 11 days into the 2026 season.`);
  }

  /* ---------------------------------------------------------------------- */
  /* Derived data                                                           */
  /* ---------------------------------------------------------------------- */

  const buchholz = phase === "finished" ? computeBuchholz(players) : null;
  const standings = sortStandings(players, buchholz);
  const byId = {};
  players.forEach((p) => (byId[p.id] = p));

  function getRoundData(r) {
    if (phase === "tournament" && r === round) {
      return currentPairings ? { pairs: currentPairings.pairs, bye: currentPairings.bye, editable: true } : null;
    }
    const h = history.find((entry) => entry.round === r);
    if (!h) return null;
    return { pairs: h.pairs, bye: h.bye, editable: false };
  }

  const availableRounds =
    phase === "finished"
      ? Array.from({ length: totalRounds }, (_, i) => i + 1)
      : Array.from({ length: round }, (_, i) => i + 1);

  const roundData = getRoundData(selectedRound);

  const filteredArchive = archive
    .filter((t) => (searchName ? t.name.toLowerCase().includes(searchName.toLowerCase()) : true))
    .filter((t) => (dateFrom ? new Date(t.date) >= new Date(dateFrom) : true))
    .filter((t) => (dateTo ? new Date(t.date) <= new Date(dateTo + "T23:59:59") : true))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const archiveHasFilter = searchName || dateFrom || dateTo;
  const visibleArchive = archiveHasFilter || showAllArchive ? filteredArchive : filteredArchive.slice(0, 10);

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Sans+3:wght@400;500;600;700&display=swap');

        :root {
          --bg: #F4ECDD;
          --surface: #FFFCF5;
          --ink: #1E140A;
          --muted: #6E5D48;
          --accent: #7C2D2D;
          --accent-soft: #F1DED2;
          --border: #D8C4A0;
          --win: #34503C;
        }
        * { box-sizing: border-box; }
        .app { background: var(--bg); color: var(--ink); font-family: 'Source Sans 3', system-ui, sans-serif; min-height: 100%; width: 100%; }

        .topbar { display: flex; justify-content: space-between; align-items: center; padding: 14px 28px; border-bottom: 1px solid var(--border); }
        .brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: var(--accent); }
        .role-toggle { display: flex; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 3px; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 200; }
        .modal-card { background: var(--surface); border-radius: 12px; padding: 24px; width: 320px; max-width: 90vw; box-shadow: 0 12px 32px rgba(0,0,0,0.25); }
        .role-btn { border: none; background: none; padding: 6px 12px; border-radius: 17px; font-size: 12px; font-weight: 600; color: var(--muted); }
        .role-btn.active { background: var(--accent); color: #fff; }

        .header { padding: 24px 28px 0 28px; }
        .eyebrow { font-size: 13px; color: var(--muted); margin: 0 0 4px 0; }
        h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; margin: 0; line-height: 1.15; }
        .round-tag { font-family: 'Fraunces', serif; font-size: 16px; color: var(--accent); }
        .points-strip { display: flex; margin: 18px 0 0 0; height: 22px; overflow: hidden; }
        .point { width: 16px; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; margin-right: 1px; flex-shrink: 0; }
        .point.down.a { border-top: 22px solid var(--accent); }
        .point.down.b { border-top: 22px solid var(--ink); opacity: 0.5; }
        .point.up.a { border-bottom: 22px solid var(--accent); }
        .point.up.b { border-bottom: 22px solid var(--ink); opacity: 0.5; }

        .content { padding: 24px 28px 60px 28px; max-width: 1180px; margin: 0 auto; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }

        label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 6px; }
        input[type="text"], input[type="number"], input[type="date"] {
          font-family: 'Source Sans 3', sans-serif; font-size: 15px; padding: 9px 12px;
          border: 1px solid var(--border); border-radius: 7px; background: #fff; color: var(--ink); width: 100%;
        }
        textarea {
          font-family: 'Source Sans 3', sans-serif; font-size: 14px; padding: 9px 12px;
          border: 1px solid var(--border); border-radius: 7px; background: #fff; color: var(--ink); width: 100%; resize: vertical;
        }
        input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

        .row { display: flex; gap: 10px; align-items: flex-end; }
        .field { flex: 1; }

        button {
          font-family: 'Source Sans 3', sans-serif; font-weight: 600; font-size: 14px; border-radius: 7px;
          border: 1px solid transparent; padding: 10px 16px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
          transition: transform 0.08s ease, opacity 0.15s ease;
        }
        button:active { transform: scale(0.98); }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-primary:hover:not(:disabled) { opacity: 0.9; }
        .btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border); }
        .btn-secondary:hover:not(:disabled) { background: var(--accent-soft); }
        .btn-ghost { background: transparent; color: var(--muted); border: none; padding: 4px 6px; font-size: 13px; }
        .btn-ghost:hover { color: var(--accent); }

        .player-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
        .player-chip { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; background: #fff; border: 1px solid var(--border); border-radius: 7px; font-size: 15px; }

        .tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--border); }
        .tab { background: none; border: none; padding: 10px 4px; margin-right: 18px; font-size: 15px; font-weight: 600; color: var(--muted); border-bottom: 2px solid transparent; border-radius: 0; }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .tab:hover:not(.active) { color: var(--ink); }

        .bye-card { background: var(--accent-soft); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-bottom: 14px; font-size: 14px; display: flex; align-items: center; gap: 10px; }

        .round-pills { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
        .round-pill { background: var(--surface); border: 1px solid var(--border); color: var(--muted); padding: 6px 13px; border-radius: 20px; font-size: 13px; font-weight: 600; }
        .round-pill.active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .round-pill:hover:not(.active) { background: var(--accent-soft); color: var(--ink); }
        .live-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); margin-bottom: 14px; cursor: pointer; }
        .live-toggle input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
        .membership-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; }
        .membership-row select { font-family: 'Source Sans 3', sans-serif; font-size: 13px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
        .needs-info-badge { font-size: 11px; font-weight: 700; color: var(--accent); }

        .qual-legend { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-bottom: 16px; }
        .qual-row { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; flex-wrap: nowrap; padding: 8px 14px; border-radius: 6px; color: #000; font-weight: 500; width: fit-content; max-width: 100%; box-sizing: border-box; }
        .qual-row.qual-tier1 { background: #00FFFF; }
        .qual-row.qual-tier2 { background: #FF00FF; }
        .qual-row.qual-tier3 { background: #00FF00; }
        tr.qual-tier1 td { background: #00FFFF; color: #000; }
        tr.qual-tier2 td { background: #FF00FF; color: #000; }
        tr.qual-tier3 td { background: #00FF00; color: #000; }
        .th-sub { font-weight: 400; font-size: 10px; color: var(--muted); text-transform: none; }
        .entry-breakdown { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--muted); }
        .entry-breakdown strong { color: var(--ink); font-size: 13px; }

        .finance-summary { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .finance-stat { flex: 1; min-width: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
        .finance-stat-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
        .finance-stat-value { font-family: 'Fraunces', serif; font-size: 22px; color: var(--accent); }
        .finance-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
        .finance-row:last-child { border-bottom: none; }
        .prize-badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px; background: var(--accent-soft); color: var(--accent); margin-right: 8px; }
        .prize-badge.win { background: var(--win); color: #fff; }
        .prize-badge.side { background: var(--border); color: var(--ink); }
        .winners-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
        .winners-col-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 8px 0; }
        @media (max-width: 600px) { .winners-columns { grid-template-columns: 1fr; } }

        .wins-highlight { display: inline-block; min-width: 26px; font-family: 'Fraunces', serif; font-weight: 700; font-size: 16px; color: var(--accent); background: var(--accent-soft); border-radius: 6px; padding: 2px 8px; }
        .buchholz-header { color: var(--muted); font-weight: 400; }
        .buchholz-cell { color: var(--muted); font-size: 13px; }

        .delete-control { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .delete-confirm { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; flex-wrap: wrap; }

        .name-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; max-height: 220px; overflow-y: auto; background: #fff; border: 1px solid var(--border); border-radius: 7px; box-shadow: 0 6px 16px rgba(0,0,0,0.12); z-index: 20; }
        .name-dropdown-option { padding: 8px 12px; font-size: 14px; cursor: pointer; }
        .name-dropdown-option:hover { background: var(--accent-soft); }

        .match-card { padding: 18px 22px; }
        .match-names { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 4px; }
        .match-name {
          font-family: 'Fraunces', serif; font-weight: 700; font-size: 20px; text-align: center; flex: 1;
          padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.5);
        }
        .match-name.winner { color: var(--accent); background: var(--accent-soft); }
        .match-name.loser { color: var(--muted); }
        .match-vs { color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

        .win-prob { margin: 6px 0 12px 0; }
        .win-prob-bar { height: 8px; border-radius: 4px; background: var(--accent-soft); overflow: hidden; }
        .win-prob-fill { height: 100%; background: var(--accent); border-radius: 4px 0 0 4px; transition: width 0.2s ease; }
        .win-prob-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; font-weight: 600; }
        .win-prob-headline { font-size: 13px; margin: 0 0 6px 0; color: var(--ink); }
        .win-prob-pct { color: var(--accent); font-weight: 700; }

        .elo-snapshot { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .elo-snapshot-stat { flex: 1; min-width: 90px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
        .history-table { display: flex; flex-direction: column; gap: 2px; }
        .history-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 4px; border-bottom: 1px solid var(--border); }
        .history-row:last-child { border-bottom: none; }

        .detail-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
        .detail-tab { padding: 8px 16px; font-size: 13px; font-weight: 600; color: var(--muted); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
        .detail-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .detail-tab:hover:not(.active) { color: var(--ink); }

        .trend-chart-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 6px 0; }
        .trend-charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 10px; }
        .trend-chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
        .axis-chart-svg { width: 100%; height: 220px; display: block; }
        @media (max-width: 700px) { .trend-charts-grid { grid-template-columns: 1fr; } }

        .match-actions { display: flex; gap: 10px; margin-top: 14px; }
        .match-actions button { flex: 1; justify-content: center; }
        .retire-row { display: flex; justify-content: space-between; margin-top: 8px; }
        .result-line { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 14px; }
        .result-line.pending { color: var(--muted); font-style: italic; border-top: 1px solid var(--border); justify-content: center; }
        .result-text { display: flex; align-items: center; gap: 6px; }

        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
        td { padding: 9px 10px; border-bottom: 1px solid var(--border); }
        tr:last-child td { border-bottom: none; }
        .rank { color: var(--muted); width: 32px; }
        .withdrawn-tag { font-size: 12px; color: var(--muted); }
        .round-cell { font-size: 13px; font-weight: 600; }
        .round-cell.win { color: var(--win); }
        .round-cell.loss { color: var(--accent); opacity: 0.75; }
        .round-cell.bye { color: var(--muted); font-size: 11px; }
        .round-cell.muted { color: var(--border); }

        .notice { display: flex; gap: 8px; align-items: flex-start; background: #fff; border: 1px solid var(--border); border-radius: 7px; padding: 10px 14px; font-size: 13px; color: var(--muted); margin-bottom: 16px; }
        .footer-actions { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }

        .winner-banner { text-align: center; padding: 30px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 20px; }
        .winner-banner .trophy { color: var(--accent); margin-bottom: 8px; }
        .winner-banner .name { font-family: 'Fraunces', serif; font-size: 30px; margin: 6px 0 2px 0; }
        .winner-banner .sub { color: var(--muted); font-size: 14px; }

        .archive-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid var(--border); cursor: pointer; }
        .archive-row:hover .archive-name { text-decoration: underline; }
        .archive-name { color: var(--accent); font-weight: 600; }
        .archive-meta { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--muted); }
        .status-chip { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
        .status-chip.live { background: var(--accent-soft); color: var(--accent); }
        .status-chip.done { background: #E7EBE4; color: var(--win); }
        .status-chip.test { background: var(--border); color: var(--muted); }
        .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .filters .field { min-width: 150px; }
        .empty-state { text-align: center; color: var(--muted); padding: 30px 0; font-size: 14px; }

        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .dashboard-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px; text-align: left; color: var(--accent); cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .dashboard-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); background: var(--accent-soft); }
        .dashboard-card-title { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; color: var(--ink); }
        .dashboard-card-desc { font-size: 13px; color: var(--muted); font-weight: 400; }

        .toast { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 12px 20px; border-radius: 30px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); z-index: 100; animation: toast-in 0.2s ease; }
        @keyframes toast-in { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
      `}</style>

      {toast && (
        <div className="toast">
          <Check size={16} color="var(--win)" />
          {toast}
        </div>
      )}

      {/* TOP BAR */}
      <div className="topbar">
        <div className="brand">
          {phase !== "dashboard" && (
            <button
              className="btn-ghost"
              onClick={() => (phase === "playerDetail" ? setPhase("players") : goHome())}
              style={{ marginRight: 4 }}
            >
              <ArrowLeft size={15} />
            </button>
          )}
          HELLENIC BACKGAMMON FEDERATION
          <span style={{ fontFamily: "'Source Sans 3', sans-serif", fontWeight: 400, fontSize: 11, color: "var(--muted)", marginLeft: 10, letterSpacing: 0 }}>
            build {APP_BUILD_VERSION}
          </span>
          <button
            className="btn-secondary"
            onClick={() => setShowWhatsNew(true)}
            style={{ marginLeft: 10, fontSize: 13, padding: "6px 12px", position: "relative" }}
            title="Changelog"
          >
            <Info size={15} /> Changelog
            {hasUnseenUpdate && (
              <span
                style={{
                  position: "absolute", top: -3, right: -3, width: 9, height: 9,
                  borderRadius: "50%", background: "#c0392b", border: "1.5px solid var(--card-bg, #fff)",
                }}
              />
            )}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button className="btn-ghost" onClick={() => setPhase("season")}>
            <TrendingUp size={14} /> Season Standings
          </button>
          <button className="btn-ghost" onClick={() => setPhase("elo")}>
            <Award size={14} /> ELO Ratings
          </button>
          {isAdmin && (
            <button className="btn-ghost" onClick={() => setPhase("players")}>
              <Users size={14} /> Players
            </button>
          )}
          {!inIframe && (
            <div className="role-toggle">
              <button
                className={`role-btn ${isAdmin ? "active" : ""}`}
                onClick={() => {
                  if (deviceUnlocked) {
                    setRole("admin");
                  } else {
                    setAdminPasswordPrompt(true);
                    setAdminPasswordError("");
                  }
                }}
              >
                <Pencil size={12} style={{ marginRight: 4 }} /> Admin
              </button>
              <button className={`role-btn ${!isAdmin ? "active" : ""}`} onClick={() => setRole("visitor")}>
                <Eye size={12} style={{ marginRight: 4 }} /> Visitor
              </button>
            </div>
          )}
          {!inIframe && isAdmin && (
            <>
              <button className="btn-ghost" onClick={() => setShowChangePassword(true)} title="Change admin password">
                <Lock size={14} />
              </button>
              <button className="btn-ghost" onClick={logoutAdmin} title="Log out of Admin on this device">
                <LogOut size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {!inIframe && adminPasswordPrompt && (
        <div className="modal-overlay" onClick={() => setAdminPasswordPrompt(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Admin password</p>
            <input
              type="password"
              value={adminPasswordInput}
              onChange={(e) => setAdminPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAdminPassword()}
              placeholder="Password"
              autoFocus
              style={{ marginBottom: 10 }}
            />
            {adminPasswordError && <p style={{ color: "var(--accent)", fontSize: 13, margin: "0 0 10px 0" }}>{adminPasswordError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setAdminPasswordPrompt(false)}>Cancel</button>
              <button className="btn-primary" onClick={submitAdminPassword}>Unlock</button>
            </div>
          </div>
        </div>
      )}

      {showWhatsNew && (
        <div className="modal-overlay" onClick={dismissWhatsNew}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, maxHeight: "80vh", overflowY: "auto" }}>
            <p style={{ margin: "0 0 4px 0", fontWeight: 600 }}>Τι νέο υπάρχει</p>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 14px 0" }}>build {APP_BUILD_VERSION}</p>

            <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px 0" }}>Τι περιλαμβάνει η εφαρμογή</p>
            <ul style={{ margin: "0 0 18px 0", paddingLeft: 18, fontSize: 13, color: "var(--muted)" }}>
              {FEATURES_SUMMARY.map((it, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>{it}</li>
              ))}
            </ul>

            <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 6px 0" }}>Πρόσφατες αλλαγές</p>
            {CHANGELOG.map((entry) => (
              <div key={entry.version} style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 6px 0" }}>{entry.date}</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {entry.items.map((it, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn-primary" onClick={dismissWhatsNew}>Κατάλαβα</button>
            </div>
          </div>
        </div>
      )}

      {confirmingFinish && (
        <div className="modal-overlay" onClick={() => setConfirmingFinish(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Finish tournament</p>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px 0" }}>
              Ενημέρωση της Season Standings με το αποτέλεσμα αυτού του τουρνουά;
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setConfirmingFinish(false);
                  finalizeRoundAndAdvance(false);
                }}
              >
                Όχι, μόνο ολοκλήρωση
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setConfirmingFinish(false);
                  finalizeRoundAndAdvance(true);
                }}
              >
                Ναι, ενημέρωση
              </button>
            </div>
          </div>
        </div>
      )}

      {!inIframe && showChangePassword && (
        <div className="modal-overlay" onClick={() => setShowChangePassword(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Change admin password</p>
            <label>Current password</label>
            <input type="password" value={changePwCurrent} onChange={(e) => setChangePwCurrent(e.target.value)} style={{ marginBottom: 10 }} />
            <label>New password</label>
            <input type="password" value={changePwNew} onChange={(e) => setChangePwNew(e.target.value)} style={{ marginBottom: 10 }} />
            {changePwError && <p style={{ color: "var(--accent)", fontSize: 13, margin: "0 0 10px 0" }}>{changePwError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setShowChangePassword(false)}>Cancel</button>
              <button className="btn-primary" onClick={submitChangePassword}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* SEASON STANDINGS */}
      {phase === "season" && (
        <>
          <div className="header">
            <p className="eyebrow">Annual Ranking</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h1>Season Standings</h1>
              <select
                value={seasonBrowseYear}
                onChange={(e) => setSeasonBrowseYear(Number(e.target.value))}
                style={{ fontFamily: "'Fraunces', serif", fontSize: 16, color: "var(--accent)", border: "1px solid var(--border)", borderRadius: 7, padding: "4px 10px", background: "var(--surface)" }}
              >
                {seasonYearsAvailable.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="notice">
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Counts each player's best {SEASON_BEST_OF} tournament results this season. Names are matched by exact spelling across tournaments — keep spelling consistent when adding players.</span>
            </div>

            {isAdmin && seasonBrowseYear === 2026 && (
              <div className="footer-actions" style={{ marginTop: 0, marginBottom: 20 }}>
                <button className="btn-secondary" onClick={importHistoricalSeason2026}>
                  <Upload size={15} /> Import 2026 history (11 days, from spreadsheet)
                </button>
              </div>
            )}

            {(() => {
              const qual = { roundA: 32, cutoffA: 5, roundB: 48, cutoffB: 16 };

              function rowClassForRank(rank) {
                if (rank === 1) return "qual-tier1";
                if (rank <= qual.cutoffA) return "qual-tier2";
                if (rank <= qual.cutoffB) return "qual-tier3";
                return "";
              }

              const seasonStandings = computeSeasonStandings(seasonData, SEASON_BEST_OF);

              return (
                <>
                  <div className="qual-legend">
                    <div className="qual-row qual-tier1">
                      <span>Player of the Year + qualifies for Round of {qual.roundA}</span>
                    </div>
                    <div className="qual-row qual-tier2">
                      <span>Qualifies for Round of {qual.roundA} — positions 2 to {qual.cutoffA}</span>
                    </div>
                    <div className="qual-row qual-tier3">
                      <span>Qualifies for Round of {qual.roundB} — positions {qual.cutoffA + 1} to {qual.cutoffB}</span>
                    </div>
                  </div>

              {seasonStandings.length === 0 ? (
                <div className="empty-state">
                  <TrendingUp size={20} style={{ marginBottom: 6 }} />
                  <p>No season data yet for {seasonBrowseYear}. It fills in as tournaments finish.</p>
                </div>
              ) : (
                <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th className="rank">Rank</th>
                        <th>Player</th>
                        <th>Events</th>
                        <th>Points<br /><span className="th-sub">(best {SEASON_BEST_OF})</span></th>
                        <th>Total<br /><span className="th-sub">(all events)</span></th>
                        <th>Wins<br /><span className="th-sub">(regular only)</span></th>
                        <th>Matches</th>
                        <th>%</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonStandings.map((p, i) => {
                        const rank = i + 1;
                        return (
                        <React.Fragment key={p.name}>
                          <tr
                            className={rowClassForRank(rank)}
                            style={{ cursor: "pointer" }}
                            onClick={() => setExpandedPlayer(expandedPlayer === p.name ? null : p.name)}
                          >
                            <td className="rank">{rank}</td>
                            <td>{p.name}</td>
                            <td>{p.eventsPlayed}</td>
                            <td><strong>{p.total}</strong></td>
                            <td>{p.sumAll}</td>
                            <td>{p.totalWins}</td>
                            <td>{p.totalMatches}</td>
                            <td>{p.pct !== null ? `${p.pct}%` : "—"}</td>
                            <td style={{ textAlign: "right", color: "var(--muted)" }}>
                              {expandedPlayer === p.name ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            </td>
                          </tr>
                          {expandedPlayer === p.name && (
                            <tr>
                              <td colSpan={9} style={{ background: "var(--bg)", padding: "10px 14px" }}>
                                {p.entries.map((e) => (
                                  <div
                                    key={e.tournamentId}
                                    style={{
                                      display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0",
                                      borderBottom: "1px solid var(--border)",
                                      color: p.countedIds.has(e.tournamentId) ? "var(--ink)" : "var(--muted)",
                                      fontWeight: p.countedIds.has(e.tournamentId) ? 600 : 400,
                                    }}
                                  >
                                    <span>
                                      {p.countedIds.has(e.tournamentId) ? <Check size={12} style={{ marginRight: 6 }} color="var(--win)" /> : null}
                                      {e.tournamentName} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({formatDate(e.date)})</span>
                                    </span>
                                    <span className="entry-breakdown">
                                      {e.wins !== undefined && (
                                        <>
                                          <span>W {e.wins}</span>
                                          <span>Bye {e.bye}</span>
                                          <span>A.A. {e.aa}</span>
                                          <span>M {e.matches}</span>
                                        </>
                                      )}
                                      <strong>{e.points} pts</strong>
                                    </span>
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );})}
                    </tbody>
                  </table>
                </div>
              )}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ELO RATINGS */}
      {phase === "elo" && (
        <>
          <div className="header">
            <p className="eyebrow">Lifetime Skill Rating</p>
            <h1>ELO Ratings</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="notice" style={{ alignItems: "flex-start" }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ margin: "0 0 6px 0" }}>
                  <strong>How this is calculated</strong> — a backgammon-specific, match-length-aware Elo, distinct from plain chess Elo:
                </p>
                <p style={{ margin: "0 0 6px 0" }}>
                  Win probability: <code>P = 1 / (1 + 10^(−(Rᴀ−Rʙ)·√N / 2000))</code>, where N = match length (points to win). This shape is well-attested across independent sources tracing to FIBS (the first online backgammon server, 1990s) — longer matches rely more on skill, so a given rating gap implies a bigger edge.
                </p>
                <p style={{ margin: "0 0 6px 0" }}>
                  Points at stake per match: <code>S = 4 × √N</code>. Winner gains (1−P)×S, loser loses the same amount.
                </p>
                <p style={{ margin: 0 }}>
                  Fixed K for every player (no experience-based acceleration). Walkover wins (opponent retired) are excluded entirely — no real backgammon was played. <strong>Caveat:</strong> the win-probability shape is cross-confirmed by multiple sources; the exact constant (4) matches one documented implementation of this family but hasn't been verified against FIBS's original source — treat it as a reasonable, sourced default.
                </p>
              </div>
            </div>

            {isAdmin && (
              !confirmingRecompute ? (
                <div className="delete-control">
                  <button className="btn-ghost" onClick={() => setConfirmingRecompute(true)}>
                    <RotateCcw size={13} /> Recompute ELO &amp; Season Standings from scratch
                  </button>
                </div>
              ) : (
                <div className="delete-confirm">
                  <span>Rebuild ELO and the 2026 Season Standings from scratch, using only tournaments marked "Official League day" — any test tournament is ignored automatically, whether or not you've deleted it. This can't be undone.</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-secondary" onClick={() => setConfirmingRecompute(false)}>Cancel</button>
                    <button
                      className="btn-primary"
                      style={{ background: "var(--accent)" }}
                      onClick={() => {
                        recomputeEloAndSeasonFromScratch();
                        setConfirmingRecompute(false);
                      }}
                    >
                      Yes, recompute
                    </button>
                  </div>
                </div>
              )
            )}

            {(() => {
              const standings = Object.values(eloData.players || {}).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, "en"));
              if (standings.length === 0) {
                return (
                  <div className="empty-state">
                    <Award size={20} style={{ marginBottom: 6 }} />
                    <p>No ELO data yet. It fills in as tournaments are played.</p>
                  </div>
                );
              }
              return (
                <div className="card" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th className="rank">Rank</th>
                        <th>Player</th>
                        <th>Rating</th>
                        <th>Matches</th>
                        <th>Experience<br /><span className="th-sub">(points played)</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((p, i) => (
                        <tr key={p.name}>
                          <td className="rank">{i + 1}</td>
                          <td>{formatNameForDisplay(p.name, nameDisplayMode)}</td>
                          <td><strong>{Math.round(p.rating)}</strong></td>
                          <td>{p.games}</td>
                          <td>{p.experience ?? p.games * 7}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* PLAYER REGISTRY */}
      {phase === "players" && !isAdmin && (
        <div className="content">
          <div className="empty-state">The player registry is only available in Admin mode.</div>
        </div>
      )}
      {phase === "players" && isAdmin && (
        <>
          <div className="header">
            <p className="eyebrow">Player Registry</p>
            <h1>Players</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="notice">
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Admin-only: contact info and membership status never appear to visitors.</span>
            </div>

            <div className="footer-actions" style={{ marginTop: 0, marginBottom: 20 }}>
              <button className="btn-secondary" onClick={addRegistryPlayer}>
                <Plus size={16} /> Add Player
              </button>
            </div>

            <div className="filters">
              <div className="field">
                <label>Search by name</label>
                <input type="text" value={registrySearch} onChange={(e) => setRegistrySearch(e.target.value)} placeholder="e.g. Zoidis" />
              </div>
              <div style={{ width: 170 }}>
                <label>Display names as</label>
                <select
                  value={nameDisplayMode}
                  onChange={(e) => setNameDisplayMode(e.target.value)}
                  style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff", color: "var(--ink)" }}
                >
                  <option value="normal">As entered</option>
                  <option value="upper">ΚΕΦΑΛΑΙΑ</option>
                  <option value="greeklish">Greeklish</option>
                </select>
              </div>
            </div>

            {(() => {
              const allPlayers = Object.entries(registry.players || {})
                .filter(([, p]) => !registrySearch || p.name.toLowerCase().includes(registrySearch.toLowerCase()))
                .sort((a, b) => a[1].name.localeCompare(b[1].name, "en"));
              const currentYear = new Date().getFullYear();

              if (allPlayers.length === 0) {
                return (
                  <div className="empty-state">
                    <Users size={20} style={{ marginBottom: 6 }} />
                    <p>No players found.</p>
                  </div>
                );
              }

              return (
                <div className="card" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Club</th>
                        <th>{currentYear} status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {allPlayers.map(([key, p]) => {
                        const thisYear = p.membership.find((m) => m.year === currentYear);
                        return (
                          <tr key={key} style={{ cursor: "pointer" }} onClick={() => openPlayerDetail(key)}>
                            <td>
                              {formatNameForDisplay(p.name, nameDisplayMode)}
                              {p.needsInfo && <span className="needs-info-badge"> ⚠ Needs info</span>}
                            </td>
                            <td>{p.club || "—"}</td>
                            <td>
                              {thisYear
                                ? `${thisYear.member ? "Member" : "Not a member"} · ${thisYear.dues ? "Dues paid" : "Dues unpaid"}`
                                : "—"}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--muted)" }}>
                              <ChevronDown size={15} style={{ transform: "rotate(-90deg)" }} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* PLAYER DETAIL */}
      {phase === "playerDetail" && (() => {
        const key = expandedRegistryPlayer;
        const p = key ? registry.players[key] : null;
        if (!p || !contactDraft) {
          return (
            <div className="content">
              <div className="empty-state">Player not found.</div>
            </div>
          );
        }
        const currentYear = new Date().getFullYear();
        const eloEntry = eloData.players?.[key];
        const ranked = Object.values(eloData.players || {}).sort((a, b) => b.rating - a.rating);
        const rank = eloEntry ? ranked.findIndex((r) => normalizeName(r.name) === key) + 1 : null;
        const stats = playerMatchStatsCache[key];
        const pct = (w, l) => (w + l > 0 ? Math.round((w / (w + l)) * 100) : null);
        const strongPct = stats ? pct(stats.vsStrongerW, stats.vsStrongerL) : null;
        const weakPct = stats ? pct(stats.vsWeakerW, stats.vsWeakerL) : null;
        return (
          <>
            <div className="header">
              <p className="eyebrow">Player Registry</p>
              <h1>{formatNameForDisplay(p.name, nameDisplayMode)}</h1>
              <div className="points-strip">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
                ))}
              </div>
            </div>
            <div className="content">
              <div className="detail-tabs">
                <button className={`detail-tab ${playerDetailTab === "contact" ? "active" : ""}`} onClick={() => setPlayerDetailTab("contact")}>
                  Contact &amp; Membership
                </button>
                <button className={`detail-tab ${playerDetailTab === "stats" ? "active" : ""}`} onClick={() => setPlayerDetailTab("stats")}>
                  Playing Stats
                </button>
              </div>

              {playerDetailTab === "contact" && (
                <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                  <div>
                    <label>Name</label>
                    <input
                      type="text"
                      value={contactDraft.name}
                      onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label>Club</label>
                    <input
                      type="text"
                      value={contactDraft.club}
                      onChange={(e) => setContactDraft({ ...contactDraft, club: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label>Email</label>
                    <input
                      type="text"
                      value={contactDraft.email}
                      onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label>Phone</label>
                    <input
                      type="text"
                      value={contactDraft.phone}
                      onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label className="live-toggle" style={{ marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!contactDraft.hasDiscount}
                        onChange={(e) => setContactDraft({ ...contactDraft, hasDiscount: e.target.checked })}
                      />
                      Discount
                    </label>
                    {contactDraft.hasDiscount && (
                      <div className="row" style={{ alignItems: "center", marginBottom: 10 }}>
                        <label style={{ margin: 0 }}>Discounted buy-in (€)</label>
                        <input
                          type="number"
                          style={{ width: 70 }}
                          value={contactDraft.discountAmount}
                          onChange={(e) => setContactDraft({ ...contactDraft, discountAmount: Number(e.target.value) || 0 })}
                        />
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button className="btn-primary" onClick={() => saveContactDraft(key)}>
                        <Save size={15} /> Save
                      </button>
                      {confirmingDeletePlayer !== key ? (
                        <button className="btn-ghost" onClick={() => setConfirmingDeletePlayer(key)}>
                          <X size={14} /> Delete player
                        </button>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                          Remove from registry? Existing tournaments, standings, and ELO history are unaffected.
                          <button className="btn-secondary" onClick={() => setConfirmingDeletePlayer(null)}>Cancel</button>
                          <button
                            className="btn-primary"
                            style={{ background: "var(--accent)" }}
                            onClick={() => {
                              deleteRegistryPlayer(key);
                              setPhase("players");
                            }}
                          >
                            Yes, delete
                          </button>
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label>Membership history</label>
                    {p.membership.length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--muted)" }}>No membership years recorded yet.</p>
                    )}
                    {p.membership.map((m) => (
                      <div key={m.year} className="membership-row">
                        <strong>{m.year}</strong>
                        <select value={m.member ? "yes" : "no"} onChange={(e) => updateMembershipRow(key, m.year, "member", e.target.value === "yes")}>
                          <option value="yes">Member</option>
                          <option value="no">Not a member</option>
                        </select>
                        <select value={m.dues ? "yes" : "no"} onChange={(e) => updateMembershipRow(key, m.year, "dues", e.target.value === "yes")}>
                          <option value="yes">Dues paid</option>
                          <option value="no">Dues unpaid</option>
                        </select>
                        <button className="btn-ghost" onClick={() => removeMembershipRow(key, m.year)}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="row" style={{ marginTop: 8 }}>
                      <div style={{ width: 100 }}>
                        <input
                          type="number"
                          value={newMembershipYear}
                          onChange={(e) => setNewMembershipYear(Number(e.target.value) || currentYear)}
                        />
                      </div>
                      <button className="btn-ghost" onClick={() => addMembershipRow(key, newMembershipYear)}>
                        <Plus size={13} /> Add year
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {playerDetailTab === "stats" && (
                <div className="card">
                  {eloEntry && (
                    <div className="elo-snapshot">
                      <div className="elo-snapshot-stat">
                        <span className="finance-stat-label">ELO Rating</span>
                        <span className="finance-stat-value">{Math.round(eloEntry.rating)}</span>
                      </div>
                      <div className="elo-snapshot-stat">
                        <span className="finance-stat-label">Rank</span>
                        <span className="finance-stat-value">#{rank}</span>
                      </div>
                      <div className="elo-snapshot-stat">
                        <span className="finance-stat-label">Experience</span>
                        <span className="finance-stat-value">{eloEntry.experience ?? eloEntry.games * 7}</span>
                      </div>
                      {stats && (
                        <>
                          <div className="elo-snapshot-stat">
                            <span className="finance-stat-label">vs higher-rated</span>
                            <span className="finance-stat-value" style={{ fontSize: 16 }}>
                              {stats.vsStrongerW}W–{stats.vsStrongerL}L{strongPct !== null && <span style={{ color: "var(--muted)", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600 }}> ({strongPct}%)</span>}
                            </span>
                          </div>
                          <div className="elo-snapshot-stat">
                            <span className="finance-stat-label">vs lower-rated</span>
                            <span className="finance-stat-value" style={{ fontSize: 16 }}>
                              {stats.vsWeakerW}W–{stats.vsWeakerL}L{weakPct !== null && <span style={{ color: "var(--muted)", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600 }}> ({weakPct}%)</span>}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <p className="trend-chart-title" style={{ marginTop: 4 }}>Performance trend</p>
                  <PlayerTrendCharts rows={eloTimeline ? eloTimeline[key] : null} />

                  <label style={{ marginTop: 18, display: "block" }}>Tournament history</label>
                  {!playerHistoryCache[key] && <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</p>}
                  {playerHistoryCache[key] && playerHistoryCache[key].length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--muted)" }}>No tournaments recorded yet.</p>
                  )}
                  {playerHistoryCache[key] && playerHistoryCache[key].length > 0 && (
                    <div className="history-table">
                      {playerHistoryCache[key].map((h, i) => (
                        <div key={i} className="history-row">
                          <span>{h.tournamentName} <span style={{ color: "var(--muted)" }}>({formatDate(h.date)})</span></span>
                          <strong>{h.points} pts</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* DASHBOARD */}
      {phase === "dashboard" && (
        <>
          <div className="header">
            <p className="eyebrow">Tournament Manager</p>
            <h1>Dashboard</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="dashboard-grid">
              <button className="dashboard-card" onClick={() => setPhase("archive")}>
                <Trophy size={26} />
                <span className="dashboard-card-title">Tournaments</span>
                <span className="dashboard-card-desc">Browse past tournaments or start a new one</span>
              </button>
              <button className="dashboard-card" onClick={() => setPhase("season")}>
                <TrendingUp size={26} />
                <span className="dashboard-card-title">Season Standings</span>
                <span className="dashboard-card-desc">Annual ranking across all tournaments</span>
              </button>
              <button className="dashboard-card" onClick={() => setPhase("elo")}>
                <Award size={26} />
                <span className="dashboard-card-title">ELO Ratings</span>
                <span className="dashboard-card-desc">Lifetime skill rating for every player</span>
              </button>
              {isAdmin && (
                <button className="dashboard-card" onClick={() => setPhase("players")}>
                  <Users size={26} />
                  <span className="dashboard-card-title">Players</span>
                  <span className="dashboard-card-desc">Registry, contact info, membership</span>
                </button>
              )}
            </div>
            <div className="footer-actions" style={{ marginTop: 24 }}>
              <button className="btn-secondary" onClick={exportAllData}>
                <Download size={15} /> Export All Data (full backup)
              </button>
              <button className="btn-secondary" onClick={() => fullBackupInputRef.current?.click()}>
                <Upload size={15} /> Import All Data (restore backup)
              </button>
              <input type="file" accept="application/json" ref={fullBackupInputRef} onChange={importAllData} style={{ display: "none" }} />
            </div>
          </div>
        </>
      )}

      {/* TOURNAMENT ARCHIVE */}
      {phase === "archive" && (
        <>
          <div className="header">
            <p className="eyebrow">Backgammon Tournament · Swiss System</p>
            <h1>Tournament Archive</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}

            {isAdmin && (
              <div className="footer-actions" style={{ marginTop: 0, marginBottom: 20 }}>
                <button className="btn-primary" onClick={goToNewTournament}>
                  <Plus size={16} /> New Tournament
                </button>
              </div>
            )}

            <div className="filters">
              <div className="field">
                <label>Search by name</label>
                <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="e.g. Championship" />
              </div>
              <div className="field">
                <label>From date</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>To date</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            {visibleArchive.length === 0 && (
              <div className="empty-state">
                <Search size={20} style={{ marginBottom: 6 }} />
                <p>No tournaments found{archiveHasFilter ? " matching these filters." : "."}</p>
              </div>
            )}

            {visibleArchive.map((t) => (
              <div className="archive-row" key={t.id} onClick={() => openArchived(t.id)}>
                <span className="archive-name">
                  {t.name}
                  {!t.isOfficial && <span className="status-chip test" style={{ marginLeft: 8 }}>Test</span>}
                </span>
                <span className="archive-meta">
                  {formatDate(t.date)}
                  <span className={`status-chip ${t.status === "Completed" ? "done" : "live"}`}>{t.status}</span>
                </span>
              </div>
            ))}

            {!archiveHasFilter && filteredArchive.length > 10 && !showAllArchive && (
              <button className="btn-ghost" onClick={() => setShowAllArchive(true)}>
                Show all ({filteredArchive.length})
              </button>
            )}
          </div>
        </>
      )}

      {/* SETUP */}
      {phase === "setup" && !isAdmin && (
        <div className="content">
          <div className="empty-state">Creating a tournament is only available in Admin mode.</div>
        </div>
      )}
      {phase === "setup" && isAdmin && (
        <>
          <div className="header">
            <p className="eyebrow">New Tournament</p>
            <h1>Setup</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}
            <div className="card">
              <div className="row" style={{ marginBottom: 14 }}>
                <div className="field">
                  <label>Tournament name (optional)</label>
                  <input type="text" value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="e.g. 14th National Championship" />
                </div>
                <div style={{ width: 110 }}>
                  <label>Rounds</label>
                  <input type="number" min={3} max={9} value={totalRounds} onChange={(e) => setTotalRounds(Math.max(3, Math.min(9, Number(e.target.value) || 5)))} />
                </div>
                <div style={{ width: 130 }}>
                  <label>Match length</label>
                  <input type="number" min={1} max={25} value={matchLength} onChange={(e) => setMatchLength(Math.max(1, Math.min(25, Number(e.target.value) || 7)))} />
                </div>
                <div style={{ width: 110 }}>
                  <label>Season</label>
                  <input type="number" value={seasonYear} onChange={(e) => setSeasonYear(Number(e.target.value) || new Date().getFullYear())} />
                </div>
              </div>

              <label className="live-toggle" style={{ marginBottom: 14 }} title="Only Official days are included when you use 'Recompute ELO & Season Standings from scratch' on the ELO page">
                <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} />
                Official League day (counts toward ELO &amp; Season Standings on recompute — leave unchecked for a test)
              </label>

              <label>Players</label>
              <div className="row" style={{ position: "relative", alignItems: "center" }}>
                <div className="field" style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => {
                      setNewPlayerName(e.target.value);
                      setNameDropdownOpen(true);
                    }}
                    onFocus={() => setNameDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setNameDropdownOpen(false), 150)}
                    onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                    placeholder="Player name — type to search, or enter a new one"
                    autoComplete="off"
                  />
                  {nameDropdownOpen && (() => {
                    const options = Object.values(registry.players || {})
                      .map((p) => p.name)
                      .filter((name) => name.toLowerCase().includes(newPlayerName.toLowerCase()))
                      .sort((a, b) => a.localeCompare(b, "en"));
                    if (options.length === 0) return null;
                    return (
                      <div className="name-dropdown">
                        {options.map((name) => (
                          <div
                            key={name}
                            className="name-dropdown-option"
                            onMouseDown={() => {
                              setNewPlayerName(name);
                              setNameDropdownOpen(false);
                            }}
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <label className="live-toggle" style={{ margin: 0, whiteSpace: "nowrap" }} title="Include this player in the side bet, collected alongside the buy-in">
                  <input type="checkbox" checked={addToSideBet} onChange={(e) => setAddToSideBet(e.target.checked)} />
                  Side bet
                </label>
                <button className="btn-secondary" onClick={addPlayer}>
                  <Plus size={16} /> Add
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <label>Bulk add (paste from Excel — one name per line)</label>
                <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"John Smith\nMaria Papas\nAlex Nikolaou"} rows={4} />
                <div style={{ marginTop: 8 }}>
                  <button className="btn-secondary" onClick={addPlayersBulk} disabled={!bulkText.trim()}>
                    <Plus size={16} /> Add All
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label>For testing: add random players from the registry</label>
                <div className="row">
                  <div style={{ width: 90 }}>
                    <input type="number" min={1} value={randomCount} onChange={(e) => setRandomCount(Math.max(1, Number(e.target.value) || 1))} />
                  </div>
                  <button className="btn-secondary" onClick={addRandomPlayers}>
                    <Dice5 size={16} /> Add random players
                  </button>
                </div>
              </div>

              <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0 6px 0" }}>
                <strong style={{ color: "var(--ink)" }}>{players.length}</strong> player{players.length === 1 ? "" : "s"} registered
                {" · "}
                <strong style={{ color: "var(--ink)" }}>{sideBets.find((b) => b.id === "default-sidebet")?.participantIds.length || 0}</strong> in the side bet
              </p>
              <div className="player-list">
                {players.map((p) => {
                  const inSideBet = sideBets.find((b) => b.id === "default-sidebet")?.participantIds.includes(p.id) || false;
                  return (
                    <div className="player-chip" key={p.id}>
                      <span>{p.name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label className="live-toggle" style={{ margin: 0 }}>
                          <input type="checkbox" checked={inSideBet} onChange={() => toggleDefaultSideBetForPlayer(p.id)} />
                          Side bet
                        </label>
                        <button className="btn-ghost" onClick={() => removePlayer(p.id)}>
                          <X size={15} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {players.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14, margin: "8px 0 0 0" }}>No players added yet.</p>}
              </div>

              <div className="footer-actions">
                <button className="btn-primary" disabled={players.length < 3} onClick={startTournament}>
                  Start Tournament <ArrowRight size={16} />
                </button>
                {players.length > 0 && players.length < 3 && (
                  <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>At least 3 players are needed.</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* TOURNAMENT */}
      {phase === "tournament" && (
        <>
          <div className="header">
            <p className="eyebrow">Swiss System</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h1>{tournamentName || "Backgammon Tournament"}</h1>
              <span className="round-tag">Round {round} of {totalRounds}</span>
            </div>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}

            <div className="tabs">
              <button className={`tab ${view === "pairings" ? "active" : ""}`} onClick={() => setView("pairings")}>Pairings</button>
              <button className={`tab ${view === "standings" ? "active" : ""}`} onClick={() => setView("standings")}>Standings</button>
              {isAdmin && (
                <>
                  <button className={`tab ${view === "finance" ? "active" : ""}`} onClick={() => setView("finance")}>Prizes</button>
                  <button className={`tab ${view === "calcutta" ? "active" : ""}`} onClick={() => setView("calcutta")}>Calcutta</button>
                </>
              )}
            </div>

            {isAdmin && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <button className="btn-ghost" onClick={toggleIsOfficial} title="Only Official days count when you recompute ELO & Season Standings from scratch">
                  {isOfficial ? <Check size={13} color="var(--win)" /> : <X size={13} />} {isOfficial ? "Official League day" : "Test tournament (excluded from recompute)"}
                </button>
              </div>
            )}

            {isAdmin && (
              <DeleteTournamentControl
                confirming={confirmingDelete}
                onStart={() => setConfirmingDelete(true)}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={confirmDeleteTournament}
              />
            )}

            {view === "pairings" && (
              <>
                <label className="live-toggle">
                  <input
                    type="checkbox"
                    checked={liveStandingsEnabled}
                    onChange={(e) => setLiveStandingsEnabled(e.target.checked)}
                  />
                  Update season standings live, after every round (not just at the end)
                </label>

                <div className="round-pills">
                  {availableRounds.map((r) => (
                    <button
                      key={r}
                      className={`round-pill ${selectedRound === r ? "active" : ""}`}
                      onClick={() => { setSelectedRound(r); setConfirmingRedraw(false); }}
                    >
                      Round {r}
                    </button>
                  ))}
                </div>

                {roundData && roundData.bye && (
                  <div className="bye-card">
                    <Dice5 size={18} />
                    <span><strong>{byId[roundData.bye]?.name}</strong> has a bye this round — automatic win.</span>
                  </div>
                )}

                {roundData && roundData.pairs.map((pr, i) => {
                  const p1 = byId[pr.p1];
                  const p2 = byId[pr.p2];
                  if (!p1 || !p2) return null;
                  const result = pr.result;
                  const canEdit = isAdmin;
                  const doSetResult = (winnerId, loserId, method) =>
                    roundData.editable ? setResult(i, winnerId, loserId, method) : setHistoricalResult(selectedRound, i, winnerId, loserId, method);
                  const doClearResult = () => (roundData.editable ? clearResult(i) : clearHistoricalResult(selectedRound, i));
                  return (
                    <div className="card match-card" key={i}>
                      <div className="match-names">
                        <span className={`match-name ${result ? (result.winnerId === p1.id ? "winner" : "loser") : ""}`}>{p1.name}</span>
                        <span className="match-vs">vs</span>
                        <span className={`match-name ${result ? (result.winnerId === p2.id ? "winner" : "loser") : ""}`}>{p2.name}</span>
                      </div>
                      {!result && <WinProbabilityBar p1Name={p1.name} p2Name={p2.name} eloData={eloData} matchLength={matchLength} />}

                      {canEdit && !result && (
                        <>
                          <div className="match-actions">
                            <button className="btn-secondary" onClick={() => doSetResult(p1.id, p2.id, "normal")}>Win {p1.name}</button>
                            <button className="btn-secondary" onClick={() => doSetResult(p2.id, p1.id, "normal")}>Win {p2.name}</button>
                          </div>
                          <div className="retire-row">
                            <button className="btn-ghost" onClick={() => doSetResult(p2.id, p1.id, "retirement")}><UserX size={13} /> {p1.name} retired</button>
                            <button className="btn-ghost" onClick={() => doSetResult(p1.id, p2.id, "retirement")}><UserX size={13} /> {p2.name} retired</button>
                          </div>
                          <div className="retire-row">
                            <button className="btn-ghost" style={{ color: "var(--muted)" }} onClick={() => doSetResult(null, null, "double_retirement")}><UserX size={13} /> Both retired (no winner)</button>
                          </div>
                        </>
                      )}

                      {result && result.method === "double_retirement" && (
                        <div className="result-line">
                          <span className="result-text" style={{ color: "var(--muted)" }}>
                            <UserX size={15} />
                            Both {p1.name} and {p2.name} retired — no winner
                          </span>
                          {canEdit && <button className="btn-ghost" onClick={doClearResult}>Undo</button>}
                        </div>
                      )}
                      {result && result.method !== "double_retirement" && (
                        <div className="result-line">
                          <span className="result-text">
                            <Check size={15} color="var(--win)" />
                            Winner: <strong>{byId[result.winnerId]?.name}</strong>
                            {result.method === "retirement" && <span style={{ color: "var(--muted)" }}>— {byId[result.loserId]?.name} retired</span>}
                          </span>
                          {canEdit && <button className="btn-ghost" onClick={doClearResult}>Undo</button>}
                        </div>
                      )}

                      {!result && !canEdit && <div className="result-line pending">Result pending</div>}
                    </div>
                  );
                })}

                {isAdmin && roundData && roundData.editable && (
                  <div className="footer-actions">
                    <button
                      className="btn-primary"
                      disabled={!roundComplete}
                      onClick={() => (round >= totalRounds ? setConfirmingFinish(true) : finalizeRoundAndAdvance(true))}
                    >
                      {round >= totalRounds ? "Finish Tournament" : "Draw Next Round"} <ArrowRight size={16} />
                    </button>
                    <button className="btn-secondary" onClick={exportJSON}><Download size={15} /> Save</button>
                    {/* TODO: TESTING ONLY — remove this button before the real/production version. */}
                    <button className="btn-ghost" onClick={randomizeRoundResults} style={{ color: "var(--muted)" }}>
                      <Dice5 size={14} /> Randomize results (testing)
                    </button>
                    {!confirmingRedraw ? (
                      <button className="btn-ghost" onClick={() => setConfirmingRedraw(true)}>
                        <RotateCcw size={14} /> Redraw this round
                      </button>
                    ) : (
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                        {round === 1 ? "Delete round 1 and go back to the player list?" : "Discard this round and reopen round " + (round - 1) + "?"}
                        <button className="btn-secondary" onClick={() => setConfirmingRedraw(false)}>Cancel</button>
                        <button
                          className="btn-primary"
                          onClick={() => {
                            redrawCurrentRound();
                            setConfirmingRedraw(false);
                          }}
                        >
                          Yes, redraw
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {view === "standings" && <StandingsTable standings={standings} buchholz={null} totalRounds={totalRounds} sideBets={sideBets} isAdmin={isAdmin} onToggleExclusion={toggleExclusion} />}
            {view === "finance" && isAdmin && (
              <FinanceTab
              players={players} totalRounds={totalRounds} isAdmin={isAdmin}
              onToggleDiscount={toggleDiscount} onChangeDiscountAmount={updatePlayerDiscountAmount} onToggleCup={toggleWantsCup}
              sideBets={sideBets} onAddSideBet={addSideBet} onRemoveSideBet={removeSideBet}
              onToggleSideBetParticipant={toggleSideBetParticipant} onChangeSideBetAmount={updateSideBetAmount}
            />
            )}
            {view === "calcutta" && isAdmin && (
              <CalcuttaTab players={players} totalRounds={totalRounds} entries={calcuttaEntries} onAdd={addCalcuttaEntry} onRemove={removeCalcuttaEntry} />
            )}
          </div>
        </>
      )}

      {/* FINISHED */}
      {phase === "finished" && (
        <>
          <div className="header">
            <p className="eyebrow">Swiss System</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h1>{tournamentName || "Backgammon Tournament"}</h1>
              <span className="round-tag">Completed</span>
            </div>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}
            <div className="winner-banner">
              <Trophy size={34} className="trophy" />
              <p className="sub">Tournament Winner</p>
              <p className="name">{standings[0]?.name}</p>
              {standings.length > 1 && buchholz && standings[0].wins === standings[1].wins && (
                <p className="sub">Decided by Buchholz (tie on wins)</p>
              )}
            </div>

            <div className="tabs">
              <button className={`tab ${view === "pairings" ? "active" : ""}`} onClick={() => setView("pairings")}>Pairings</button>
              <button className={`tab ${view === "standings" ? "active" : ""}`} onClick={() => setView("standings")}>Standings</button>
              {isAdmin && (
                <>
                  <button className={`tab ${view === "finance" ? "active" : ""}`} onClick={() => setView("finance")}>Prizes</button>
                  <button className={`tab ${view === "calcutta" ? "active" : ""}`} onClick={() => setView("calcutta")}>Calcutta</button>
                </>
              )}
            </div>

            {isAdmin && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <button className="btn-ghost" onClick={toggleIsOfficial} title="Only Official days count when you recompute ELO & Season Standings from scratch">
                  {isOfficial ? <Check size={13} color="var(--win)" /> : <X size={13} />} {isOfficial ? "Official League day" : "Test tournament (excluded from recompute)"}
                </button>
              </div>
            )}

            {isAdmin && (
              <DeleteTournamentControl
                confirming={confirmingDelete}
                onStart={() => setConfirmingDelete(true)}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={confirmDeleteTournament}
              />
            )}

            {view === "pairings" && (
              <>
                <div className="round-pills">
                  {availableRounds.map((r) => (
                    <button
                      key={r}
                      className={`round-pill ${selectedRound === r ? "active" : ""}`}
                      onClick={() => setSelectedRound(r)}
                    >
                      Round {r}
                    </button>
                  ))}
                </div>

                {roundData && roundData.bye && (
                  <div className="bye-card">
                    <Dice5 size={18} />
                    <span><strong>{byId[roundData.bye]?.name}</strong> had a bye this round.</span>
                  </div>
                )}

                {roundData && roundData.pairs.map((pr, i) => {
                  const p1 = byId[pr.p1];
                  const p2 = byId[pr.p2];
                  if (!p1 || !p2) return null;
                  const result = pr.result;
                  return (
                    <div className="card match-card" key={i}>
                      <div className="match-names">
                        <span className={`match-name ${result ? (result.winnerId === p1.id ? "winner" : "loser") : ""}`}>{p1.name}</span>
                        <span className="match-vs">vs</span>
                        <span className={`match-name ${result ? (result.winnerId === p2.id ? "winner" : "loser") : ""}`}>{p2.name}</span>
                      </div>
                      {result && (
                        <div className="result-line">
                          <span className="result-text">
                            <Check size={15} color="var(--win)" />
                            Winner: <strong>{byId[result.winnerId]?.name}</strong>
                            {result.method === "retirement" && <span style={{ color: "var(--muted)" }}>— {byId[result.loserId]?.name} retired</span>}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {view === "standings" && <StandingsTable standings={standings} buchholz={buchholz} totalRounds={totalRounds} sideBets={sideBets} isAdmin={isAdmin} onToggleExclusion={toggleExclusion} />}
            {view === "finance" && isAdmin && (
              <FinanceTab
              players={players} totalRounds={totalRounds} isAdmin={isAdmin}
              onToggleDiscount={toggleDiscount} onChangeDiscountAmount={updatePlayerDiscountAmount} onToggleCup={toggleWantsCup}
              sideBets={sideBets} onAddSideBet={addSideBet} onRemoveSideBet={removeSideBet}
              onToggleSideBetParticipant={toggleSideBetParticipant} onChangeSideBetAmount={updateSideBetAmount}
            />
            )}
            {view === "calcutta" && isAdmin && (
              <CalcuttaTab players={players} totalRounds={totalRounds} entries={calcuttaEntries} onAdd={addCalcuttaEntry} onRemove={removeCalcuttaEntry} />
            )}

            {isAdmin && (
              <div className="footer-actions">
                <button className="btn-secondary" onClick={exportJSON}><Download size={15} /> Export Results (JSON)</button>
                <button className="btn-secondary" onClick={goHome}><RotateCcw size={15} /> Home</button>
              </div>
            )}
          </div>
        </>
      )}

      {isAdmin && (phase === "tournament" || phase === "finished") && (
        <div className="content" style={{ paddingTop: 0, marginTop: -20 }}>
          <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Load tournament file (.json)
          </button>
          <input type="file" accept="application/json" ref={fileInputRef} onChange={importJSON} style={{ display: "none" }} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Standings table                                                        */
/* ---------------------------------------------------------------------- */

function roundCell(player, roundNumber) {
  const entry = player.matchLog.find((m) => m.round === roundNumber);
  if (!entry) {
    if (player.withdrawn && player.withdrawnRound && roundNumber > player.withdrawnRound) {
      return <span className="round-cell muted">—</span>;
    }
    return <span className="round-cell muted">·</span>;
  }
  if (entry.method === "bye") return <span className="round-cell bye">BYE</span>;
  if (entry.result === "win") {
    return (
      <span className="round-cell win" title={entry.method === "retirement_win" ? "Win by opponent's withdrawal" : "Win"}>
        W{entry.method === "retirement_win" ? "*" : ""}
      </span>
    );
  }
  return (
    <span className="round-cell loss" title={entry.method === "retirement_loss" ? "Loss by withdrawal" : "Loss"}>
      L{entry.method === "retirement_loss" ? "*" : ""}
    </span>
  );
}

function CalcuttaTab({ players, totalRounds, entries, onAdd, onRemove }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [buyer, setBuyer] = useState("");
  const [amount, setAmount] = useState(20);

  const boughtIds = new Set(entries.map((e) => e.playerId));
  const availablePlayers = players.filter((p) => !boughtIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, "en"));
  const playersById = {};
  players.forEach((p) => (playersById[p.id] = p));
  const result = computeCalcuttaResult(entries, players, totalRounds);

  return (
    <>
      <div className="notice">
        <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>A separate pool from the official prize pool. Record who bought each player and for how much — the pool is paid out to whoever bought the eventual tournament winner(s), split evenly on a tie.</span>
      </div>

      <div className="finance-summary">
        <div className="finance-stat">
          <span className="finance-stat-label">Calcutta pool</span>
          <span className="finance-stat-value">{result.pool}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Players sold</span>
          <span className="finance-stat-value">{entries.length}</span>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Result</p>
        {result.winners.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No completed winner yet.</p>
        ) : (
          result.payouts.map((p) => (
            <div key={p.player.id} className="finance-row">
              <span>
                <span className="prize-badge win">{totalRounds}/{totalRounds}</span> {p.player.name}
                {p.sold ? <> — bought by <strong>{p.buyer}</strong></> : <span style={{ color: "var(--muted)" }}> — not sold</span>}
              </span>
              <strong>{p.sold ? `${p.amount.toFixed(2)}€` : "—"}</strong>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Entries</p>
        {entries.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14 }}>No players sold yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="finance-row">
            <span>{playersById[e.playerId]?.name || "Unknown"} <span style={{ color: "var(--muted)", fontSize: 12 }}>— {e.buyer}</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>{e.amount}€</strong>
              <button className="btn-ghost" onClick={() => onRemove(e.id)}><X size={14} /></button>
            </span>
          </div>
        ))}

        <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
          <div style={{ width: 200 }}>
            <select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select player…</option>
              {availablePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <input type="text" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Buyer name" />
          </div>
          <div style={{ width: 90 }}>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="€" />
          </div>
          <button
            className="btn-secondary"
            disabled={!selectedPlayerId || !buyer.trim()}
            onClick={() => {
              onAdd(selectedPlayerId, buyer, amount);
              setSelectedPlayerId("");
              setBuyer("");
            }}
          >
            <Plus size={16} /> Add
          </button>
        </div>
      </div>
    </>
  );
}

function FinanceTab({
  players, totalRounds, isAdmin, onToggleDiscount, onChangeDiscountAmount, onToggleCup,
  sideBets, onAddSideBet, onRemoveSideBet, onToggleSideBetParticipant, onChangeSideBetAmount,
}) {
  const f = computeTournamentFinance(players, totalRounds);
  const playersById = {};
  players.forEach((p) => (playersById[p.id] = p));
  const sideBetsTotal = sideBets.reduce((sum, bet) => sum + computeSideBetResult(bet, playersById).pool, 0);
  return (
    <>
      <div className="finance-summary">
        <div className="finance-stat">
          <span className="finance-stat-label">Total collected</span>
          <span className="finance-stat-value">{f.totalCollected}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Federation</span>
          <span className="finance-stat-value">{f.federationTotal}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Venue</span>
          <span className="finance-stat-value">{f.venueTotal}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Prize pool</span>
          <span className="finance-stat-value">{f.prizePool}€</span>
        </div>
        <div className="finance-stat">
          <span className="finance-stat-label">Side bets total</span>
          <span className="finance-stat-value">{sideBetsTotal}€</span>
        </div>
      </div>

      {f.shortfall && (
        <div className="notice" style={{ borderColor: "var(--accent)" }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            The prize pool doesn't cover the fixed {RUNNER_UP_PRIZE}€ payouts this time ({f.runnerUps.length} runner(s)-up). This is
            mathematically very unlikely in a normal Swiss field — double check the results before paying out.
          </span>
        </div>
      )}

      <div className="card">
        <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Winners</p>
        {f.runnerUps.length === 0 && f.perfects.length === 0 && sideBets.every((b) => computeSideBetResult(b, playersById).winners.length === 0) ? (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No results to pay out yet.</p>
        ) : (
          <div className="winners-columns">
            <div>
              <p className="winners-col-label">Tournament</p>
              {f.perfects.length === 0 && f.runnerUps.length === 0 && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No results yet.</p>
              )}
              {f.perfects.map((p) => (
                <div key={`pf-${p.id}`} className="finance-row">
                  <span><span className="prize-badge win">{totalRounds}/{totalRounds}</span> {p.name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {isAdmin && (
                      <label className="live-toggle" style={{ margin: 0 }}>
                        <input type="checkbox" checked={!!p.wantsCup} onChange={() => onToggleCup(p.id)} />
                        Cup (−{CUP_COST}€)
                      </label>
                    )}
                    <strong>{(p.wantsCup ? f.perfectShare - CUP_COST : f.perfectShare).toFixed(2)}€</strong>
                  </span>
                </div>
              ))}
              {f.runnerUps.map((p) => (
                <div key={`ru-${p.id}`} className="finance-row">
                  <span><span className="prize-badge">{totalRounds - 1}/{totalRounds}</span> {p.name}</span>
                  <strong>{RUNNER_UP_PRIZE}€</strong>
                </div>
              ))}
            </div>

            <div>
              <p className="winners-col-label">Side bets</p>
              {sideBets.every((b) => computeSideBetResult(b, playersById).winners.length === 0) && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No results yet.</p>
              )}
              {sideBets.map((bet) => {
                const result = computeSideBetResult(bet, playersById);
                return result.winners.map((w) => (
                  <div key={`sb-${bet.id}-${w.id}`} className="finance-row">
                    <span><span className="prize-badge side">{bet.label}</span> {w.name}</span>
                    <strong>{result.share.toFixed(2)}€</strong>
                  </div>
                ));
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Buy-in</th>
              {isAdmin && <th>Discount</th>}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.hasDiscount ? (p.discountAmount ?? 32) : BUYIN_FULL}€</td>
                {isAdmin && (
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label className="live-toggle" style={{ margin: 0 }}>
                        <input type="checkbox" checked={!!p.hasDiscount} onChange={() => onToggleDiscount(p.id)} />
                      </label>
                      {p.hasDiscount && (
                        <input
                          type="number"
                          style={{ width: 60 }}
                          value={p.discountAmount ?? 32}
                          onChange={(e) => onChangeDiscountAmount(p.id, Number(e.target.value) || 0)}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && <SideBetsSection players={players} sideBets={sideBets} onAdd={onAddSideBet} onRemove={onRemoveSideBet} onToggleParticipant={onToggleSideBetParticipant} onChangeAmount={onChangeSideBetAmount} />}
    </>
  );
}

function SideBetsSection({ players, sideBets, onAdd, onRemove, onToggleParticipant, onChangeAmount }) {
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState(40);
  const playersById = {};
  players.forEach((p) => (playersById[p.id] = p));

  return (
    <div className="card">
      <p style={{ margin: "0 0 10px 0", fontWeight: 600 }}>Side bets</p>
      <p style={{ margin: "0 0 14px 0", fontSize: 13, color: "var(--muted)" }}>
        Separate from the official prize pool. Whoever has the most wins among the participants (byes and opponent-retirement wins count too) takes the whole side pool — ties split it evenly.
      </p>

      {sideBets.map((bet) => {
        const result = computeSideBetResult(bet, playersById);
        return (
          <div key={bet.id} className="finance-row">
            <span>{bet.label} <span style={{ color: "var(--muted)", fontSize: 12 }}>({bet.participantIds.length} participants, {result.pool}€ pool)</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>€</span>
              <input
                type="number"
                style={{ width: 60 }}
                value={bet.amountPerPlayer}
                onChange={(e) => onChangeAmount(bet.id, Number(e.target.value) || 0)}
              />
              <span style={{ fontSize: 13, color: "var(--muted)" }}>per player</span>
              <button className="btn-ghost" onClick={() => onRemove(bet.id)}><X size={14} /></button>
            </span>
          </div>
        );
      })}

      <div className="row" style={{ marginTop: 16 }}>
        <div className="field">
          <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (e.g. 'The regulars')" />
        </div>
        <div style={{ width: 90 }}>
          <input type="number" value={newAmount} onChange={(e) => setNewAmount(Number(e.target.value) || 0)} placeholder="€" />
        </div>
        <button
          className="btn-secondary"
          onClick={() => {
            onAdd(newLabel.trim(), newAmount);
            setNewLabel("");
            setNewAmount(40);
          }}
        >
          <Plus size={15} /> Add side bet
        </button>
      </div>
    </div>
  );
}

function formatMonthLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function AxisLineChart({ points, color, suffix = "" }) {
  if (!points || points.length < 2) return <p style={{ fontSize: 13, color: "var(--muted)" }}>Not enough history yet for a trend.</p>;
  const width = 560;
  const height = 240;
  const padL = 42, padR = 10, padT = 12, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const values = points.map((p) => p.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + i * stepX,
    y: padT + plotH - ((p.y - min) / range) * plotH,
    label: p.label,
    full: p.full,
    val: p.y,
  }));
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const gridValues = [max, (max + min) / 2, min];
  const tickCount = Math.min(6, points.length);
  const tickIndices = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round((i * (points.length - 1)) / (tickCount - 1 || 1))))];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="axis-chart-svg">
      {gridValues.map((v, i) => {
        const y = padT + plotH - ((v - min) / range) * plotH;
        return (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v)}{suffix}</text>
          </g>
        );
      })}
      <polyline points={polyline} fill="none" stroke={color} strokeWidth="2" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="3" fill={color}>
          <title>{c.full}: {Math.round(c.val)}{suffix}</title>
        </circle>
      ))}
      {tickIndices.map((idx) => (
        <text key={idx} x={coords[idx].x} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
          {coords[idx].label}
        </text>
      ))}
    </svg>
  );
}

function PlayerTrendCharts({ rows }) {
  if (!rows) return <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</p>;
  if (rows.length < 2) return <p style={{ fontSize: 13, color: "var(--muted)" }}>Not enough history yet for a trend.</p>;
  const eloPoints = rows.map((r) => ({ y: r.rating, label: formatMonthLabel(r.date), full: formatDate(r.date) }));
  const winRatePoints = rows.map((r) => ({ y: r.winRate, label: formatMonthLabel(r.date), full: formatDate(r.date) }));
  return (
    <div className="trend-charts-grid">
      <div className="trend-chart-card">
        <p className="trend-chart-title">ELO over time</p>
        <AxisLineChart points={eloPoints} color="var(--accent)" />
      </div>
      <div className="trend-chart-card">
        <p className="trend-chart-title">Win rate over time</p>
        <AxisLineChart points={winRatePoints} color="var(--win)" suffix="%" />
      </div>
    </div>
  );
}

function WinProbabilityBar({ p1Name, p2Name, eloData, matchLength }) {
  const r1 = eloData.players?.[normalizeName(p1Name)]?.rating ?? ELO_INITIAL;
  const r2 = eloData.players?.[normalizeName(p2Name)]?.rating ?? ELO_INITIAL;
  const p1Prob = Math.round(eloWinProbability(r1, r2, matchLength || 7) * 100);
  const p2Prob = 100 - p1Prob;
  const p1Favored = p1Prob >= p2Prob;
  const favorite = p1Favored ? p1Name : p2Name;
  const favoriteProb = Math.max(p1Prob, p2Prob);
  return (
    <div className="win-prob">
      <p className="win-prob-headline" style={{ textAlign: p1Favored ? "left" : "right" }}>
        Predicted winner (ELO): <strong>{favorite}</strong> <span className="win-prob-pct">{favoriteProb}%</span>
      </p>
      <div className="win-prob-bar">
        <div className="win-prob-fill" style={{ width: `${p1Prob}%` }} />
      </div>
      <div className="win-prob-labels">
        <span>{p1Prob}%</span>
        <span>{p2Prob}%</span>
      </div>
    </div>
  );
}

function DeleteTournamentControl({ confirming, onStart, onCancel, onConfirm }) {
  if (!confirming) {
    return (
      <div className="delete-control">
        <button className="btn-ghost" onClick={onStart}>
          <X size={13} /> Delete tournament
        </button>
      </div>
    );
  }
  return (
    <div className="delete-confirm">
      <span>Delete this tournament permanently? This can't be undone.</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" style={{ background: "var(--accent)" }} onClick={onConfirm}>Yes, delete it</button>
      </div>
    </div>
  );
}

function StandingsTable({ standings, buchholz, totalRounds, sideBets, isAdmin, onToggleExclusion }) {
  const rounds = Array.from({ length: totalRounds || 0 }, (_, i) => i + 1);
  const inAnySideBet = (playerId) => (sideBets || []).some((b) => b.participantIds.includes(playerId));
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th className="rank">Rank</th>
            <th>Player</th>
            {rounds.map((r) => (
              <th key={r} style={{ textAlign: "center" }}>R{r}</th>
            ))}
            <th style={{ textAlign: "center" }}>Wins</th>
            {buchholz && <th className="buchholz-header">Buchholz</th>}
            <th>Status</th>
            <th style={{ textAlign: "center" }}>Side bet</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((p, i) => (
            <tr key={p.id}>
              <td className="rank">{i + 1}</td>
              <td>{p.name}</td>
              {rounds.map((r) => (
                <td key={r} style={{ textAlign: "center" }}>{roundCell(p, r)}</td>
              ))}
              <td style={{ textAlign: "center" }}><span className="wins-highlight">{p.wins}</span></td>
              {buchholz && <td className="buchholz-cell">{buchholz[p.id] ?? "—"}</td>}
              <td className="withdrawn-tag">
                <span style={p.withdrawn ? { color: "var(--danger, #c0392b)" } : undefined}>
                  {p.withdrawn ? `Retired (R${p.withdrawnRound})` : "Active"}
                </span>
                {p.excludedFromTournament && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }}>· Out of tournament</span>}
                {isAdmin && onToggleExclusion && (
                  <button
                    className="btn-ghost"
                    style={{ marginLeft: 8, fontSize: 11, padding: "2px 6px" }}
                    onClick={() => onToggleExclusion(p.id)}
                  >
                    {p.excludedFromTournament ? "Επαναφορά" : "Απόσυρση"}
                  </button>
                )}
              </td>
              <td style={{ textAlign: "center" }}>
                <span style={{ display: "flex", justifyContent: "center" }}>
                  {inAnySideBet(p.id) ? <Check size={15} color="var(--win)" /> : "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--muted)", padding: "8px 12px 12px 12px", margin: 0 }}>
        * = result due to opponent's withdrawal
      </p>
    </div>
  );
}
