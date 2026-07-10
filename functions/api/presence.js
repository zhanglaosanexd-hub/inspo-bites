const SESSION_TTL_MS = 45 * 1000;
const sessions = globalThis.__inspoPresenceSessions ?? new Map();

globalThis.__inspoPresenceSessions = sessions;

export async function onRequest({ request }) {
  const now = Date.now();
  pruneSessions(now);

  if (request.method === "POST") {
    const payload = await readJson(request);
    const id = normalizeSessionId(payload?.id);

    if (id) {
      if (payload?.status === "leave") sessions.delete(id);
      else sessions.set(id, now);
    }
  }

  return json({ online: sessions.size });
}

function pruneSessions(now) {
  for (const [id, lastSeen] of sessions) {
    if (now - lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function normalizeSessionId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{8,96}$/.test(id) ? id : "";
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
