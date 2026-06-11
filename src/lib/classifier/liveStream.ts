// Live streaming client for the EU AI Act Compliance Engine.
//
// Calls the server-side proxy at /api/classify, which uses the runtime
// LOVABLE_API_KEY secret to talk to the Lovable AI Gateway. No API key
// ever reaches the browser.

export type StreamParams = {
  signalsRules: string;
  description: string;
  signal?: AbortSignal;
  onChunk: (textDelta: string) => void;
};

export async function streamLive(opts: StreamParams): Promise<void> {
  const searchParams = typeof window !== 'undefined' ? window.location.search : '';
  const res = await fetch(`/api/classify${searchParams}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      signalsRules: opts.signalsRules,
      description: opts.description,
    }),
  });

  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(`Classifier ${res.status}: ${detail}`);
  }

  await readSse(res.body, opts.onChunk);
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        buf = line + "\n" + buf;
        break;
      }
      const text = json?.choices?.[0]?.delta?.content ?? "";
      if (text) onChunk(text);
    }
  }
}
