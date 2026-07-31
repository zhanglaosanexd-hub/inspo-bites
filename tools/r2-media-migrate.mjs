#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = path.resolve(new URL("..", import.meta.url).pathname);
const ITEMS_PATH = path.join(ROOT_DIR, "data", "items.json");
const MEDIA_CONFIG_PATH = path.join(ROOT_DIR, "data", "media-config.js");
const MEDIA_MAP_PATH = path.join(ROOT_DIR, "data", "media-map.json");

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v", ".webm"]);
const UPLOADABLE_REMOTE_HOSTS = new Set(["www.yuque.com", "cdn.nlark.com"]);

const args = new Set(process.argv.slice(2));
const shouldUpload = args.has("--upload");
const shouldWriteConfig = args.has("--write-config");
const includeRemote = !args.has("--local-only");
const publicBaseUrl = normalizeBaseUrl(readArg("--base-url") || process.env.R2_PUBLIC_BASE_URL || process.env.MEDIA_BASE_URL);

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  const items = await readItems();
  const mediaEntries = await collectMediaEntries(items);

  if (!mediaEntries.length) {
    console.log("No media entries found.");
    return;
  }

  const credentials = readR2Credentials();
  const urlMap = {};

  console.log(`${shouldUpload ? "Uploading" : "Planning"} ${mediaEntries.length} media files`);
  console.log(`Public base URL: ${publicBaseUrl || "(not configured)"}`);
  console.log("");

  for (const [index, entry] of mediaEntries.entries()) {
    const publicUrl = publicBaseUrl ? `${publicBaseUrl}/${entry.key}` : "";
    const label = `${String(index + 1).padStart(3, "0")}/${mediaEntries.length}`;
    console.log(`${label} ${entry.source} -> ${entry.key}`);

    if (publicUrl) urlMap[entry.source] = publicUrl;

    if (!shouldUpload) continue;
    if (!credentials) {
      throw new Error("Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
    }

    const file = await loadEntryBytes(entry);
    await putR2Object({
      credentials,
      key: entry.key,
      body: file.body,
      contentType: entry.contentType,
    });
  }

  if (shouldWriteConfig) {
    await writeFile(MEDIA_MAP_PATH, `${JSON.stringify(urlMap, null, 2)}\n`);
    await writeFile(
      MEDIA_CONFIG_PATH,
      [
        `window.INSPO_MEDIA_BASE_URL = ${JSON.stringify(publicBaseUrl || "")};`,
        `window.INSPO_MEDIA_URL_MAP = ${JSON.stringify(urlMap, null, 2)};`,
        "",
      ].join("\n"),
    );
    console.log("");
    console.log(`Wrote ${path.relative(ROOT_DIR, MEDIA_MAP_PATH)}`);
    console.log(`Wrote ${path.relative(ROOT_DIR, MEDIA_CONFIG_PATH)}`);
  }

  if (!shouldUpload) {
    console.log("");
    console.log("Dry run only. Add --upload to upload files to R2.");
  }
}

async function readItems() {
  const raw = await readFile(ITEMS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.items || [];
}

async function collectMediaEntries(items) {
  const candidates = new Map();

  for (const item of items) {
    addCandidate(candidates, item.cover);
    addCandidate(candidates, item.video);
    addCandidate(candidates, item.avatar);
    addCandidate(candidates, item.appIcon);

    if (Array.isArray(item.materials)) {
      for (const material of item.materials) {
        addCandidate(candidates, typeof material === "string" ? material : material?.file);
      }
    }
  }

  const entries = [];
  for (const source of candidates.keys()) {
    const entry = await createMediaEntry(source);
    if (entry) entries.push(entry);
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function addCandidate(candidates, value) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || !isMediaUrl(source)) return;
  candidates.set(source, true);
}

async function createMediaEntry(source) {
  const localAssetPath = normalizeLocalAssetPath(source);
  if (localAssetPath) {
    const absolutePath = path.join(ROOT_DIR, localAssetPath);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) return null;
    } catch {
      return null;
    }

    return {
      source,
      key: localAssetPath,
      localPath: absolutePath,
      contentType: inferContentType(localAssetPath),
    };
  }

  if (!includeRemote || !isUploadableRemoteUrl(source)) return null;

  return {
    source,
    key: createRemoteKey(source),
    remoteUrl: source,
    contentType: inferContentType(source),
  };
}

function isMediaUrl(value) {
  const lower = value.split("?")[0].toLowerCase();
  const extension = path.extname(lower);
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}

function isUploadableRemoteUrl(value) {
  try {
    const url = new URL(value);
    return UPLOADABLE_REMOTE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function normalizeLocalAssetPath(value) {
  if (value.startsWith("./assets/")) return value.slice(2);
  if (value.startsWith("/assets/")) return value.slice(1);
  if (value.startsWith("assets/")) return value;
  return "";
}

function createRemoteKey(source) {
  const url = new URL(source);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const basename = sanitizeFilename(path.basename(url.pathname) || `${hash}.bin`);
  return `yuque/${hash}-${basename}`;
}

function sanitizeFilename(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function loadEntryBytes(entry) {
  if (entry.localPath) {
    return { body: await readFile(entry.localPath) };
  }

  const response = await fetch(entry.remoteUrl, {
    headers: { "User-Agent": "Inspo.design R2 media migrator" },
  });
  if (!response.ok) throw new Error(`Failed to download ${entry.remoteUrl}: ${response.status}`);

  return { body: Buffer.from(await response.arrayBuffer()) };
}

function inferContentType(value) {
  const extension = path.extname(value.split("?")[0]).toLowerCase();
  const types = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webm": "video/webm",
    ".webp": "image/webp",
  };
  return types[extension] || "application/octet-stream";
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function normalizeBaseUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function readR2Credentials() {
  const credentials = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  };

  return Object.values(credentials).every(Boolean) ? credentials : null;
}

async function putR2Object({ credentials, key, body, contentType }) {
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const pathname = `/${credentials.bucket}/${encodedKey}`;
  const endpoint = `https://${host}${pathname}`;
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = [
    "cache-control:public, max-age=31536000, immutable",
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const signedHeaders = "cache-control;content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(getSigningKey(credentials.secretAccessKey, dateStamp), stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`R2 upload failed for ${key}: ${response.status} ${text}`);
  }
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getSigningKey(secretAccessKey, dateStamp) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
