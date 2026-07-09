import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4174);
const HOST = "127.0.0.1";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/admin/content" && request.method === "GET") {
      await sendJson(response, await readContent());
      return;
    }

    if (url.pathname === "/api/admin/content" && request.method === "POST") {
      const body = await readJsonBody(request);
      await writeJsonFile(["data", "items.json"], { items: Array.isArray(body.items) ? body.items : [] });
      await writeJsonFile(["data", "sections.json"], {
        sections: Array.isArray(body.sections) ? body.sections : [],
      });
      await writeStaticContentCache();
      await sendJson(response, { ok: true });
      return;
    }

    if (url.pathname === "/api/admin/upload" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await saveUpload(body);
      await sendJson(response, result);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    const status = error.status || 500;
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message || "Server error" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Inspo Bites local server running at http://${HOST}:${PORT}/`);
});

async function readContent() {
  const [itemsData, sectionsData] = await Promise.all([
    readJsonFile(["data", "items.json"]),
    readJsonFile(["data", "sections.json"]),
  ]);

  return {
    items: Array.isArray(itemsData) ? itemsData : itemsData.items || [],
    sections: Array.isArray(sectionsData) ? sectionsData : sectionsData.sections || [],
  };
}

async function writeStaticContentCache() {
  const content = await readContent();
  await writeFile(safePath(["data", "content.js"]), `window.INSPO_STATIC_DATA = ${JSON.stringify(content, null, 2)};\n`);
}

async function saveUpload(body) {
  const name = sanitizeFilename(body?.name || "upload");
  const base64 = body?.base64 || "";
  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length) throw httpError(400, "上传文件为空。");
  if (buffer.length > MAX_MEDIA_BYTES) throw httpError(413, `${name} 超过 10MB，暂时不能上传。`);

  const uploadsDir = safePath(["assets", "uploads"]);
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${Date.now()}-${name}`;
  const filePath = path.join(uploadsDir, filename);
  await writeFile(filePath, buffer);

  return { ok: true, path: `./assets/uploads/${filename}` };
}

async function serveStatic(pathname, response) {
  const segments = decodeURIComponent(pathname)
    .split("/")
    .filter(Boolean);
  let filePath = safePath(segments);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw httpError(404, "Not found");
  }

  if (fileStat.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    fileStat = await stat(filePath);
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-length": fileStat.size,
    "content-type": mimeTypes.get(extension) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

async function readJsonFile(segments) {
  return JSON.parse(await readFile(safePath(segments), "utf8"));
}

async function writeJsonFile(segments, data) {
  await writeFile(safePath(segments), `${JSON.stringify(data, null, 2)}\n`);
}

function safePath(segments) {
  const resolved = path.resolve(ROOT, ...segments);
  if (!resolved.startsWith(ROOT)) throw httpError(400, "Invalid path");
  return resolved;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function sendJson(response, data) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sanitizeFilename(name) {
  return String(name)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
