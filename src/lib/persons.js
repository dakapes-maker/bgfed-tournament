/* ---------------------------------------------------------------------- */
/* Player identity                                                         */
/* A player is a *person* with a permanent id. Every spelling the person    */
/* has ever had (aliases) leads to the same id, so renaming or correcting   */
/* a name never splits their history. Until the registry is migrated, a     */
/* name behaves exactly as it always did.                                   */
/* ---------------------------------------------------------------------- */

export let PERSON_LOOKUP = new Map(); // spelling (trimmed, lower case) -> person id
export let PERSON_DISPLAY = new Map(); // person id -> current display name

export function baseName(name) {
  return String(name ?? "").trim().toLowerCase();
}

export function setPersonLookup(registry) {
  const lookup = new Map();
  const display = new Map();
  if (registry && registry.identityVersion === 2) {
    Object.entries(registry.players || {}).forEach(([key, p]) => {
      display.set(key, p.name);
      new Set([...(p.aliases || []), baseName(p.name)]).forEach((s) => {
        if (s && !lookup.has(s)) lookup.set(s, key);
      });
    });
  }
  PERSON_LOOKUP = lookup;
  PERSON_DISPLAY = display;
}

/** The key under which a person is stored everywhere (registry, ELO, season,
 * statistics): their permanent id once the registry is migrated, otherwise
 * the plain lower-cased name. */
export function normalizeName(name) {
  const b = baseName(name);
  return PERSON_LOOKUP.get(b) || b;
}

/** The person's current display name, falling back to what was typed. */
export function displayNameFor(key, fallback) {
  return PERSON_DISPLAY.get(key) || fallback;
}

export function newPersonId(existing) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    let s = "";
    for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    const id = `pl_${s}`;
    if (!existing || !existing[id]) return id;
  }
}

export function personSpellings(p) {
  return [...new Set([...(p.aliases || []), baseName(p.name)])];
}

export function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function wordsOf(s) {
  return stripAccents(baseName(s)).split(/\s+/).filter(Boolean);
}

/** Persons whose name merely LOOKS like the typed one: the same words in a
 * different order, or one word in common and the other one or two letters
 * off. It is only used to ASK the admin — never to merge on its own. */
export function findLookalikePersons(typed, players) {
  const t = wordsOf(typed);
  if (t.length < 2) return [];
  const out = [];
  Object.entries(players).forEach(([key, p]) => {
    let reason = null;
    personSpellings(p).forEach((sp) => {
      if (reason) return;
      const w = wordsOf(sp);
      if (w.length !== t.length) return;
      if ([...w].sort().join(" ") === [...t].sort().join(" ")) {
        reason = "reordered";
        return;
      }
      const common = t.filter((x) => w.includes(x) && x.length >= 3);
      if (common.length >= 1 && common.length === t.length - 1) {
        const restT = t.filter((x) => !w.includes(x));
        const restW = w.filter((x) => !t.includes(x));
        if (restT.length === 1 && restW.length === 1 && Math.min(restT[0].length, restW[0].length) >= 4 && editDistance(restT[0], restW[0]) <= 2) {
          reason = "similar";
        }
      }
    });
    if (reason) out.push({ key, person: p, reason });
  });
  return out;
}

export const GREEK_DIGRAPHS = [
  ["ου", "ou"], ["αι", "e"], ["ει", "i"], ["οι", "i"],
  ["γγ", "ng"], ["γκ", "g"], ["μπ", "b"], ["ντ", "d"],
  ["τσ", "ts"], ["τζ", "tz"], ["θ", "th"], ["χ", "ch"], ["ψ", "ps"],
];
export const GREEK_SINGLE = {
  "α":"a","β":"v","γ":"g","δ":"d","ε":"e","ζ":"z","η":"i","ι":"i",
  "κ":"k","λ":"l","μ":"m","ν":"n","ξ":"x","ο":"o","π":"p","ρ":"r",
  "σ":"s","ς":"s","τ":"t","υ":"i","φ":"f","ω":"o",
};

export function hasGreekLetters(s) {
  return /[Α-Ωα-ωΆΈΉΊΌΎΏάέήίόύώΪΫϊϋΐΰ]/.test(s);
}

export function toGreeklish(name) {
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

export function formatNameForDisplay(name, mode) {
  if (mode === "upper") {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  if (mode === "greeklish") return toGreeklish(name);
  return name;
}

/** Next registry number: one above the highest ever given. */
export function nextRegNo(registry) {
  const top = Math.max(registry.regNoMax || 0, ...Object.values(registry.players || {}).map((p) => p.regNo || 0));
  return top + 1;
}

export function formatRegNo(n) {
  return n ? `#${String(n).padStart(3, "0")}` : "";
}

export function stripAccents(s) {
  return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

