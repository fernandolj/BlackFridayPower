// Tiny Upstash Redis REST client (no dependencies). Finds the variables under any prefix.
const envKeys = Object.keys(process.env);
const pick = (re) => { const k = envKeys.filter((x) => re.test(x) && !/READ_ONLY/i.test(x)).sort()[0]; return k ? process.env[k] : ""; };
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || pick(/(KV_REST_API_URL|REDIS_REST_URL)$/i);
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || pick(/(KV_REST_API_TOKEN|REDIS_REST_TOKEN)$/i);

async function redis(cmds) {
  const r = await fetch(URL_.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  const out = await r.json();
  if (out.some((x) => x && x.error)) throw new Error("storage error");
  return out.map((x) => x.result);
}
module.exports = { redis, configured: !!(URL_ && TOKEN) };
