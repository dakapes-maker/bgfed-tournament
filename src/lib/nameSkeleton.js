import { editDistance, stripAccents } from "./persons.js";

/* ---- Name skeletons for matching imported names (Build 4A) -------------
 * Greek and greeklish spellings of a surname reduced to one simplified
 * form, so ZOIDIS, ΖΩΙΔΗΣ and «Ζωίδης» compare equal. A Latin spelling
 * yields several variants (e.g. "OI" may be «οι» or «ο-ι»; H/P may be the
 * Greek Η/Ρ typed with Latin letters). Used only to SUGGEST matches. */
export const SKEL_GREEK = [["ΜΠ","B"],["ΝΤ","D"],["ΓΚ","G"],["ΓΓ","G"],["ΟΥ","U"],["ΕΙ","I"],["ΟΙ","I"],["ΑΙ","E"],["ΑΥ","AV"],["ΕΥ","EV"],
  ["Α","A"],["Β","V"],["Γ","G"],["Δ","D"],["Ε","E"],["Ζ","Z"],["Η","I"],["Θ","TH"],["Ι","I"],["Κ","K"],["Λ","L"],["Μ","M"],["Ν","N"],["Ξ","KS"],["Ο","O"],["Π","P"],["Ρ","R"],["Σ","S"],["Τ","T"],["Υ","I"],["Φ","F"],["Χ","H"],["Ψ","PS"],["Ω","O"]];
export function skelFinish(x) {
  return x.replace(/[^A-Z]/g, "").replace(/(.)\1+/g, "$1");
}
export function nameSkeletons(word) {
  const s = stripAccents(String(word || "").toUpperCase()).replace(/Σ/g, "Σ");
  if (/[Α-Ω]/.test(s)) {
    let t = s;
    SKEL_GREEK.forEach(([a, b]) => { t = t.split(a).join(b); });
    return new Set([skelFinish(t)]);
  }
  const out = new Set();
  for (const keepOI of [false, true]) {
    for (const visual of [0, 1, 2]) {
      let t = s;
      if (visual >= 1) t = t.replace(/H/g, "I");
      if (visual === 2) t = t.replace(/P/g, "R");
      const reps = [["MP","B"],["NT","D"],["GK","G"],["OU","U"],["OY","U"],["EI","I"],["AI","E"],["CH","H"],["PH","F"],["X","H"],["Y","I"],["W","O"],["C","K"],["J","I"]];
      if (!keepOI) reps.splice(6, 0, ["OI","I"]);
      reps.forEach(([a, b]) => { t = t.split(a).join(b); });
      out.add(skelFinish(t));
    }
  }
  return out;
}
export function skeletonsMinDistance(A, B) {
  let best = 99;
  A.forEach((a) => B.forEach((b) => { best = Math.min(best, editDistance(a, b)); }));
  return best;
}
/** Surname part of a source name: "DIMAKIS S." -> "DIMAKIS"; "ΚΑΛΛΕΡΓΗ ΔΩΡΟΘΕΑ" -> "ΚΑΛΛΕΡΓΗ". */
export function sourceSurname(n) {
  return String(n || "").trim().split(/\s+/)[0];
}
/** "ΜΗΛΙΩΝΗΣ" -> "Μηλιωνης", "PAPANDREOY" -> "Papandreoy" (accents unknown; editable). */
export function titleCaseName(n) {
  return String(n || "").toLowerCase().replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase()).replace(/σ(\s|$)/g, "ς$1");
}
