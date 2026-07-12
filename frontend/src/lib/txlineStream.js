// Authenticated SSE client for TxLINE's /api/scores/stream and
// /api/odds/stream, ported line-for-line from the official guide at
// https://txline.txodds.com/documentation/examples/streaming-data
//
// Why not `new EventSource(url)`: the browser's built-in EventSource cannot
// send custom headers, and TxLINE's data endpoints require both
// `Authorization: Bearer <jwt>` and `X-Api-Token: <apiToken>`. The documented
// workaround — and the one used here — is `fetch()` + manual parsing of the
// `text/event-stream` body via a ReadableStream reader.

/** @typedef {{ id?: string, event?: string, data: string, retry?: number }} SseMessage */

function parseSseBlock(block) {
  const message = { data: "" };

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;

    const separatorIndex = rawLine.indexOf(":");
    const field =
      separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value =
      separatorIndex === -1
        ? ""
        : rawLine.slice(separatorIndex + 1).replace(/^ /, "");

    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }

  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

/** @returns {AsyncGenerator<SseMessage>} */
async function* readSseMessages(response) {
  if (!response.body) throw new Error("Stream response has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);

        const message = parseSseBlock(block);
        if (message) yield message;

        separator = buffer.match(/\r?\n\r?\n/);
      }
    }

    buffer += decoder.decode();
    const message = parseSseBlock(buffer);
    if (message) yield message;
  } finally {
    reader.releaseLock();
  }
}

function parseSseData(data) {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Opens one of TxLINE's authenticated SSE endpoints and yields parsed
 * messages until `signal` aborts or the connection drops.
 *
 * @param {"scores"|"odds"} kind
 * @param {{ apiOrigin: string, jwt: string, apiToken: string, signal?: AbortSignal }} opts
 * @returns {AsyncGenerator<{ event: string, data: any }>}
 */
export async function* openTxlineStream(
  kind,
  { apiOrigin, jwt, apiToken, signal },
) {
  // Both the Vite dev-server proxy (vite.config.js) and this production
  // path exist for the exact same reason: TxLINE's streaming endpoints
  // don't send Access-Control-Allow-Origin, so a direct cross-origin fetch
  // from the browser fails with a CORS error no matter what. Dev routes
  // through Vite's own server (same-origin to localhost); production
  // routes through /api/txline-stream/*, a Vercel Edge Function that makes
  // the actual cross-origin request server-side instead, then streams the
  // response back same-origin. See frontend/api/txline-stream/[...path].js.
  const streamUrl = import.meta.env.DEV
    ? `/txline-stream/${kind}/stream`
    : `/api/txline-stream/${kind}/stream`;
  const response = await fetch(streamUrl, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": apiToken,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Stream failed: ${response.status}`);
  }

  for await (const message of readSseMessages(response)) {
    yield {
      event: message.event ?? "message",
      data: parseSseData(message.data),
    };
  }
}

export const streamScores = (opts) => openTxlineStream("scores", opts);
export const streamOdds = (opts) => openTxlineStream("odds", opts);

export { parseSseBlock, readSseMessages, parseSseData };
