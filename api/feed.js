// Public RSS feed of admin-approved tournament recaps. Read by WordPress
// (via the Feedzy plugin, or any other RSS reader) on its own schedule —
// nothing is ever pushed from us to bgfed.gr, so this never triggers
// Cloudflare's Bot Fight Mode the way the old push-based approach did.
//
// Reads straight from Firestore (same public project as the app itself;
// access is controlled by Firestore's own rules, no secret needed here).

import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBeaW3Ns7VbMH59PeuUinGBT1iypTbzzDw",
  authDomain: "bgfed-tournament-application.firebaseapp.com",
  projectId: "bgfed-tournament-application",
  storageBucket: "bgfed-tournament-application.firebasestorage.app",
  messagingSenderId: "153732165436",
  appId: "1:153732165436:web:5f92921160fff65097f839",
};

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, "meta", "rssFeed"));
    const items = snap.exists() ? snap.data().items || [] : [];

    const itemsXml = items
      .map(
        (it) => `
    <item>
      <title>${escapeXml(it.title || "")}</title>
      <link>${escapeXml(it.link || "")}</link>
      <guid isPermaLink="false">${escapeXml(it.guid || "")}</guid>
      <pubDate>${new Date(it.pubDate).toUTCString()}</pubDate>
      <description><![CDATA[${it.description || ""}]]></description>
    </item>`
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Ελληνική Ομοσπονδία Backgammon — Αποτελέσματα Τουρνουά</title>
  <link>https://bgfed-tournament.vercel.app</link>
  <atom:link href="https://bgfed-tournament.vercel.app/api/feed" rel="self" type="application/rss+xml" />
  <description>Αυτόματη ροή αποτελεσμάτων από το Backgammon Premier League.</description>
  <language>el</language>${itemsXml}
</channel>
</rss>`;

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).send(xml);
  } catch (err) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(500).send(`Σφάλμα δημιουργίας feed: ${err.message}`);
  }
}
