// Cloudflare Worker. Static files in /public are served by Cloudflare automatically.
// This script only handles POST /ask: it sends the question to a free open model on
// Workers AI and streams the answer back. No API key is needed or stored anywhere.

const SYSTEM = "You are an answer engine that replies the way Google's featured answers and AI Overviews do: precise, factual and specific to exactly what was asked. Never give a generic or vague answer.\nContent rules:\n- The FIRST step answers the exact question in one sentence that contains the concrete fact: a name, number with units, date, place, definition, or a yes/no with the reason. Never open with \"It depends\", and never just restate the question.\n- Then give the 2 to 4 most useful specifics: real figures, named examples, the actual mechanism, dates, comparisons. Concrete beats abstract. For how/why questions explain the real mechanism in order. For comparisons use a table with real values. For \"types of / examples of\" use cards. For history or sequences use a timeline. For quantities use bars with real numbers.\n- Use only facts you are confident about. Never invent statistics, quotes or names. Say \"about\" for approximate figures. If you do not know, say so plainly in the first step. For live data (prices, scores, news, today's weather) say you cannot see live data, then give the stable background.\nReply with ONLY a JSON object with keys in this order: title, type, items, links, columns, rows, steps, related.\ntype is one of:\n- \"diagram\": parts, processes or relationships. Use items (nodes) and links (arrows between item ids, optional short label).\n- \"table\": comparisons. Use columns and rows (each row has id and cells matching the columns).\n- \"cards\": a set of things or objects. Use items with label and a short detail.\n- \"timeline\": ordered stages or history. Use items in order, with label (the year or stage) and detail.\n- \"bars\": numeric comparison. Use items with label and numeric value.\nRules: ids are short (\"a\",\"b\",\"c\"). Labels under 4 words. Details under 16 words and specific (include the number, name or reason). At most 8 items or rows. Omit fields you don't use. Put \"steps\" last.\nsteps: 3 to 5 steps. The FIRST step is the direct answer (the featured snippet). The next 2 to 4 steps are the supporting specifics. Each \"say\" is one plain sentence under 28 words. \"focus\" lists the ids of the items (or row ids) discussed in that step.\nrelated: 3 short follow-up questions people also ask about this topic. Put \"related\" last, after steps.\nExample for \"how does a kettle work\":\n{\"title\":\"How a kettle works\",\"type\":\"diagram\",\"items\":[{\"id\":\"a\",\"label\":\"Power socket\",\"detail\":\"Supplies mains electricity, 230 V in India and the UK.\"},{\"id\":\"b\",\"label\":\"Heating element\",\"detail\":\"A coil of resistive wire, typically 1.5 to 3 kW.\"},{\"id\":\"c\",\"label\":\"Water\"},{\"id\":\"d\",\"label\":\"Thermostat\",\"detail\":\"A bimetallic strip that bends when steam hits it.\"}],\"links\":[{\"from\":\"a\",\"to\":\"b\",\"label\":\"current\"},{\"from\":\"b\",\"to\":\"c\",\"label\":\"heat\"},{\"from\":\"c\",\"to\":\"d\",\"label\":\"steam\"}],\"steps\":[{\"say\":\"A kettle boils water by passing mains current through a resistive heating element, then a steam-triggered thermostat cuts the power.\",\"focus\":[\"a\",\"b\",\"c\",\"d\"]},{\"say\":\"The element, usually 1.5 to 3 kilowatts, turns electricity into heat that warms the water.\",\"focus\":[\"b\",\"c\"]},{\"say\":\"Near 100 degrees Celsius, steam reaches a bimetallic strip, which bends and switches the kettle off.\",\"focus\":[\"c\",\"d\"]}],\"related\":[\"Why does a kettle switch itself off?\",\"How much power does a kettle use?\",\"Is an electric kettle cheaper than a gas hob?\"]}";
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"; // bigger model: more accurate, specific answers
const FALLBACK = "@cf/meta/llama-3.1-8b-instruct";   // used if the big model errors or is busy
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
        const run = m => env.AI.run(m, {
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }],
          stream: true, max_tokens: 1500, temperature: 0.3
        });
        let stream;
        try { stream = await run(env.MODEL || MODEL); } catch (e1) { stream = await run(FALLBACK); }
        return new Response(stream.pipeThrough(convert()), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
      } catch (e) {
        const msg = String((e && e.message) || e);
        return new Response("AI error: " + msg, { status: /limit|quota|neuron|capacity/i.test(msg) ? 429 : 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
