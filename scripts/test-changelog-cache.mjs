import assert from "node:assert/strict";
import test from "node:test";
import { onRequest, parseChangelogText } from "../functions/api/changelog.js";
import { CHANGELOG_SNAPSHOT } from "../functions/_shared/changelog-snapshot.js";

const origin = "https://inspo-design.pages.dev";
const key = `${origin}/api/changelog`;
const release = (version, updatedAt = "2026.11.02") => ({ version, updatedAt, changes: [`Release ${version}`] });
const documentResponse = (latest) => new Response(JSON.stringify({ data: {
  body: `## V ${latest.version}\n更新时间：${latest.updatedAt}\n${latest.changes.map((line) => `- ${line}`).join("\n")}`,
} }), { headers: { "Content-Type": "application/json" } });

async function fixture(run) {
  const original = { fetch: globalThis.fetch, caches: globalThis.caches, now: Date.now, setTimeout: globalThis.setTimeout };
  const entries = new Map();
  let now = Date.parse("2026-11-02T08:00:00Z");
  let calls = 0;
  let upstream = async () => documentResponse(CHANGELOG_SNAPSHOT);
  const pending = [];
  const cache = {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response.clone()); },
  };
  Date.now = () => now;
  globalThis.caches = { default: cache };
  globalThis.fetch = async (...args) => { calls += 1; return upstream(...args); };
  const request = (query = "", options = {}) => onRequest({
    request: new Request(`${key}${query}`, { method: options.method || "GET" }),
    env: {},
    ...(options.background ? { waitUntil: (promise) => pending.push(promise) } : {}),
  });
  const seed = (latest, extras = {}) => entries.set(key, new Response(JSON.stringify({
    latest, source: "yuque", checkedAt: now - 61000, retryAt: 0,
    fetchedAt: "2026-11-02T07:58:00.000Z", ...extras,
  })));
  try {
    await run({ request, seed, cache, entries, pending,
      calls: () => calls, advance: (ms) => { now += ms; },
      upstream: (callback) => { upstream = callback; },
      flush: async () => { await Promise.all(pending.splice(0)); },
    });
  } finally {
    Object.assign(globalThis, { fetch: original.fetch, caches: original.caches, setTimeout: original.setTimeout });
    Date.now = original.now;
  }
}

test("cold 429 returns the published seven-item snapshot and shares query-independent cache", async () => fixture(async (f) => {
  f.upstream(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } }));
  const first = await f.request("?v=visitor-a");
  assert.equal(first.status, 200);
  assert.deepEqual((await first.json()).latest, CHANGELOG_SNAPSHOT);
  assert.equal(CHANGELOG_SNAPSHOT.changes.length, 7);
  await f.request("?v=visitor-b&other=1");
  assert.equal(f.calls(), 1);
  assert.deepEqual([...f.entries.keys()], [key]);
  assert.match(f.entries.get(key).headers.get("Cache-Control"), /max-age=2592000/);
}));

test("healthy cache refreshes after 60 seconds and stale data returns before background fetch", async () => fixture(async (f) => {
  f.upstream(async () => documentResponse(release("1.02")));
  assert.equal((await (await f.request("?v=1")).json()).latest.version, "1.02");
  f.advance(59000);
  await f.request("?v=2");
  assert.equal(f.calls(), 1);
  f.advance(2000);
  let complete;
  f.upstream(() => new Promise((resolve) => { complete = resolve; }));
  const stale = await f.request("?v=3", { background: true });
  assert.equal((await stale.json()).latest.version, "1.02");
  assert.equal(f.calls(), 2);
  complete(documentResponse(release("1.03")));
  await f.flush();
  assert.equal((await (await f.request("?v=4")).json()).latest.version, "1.03");
}));

test("newer cached releases survive older Yuque results", async () => fixture(async (f) => {
  f.seed(release("1.03"));
  f.upstream(async () => documentResponse(release("1.00", "2026.08.13")));
  assert.equal((await (await f.request()).json()).latest.version, "1.03");
  assert.equal((await f.entries.get(key).clone().json()).latest.version, "1.03");
}));

test("a cold old remote result or old cached release cannot downgrade bundled 1.01", async () => fixture(async (f) => {
  f.upstream(async () => documentResponse(release("1.00", "2026.08.13")));
  assert.deepEqual((await (await f.request()).json()).latest, CHANGELOG_SNAPSHOT);
  f.seed(release("1.00", "2026.08.13"));
  assert.deepEqual((await (await f.request()).json()).latest, CHANGELOG_SNAPSHOT);
}));

