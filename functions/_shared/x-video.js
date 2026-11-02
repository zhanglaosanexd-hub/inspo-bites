export function getXVideoPath(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return "";
    const post = url.pathname.match(/\/status\/(\d{15,22})(?:\/|$)/)?.[1];
    if (!post) return "";
    const clip = Math.max(0, Number(url.pathname.match(/\/video\/(\d+)/)?.[1] || 1) - 1);
    return `/api/video?post=${post}&clip=${Math.min(clip, 3)}&quality=original`;
  } catch {
    return "";
  }
}
