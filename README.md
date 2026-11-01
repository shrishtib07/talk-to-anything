# Talk to Anything

Ask a question out loud or by typing. The page answers in short spoken steps while it draws a diagram, table, timeline or chart and highlights the part being explained. Change something ("Run it in summer", "Brake", "Sun sets") and the drawing redraws with a new explanation.

**Live demo:** https://talk-to-anything.shrishti5-sb.workers.dev/

No sign-up, install or API key is needed to use it.

## What it does

- **Prepared topics draw instantly** (heat pump, lithium-ion cell, EV drivetrain, grid battery, LFP vs NMC, planet sizes, internet history, DNS lookup). They animate on load, and each has "change something" buttons.
- **Any other question** is sent to a free open model (Llama 3.3 70B on Cloudflare Workers AI, with Llama 3.1 8B as a backup). It is prompted to answer like a Google featured answer: the direct, specific answer first, then real figures, names and mechanisms, drawn as a diagram, table, cards, timeline or bar chart.
- **If the model is unavailable** (for example the daily free allowance is used up) the page says so and offers Replay to try again. Prepared topics still work.
- **Tap anything** in a drawing to see its detail. "People also ask" questions follow every answer.
- **Voice:** tap 🎤 to ask by voice (Chrome and Edge on Android and desktop, Safari on iPhone). Nothing is spoken automatically; tap 🔊 Listen to the answer to hear it, and tap again to stop.

## How it works

```
Browser (public/index.html)
  |-- prepared topics: data in the page, drawn as SVG, no network
  |-- other questions: POST /ask  ->  Worker (src/index.js)  ->  Workers AI (Llama 3.3 70B)
  |        streamed reply is parsed as it arrives, so the first step is drawn and spoken early
  '-- no third-party data sources, no API key
```

- `public/index.html` is the whole front end: drawing engine, topic data, speech, routing and streaming parser. No build step and no dependencies.
- `src/index.js` is a tiny Worker. It caps question length, rate-limits each visitor, keeps the system prompt on the server, and converts the model's stream into the format the page reads.
- `wrangler.toml` tells Cloudflare to serve `public/` and attach the free Workers AI binding.

## Run it locally

The page works on its own, without the Worker:

```
cd public
python -m http.server 8000
```

Open http://localhost:8000. Prepared topics work immediately. For any-question answers locally, the page offers an optional on-device model (about 1 GB, downloaded once, needs desktop Chrome or Edge with WebGPU) or your own Anthropic API key (stored only in your browser).

## Deploy for free on Cloudflare

1. Fork or upload this repo to your GitHub account.
2. In the Cloudflare dashboard open Workers & Pages, choose Create, then import the repository.
3. Keep the default deploy command (`npx wrangler deploy`) and deploy. `wrangler.toml` already declares the static files and the Workers AI binding.
4. Open the `workers.dev` link it gives you.

Or from a terminal: `npx wrangler deploy`.

## Limits and known issues

- The free Workers AI plan has a daily allowance, and the 70B model uses it faster than a small one. When it is used up the page asks you to try again later.
- Open models can still get facts wrong, and have no live data (prices, scores, news). The prompt tells the model to say so instead of guessing.
- Voice input uses the browser's speech recognition. It works in Chrome and Edge, and is not available in every browser or inside sandboxed previews.
- Spoken output quality depends on the voices installed on the device.

## Credits

Cloudflare Workers and Workers AI (Meta Llama 3.3 70B and 3.1 8B Instruct), and the browser Web Speech API.
