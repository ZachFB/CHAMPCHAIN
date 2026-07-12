// Production equivalent of the Vite dev-server proxy in vite.config.js.
// TxLINE's /api/scores/stream and /api/odds/stream don't send an
// Access-Control-Allow-Origin header, so a direct browser fetch from
// https://champchain.vercel.app to https://txline-dev.txodds.com fails
// with a CORS error — the browser blocks it before any JS ever sees the
// response, regardless of what headers the client sends. Only the server
// can fix that, and it's TxLINE's server, not ours — so this proxies the
// request server-side instead: Vercel's edge function fetches TxLINE (a
// server-to-server request, never subject to browser CORS at all), then
// streams the response back to the browser from OUR OWN origin, which is
// always same-origin and therefore never CORS-blocked.
//
// Route: /api/txline-stream/scores/stream  ->  https://txline-dev.txodds.com/api/scores/stream
// Route: /api/txline-stream/odds/stream    ->  https://txline-dev.txodds.com/api/odds/stream
//
// Must be Edge runtime, not the default Node serverless runtime — Node
// functions buffer the whole response before returning it, which would
// turn a live stream into "wait however long, then get everything at
// once." Edge functions support real streaming Response bodies.
export const config = { runtime: "edge" };

const TXLINE_ORIGIN = "https://txline-dev.txodds.com";

export default async function handler(request) {
  const url = new URL(request.url);
  // Strip the "/api/txline-stream" prefix, keep everything after it
  // (path + query string) exactly as the client sent it.
  const upstreamPath = url.pathname.replace(/^\/api\/txline-stream/, "");
  const upstreamUrl = `${TXLINE_ORIGIN}${upstreamPath}${url.search}`;

  const upstream = await fetch(upstreamUrl, {
    headers: {
      Authorization: request.headers.get("authorization") ?? "",
      "X-Api-Token": request.headers.get("x-api-token") ?? "",
      Accept: "text/event-stream",
    },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache",
      // Same-origin already makes this unnecessary for our own frontend,
      // but harmless to include for anyone testing this endpoint directly.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
