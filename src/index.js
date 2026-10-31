// Cloudflare Worker. Static files in /public are served by Cloudflare automatically.
// This script only handles POST /ask: it sends the question to a free open model on
// Workers AI and streams the answer back. No API key is needed or stored anywhere.

const SYSTEM = "You are a friendly tutor who explains things visually. For the question below, choose the best visual and narrate it in short spoken steps.\nReply with ONLY a JSON object with keys in this order: title, type, items, links, columns, rows, steps.\ntype is one of:\n- \"diagram\": parts, processes or relationships. Use items (nodes) and links (arrows between item ids, optional short label).\n- \"table\": comparisons. Use columns and rows (each row has id and cells matching the columns).\n- \"cards\": a set of things or objects. Use items with label and a short detail.\n- \"timeline\": ordered stages or history. Use items in order, with label and detail.\n- \"bars\": numeric comparison. Use items with label and numeric value.\nRules: ids are short (\"a\",\"b\",\"c\"). Labels under 4 words. Details under 12 words. At most 8 items or rows. Omit fields you don't use. Put \"steps\" last.\nsteps: 3 to 5 steps. Each \"say\" is one plain spoken sentence under 25 words. \"focus\" lists the ids of the items (or row ids) discussed in that step.\nExample for \"how does a kettle work\":\n{\"title\":\"How a kettle works\",\"type\":\"diagram\",\"items\":[{\"id\":\"a\",\"label\":\"Power socket\",\"detail\":\"Supplies mains electricity.\"},{\"id\":\"b\",\"label\":\"Heating element\"},{\"id\":\"c\",\"label\":\"Water\"},{\"id\":\"d\",\"label\":\"Thermostat\"}],\"links\":[{\"from\":\"a\",\"to\":\"b\",\"label\":\"current\"},{\"from\":\"b\",\"to\":\"c\",\"label\":\"heat\"},{\"from\":\"c\",\"to\":\"d\",\"label\":\"steam\"}],\"steps\":[{\"say\":\"Mains current flows into the heating element.\",\"focus\":[\"a\",\"b\"]},{\"say\":\"The element heats the water until it boils.\",\"focus\":[\"b\",\"c\"]},{\"say\":\"Steam trips the thermostat, which cuts the power.\",\"focus\":[\"c\",\"d\"]}]}";
const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_Q = 300;        // characters per question
const MAX_PER_MIN = 20;   // per visitor, best effort per Worker instance
const hits = new Map();

function limited(ip) {
  const now = Date.now(), win = 60000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > MAX_PER_MIN;
}

// Workers AI streams {"response":"token"}. The page reads Anthropic-style events, so convert.
function convert() {
  const dec = new TextDecoder(), enc = new TextEncoder(); let buf = "";
  const emit = (ln, ctl) => {
    if (!ln.startsWith("data:")) return;
    const d = ln.slice(5).trim(); if (!d || d === "[DONE]") return;
    try {
      const t = JSON.parse(d).response;
      if (t) ctl.enqueue(enc.encode("data: " + JSON.stringify({ type: "content_block_delta", delta: { text: t } }) + "\n\n"));
    } catch (e) {}
  };
  return new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const ln of lines) emit(ln, ctl);
    },
    flush(ctl) { if (buf) emit(buf, ctl); }
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/ask") {
      if (!env.AI) return new Response("Add a Workers AI binding named AI", { status: 500 });
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      if (limited(ip)) return new Response("Slow down", { status: 429 });
      let body; try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
      const q = String((body && body.q) || "").trim().slice(0, MAX_Q);
      if (!q) return new Response("Empty question", { status: 400 });
      try {
        const stream = await env.AI.run(env.MODEL || MODEL, {
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }],
          stream: true, max_tokens: 1200, temperature: 0.4
        });
        return new Response(stream.pipeThrough(convert()), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
      } catch (e) {
        const msg = String((e && e.message) || e);
        return new Response("AI error: " + msg, { status: /limit|quota|neuron|capacity/i.test(msg) ? 429 : 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
