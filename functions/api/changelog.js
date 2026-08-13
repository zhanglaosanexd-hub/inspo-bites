const CHANGELOG_SOURCE = {
  repo: "zhanglaosan-bz7nq/gmzg15",
  slug: "ga8hanhedvi0agcg",
  url: "https://www.yuque.com/zhanglaosan-bz7nq/gmzg15/ga8hanhedvi0agcg?singleDoc#",
};

const YUQUE_API_BASE = "https://www.yuque.com/api/v2/repos";
const CACHE_SECONDS = 60;
const STALE_SECONDS = 60 * 60;

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const token = env.YUQUE_TOKEN || env.YUQUE_AUTH_TOKEN || "";

  try {
    const document = await fetchYuqueDocument(token);
    const latest = parseChangelogText(getDocumentBody(document));
    if (!latest) throw new Error("语雀更新日志中未找到有效版本号。");

    return json(
      {
        source: "yuque",
        sourceUrl: CHANGELOG_SOURCE.url,
        fetchedAt: new Date().toISOString(),
        latest,
      },
      200,
      `max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
    );
  } catch (error) {
    return json(
      {
        source: "yuque",
        sourceUrl: CHANGELOG_SOURCE.url,
        fetchedAt: new Date().toISOString(),
        latest: null,
        error: error?.message || "语雀更新日志读取失败。",
      },
      503,
      "no-store",
    );
  }
}

async function fetchYuqueDocument(token) {
  const endpoint = `${YUQUE_API_BASE}/${CHANGELOG_SOURCE.repo}/docs/${CHANGELOG_SOURCE.slug}`;
  const headers = {
    Accept: "application/json",
    "User-Agent": "Inspo.design Changelog",
  };
  if (token) headers["X-Auth-Token"] = token;

  const response = await fetch(endpoint, { headers });
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Yuque returned ${response.status}`);
  }

  return payload.data || payload;
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
