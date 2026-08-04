const ALLOWED_IMAGE_HOSTS = new Set(["cdn.nlark.com"]);
const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const CACHE_SECONDS = 30 * 24 * 60 * 60;

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return text("Method not allowed", 405, "no-store");

  const requestUrl = new URL(request.url);
  const source = requestUrl.searchParams.get("url") || "";
  const mediaUrl = parseAllowedImageUrl(source);
  if (!mediaUrl) return text("Unsupported media URL", 400, "no-store");

  const upstream = await fetch(mediaUrl.toString(), {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Inspo.design Media Proxy",
    },
    cf: {
      cacheEverything: true,
      cacheTtl: CACHE_SECONDS,
    },
  });

  if (!upstream.ok) return text("Media unavailable", upstream.status, "no-store");

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}, immutable`);
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/jpeg");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, { status: 200, headers });
}

function parseAllowedImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_IMAGE_HOSTS.has(url.hostname)) return null;
    if (!url.pathname.startsWith("/yuque/")) return null;
    if (!ALLOWED_IMAGE_EXTENSIONS.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function text(body, status, cacheControl) {
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheControl,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
