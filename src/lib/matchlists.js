/* ---- Match lists (bgfed-matchlist/1) -------------------------------------
 * Matches of a club that does not run its tournaments in the app, each with
 * its own date: { format, name, sourceId, organiser?, sourceName?, dateFrom?,
 * dateTo?, players: [names], matches: [{ id, date, time?, p1, p2, winner,
 * score1?, score2?, matchLength?, method: "normal" | "walkover", label?,
 * note?, dateAssumed? }], matching?: <bgfed-matching/1> }.
 * Stored like the other imports (imp-… document + entry of sys-imports) with
 * kind: "matchlist". They count ONLY in the ELO rankings (each normal match
 * at its own date + time) and in the players' statistics; never in season
 * standings, the tournaments list or titles. A walkover counts nowhere. */
export const MATCHLIST_FORMAT = "bgfed-matchlist/1";

export function isMatchlist(doc) {
  return !!doc && (doc.kind === "matchlist" || doc.format === MATCHLIST_FORMAT);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function validYmd(s) {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Problems and summary of a match list. The import is allowed only with no
 * problems. */
export function validateMatchlist(doc) {
  if (!doc || doc.format !== MATCHLIST_FORMAT) return { problems: ["Το αρχείο δεν είναι λίστα αγώνων (bgfed-matchlist/1)."], summary: null };
  const problems = [];
  if (!String(doc.name || "").trim()) problems.push("Λείπει το όνομα της λίστας (name).");
  if (!String(doc.sourceId || "").trim()) problems.push("Λείπει το σταθερό αναγνωριστικό (sourceId).");
  const players = new Set(doc.players || []);
  const matches = Array.isArray(doc.matches) ? doc.matches : [];
  if (matches.length === 0) problems.push("Η λίστα δεν έχει αγώνες.");
  const ids = new Set();
  matches.forEach((m, i) => {
    const tag = `Αγώνας ${m && m.id != null ? `«${m.id}»` : `#${i + 1}`}`;
    if (!m || typeof m !== "object") { problems.push(`${tag}: μη έγκυρη εγγραφή.`); return; }
    if (m.id == null || m.id === "") problems.push(`${tag}: λείπει το id.`);
    else if (ids.has(String(m.id))) problems.push(`${tag}: το id υπάρχει δύο φορές.`);
    else ids.add(String(m.id));
    [m.p1, m.p2, m.winner].forEach((p) => {
      if (!players.has(p)) problems.push(`${tag}: άγνωστος παίκτης «${p ?? ""}».`);
    });
    if (m.p1 === m.p2) problems.push(`${tag}: ο ίδιος παίκτης και στις δύο θέσεις.`);
    if (m.winner !== m.p1 && m.winner !== m.p2) problems.push(`${tag}: ο νικητής δεν είναι ένας από τους δύο παίκτες.`);
    if (m.method !== "normal" && m.method !== "walkover") problems.push(`${tag}: άγνωστος τρόπος «${m.method ?? ""}» (normal ή walkover).`);
    if (m.method === "normal" && !validYmd(m.date)) problems.push(`${tag}: χρειάζεται έγκυρη ημερομηνία (ΕΕΕΕ-ΜΜ-ΗΗ).`);
    if (m.method === "walkover" && m.date != null && !validYmd(m.date)) problems.push(`${tag}: μη έγκυρη ημερομηνία.`);
    if (m.time != null && !/^\d{1,2}:\d{2}$/.test(String(m.time))) problems.push(`${tag}: μη έγκυρη ώρα «${m.time}» (ΩΩ:ΛΛ).`);
    if (m.matchLength != null && !(Number(m.matchLength) > 0)) problems.push(`${tag}: μη έγκυρο μήκος αγώνα.`);
  });
  if (doc.matching && doc.matching.format !== "bgfed-matching/1") problems.push("Οι αποφάσεις αντιστοίχισης δεν είναι σε μορφή bgfed-matching/1.");
  const counted = matches.filter((m) => m && m.method === "normal");
  const dates = matches.map((m) => m && m.date).filter(validYmd).sort();
  return {
    problems,
    summary: {
      players: players.size,
      counted: counted.length,
      walkovers: matches.filter((m) => m && m.method === "walkover").length,
      dateFrom: dates[0] || doc.dateFrom || "",
      dateTo: dates[dates.length - 1] || doc.dateTo || "",
      dateAssumed: matches.filter((m) => m && m.dateAssumed).length,
    },
  };
}

/** Moment of a match for the ELO order: its date at its time (local), or at
 * noon without a time (as the imported tournaments). */
export function matchlistMatchIso(m) {
  if (!validYmd(m && m.date)) return null;
  const [y, mo, d] = m.date.split("-").map(Number);
  const [hh, mm] = m.time && /^\d{1,2}:\d{2}$/.test(String(m.time)) ? String(m.time).split(":").map(Number) : [12, 0];
  return new Date(y, mo - 1, d, hh, mm).toISOString();
}

/** The matches that count (method "normal"), in play order: date, time,
 * then the order of the file. Each with its moment (iso). */
export function countedMatchlistMatches(doc) {
  return (doc.matches || [])
    .map((m, i) => ({ m, i, iso: m && m.method === "normal" ? matchlistMatchIso(m) : null }))
    .filter((x) => x.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso) || a.i - b.i)
    .map(({ m, iso }) => ({ ...m, iso }));
}

/** Saves a match list: the document, then the list of imports. A new list
 * with the same sourceId replaces the old one (replaceId).
 * io: { newId(), now(), saveDoc(id, doc) → bool, saveList(list) → bool }.
 * Returns { ok, docSaved, list }. */
export async function saveMatchlistImport(doc, summary, { competitionId, importsList, replaceId }, io) {
  const id = replaceId || io.newId();
  const { matching: _matching, personMap: _personMap, ...rest } = doc;
  const stored = { ...rest, kind: "matchlist", competitionId, dateFrom: summary.dateFrom, dateTo: summary.dateTo, importedAt: io.now() };
  if (!(await io.saveDoc(id, stored))) return { ok: false, docSaved: false, list: importsList || [] };
  const entry = {
    id, kind: "matchlist", name: doc.name, sourceId: doc.sourceId, organiser: doc.organiser || "",
    date: summary.dateFrom, dateEnd: summary.dateTo, dateFrom: summary.dateFrom, dateTo: summary.dateTo,
    competitionId, players: summary.players, matches: summary.counted, walkovers: summary.walkovers,
    winner: "—", importedAt: stored.importedAt,
  };
  const list = [...(importsList || []).filter((t) => t.id !== id), entry];
  const listSaved = await io.saveList(list);
  return { ok: listSaved, docSaved: true, list };
}

/** A player's matches in the match lists, one group per list (newest
 * first): { id, name, competitionId, rows: [{ date, time, oppKey, oppName,
 * result: "win" | "loss", walkover, score, label, note }] }. */
export function playerMatchlistGroups(importDocs, key) {
  const groups = [];
  Object.entries(importDocs || {}).forEach(([id, doc]) => {
    if (!isMatchlist(doc) || !doc.personMap) return;
    const rows = [];
    (doc.matches || []).forEach((m) => {
      const k1 = doc.personMap[m.p1];
      const k2 = doc.personMap[m.p2];
      if (k1 !== key && k2 !== key) return;
      const mine = k1 === key ? m.p1 : m.p2;
      const opp = k1 === key ? m.p2 : m.p1;
      const score = m.score1 != null && m.score2 != null ? (mine === m.p1 ? `${m.score1}–${m.score2}` : `${m.score2}–${m.score1}`) : "";
      rows.push({ date: m.date || "", time: m.time || "", oppKey: doc.personMap[opp] || null, oppName: opp, result: m.winner === mine ? "win" : "loss", walkover: m.method === "walkover", score, label: m.label || "", note: m.note || "" });
    });
    if (rows.length === 0) return;
    rows.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    groups.push({ id, name: doc.name, competitionId: doc.competitionId, rows });
  });
  groups.sort((a, b) => (b.rows[0].date || "").localeCompare(a.rows[0].date || ""));
  return groups;
}
