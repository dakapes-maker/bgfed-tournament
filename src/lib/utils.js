// True specifically when this app was loaded inside an embed on the
// Federation's own site (bgfed.gr) — used to hide the Admin option there.
// NOTE: a plain "am I in any iframe?" check doesn't work here, because
// claude.ai's own artifact viewer already wraps the app in an iframe even
// on its "direct" public link — that check would hide Admin everywhere.
// Checking document.referrer for the specific embedding domain avoids that.
// This is a UX nicety only (avoids showing the button to random site
// visitors) — the real gate is still the password, so a missed edge case
// here is not a security hole.
export function isEmbeddedOnFederationSite() {
  try {
    return /bgfed\.gr/i.test(document.referrer);
  } catch {
    return false;
  }
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}
