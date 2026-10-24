import { nameSkeletons, skeletonsMinDistance, sourceSurname } from "./nameSkeleton.js";
import { SYS_IMPORTS_ID } from "./sysDocs.js";

/* ---- Imports and the persons of the registry (2026-10-24.03) ------------
 * An import links each source name to a person through its personMap.
 * When two persons are merged, the imports that point to the absorbed one
 * must point to the one kept — otherwise their matches (ELO, standings)
 * belong to a person that no longer exists. */

/** The import with every `fromKey` of its personMap replaced by `toKey`;
 * null when nothing changes. */
export function remapPersonKey(doc, fromKey, toKey) {
  if (!doc || !doc.personMap) return null;
  let changed = false;
  const personMap = {};
  Object.entries(doc.personMap).forEach(([n, k]) => {
    if (k === fromKey) changed = true;
    personMap[n] = k === fromKey ? toKey : k;
  });
  return changed ? { ...doc, personMap } : null;
}

/** After a merge of persons: every import (and match list) that points to
 * `fromKey` is re-read strictly and saved pointing to `toKey`.
 * io: { load(id) (strict, throws), save(id, doc) → bool }.
 * Returns { changed: [{ id, name, doc }], failed: [name] }. */
export async function remapImportsPerson(fromKey, toKey, io) {
  const changed = [];
  const failed = [];
  let list;
  try {
    const d = await io.load(SYS_IMPORTS_ID);
    list = d && Array.isArray(d.list) ? d.list : [];
  } catch {
    return { changed, failed: ["λίστα εισαγωγών"] };
  }
  for (const it of list) {
    let doc;
    try {
      doc = await io.load(it.id);
    } catch {
      failed.push(it.name || it.id);
      continue;
    }
    const next = remapPersonKey(doc, fromKey, toKey);
    if (!next) continue;
    if (await io.save(it.id, next)) changed.push({ id: it.id, name: it.name || doc.name, doc: next });
    else failed.push(it.name || it.id);
  }
  return { changed, failed };
}

/** Source names of the imports whose person is missing from the registry
 * (e.g. merged away before this build): [{ importId, importName, sourceName, key }]. */
export function orphanPersonMapEntries(docs, players) {
  const out = [];
  (docs || []).forEach((d) => {
    Object.entries(d.personMap || {}).forEach(([sourceName, key]) => {
      if (key && !players[key]) out.push({ importId: d.id, importName: d.name || d.id, sourceName, key });
    });
  });
  return out;
}

/** Likely person for a source name: the persons whose surname is closest
 * (name skeletons, distance ≤ 1), leaving out those already in the same
 * import; with several, those of `clubId`. `key` only when exactly one. */
export function suggestPersonFor(sourceName, players, { exclude = new Set(), clubId = null } = {}) {
  const sks = nameSkeletons(sourceSurname(sourceName));
  let best = 2;
  let candidates = [];
  Object.entries(players || {}).forEach(([k, p]) => {
    if (exclude.has(k)) return;
    const dist = skeletonsMinDistance(sks, nameSkeletons(sourceSurname(p.name)));
    if (dist < best) {
      best = dist;
      candidates = [k];
    } else if (dist === best) candidates.push(k);
  });
  if (candidates.length > 1 && clubId) {
    const own = candidates.filter((k) => players[k].clubId === clubId);
    if (own.length >= 1) candidates = [...own, ...candidates.filter((k) => !own.includes(k))];
    if (own.length === 1) return { key: own[0], candidates };
  }
  return { key: candidates.length === 1 ? candidates[0] : null, candidates };
}
