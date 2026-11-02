import { CHANGELOG_SNAPSHOT } from "../_shared/changelog-snapshot.js";

const CHANGELOG_SOURCE = {
  repo: "zhanglaosan-bz7nq/gmzg15",
  slug: "ga8hanhedvi0agcg",
  url: "https://www.yuque.com/zhanglaosan-bz7nq/gmzg15/ga8hanhedvi0agcg?singleDoc#",
};

const YUQUE_API_BASE = "https://www.yuque.com/api/v2/repos";
const CACHE_SECONDS = 60;
const SNAPSHOT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 4000;
const ERROR_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 5 * 60;
const refreshes = new Map();

export async function onRequest({ request, env = {}, waitUntil }) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  // The frontend adds a minute bucket, but all visitors share one origin fetch.
  const cacheKey = new Request(new URL("/api/changelog", request.url).toString());
  const edgeCache = globalThis.caches?.default;
  const cached = await readCache(edgeCache, cacheKey);
  const now = Date.now();
  const current = selectState(cached);
  const canUseCache = cached && (cached.retryAt
    ? cached.retryAt > now
    : now - cached.checkedAt < CACHE_SECONDS * 1000);
  if (canUseCache) {
    return changelogResponse(current, true);
  }

  let refresh = refreshes.get(cacheKey.url);
  if (!refresh) {
    refresh = refreshChangelog({ edgeCache, cacheKey, cached: current, env })
      .finally(() => refreshes.delete(cacheKey.url));
    refreshes.set(cacheKey.url, refresh);
  }

  // Keep the last successful release visible while checking Yuque again.
  if (cached && typeof waitUntil === "function") {
    waitUntil(refresh);
    return changelogResponse(current, true);
  }
  return changelogResponse(await refresh);
}

async function refreshChangelog({ edgeCache, cacheKey, cached, env }) {
  let next;
  try {
    const token = env.YUQUE_TOKEN || env.YUQUE_AUTH_TOKEN || "";
    const document = await fetchYuqueDocument(token);
    const latest = parseChangelogText(getDocumentBody(document));
    if (!isValidLatest(latest)) throw new Error("语雀更新日志中未找到完整版本记录。");

    next = selectState({
      latest,
      source: "yuque",
      fetchedAt: new Date().toISOString(),
    }, cached);
    next = { ...next, checkedAt: Date.now(), retryAt: 0 };
  } catch (error) {
    const seconds = error.retryAfterSeconds || ERROR_BACKOFF_SECONDS;
    const checkedAt = Date.now();
    next = { ...cached, checkedAt, retryAt: checkedAt + seconds * 1000 };
  }

  // A slower, older response must not replace a newer release already cached.
  const stored = await readCache(edgeCache, cacheKey);
  const selected = selectState(next, stored);
  next = {
    ...selected,
    checkedAt: Math.max(next.checkedAt, stored?.checkedAt || 0),
    retryAt: next.checkedAt >= (stored?.checkedAt || 0) ? next.retryAt : stored.retryAt,
  };
  if (edgeCache) {
    try {
      await edgeCache.put(cacheKey, json(next, 200, `public, max-age=${SNAPSHOT_RETENTION_SECONDS}`));
    } catch {
      // Cache availability must not make the published release unavailable.
    }
  }
  return next;
}

async function readCache(edgeCache, key) {
  if (!edgeCache) return null;
  try {
    const response = await edgeCache.match(key);
    const state = response ? await response.json() : null;
    return isValidLatest(state?.latest) && Number.isFinite(state.checkedAt) ? state : null;
  } catch {
    return null;
  }
}

function selectState(candidate, baseline = null) {
  let selected = {
    latest: CHANGELOG_SNAPSHOT,
    source: "yuque-fallback",
    fetchedAt: null,
    checkedAt: 0,
    retryAt: 0,
  };
  for (const state of [baseline, candidate]) {
    if (!isValidLatest(state?.latest)) continue;
    const difference = compareVersions(state.latest.version, selected.latest.version);
    if (difference < 0) continue;
    if (difference === 0 && state.latest.updatedAt < selected.latest.updatedAt) continue;
    selected = { ...selected, ...state };
  }
  return selected;
}

