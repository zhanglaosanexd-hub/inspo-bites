import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { onRequest } from "../functions/api/video.js";
import { getXVideoPath } from "../functions/_shared/x-video.js";

class Element {
  constructor() { this.dataset = {}; this.attributes = new Map(); this.events = new Map(); this.hidden = false; this.isConnected = true; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(fn); }
  removeEventListener(name, fn) { this.events.get(name)?.delete(fn); }
  emit(name) { for (const fn of [...(this.events.get(name) || [])]) fn(); }
  set src(value) { this.setAttribute("src", value); }
  get src() { return this.getAttribute("src"); }
}
const timers = new Map(); let timerId = 0;
const schedule = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
const clear = (id) => timers.delete(id);
const advance = (ms) => { for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); } };
const observers = [];
class Observer {
  constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}
const gallery = new Element(); gallery.videos = []; gallery.images = [];
gallery.querySelectorAll = (selector) => selector.startsWith("video") ? gallery.videos : gallery.images;
const context = {
  window: { matchMedia: () => ({ matches: false }), IntersectionObserver: Observer, setTimeout: schedule, clearTimeout: clear },
  document: { hidden: false, baseURI: "https://site.test/", querySelector: (selector) => selector === "#gallery" ? gallery : null },
  navigator: {}, IntersectionObserver: Observer, Intl, URL, AbortController, console, setTimeout: schedule, clearTimeout: clear,
};
vm.createContext(context);
for (const file of ["data/inspiration-media.js", "data/media-config.js", "data/app-recap-index.js"]) {
  vm.runInContext(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), context);
}
const script = (await readFile(new URL("../script.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "").replace(/init\(\)\.catch\(\(error\) => \{[\s\S]*$/, "");
vm.runInContext(script, context);
const run = (code) => vm.runInContext(code, context);
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function video(posterReady = true) {
  const poster = new Element(); poster.complete = posterReady; poster.naturalWidth = posterReady ? 100 : 0; poster.src = "/cover.webp";
  const fallback = new Element(); fallback.hidden = true;
  const classes = new Set();
  const container = { querySelector: (selector) => selector.startsWith("img") ? poster : fallback, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const media = new Element(); Object.assign(media, { parentElement: container, paused: true, readyState: 0, currentTime: 0, loads: 0, plays: 0 });
  media.dataset.videoPath = "/preview.mp4";
  media.load = () => { media.loads++; media.readyState = 1; };
  media.pause = () => { media.paused = true; };
  media.play = () => { media.plays++; media.paused = false; return Promise.resolve(); };
  return { media, poster, classes };
}
const sample = video(); gallery.videos = [sample.media];
run("bindVideoFallbacks(gallery)");
assert.equal(sample.media.src, null, "Offscreen videos must not request data");
observers.at(-1).callback([{ target: sample.media, isIntersecting: true }]); await tick();
assert.equal(sample.media.loads, 1);
assert.equal(sample.media.paused, false, "Metadata-only Safari state must still request play()");
assert.equal(sample.media.muted, true); assert.equal(sample.media.playsInline, true);
sample.media.currentTime = 3;
observers.at(-1).callback([{ target: sample.media, isIntersecting: false }]);
assert.equal(sample.media.paused, true);
observers.at(-1).callback([{ target: sample.media, isIntersecting: true }]); await tick();
assert.equal(sample.media.loads, 1); assert.equal(sample.media.currentTime, 3);
run("galleryPlaybackSuspended=true; refreshMediaPlayback()"); assert.equal(sample.media.paused, true);
run("galleryPlaybackSuspended=false; refreshMediaPlayback()"); await tick(); assert.equal(sample.media.paused, false);
context.document.hidden = true; run("refreshMediaPlayback()"); assert.equal(sample.media.paused, true);
context.document.hidden = false; run("refreshMediaPlayback()"); await tick();
sample.media.emit("error"); advance(750); await tick(); assert.equal(sample.media.loads, 2);
run("releaseVideoMedia(gallery)");
assert.equal(sample.media.src, null); assert.equal(run("mediaPlaybackHandlers.size"), 0);
const released = sample.media.loads; advance(10000); assert.equal(sample.media.loads, released);

const slowPoster = video(false); gallery.videos = [slowPoster.media]; run("bindVideoFallbacks(gallery)");
observers.at(-1).callback([{ target: slowPoster.media, isIntersecting: true }]);
assert.equal(slowPoster.media.src, null); advance(400); await tick(); assert.equal(slowPoster.media.paused, false);
run("releaseVideoMedia(gallery)");
const deferred = new Element(); deferred.complete = true; deferred.naturalWidth = 0; deferred.dataset.mediaPath = "/deferred.webp";
deferred.parentElement = { querySelector: () => null }; gallery.images = [deferred]; gallery.videos = [];
run("bindImageFallbacks(gallery); bindGalleryImageLoading()");
assert.equal(deferred.hidden, false); assert.equal(deferred.src, null);
observers.at(-1).callback([{ target: deferred, isIntersecting: true }]); assert.equal(deferred.src, "/deferred.webp");

for (const source of ["https://x.com/author/status/2104157692747206787/video/2", "https://twitter.com/author/status/2104157692747206787", "https://evil.test/status/2104157692747206787"]) {
  context.source = source; assert.equal(run("getXVideoPath(source)"), getXVideoPath(source));
}
assert.match(run('normalizeItemMedia({video:"https://www.yuque.com/attachments/yuque/new.mp4",url:"https://x.com/author/status/2104157692747206787"}).video'), /^\/api\/video\?/);
assert.match(run('getPreviewVideoUrl({video:"./assets/inspiration-video-cache/55-x-preview.mp4"})'), /inspiration-previews\/55-/);

let metadataCalls = 0; let finish;
context.fetch = async () => { metadataCalls++; return new Promise((resolve) => { finish = resolve; }); };
context.item = { id: "test-recap", materialsUrl: "./data/app-recap-details/test.json" };
const p1 = run("fetchAppRecapMaterials(item)"); const p2 = run("fetchAppRecapMaterials(item)");
assert.equal(p1, p2); assert.equal(metadataCalls, 1);
finish({ ok: true, json: async () => ({ materials: [{ file: "./assets/page.webp", kind: "image" }] }) });
await p1; await run("fetchAppRecapMaterials(item)"); assert.equal(metadataCalls, 1);
context.product = { id: "test-product", title: "Test App", appRecapReports: [
  { ...context.item, appYear: 2025 },
  { id: "test-recap-2024", appYear: 2024, materials: [{ file: "./assets/older.webp", kind: "image" }] },
] };
const productPromise = run("fetchAppRecapMaterials(product)");
assert.equal(productPromise, run("fetchAppRecapMaterials(product)"));
const productMaterials = await productPromise;
assert.equal(productMaterials.length, 2); assert.equal(productMaterials[1].reportYear, "2024");
assert.equal(metadataCalls, 1, "Product modal must reuse per-report data without duplicate requests");

const localCache = new Map();
context.window.localStorage = { getItem: (key) => localCache.get(key), setItem: (key, value) => localCache.set(key, value) };
context.collection = { sections: [], items: { items: [{ id: "local", section: "inspiration" }] } };
context.remote = { sections: [], items: [{ id: "remote", section: "inspiration" }], replaceSections: [] };
run("writeCachedRemoteCollectionData(remote)");
let remoteCalls = 0;
context.fetch = async () => { remoteCalls++; return { ok: true, json: async () => context.remote }; };
await run("loadRemoteCollectionData(collection)");
assert.equal(remoteCalls, 0, "Fresh CMS data must be reused across page visits");
run("window.localStorage.setItem(REMOTE_CONTENT_CACHE_KEY, JSON.stringify({cachedAt: Date.now()-61000, data: remote}))");
await run("loadRemoteCollectionData(collection)");
assert.equal(remoteCalls, 1, "Expired CMS metadata must refresh in the background");

const realFetch = globalThis.fetch; const realCaches = globalThis.caches;
const saved = new Map(); let sourceMetadataCalls = 0; const mediaUrls = [];
globalThis.caches = { default: { match: async (key) => saved.get(key.url)?.clone(), put: async (key, response) => { saved.set(key.url, response); } } };
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("https://api.fxtwitter.com/")) {
    sourceMetadataCalls++;
    return Response.json({ tweet: { media: { videos: [{ formats: [
      { container: "mp4", bitrate: 256000, url: "https://video.twimg.com/low.mp4" },
      { container: "mp4", bitrate: 832000, url: "https://video.twimg.com/preview.mp4" },
      { container: "mp4", bitrate: 2176000, url: "https://video.twimg.com/original.mp4" },
      { container: "mp4", bitrate: 9999999, url: "https://evil.test/private.mp4" },
    ] }] } } });
  }
  mediaUrls.push(String(url));
  return new Response(options.method === "HEAD" ? null : "0123456789abcdef", { status: options.headers.has("Range") ? 206 : 200, headers: { "Content-Length": "16", "Content-Range": "bytes 0-15/1000" } });
};
try {
  assert.equal((await onRequest({ request: new Request("https://site.test/api/video?post=bad") })).status, 400);
  const first = await onRequest({ request: new Request("https://site.test/api/video?post=2104157692747206787&quality=preview", { headers: { Range: "bytes=0-15" } }) });
  assert.equal(first.status, 206); assert.equal(first.headers.get("Content-Range"), "bytes 0-15/1000");
  assert.equal(await first.text(), "0123456789abcdef"); assert.equal(mediaUrls.at(-1), "https://video.twimg.com/preview.mp4");
  const second = await onRequest({ request: new Request("https://site.test/api/video?post=2104157692747206787&quality=original", { method: "HEAD" }) });
  assert.equal(second.headers.get("X-Inspo-Metadata-Cache"), "HIT");
  assert.equal(mediaUrls.at(-1), "https://video.twimg.com/original.mp4"); assert.equal(sourceMetadataCalls, 1);
  saved.set("https://site.test/__video_metadata/2104157692747206787", new Response("invalid JSON"));
  const recovered = await onRequest({ request: new Request("https://site.test/api/video?post=2104157692747206787", { method: "HEAD" }) });
  assert.equal(recovered.status, 200); assert.equal(sourceMetadataCalls, 2);
} finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; }
console.log("PASS: viewport playback, Safari metadata state, pause/resume, hidden-page/modal suspension, slow posters, retry/cleanup, deferred covers, legacy URLs, shared recap metadata and safe cached video range proxy");
