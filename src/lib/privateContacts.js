// Players' private details (5A). Before the move they live inside the public
// registry (meta/registry); after it (registry.contactsVersion === 1) they
// live in private/contacts, readable by administrators only. In memory an
// administrator always works with the joined registry, so screens and the
// rest of the code are unchanged; saving splits it again.

export const PRIVATE_FIELDS = ["email", "phone", "membership", "hasDiscount", "discountAmount", "needsInfo"];

/** The values a player has when no private details are stored for them —
 * the same defaults the app gives an imported person today. */
export const DEFAULT_PRIVATE = { email: "", phone: "", membership: [], hasDiscount: false, discountAmount: 32, needsInfo: false };

function pickPrivate(p) {
  const out = {};
  PRIVATE_FIELDS.forEach((f) => {
    if (p && p[f] !== undefined) out[f] = p[f];
  });
  return out;
}

function hasAnyPrivate(p) {
  return PRIVATE_FIELDS.some((f) => p && p[f] !== undefined);
}

/** Registry without any private field (what a visitor may see). */
export function stripPrivate(registry) {
  const players = {};
  Object.entries(registry.players || {}).forEach(([k, p]) => {
    const rest = { ...p };
    PRIVATE_FIELDS.forEach((f) => delete rest[f]);
    players[k] = rest;
  });
  return { ...registry, players };
}

/** Joins the private details into the registry for an administrator. A
 * person with nothing stored gets the defaults, so admin screens never meet
 * a missing field. Details already inside the registry (before the move)
 * are kept as they are. */
export function mergeContacts(registry, contactsDoc) {
  const stored = (contactsDoc && contactsDoc.players) || {};
  const players = {};
  Object.entries(registry.players || {}).forEach(([k, p]) => {
    players[k] = { ...DEFAULT_PRIVATE, ...pickPrivate(stored[k]), ...pickPrivate(p), ...p };
  });
  return { ...registry, players };
}

/** Splits a joined registry for saving: the public registry (marked
 * contactsVersion: 1) and the private document. A person whose private
 * fields are absent from the registry passed in (e.g. one read back from the
 * database) keeps what is already stored in currentContacts — a save can
 * never wipe someone's details by accident. Persons no longer in the
 * registry (e.g. merged into another) are dropped from the private document. */
export function splitRegistry(registry, currentContacts) {
  const stored = (currentContacts && currentContacts.players) || {};
  const privatePlayers = {};
  Object.entries(registry.players || {}).forEach(([k, p]) => {
    privatePlayers[k] = { ...DEFAULT_PRIVATE, ...pickPrivate(stored[k]), ...(hasAnyPrivate(p) ? pickPrivate(p) : {}) };
  });
  return {
    publicRegistry: { ...stripPrivate(registry), contactsVersion: 1 },
    contacts: { version: 1, players: privatePlayers },
  };
}

/** Preview of the move: how many players and what is stored for them. */
export function contactsSummary(registry) {
  const ps = Object.values(registry.players || {});
  return {
    players: ps.length,
    withEmail: ps.filter((p) => (p.email || "").trim()).length,
    withPhone: ps.filter((p) => (p.phone || "").trim()).length,
    withMembership: ps.filter((p) => Array.isArray(p.membership) && p.membership.length > 0).length,
    withDiscount: ps.filter((p) => p.hasDiscount).length,
  };
}

/** Verification after the move: every person's private fields in the
 * document read back are exactly those of the registry they came from.
 * Returns the ids that do not match (empty = all good). */
export function contactsMismatches(registry, contactsDoc) {
  const stored = (contactsDoc && contactsDoc.players) || {};
  const bad = [];
  Object.entries(registry.players || {}).forEach(([k, p]) => {
    const want = { ...DEFAULT_PRIVATE, ...pickPrivate(p) };
    const got = stored[k];
    if (!got || PRIVATE_FIELDS.some((f) => JSON.stringify(got[f]) !== JSON.stringify(want[f]))) bad.push(k);
  });
  if (Object.keys(stored).length !== Object.keys(registry.players || {}).length) bad.push("(πλήθος)");
  return bad;
}

/** The move (5A), step by step; any failure stops it before the public
 * registry is touched:
 *   1. write private/contacts from the registry,
 *   2. read it back strictly and check every field,
 *   3. only then write the public registry without private fields
 *      (contactsVersion: 1).
 * io: { saveContacts(doc) → bool, loadContactsStrict() → doc (throws),
 *       saveRegistry(registry) → bool }. */
export async function moveContacts(registry, io) {
  const { publicRegistry, contacts } = splitRegistry(registry, null);
  if (!(await io.saveContacts(contacts))) return { ok: false, message: "Τα στοιχεία επικοινωνίας δεν γράφτηκαν. Το μητρώο δεν άλλαξε." };
  let back;
  try {
    back = await io.loadContactsStrict();
  } catch {
    return { ok: false, message: "Η επαλήθευση δεν διαβάστηκε. Το μητρώο δεν άλλαξε· δοκίμασε ξανά." };
  }
  const bad = contactsMismatches(registry, back);
  if (bad.length > 0) return { ok: false, message: `Η επαλήθευση βρήκε διαφορές (${bad.length}). Το μητρώο δεν άλλαξε.` };
  if (!(await io.saveRegistry(publicRegistry))) return { ok: false, message: "Το δημόσιο μητρώο δεν γράφτηκε· τα στοιχεία υπάρχουν ήδη και στο ιδιωτικό έγγραφο. Δοκίμασε ξανά." };
  return { ok: true, publicRegistry, contacts: back };
}
