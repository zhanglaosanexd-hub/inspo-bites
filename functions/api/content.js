const DEFAULT_SOURCES = [
  {
    section: "inspiration",
    repo: "zhanglaosan-bz7nq/gmzg15",
    slug: "wv0ye00q7degi1zp",
    reference: "https://www.yuque.com/zhanglaosan-bz7nq/gmzg15/wv0ye00q7degi1zp?singleDoc#",
  },
  {
    section: "ux-bites",
    repo: "zhanglaosan-bz7nq/blot0b",
    slug: "gknnx9dn7fs4pa3p",
    reference: "https://www.yuque.com/zhanglaosan-bz7nq/blot0b/gknnx9dn7fs4pa3p?singleDoc#",
  },
];

const CACHE_SECONDS = 5 * 60;
const STALE_SECONDS = 24 * 60 * 60;
const YUQUE_API_BASE = "https://www.yuque.com/api/v2/repos";

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, "no-store");

  const token = env.YUQUE_TOKEN || env.YUQUE_AUTH_TOKEN || "";
  const sources = readSources(env);

  if (!token || !sources.length) {
    return json(
      {
        source: "yuque",
        items: [],
        sections: [],
        replaceSections: [],
        fetchedAt: new Date().toISOString(),
        warnings: [!token ? "YUQUE_TOKEN is not configured." : "No Yuque CMS sources configured."],
      },
      200,
      "no-store",
    );
  }

  const results = await Promise.allSettled(
    sources.map(async (source, index) => {
      const doc = await fetchYuqueDoc(source, token);
      const parsed = parseYuqueDocument(source, doc, index);
      return {
        source,
        items: parsed.items,
        sections: parsed.sections,
        shouldReplace: parsed.ok,
        warning: parsed.warning,
      };
    }),
  );

  const items = [];
  const sections = [];
  const replaceSections = new Set();
  const warnings = [];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push(`${sources[index].section}: ${result.reason?.message || "Yuque fetch failed."}`);
      return;
    }

    items.push(...result.value.items);
    sections.push(...result.value.sections);
    if (result.value.shouldReplace) replaceSections.add(result.value.source.section);
    if (result.value.warning) warnings.push(result.value.warning);
  });

  return json(
    {
      source: "yuque",
      items,
      sections,
      replaceSections: Array.from(replaceSections),
      fetchedAt: new Date().toISOString(),
      warnings,
    },
    200,
    `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
  );
}

function readSources(env) {
  const raw = env.YUQUE_CMS_SOURCES || env.YUQUE_SOURCES;
  if (!raw) return DEFAULT_SOURCES;

  try {
    const parsed = JSON.parse(raw);
    const sourceList = Array.isArray(parsed) ? parsed : parsed.sources;
    return sourceList
      .map((source) => ({
        ...source,
        repo: source.repo || normalizeRepo(source.namespace, source.book || source.bookSlug),
        slug: source.slug || source.doc || source.docSlug,
      }))
      .filter((source) => source.section && source.repo && source.slug);
  } catch (error) {
    return DEFAULT_SOURCES;
  }
}

function normalizeRepo(namespace, book) {
  return namespace && book ? `${namespace}/${book}` : "";
}

async function fetchYuqueDoc(source, token) {
  const endpoint = `${YUQUE_API_BASE}/${source.repo}/docs/${source.slug}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Inspo.design CMS",
      "X-Auth-Token": token,
    },
  });

  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload.message || payload.error || `Yuque returned ${response.status}`;
    throw new Error(message);
  }

  return payload.data || payload;
}

function parseYuqueDocument(source, doc, sourceIndex) {
  const body = getDocBody(doc);
  const docTitle = doc.title || source.title || source.slug;
  const docUpdatedAt = doc.updated_at || doc.updatedAt || doc.published_at || doc.created_at;
  const reference = source.reference || `https://www.yuque.com/${source.repo}/${source.slug}`;

  const jsonPayload = parseJsonPayload(body);
  if (jsonPayload) {
    return {
      ok: true,
      items: normalizeJsonItems(jsonPayload.items || jsonPayload, source, doc, reference),
      sections: normalizeJsonSections(jsonPayload.sections),
    };
  }

  const markdown = htmlToMarkdownish(body);
  const blocks = splitIntoBlocks(markdown, docTitle);
  const parsedItems = blocks
    .map((block, index) =>
      normalizeBlockItem(block, {
        source,
        sourceIndex,
        itemIndex: index,
        doc,
        docUpdatedAt,
        reference,
      }),
    )
    .filter(Boolean);

  const fallbackItems = parsedItems.length
    ? []
    : extractMediaUrls(markdown).map((url, index) =>
        normalizeJsonItem(
          {
            title: `${docTitle} ${index + 1}`,
            cover: isVideoUrl(url) ? "" : url,
            video: isVideoUrl(url) ? url : "",
            url: reference,
            dateAdded: dateOnly(docUpdatedAt),
          },
          source,
          doc,
          reference,
          index,
        ),
      );

  const items = parsedItems.length ? parsedItems : fallbackItems;

  return {
    ok: true,
    items,
    sections: [],
    warning: items.length ? "" : `${source.section}: 没有从语雀文档解析到内容。`,
  };
}

