const metadataRequests = new Map();

export async function onRequest({ request, waitUntil }) {
  if (!["GET", "HEAD"].includes(request.method)) return failure("Method not allowed", 405);
  const url = new URL(request.url);
  const post = url.searchParams.get("post") || "";
  const clip = Number(url.searchParams.get("clip") || 0);
  if (!/^\d{15,22}$/.test(post) || !Number.isInteger(clip) || clip < 0 || clip > 3) return failure("Invalid video", 400);
  try {
    const cache = globalThis.caches?.default;
    const key = new Request(new URL(`/__video_metadata/${post}`, request.url));
    let cached = null;
    let metadata = null;
    try {
      cached = await cache?.match(key);
      metadata = cached ? await cached.json() : null;
    } catch {
      cached = null;
    }
    if (!metadata) {
      let pending = metadataRequests.get(post);
      if (!pending) {
        pending = fetch(`https://api.fxtwitter.com/status/${post}`, {
          headers: { Accept: "application/json", "User-Agent": "Inspo.design Media" },
          signal: AbortSignal.timeout(10000),
        }).then(async (response) => {
          if (!response.ok) throw new Error("Video metadata unavailable");
          return response.json();
        }).finally(() => metadataRequests.delete(post));
        metadataRequests.set(post, pending);
      }
      metadata = await pending;
      if (cache) {
        const save = cache.put(key, new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } })).catch(() => {});
        if (typeof waitUntil === "function") waitUntil(save);
        else await save;
      }
    }
    const formats = (metadata.tweet?.media?.videos?.[clip]?.formats || [])
      .filter((format) => {
        try {
          const source = new URL(format.url);
          return format.container === "mp4" && source.protocol === "https:" && source.hostname === "video.twimg.com" && !source.port && /\.mp4$/i.test(source.pathname);
        } catch { return false; }
      })
      .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
    const source = url.searchParams.get("quality") === "original"
      ? formats.at(-1)
      : formats.filter((format) => Number(format.bitrate) <= 1000000).at(-1) || formats[0];
    if (!source) return failure("Public video unavailable", 404);
    const headers = new Headers({ "User-Agent": "Inspo.design Media" });
    if (request.headers.has("Range")) headers.set("Range", request.headers.get("Range"));
    const upstream = await fetch(source.url, {
      method: request.method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      cf: { cacheEverything: true, cacheTtl: 30 * 24 * 60 * 60 },
    });
    if (!upstream.ok) return failure("Video unavailable", upstream.status);
    const output = new Headers({
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=86400",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "X-Inspo-Metadata-Cache": cached ? "HIT" : "MISS",
    });
    for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
      if (upstream.headers.has(name)) output.set(name, upstream.headers.get(name));
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: output });
  } catch {
    return failure("Video temporarily unavailable", 502);
  }
}

function failure(message, status) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}