test("same-version responses with an older date do not replace the published entry", async () => fixture(async (f) => {
  f.upstream(async () => documentResponse(release("1.01", "2026.08.13")));
  assert.deepEqual((await (await f.request()).json()).latest, CHANGELOG_SNAPSHOT);
}));

test("a newer cache written during fetch wins over a slow older response", async () => fixture(async (f) => {
  f.upstream(async () => {
    f.seed(release("1.04"), { checkedAt: Date.now() });
    return documentResponse(release("1.02"));
  });
  assert.equal((await (await f.request()).json()).latest.version, "1.04");
  assert.equal((await f.entries.get(key).clone().json()).latest.version, "1.04");
}));

test("429 backoff respects seconds and resumes after expiry", async () => fixture(async (f) => {
  f.upstream(async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }));
  await f.request();
  f.advance(61000);
  await f.request("?v=next-minute");
  assert.equal(f.calls(), 1);
  f.advance(60000);
  f.upstream(async () => documentResponse(release("1.02")));
  assert.equal((await (await f.request()).json()).latest.version, "1.02");
  assert.equal(f.calls(), 2);
}));

test("date Retry-After is capped at five minutes instead of disabling updates indefinitely", async () => fixture(async (f) => {
  f.upstream(async () => new Response("", { status: 429, headers: { "Retry-After": "Tue, 03 Nov 2026 08:00:00 GMT" } }));
  await f.request();
  f.advance(299000);
  await f.request();
  assert.equal(f.calls(), 1);
  f.advance(2000);
  await f.request();
  assert.equal(f.calls(), 2);
}));

test("an outage preserves the last success, then recovery replaces it", async () => fixture(async (f) => {
  f.seed(release("1.02"));
  f.upstream(async () => { throw new Error("network unavailable"); });
  assert.equal((await (await f.request()).json()).latest.version, "1.02");
  f.advance(31000);
  f.upstream(async () => documentResponse(release("1.03")));
  assert.equal((await (await f.request()).json()).latest.version, "1.03");
}));

test("timeout aborts after four seconds and returns valid fallback", async () => fixture(async (f) => {
  const actualTimeout = globalThis.setTimeout;
  let timeoutMs;
  globalThis.setTimeout = (callback, ms, ...args) => {
    timeoutMs = ms;
    return actualTimeout(callback, 1, ...args);
  };
  f.upstream((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  assert.deepEqual((await (await f.request()).json()).latest, CHANGELOG_SNAPSHOT);
  assert.equal(timeoutMs, 4000);
}));

test("overlapping visitors share one in-flight Yuque fetch", async () => fixture(async (f) => {
  let complete;
  f.upstream(() => new Promise((resolve) => { complete = resolve; }));
  const requests = [f.request("?v=one"), f.request("?v=two")];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls(), 1);
  complete(documentResponse(release("1.02")));
  assert.deepEqual(await Promise.all(requests.map(async (response) => (await (await response).json()).latest.version)), ["1.02", "1.02"]);
}));

test("Cache API read/write errors, absent cache, and malformed remote data keep fallback available", async () => fixture(async (f) => {
  globalThis.caches = { default: { match: async () => { throw new Error("cache read"); }, put: async () => { throw new Error("cache write"); } } };
  f.upstream(async () => new Response("not JSON", { status: 200 }));
  assert.deepEqual((await (await f.request()).json()).latest, CHANGELOG_SNAPSHOT);
  delete globalThis.caches;
  assert.deepEqual((await (await f.request()).json()).latest, CHANGELOG_SNAPSHOT);
}));

test("invalid cached JSON is ignored and OPTIONS/unsupported methods never hit Yuque", async () => fixture(async (f) => {
  f.entries.set(key, new Response("invalid JSON"));
  assert.equal((await f.request("", { method: "OPTIONS" })).status, 204);
  assert.equal((await f.request("", { method: "POST" })).status, 405);
  assert.equal(f.calls(), 0);
  assert.equal((await f.request()).status, 200);
}));

test("markdown and HTML logs parse the newest numeric version", () => {
  const latest = parseChangelogText("<h2>V 1.9</h2><p>更新时间：2026.10.01</p><li>Old</li><h2>V 1.10</h2><p>更新时间：2026.11.02</p><li>New</li>");
  assert.deepEqual(latest, { version: "1.10", updatedAt: "2026.11.02", changes: ["New"] });
});