function getDocBody(doc) {
  return [
    doc.body,
    doc.body_markdown,
    doc.body_md,
    doc.markdown,
    doc.body_html,
    doc.html,
    doc.raw,
  ].find((value) => typeof value === "string" && value.trim()) || "";
}

function parseJsonPayload(body) {
  const candidates = [];
  const trimmed = stripHtml(body).trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) candidates.push(trimmed);

  for (const match of body.matchAll(/```(?:json|cms|inspo)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) || parsed.items || parsed.sections) return parsed;
    } catch {
      // Ignore non-JSON code blocks.
    }
  }

  return null;
}

function normalizeJsonItems(items, source, doc, reference) {
  const sourceItems = Array.isArray(items) ? items : [];
  return sourceItems
    .map((item, index) => normalizeJsonItem(item, source, doc, reference, index))
    .filter(Boolean);
}

function normalizeJsonSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.filter((section) => section?.id);
}

function normalizeJsonItem(item, source, doc, reference, index = 0) {
  if (!item || typeof item !== "object") return null;

  const title = pick(item, ["title", "name", "标题", "名称"]) || `${doc.title || source.section} ${index + 1}`;
  const section = pick(item, ["section", "tab", "分区", "栏目"]) || source.section;
  const sourceText = normalizeSource(pick(item, ["source", "来源"]) || "");
  const url = pick(item, ["url", "link", "href", "原文", "链接", "地址"]) || reference;
  const type = pick(item, ["type", "category", "分类", "类别", "类型"]) || "";
  const cover = pick(item, ["cover", "image", "poster", "封面", "图片"]) || "";
  const video = pick(item, ["video", "movie", "视频", "动图"]) || "";
  const materials = normalizeMaterialsValue(
    pick(item, ["materials", "assets", "shots", "screenshots", "内容素材", "素材", "截图"]),
  );

  return cleanupItem({
    id: pick(item, ["id", "slug", "唯一ID"]) || slugify(`${section}-${title}-${index}`),
    section,
    title,
    description: pick(item, ["description", "summary", "短描述", "摘要", "描述"]) || "",
    longDescription: pick(item, ["longDescription", "detail", "detailsText", "详情描述", "正文", "详情"]) || "",
    author: pick(item, ["author", "creator", "作者"]) || "",
    avatar: pick(item, ["avatar", "authorAvatar", "作者头像", "头像"]) || "",
    source: sourceText,
    type,
    tags: normalizeTags(pick(item, ["tags", "labels", "标签", "tag"]), type, sourceText, url),
    cover,
    video,
    url,
    dateAdded: dateOnly(pick(item, ["dateAdded", "createdAt", "添加日期", "上传时间"]) || doc.updated_at || doc.created_at),
    createdAt: pick(item, ["createdAt", "uploadedAt", "上传时间"]) || "",
    details: normalizeDetailsValue(item.details || item.detailRows || item.详情字段, item, sourceText, type),
    materials,
    size: pick(item, ["size", "ratio", "卡片比例", "尺寸"]) || "",
    layout: pick(item, ["layout", "布局"]) || "",
    appIcon: pick(item, ["appIcon", "icon", "App图标", "App 图标", "图标"]) || "",
    imageCount: numberOrEmpty(pick(item, ["imageCount", "count", "张数", "图片数"])),
    reference,
  });
}

function normalizeBlockItem(block, context) {
  const fields = extractKeyValues(block.text);
  const media = extractMediaUrls(block.raw);
  const title = fields.title || block.title;
  const firstVideo = fields.video || media.find(isVideoUrl) || "";
  const firstImage = fields.cover || media.find((url) => !isVideoUrl(url)) || "";
  const materials = fields.materials.length
    ? fields.materials
    : media.slice(firstVideo || firstImage ? 1 : 0).map((file) => ({ file }));

  if (!title && !firstVideo && !firstImage) return null;

  return cleanupItem({
    id: fields.id || slugify(`${context.source.section}-${title || context.doc.title}-${context.itemIndex}`),
    section: fields.section || context.source.section,
    title: title || `${context.doc.title || context.source.section} ${context.itemIndex + 1}`,
    description: fields.description || "",
    longDescription: fields.longDescription || block.description,
    author: fields.author || "",
    avatar: fields.avatar || "",
    source: normalizeSource(fields.source || ""),
    type: fields.type || "",
    tags: normalizeTags(fields.tags, fields.type, fields.source, fields.url),
    cover: firstImage,
    video: firstVideo,
    url: fields.url || context.reference,
    dateAdded: fields.dateAdded || dateOnly(context.docUpdatedAt || new Date().toISOString()),
    createdAt: fields.createdAt || "",
    details: fields.details.length ? fields.details : buildDetailRows(fields.source, fields.type, fields.extraDetails),
    materials,
    size: fields.size || inferSize(firstImage, firstVideo, fields.section || context.source.section),
    layout: fields.layout || "",
    appIcon: fields.appIcon || "",
    imageCount: fields.imageCount || (materials.length ? materials.length : ""),
    reference: context.reference,
  });
}

function splitIntoBlocks(markdown, fallbackTitle) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let current = null;

  lines.forEach((line) => {
    const heading = line.match(/^\s{0,3}#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      if (current) blocks.push(current);
      current = { title: cleanText(heading[1]), raw: "", text: "" };
      return;
    }

    if (!current) current = { title: fallbackTitle, raw: "", text: "" };
    current.raw += `${line}\n`;
    current.text += `${stripMarkdown(line)}\n`;
  });

  if (current) blocks.push(current);
  return blocks.filter((block) => block.raw.trim() || block.title);
}

function extractKeyValues(text) {
  const fields = {
    extraDetails: [],
    details: [],
    materials: [],
    tags: [],
  };
  const descriptionLines = [];
  let captureLongDescription = false;

  text.split(/\r?\n/).forEach((line) => {
    const cleanLine = cleanText(line.replace(/^[-*]\s+/, ""));
    if (!cleanLine) {
      if (descriptionLines.length) descriptionLines.push("");
      return;
    }

    const pair = cleanLine.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
    if (!pair) {
      if (captureLongDescription || !looksLikeMedia(cleanLine)) descriptionLines.push(cleanLine);
      return;
    }

    const key = pair[1].trim();
    const value = pair[2].trim();
    const normalizedKey = normalizeKey(key);

    if (normalizedKey === "longDescription") {
      captureLongDescription = true;
      if (value) descriptionLines.push(value);
      return;
    }

    captureLongDescription = false;

    if (normalizedKey.startsWith("detail:")) {
      fields.extraDetails.push({ label: normalizedKey.replace("detail:", ""), value });
      return;
    }

    if (normalizedKey === "materials") {
      fields.materials.push(...normalizeMaterialsValue(value));
      return;
    }

    if (normalizedKey === "tags") {
      fields.tags.push(...normalizeTags(value));
      return;
    }

    if (normalizedKey === "details") {
      fields.details.push(...parseInlineDetails(value));
      return;
    }

    if (normalizedKey) {
      fields[normalizedKey] = value;
      return;
    }

    descriptionLines.push(cleanLine);
  });

  fields.longDescription = fields.longDescription || compactParagraphs(descriptionLines);
  if (!fields.description && fields.longDescription) {
    fields.description = fields.longDescription.split(/\n{2,}/)[0].slice(0, 120);
  }

  fields.details.push(...buildDetailRows(fields.source, fields.type, fields.extraDetails));
  return fields;
}

function normalizeKey(key) {
  const map = {
    id: "id",
    slug: "id",
    title: "title",
    name: "title",
    section: "section",
    tab: "section",
    author: "author",
    avatar: "avatar",
    source: "source",
    url: "url",
    link: "url",
    href: "url",
    type: "type",
    category: "type",
    cover: "cover",
    image: "cover",
    poster: "cover",
    video: "video",
    movie: "video",
    materials: "materials",
    assets: "materials",
    tags: "tags",
    labels: "tags",
    description: "description",
    summary: "description",
    detail: "longDescription",
    details: "details",
    createdat: "createdAt",
    uploadedat: "createdAt",
    dateadded: "dateAdded",
    size: "size",
    ratio: "size",
    layout: "layout",
    appicon: "appIcon",
    icon: "appIcon",
    imagecount: "imageCount",
    count: "imageCount",
    标题: "title",
    名称: "title",
    分区: "section",
    栏目: "section",
    作者: "author",
    头像: "avatar",
    作者头像: "avatar",
    来源: "source",
    原文: "url",
    链接: "url",
    地址: "url",
    分类: "type",
    类别: "type",
    类型: "type",
    封面: "cover",
    图片: "cover",
    视频: "video",
    动图: "video",
    素材: "materials",
    内容素材: "materials",
    标签: "tags",
    短描述: "description",
    摘要: "description",
    描述: "description",
    详情: "longDescription",
    正文: "longDescription",
    详情描述: "longDescription",
    添加日期: "dateAdded",
    收录时间: "dateAdded",
    上传时间: "createdAt",
    尺寸: "size",
    卡片比例: "size",
    布局: "layout",
    图标: "appIcon",
    "app图标": "appIcon",
    "app 图标": "appIcon",
    张数: "imageCount",
    图片数: "imageCount",
    风格: "detail:Style",
    色彩: "detail:Color",
    颜色: "detail:Color",
    交互: "detail:Interaction",
    年份: "detail:年份",
  };

  const normalized = key.toLowerCase().replace(/\s+/g, "");
  return map[key] || map[normalized] || "";
}

function buildDetailRows(source, type, extraDetails = []) {
  const rows = [];
  if (source) rows.push({ label: "Source", value: normalizeSource(source).split("/")[0].trim() });
  if (type) rows.push({ label: "Category", value: type });
  rows.push(...extraDetails);
  return rows;
}

function normalizeDetailsValue(value, item, source, type) {
  const details = [];

  if (Array.isArray(value)) {
    value.forEach((row) => {
      if (Array.isArray(row)) details.push({ label: row[0], value: row[1] });
      else if (row?.label || row?.name) details.push({ label: row.label || row.name, value: row.value || row.text || "" });
    });
  } else if (typeof value === "string") {
    details.push(...parseInlineDetails(value));
  }

  if (!details.length) details.push(...buildDetailRows(source, type));
  return details;
}

function parseInlineDetails(value) {
  return String(value)
    .split(/[;；]\s*/)
    .map((part) => part.match(/^([^:：=]+)[:：=]\s*(.+)$/))
    .filter(Boolean)
    .map((match) => ({ label: cleanText(match[1]), value: cleanText(match[2]) }));
}

function normalizeMaterialsValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((material) => {
        if (typeof material === "string") return { file: material };
        return material?.file || material?.url ? { ...material, file: material.file || material.url } : null;
      })
      .filter(Boolean);
  }

  return String(value)
    .split(/[\n,，]\s*/)
    .map((file) => cleanText(file))
    .filter(Boolean)
    .map((file) => ({ file }));
}

function normalizeTags(value, type = "", source = "", url = "") {
  const tags = [];
  const append = (tag) => {
    const cleanTag = cleanText(tag);
    if (cleanTag && !tags.includes(cleanTag)) tags.push(cleanTag);
  };

  if (Array.isArray(value)) value.forEach(append);
  else if (typeof value === "string") value.split(/[,，、/\s]+/).forEach(append);

  if (type) append(type);
  if (normalizeSource(source).startsWith("𝕏") || isXUrl(url)) append("𝕏");
  return tags;
}

function cleanupItem(item) {
  const next = { ...item };
  next.source = normalizeSource(next.source);
  next.tags = normalizeTags(next.tags, next.type, next.source, next.url);
  next.details = (next.details || []).map((row) => ({
    label: row.label || row.name || "",
    value: normalizeSource(row.value || ""),
  }));
  next.dateAdded = dateOnly(next.dateAdded || new Date().toISOString());

  if (!next.cover && !next.video && next.materials?.length) {
    const first = next.materials[0].file;
    if (isVideoUrl(first)) next.video = first;
    else next.cover = first;
  }

  if (next.section === "ux-bites") {
    next.source = next.source || "流浪笔记";
    next.size = next.size || "tall";
  }

  if (next.section === "app-recap") {
    next.layout = "app-recap";
    next.size = "portrait";
  }

  return next;
}

function pick(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function extractMediaUrls(text) {
  const urls = new Set();
  const patterns = [
    /!\[[^\]]*]\(([^)]+)\)/g,
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<video[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
    /(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|mp4|mov)(?:\?[^\s"'<>]*)?)/gi,
  ];

  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) urls.add(decodeHtml(match[1]).trim());
  });

  return Array.from(urls);
}

function htmlToMarkdownish(value) {
  return decodeHtml(String(value || ""))
    .replace(/<h([1-3])[^>]*>/gi, (_, level) => `\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-3]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ");
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, ""));
}

function stripMarkdown(value) {
  return decodeHtml(String(value || ""))
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactParagraphs(lines) {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeMedia(value) {
  return /\.(png|jpe?g|webp|gif|mp4|mov)(\?|$)/i.test(value);
}

function isVideoUrl(value) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(String(value || ""));
}

function isXUrl(value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    return hostname === "x.com" || hostname === "twitter.com";
  } catch {
    return false;
  }
}

function normalizeSource(value) {
  return cleanText(value)
    .replace(/^X(?=\s|\/|$)/, "𝕏")
    .replace(/^Twitter(?=\s|\/|$)/i, "𝕏");
}

function inferSize(cover, video, section) {
  if (section === "ux-bites") return "tall";
  if (video) return "wide";
  if (cover) return "standard";
  return "standard";
}

function dateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const match = String(value).match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/);
  return match ? match[0].replaceAll("/", "-") : new Date().toISOString().slice(0, 10);
}

function numberOrEmpty(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : "";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
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
