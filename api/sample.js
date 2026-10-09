// Vercel serverless function: turns the app's product lookup prompt into Claude's JSON answer.
// Requires the ANTHROPIC_API_KEY environment variable (set in Vercel project settings).
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
  const prompt = req.body && req.body.prompt;
  // Only accept the app's own product-lookup prompts, and keep them short.
  if (typeof prompt !== "string" || prompt.length > 2500 || !prompt.startsWith('Product: "')) {
    return res.status(400).json({ error: "Bad request" });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "Upstream error " + r.status });
    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b < a) return res.status(502).json({ error: "No JSON in reply" });
    return res.status(200).json(JSON.parse(text.slice(a, b + 1)));
  } catch (e) {
    return res.status(502).json({ error: "Lookup failed" });
  }
};