function isValidLatest(latest) {
  return latest && /^\d+(?:\.\d+){1,2}$/.test(latest.version)
    && /^20\d{2}\.\d{2}\.\d{2}$/.test(latest.updatedAt)
    && Array.isArray(latest.changes) && latest.changes.length > 0
    && latest.changes.every((change) => typeof change === "string" && change.trim());
}

function changelogResponse(state, fromCache = false) {
  return json({
    source: state.source === "yuque" && fromCache ? "yuque-cache" : state.source,
    sourceUrl: CHANGELOG_SOURCE.url,
    fetchedAt: state.fetchedAt,
    latest: state.latest,
  }, 200, `public, max-age=0, s-maxage=${CACHE_SECONDS}`);
}

async function fetchYuqueDocument(token) {
  const endpoint = `${YUQUE_API_BASE}/${CHANGELOG_SOURCE.repo}/docs/${CHANGELOG_SOURCE.slug}`;
  const headers = {
    Accept: "application/json",
    "User-Agent": "Inspo.design Changelog",
  };
  if (token) headers["X-Auth-Token"] = token;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { headers, signal: controller.signal });
    const text = await response.text();
    let payload = {};

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(`Yuque returned ${response.status}`);
      if (response.status === 429 || response.headers.has("Retry-After")) {
        error.retryAfterSeconds = retryAfterSeconds(response.headers.get("Retry-After"));
      }
      throw error;
    }

    return payload.data || payload;
  } finally {
    clearTimeout(timeout);
  }
}

function retryAfterSeconds(value) {
  const parsed = /^\d+(?:\.\d+)?$/.test(value || "")
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(parsed)
    ? Math.max(5, Math.min(MAX_BACKOFF_SECONDS, parsed))
    : CACHE_SECONDS;
}

function getDocumentBody(document) {
  return [
    document.body,
    document.body_markdown,
    document.body_md,
    document.markdown,
    document.body_html,
    document.html,
    document.raw,
  ].find((value) => typeof value === "string" && value.trim()) || "";
}

export function parseChangelogText(value) {
  const lines = toPlainText(value)
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
  const entries = [];
  let current = null;

  lines.forEach((line) => {
    const versionMatch = line.match(/^v(?:ersion)?\s*([0-9]+(?:\.[0-9]+){1,2})\b/i);
    if (versionMatch) {
      if (current) entries.push(current);
      current = { version: versionMatch[1], updatedAt: "", changes: [] };
      return;
    }

    if (!current) return;

    const dateMatch = line.match(/更新时间\s*[：:]\s*(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (dateMatch) {
      current.updatedAt = `${dateMatch[1]}.${dateMatch[2].padStart(2, "0")}.${dateMatch[3].padStart(2, "0")}`;
      return;
    }

    if (shouldKeepChange(line)) current.changes.push(line);
  });

  if (current) entries.push(current);
  if (!entries.length) return null;

  return entries
    .sort((left, right) => compareVersions(right.version, left.version))[0];
}

function toPlainText(value) {
  return decodeHtml(String(value || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(?:h[1-6]|p|div|li|section|article|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function cleanLine(value) {
  return String(value || "")
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldKeepChange(line) {
  if (!line) return false;
  if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(line)) return false;
  if (/^(?:Inspo\.design\s*)?更新日志$/i.test(line)) return false;
  if (/^(?:更新内容|本次更新|版本更新|更新说明)[：:]?$/i.test(line)) return false;
  if (/^更新时间\s*[：:]/.test(line)) return false;
  if (/^https?:\/\//i.test(line)) return false;
  return true;
}

function compareVersions(left, right) {
  const leftParts = String(left).match(/\d+/g)?.map(Number) || [];
  const rightParts = String(right).match(/\d+/g)?.map(Number) || [];
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function json(payload, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheControl,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
