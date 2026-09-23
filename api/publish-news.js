// Vercel Serverless Function — publishes a tournament summary as a
// WordPress post via the REST API, authenticated with an Application
// Password. The credential lives only in Vercel's environment variables
// (WP_URL, WP_USERNAME, WP_APP_PASSWORD) — never in the frontend bundle.
//
// Defaults to status: "draft" so nothing goes live without a human
// clicking "Publish" inside WordPress. Change DEFAULT_STATUS to
// "publish" below if/when live, no-review posting is wanted instead.
// Change DEFAULT_CATEGORY_ID (or pass categoryId in the request body)
// once the target category on bgfed.gr is decided.

const DEFAULT_STATUS = "draft";
const DEFAULT_CATEGORY_ID = null; // e.g. 12, once known

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { WP_URL, WP_USERNAME, WP_APP_PASSWORD } = process.env;
  if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    return res.status(500).json({ error: "Server is missing WP_URL / WP_USERNAME / WP_APP_PASSWORD environment variables." });
  }

  const { title, content, categoryId, status } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: "Missing required fields: title, content." });
  }

  const auth = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString("base64");
  const postBody = {
    title,
    content,
    status: status || DEFAULT_STATUS,
  };
  const category = categoryId ?? DEFAULT_CATEGORY_ID;
  if (category) postBody.categories = [category];

  try {
    const wpRes = await fetch(`${WP_URL.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(postBody),
    });

    const data = await wpRes.json();
    if (!wpRes.ok) {
      return res.status(wpRes.status).json({ error: data?.message || "WordPress rejected the request." });
    }

    return res.status(200).json({
      success: true,
      id: data.id,
      status: data.status,
      link: data.link, // preview/edit link is more useful than the public link while status is "draft"
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected error contacting WordPress." });
  }
}
