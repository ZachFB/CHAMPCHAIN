// Backend indépendant : sert uniquement de proxy server-to-server vers
// TxLINE. Contourne les deux limites qu'on avait avec les Edge Functions
// Vercel : (1) timeouts courts peu adaptés à un stream long, (2) confusion
// possible entre code déployé et code local à cause du cache de build.
//
// Ce serveur tourne en continu (contrairement à une fonction serverless),
// ce qui est exactement ce qu'il faut pour du SSE (Server-Sent Events).
//
// Route:  GET /api/:kind/stream   (kind = "scores" | "odds")
// Proxy:  https://txline-dev.txodds.com/api/:kind/stream

import express from "express";
import cors from "cors";

const app = express();

const TXLINE_ORIGIN = "https://txline-dev.txodds.com";

// Autorise seulement ton frontend déployé (et le dev local) à appeler ce
// backend. Remplace FRONTEND_ORIGIN par l'URL réelle de ton site Vercel.
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_ORIGIN, // ex: https://champchain-n9in-ecru.vercel.app
  "http://localhost:5173",
].filter(Boolean);

app.use(
  cors({
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
  })
);

app.get("/api/:kind/stream", async (req, res) => {
  const { kind } = req.params;

  if (!["scores", "odds"].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'scores' or 'odds'" });
  }

  const upstreamUrl = `${TXLINE_ORIGIN}/api/${kind}/stream${
    req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""
  }`;

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: {
        Authorization: req.headers["authorization"] ?? "",
        "X-Api-Token": req.headers["x-api-token"] ?? "",
        Accept: "text/event-stream",
      },
    });
  } catch (err) {
    console.error(`[txline-proxy] fetch to ${upstreamUrl} failed:`, err);
    return res.status(502).json({ error: "Could not reach TxLINE upstream" });
  }

  // Log utile pendant le hackathon : montre exactement ce que TxLINE
  // répond, visible dans les logs Render en cas de souci (401/403/404...).
  console.log(
    `[txline-proxy] ${kind} -> ${upstream.status} ${upstream.statusText}`
  );

  if (!upstream.ok || !upstream.body) {
    const bodyText = await upstream.text().catch(() => "");
    console.error(`[txline-proxy] upstream error body: ${bodyText.slice(0, 500)}`);
    return res.status(upstream.status).send(bodyText);
  }

  res.writeHead(200, {
    "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Stream la réponse TxLine directement vers le client, chunk par chunk.
  const reader = upstream.body.getReader();
  req.on("close", () => reader.cancel().catch(() => {}));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    console.error(`[txline-proxy] stream error for ${kind}:`, err);
  } finally {
    res.end();
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`txline-proxy backend listening on port ${PORT}`);
});
