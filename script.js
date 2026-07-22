const state = {
  section: "inspiration",
  filter: "All",
  query: "",
  sort: "recent",
  viewMode: "masonry",
};

let items = [];
let sections = {};
let sectionList = [];
let resizeFrame = 0;
let visibleItems = [];
let activeDetailIndex = 0;
let detailTransitionFrame = 0;
let detailCloseTimer = 0;

const gallery = document.querySelector("#gallery");
const sectionNav = document.querySelector(".section-nav");
const emptyState = document.querySelector("#empty-state");
const filterStrip = document.querySelector("#filter-strip");
const pageTitle = document.querySelector("#page-title");
const pageEyebrow = document.querySelector("#page-eyebrow");
const pageDescription = document.querySelector("#page-description");
const itemCount = document.querySelector("#item-count");
const lastUpdated = document.querySelector("#last-updated");
const sidebarUpdated = document.querySelector("#sidebar-updated");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const viewSwitcher = document.querySelector("#view-switcher");
const detailViewer = document.querySelector("#detail-viewer");
const detailPreview = document.querySelector("#detail-preview");
const detailPrevButton = document.querySelector("#detail-prev");
const detailNextButton = document.querySelector("#detail-next");
const detailTitle = document.querySelector("#detail-title");
const detailSection = document.querySelector("#detail-section");
const detailAuthor = document.querySelector("#detail-author");
const detailDescription = document.querySelector("#detail-description");
const detailMeta = document.querySelector("#detail-meta");
const detailTags = document.querySelector("#detail-tags");
const detailSourceLink = document.querySelector("#detail-source-link");
const clickSparkCanvas = document.querySelector("#click-spark-canvas");
const onlineCount = document.querySelector("#online-count");

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const DETAIL_LABELS = {
  Source: "来源",
  Category: "分类",
  Style: "风格",
  Color: "色彩",
  Interaction: "交互",
  Tool: "工具",
  Medium: "媒介",
  Material: "材质",
  Added: "收录时间",
};
const DETAIL_VALUE_LABELS = {
  Interface: "界面",
  Image: "图片",
  "Floral / Light 3D": "花卉 / 轻 3D",
  "Bright / Soft gradient": "明亮 / 柔和渐变",
  "Looping motion": "循环动效",
  "Skeuomorphic / Hardware": "拟物 / 硬件感",
  "Brand motion": "品牌动效",
  "Ticket / Gold": "票券 / 金色",
  "Dark / Gold": "深色 / 金色",
  "Collectible ticket motion": "收藏票券动效",
  "Reading interaction": "阅读交互",
  "Physical / Skeuomorphic": "真实物理 / 拟物",
  "Paper / Light bleed": "纸张 / 透光",
  "Page turn": "翻页",
  "Ticket / Holographic": "票券 / 镭射",
  "Dark / Iridescent": "深色 / 虹彩",
  "Tear-away ticket motion": "可撕票券动效",
  "Spatial carousel": "空间轮播",
  "Rotating portfolio browse": "旋转式作品浏览",
  Typography: "字体排版",
  "Type motion": "字体动效",
  "Monochrome / Accent": "单色 / 强调色",
  "In / Out transition": "进入 / 退出转场",
};
const FILTER_LABELS = {
  All: "全部",
};
const ONLINE_BASE_COUNT = 13;
const ONLINE_COUNT_ENDPOINT = "/api/presence";
const ONLINE_COUNT_REFRESH_MS = 15 * 1000;
const ONLINE_SESSION_KEY = "inspo-presence-session";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NEW_WINDOW_MS = 36 * 60 * 60 * 1000;
const GALLERY_GAP = 14;
const GALLERY_DEFAULT_COLUMNS = 4;
const GALLERY_MIN_CARD_WIDTH = 260;
const GALLERY_MAX_CARD_WIDTH = 430;
const APP_RECAP_COLUMNS = 5;
const APP_RECAP_MIN_CARD_WIDTH = 150;
const APP_RECAP_MAX_CARD_WIDTH = 300;
const SINGLE_CARD_MAX_WIDTH = 430;
const DETAIL_PREVIEW_MAX_WIDTH = 1060;
const DETAIL_PREVIEW_VERTICAL_GUTTER = 112;
const DETAIL_EXIT_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 360;
const DATA_VERSION = "20260722-yuque-cms";

let onlineCountTimer = 0;

async function init() {
  const collectionData = await loadCollectionData();

  sectionList = normalizeSections(collectionData.sections);
  sections = Object.fromEntries(sectionList.map((section) => [section.id, section]));
  items = normalizeItems(collectionData.items);
  state.section = sections[state.section]?.id || sectionList[0]?.id || "";

  startOnlineCountMonitoring();
  renderSidebar();
  bindEvents();
  initClickSpark();
  render();
}

async function loadCollectionData() {
  const localFallback = window.INSPO_STATIC_DATA;

  if (window.location.protocol === "file:" && localFallback) return localFallback;

  try {
    const [sectionsResponse, itemsResponse] = await Promise.all([
      fetch(`./data/sections.json?v=${DATA_VERSION}`, { cache: "no-store" }),
      fetch(`./data/items.json?v=${DATA_VERSION}`, { cache: "no-store" }),
    ]);

    if (!sectionsResponse.ok || !itemsResponse.ok) {
      throw new Error("内容数据加载失败");
    }

    const localData = {
      sections: await sectionsResponse.json(),
      items: await itemsResponse.json(),
    };

    return await loadRemoteCollectionData(localData);
  } catch (error) {
    if (localFallback) return localFallback;
    throw error;
  }
}

async function loadRemoteCollectionData(localData) {
  try {
    const response = await fetch(`/api/content?v=${DATA_VERSION}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) return localData;

    const remoteData = await response.json();
    const remoteItems = Array.isArray(remoteData.items) ? remoteData.items : [];
    const remoteSections = Array.isArray(remoteData.sections) ? remoteData.sections : [];
    const replaceSections = Array.isArray(remoteData.replaceSections)
      ? remoteData.replaceSections.filter(Boolean)
      : [...new Set(remoteItems.map((item) => item.section).filter(Boolean))];

    if (!remoteItems.length && !remoteSections.length) return localData;

    return mergeCollectionData(localData, {
      sections: remoteSections,
      items: remoteItems,
      replaceSections,
    });
  } catch {
    return localData;
  }
}

function mergeCollectionData(localData, remoteData) {
  const localSections = Array.isArray(localData.sections)
    ? localData.sections
    : localData.sections?.sections || [];
  const localItems = Array.isArray(localData.items) ? localData.items : localData.items?.items || [];
  const remoteSections = Array.isArray(remoteData.sections) ? remoteData.sections : [];
  const remoteItems = Array.isArray(remoteData.items) ? remoteData.items : [];
  const replaceSections = new Set(remoteData.replaceSections || []);
  const sectionMap = new Map(localSections.map((section) => [section.id, section]));

  remoteSections.forEach((section) => {
    if (section.id) sectionMap.set(section.id, { ...sectionMap.get(section.id), ...section });
  });

  const localItemsToKeep = localItems.filter((item) => !replaceSections.has(item.section));
  const itemMap = new Map(localItemsToKeep.map((item) => [item.id, item]));

  remoteItems.forEach((item) => {
    if (item.id) itemMap.set(item.id, item);
  });

  return {
    sections: { sections: Array.from(sectionMap.values()) },
    items: { items: Array.from(itemMap.values()) },
  };
}

function normalizeSections(data) {
  const source = Array.isArray(data) ? data : data.sections || [];
  return source
    .filter((section) => section.id)
    .map((section) => ({
      ...section,
      label: section.label || section.eyebrow || section.title || section.id,
      title: section.title || section.label || section.id,
      eyebrow: section.eyebrow || section.label || "精选内容",
      description: section.description || "",
      filters: normalizeList(section.filters, ["All"]),
      showFilters: section.showFilters !== false,
    }));
}

function normalizeItems(data) {
  const source = Array.isArray(data) ? data : data.items || [];
  return source.map((item) => ({
    ...item,
    createdAt: item.createdAt || dateToCreatedAt(item.dateAdded),
    tags: normalizeList(item.tags),
    details: Array.isArray(item.details) ? item.details : [],
  }));
}

function normalizeList(value, fallback = []) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function bindEvents() {
  sectionNav.addEventListener("click", (event) => {
    const button = event.target.closest(".section-link");
    if (!button) return;

    state.section = button.dataset.section;
    state.filter = "All";
    state.query = "";
    searchInput.value = "";
    render();
  });

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderGallery();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGallery();
  });

  viewSwitcher.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-mode]");
    if (!button) return;

    state.viewMode = button.dataset.viewMode;
    renderGallery();
  });

  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      renderGallery();
      updateDetailPreviewSize();
    });
  });

  gallery.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-detail-id]");
    if (!trigger) return;

    openDetail(trigger.dataset.detailId);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !detailViewer.hidden) closeDetail();
    if (event.key === "ArrowLeft" && !detailViewer.hidden) moveDetail(-1);
    if (event.key === "ArrowRight" && !detailViewer.hidden) moveDetail(1);
  });

  document.querySelector("#detail-close").addEventListener("click", closeDetail);
  detailPrevButton.addEventListener("click", () => moveDetail(-1));
  detailNextButton.addEventListener("click", () => moveDetail(1));
  detailViewer.addEventListener("click", (event) => {
    const clickedContent = event.target.closest(".detail-panel, .detail-preview");
    if (!clickedContent) closeDetail();
  });
}

function initClickSpark() {
  if (!clickSparkCanvas) return;

  const context = clickSparkCanvas.getContext("2d");
  const sparks = [];
  const settings = {
    color: "rgba(23, 23, 23, 0.78)",
    size: 12,
    radius: 18,
    count: 8,
    duration: 420,
    extraScale: 1.15,
  };

  let animationFrame = 0;

  const resize = () => {
    const scale = window.devicePixelRatio || 1;
    clickSparkCanvas.width = Math.ceil(window.innerWidth * scale);
    clickSparkCanvas.height = Math.ceil(window.innerHeight * scale);
    clickSparkCanvas.style.width = `${window.innerWidth}px`;
    clickSparkCanvas.style.height = `${window.innerHeight}px`;
    context.setTransform(scale, 0, 0, scale, 0, 0);
  };

  const draw = (timestamp) => {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];
      const elapsed = timestamp - spark.startTime;

      if (elapsed >= settings.duration) {
        sparks.splice(index, 1);
        continue;
      }

      const progress = elapsed / settings.duration;
      const eased = progress * (2 - progress);
      const distance = eased * settings.radius * settings.extraScale;
      const lineLength = settings.size * (1 - eased);
      const opacity = 1 - eased;
      const startX = spark.x + distance * Math.cos(spark.angle);
      const startY = spark.y + distance * Math.sin(spark.angle);
      const endX = spark.x + (distance + lineLength) * Math.cos(spark.angle);
      const endY = spark.y + (distance + lineLength) * Math.sin(spark.angle);

      context.globalAlpha = opacity;
      context.strokeStyle = settings.color;
      context.lineWidth = 1.7;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
    }

    context.globalAlpha = 1;

    if (sparks.length) {
      animationFrame = requestAnimationFrame(draw);
    } else {
      animationFrame = 0;
    }
  };

  const spawn = (event) => {
    if (event.button && event.button !== 0) return;

    const now = performance.now();
    for (let index = 0; index < settings.count; index += 1) {
      sparks.push({
        x: event.clientX,
        y: event.clientY,
        angle: (Math.PI * 2 * index) / settings.count,
        startTime: now,
      });
    }

    if (!animationFrame) animationFrame = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointerdown", spawn, { passive: true });
}

function renderSidebar() {
  sectionNav.innerHTML = sectionList
    .map(
      (section) => `
        <button class="section-link" type="button" data-section="${escapeHtml(section.id)}">
          <span>${escapeHtml(section.label)}</span>
          <small>${escapeHtml(section.title)}</small>
        </button>
      `,
    )
    .join("");
}

function render() {
  const section = sections[state.section];
  if (!section) return;

  pageTitle.textContent = section.title;
  pageEyebrow.textContent = section.eyebrow;
  pageDescription.textContent = section.description;

  document.querySelectorAll(".section-link").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === state.section);
  });

  const showFilters = section.showFilters !== false;
  filterStrip.hidden = false;
  filterStrip.classList.toggle("is-placeholder", !showFilters);
  filterStrip.setAttribute("aria-hidden", String(!showFilters));
  if (!showFilters) state.filter = "All";

  if (showFilters) {
    renderFilters(section.filters.length ? section.filters : ["All"]);
  } else {
    filterStrip.innerHTML = "";
  }

  renderGallery();
}

function renderFilters(filters) {
  filterStrip.innerHTML = filters
    .map(
      (filter) => `
        <button class="filter-chip ${filter === state.filter ? "is-active" : ""}" type="button" data-filter="${filter}">
          ${escapeHtml(getFilterLabel(filter))}
        </button>
      `,
    )
    .join("");

  filterStrip.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderFilters(sections[state.section].filters);
      renderGallery();
    });
  });
}

function renderGallery() {
  const filtered = getVisibleItems();
  visibleItems = filtered;
  itemCount.textContent = `${filtered.length} 条内容`;

  const recentDate = getRecentDate(items.filter((item) => item.section === state.section));
  if (recentDate) {
    lastUpdated.textContent = formatUpdatedText(recentDate);
  }

  const globalRecentDate = getRecentDate(items);
  if (globalRecentDate) {
    sidebarUpdated.textContent = formatUpdatedText(globalRecentDate);
  }

  renderViewModeControls();
  if (state.viewMode === "single") renderSingleColumn(filtered);
  else if (state.viewMode === "grid") renderUniformGrid(filtered);
  else renderMasonry(filtered);
  emptyState.hidden = filtered.length > 0;
}

function renderViewModeControls() {
  viewSwitcher.querySelectorAll("[data-view-mode]").forEach((button) => {
    const isActive = button.dataset.viewMode === state.viewMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function getVisibleItems() {
  const query = state.query;
  const section = sections[state.section];
  const activeFilter = section?.showFilters === false ? "All" : state.filter;
  const visible = items.filter((item) => {
    const tags = normalizeList(item.tags);
    const inSection = item.section === state.section;
    const inFilter = activeFilter === "All" || tags.includes(activeFilter);
    const haystack =
      `${item.title || ""} ${item.description || ""} ${item.source || ""} ${tags.join(" ")}`.toLowerCase();
    const inQuery = !query || haystack.includes(query);
    return inSection && inFilter && inQuery;
  });

  return visible.sort((a, b) => {
    if (state.sort === "title") return a.title.localeCompare(b.title);
    if (state.sort === "source") return a.source.localeCompare(b.source);
    return new Date(b.dateAdded) - new Date(a.dateAdded);
  });
}

function createCard(item) {
  if (isAppRecapItem(item)) return createAppRecapCard(item);

  const media = createMediaMarkup(item);
  const itemUrl = escapeHtml(item.url || "");
  const itemTitle = escapeHtml(item.title || "未命名内容");
  const newBadge = isNewItem(item) ? `<span class="new-badge" aria-label="新内容">新</span>` : "";
  const externalAction = item.url
    ? `
        <a
          class="card-action"
          href="${itemUrl}"
          target="_blank"
          rel="noreferrer"
          aria-label="打开 ${itemTitle} 的原文链接"
        ></a>
      `
    : "";

  return `
    <article class="work-card is-${item.size || "standard"}">
      <div class="media-frame">
        <button class="media-link" type="button" data-detail-id="${escapeHtml(item.id)}" aria-label="查看 ${itemTitle} 详情">
          ${media}
        </button>
        ${newBadge}
        ${externalAction}
      </div>
    </article>
  `;
}

function createAppRecapCard(item) {
  const itemTitle = escapeHtml(item.title || "未命名内容");
  const category = escapeHtml(item.type || item.tags?.[0] || "其他");
  const icon = escapeHtml(item.appIcon || item.avatar || "");
  const count = Number(item.imageCount || item.materials?.length || 0);
  const cover = escapeHtml(item.cover || "");

  return `
    <article class="work-card app-recap-card is-portrait">
      <div class="media-frame">
        <button class="media-link" type="button" data-detail-id="${escapeHtml(item.id)}" aria-label="查看 ${itemTitle} 详情">
          ${
            cover
              ? `<img class="app-recap-cover" src="${cover}" alt="${itemTitle}" loading="lazy" referrerpolicy="no-referrer" />`
              : createMediaMarkup(item)
          }
        </button>
        <span class="app-recap-type">${category}</span>
        <span class="app-recap-count">${count}张</span>
        ${
          icon
            ? `<span class="app-recap-icon"><img src="${icon}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>`
            : ""
        }
      </div>
    </article>
  `;
}

function createMediaMarkup(item) {
  const itemTitle = escapeHtml(item.title || "未命名内容");

  if (item.motionCover) return createMotionCover(item);
  if (item.video) {
    const poster = item.cover ? ` poster="${item.cover}"` : "";
    return `
      <video muted autoplay loop playsinline preload="metadata"${poster} data-video-path="${item.video}">
        <source src="${item.video}" type="video/mp4" />
      </video>
      <span class="media-missing" hidden>
        <strong>需要视频文件</strong>
        <small>${item.video.replace("./assets/", "assets/")}</small>
      </span>
    `;
  }

  if (item.cover) return `<img src="${escapeHtml(item.cover)}" alt="${itemTitle}" loading="lazy" />`;

  return `
    <span class="media-missing">
      <strong>需要素材</strong>
      <small>在后台补充封面或视频</small>
    </span>
  `;
}

function openDetail(itemId) {
  const nextIndex = visibleItems.findIndex((item) => item.id === itemId);
  if (nextIndex < 0) return;

  clearTimeout(detailCloseTimer);
  cancelAnimationFrame(detailTransitionFrame);
  activeDetailIndex = nextIndex;
  renderDetail();
  detailViewer.hidden = false;
  updateDetailPreviewSize();
  detailViewer.classList.remove("is-open", "is-closing");
  document.body.classList.add("detail-open");
  detailTransitionFrame = requestAnimationFrame(() => {
    detailViewer.classList.add("is-open");
    updateDetailPreviewSize();
  });
  document.querySelector("#detail-close").focus({ preventScroll: true });
}

function closeDetail() {
  if (detailViewer.hidden || detailViewer.classList.contains("is-closing")) return;

  cancelAnimationFrame(detailTransitionFrame);
  detailViewer.classList.remove("is-open");
  detailViewer.classList.add("is-closing");
  clearTimeout(detailCloseTimer);
  detailCloseTimer = setTimeout(() => {
    detailViewer.hidden = true;
    detailViewer.classList.remove("is-closing");
    document.body.classList.remove("detail-open");
    detailPreview.innerHTML = "";
  }, DETAIL_EXIT_MS);
}

function moveDetail(direction) {
  if (!visibleItems.length) return;
  const nextIndex = activeDetailIndex + direction;
  if (nextIndex < 0 || nextIndex >= visibleItems.length) return;

  activeDetailIndex = nextIndex;
  renderDetail();
}

function renderDetail() {
  const item = visibleItems[activeDetailIndex];
  if (!item) return;
  const isAppRecap = isAppRecapItem(item);

  detailViewer.classList.toggle("is-app-recap-detail", isAppRecap);
  detailPreview.classList.toggle("is-app-recap-preview", isAppRecap);
  detailSection.textContent = sections[item.section]?.eyebrow || sections[item.section]?.title || "Design";
  detailTitle.textContent = item.title;
  detailAuthor.innerHTML = createAuthorMarkup(item);
  bindAuthorAvatar(detailAuthor);
  detailDescription.hidden = isAppRecap || !(item.longDescription || item.description);
  detailDescription.textContent = isAppRecap ? "" : item.longDescription || item.description;
  detailPreview.innerHTML = isAppRecap ? createAppRecapDetailMarkup(item) : createMediaMarkup(item);
  bindVideoFallbacks(detailPreview);
  bindAppRecapImageRatios(detailPreview);
  bindDetailPreviewRatio();
  detailSourceLink.hidden = isAppRecap || !item.url;
  detailSourceLink.href = item.url || "#";
  detailTags.hidden = isAppRecap;
  detailTags.innerHTML = isAppRecap
    ? ""
    : normalizeList(item.tags)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
  detailMeta.innerHTML = getDetailRows(item)
    .map(
      ([label, value]) => `
        <div class="detail-meta-row">
          <dt>${escapeHtml(getDetailLabel(label))}</dt>
          <dd>${escapeHtml(getDetailValue(value))}</dd>
        </div>
      `,
    )
    .join("");
  updateDetailNav();
}

function createAppRecapDetailMarkup(item) {
  const materials = normalizeMaterials(item);
  if (!materials.length) return createMediaMarkup(item);

  return `
    <div class="app-recap-strip" aria-label="${escapeHtml(item.title)} 年度回顾截图">
      ${materials
        .map(
          (material, index) => `
            <figure class="app-recap-shot">
              <img
                class="app-recap-shot-image"
                src="${escapeHtml(material.file)}"
                alt="${escapeHtml(`${item.title} 截图 ${index + 1}`)}"
                loading="${index < 3 ? "eager" : "lazy"}"
                fetchpriority="${index < 3 ? "high" : "auto"}"
                referrerpolicy="no-referrer"
              />
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

function updateDetailNav() {
  const hasPrevious = activeDetailIndex > 0;
  const hasNext = activeDetailIndex < visibleItems.length - 1;
  detailPrevButton.disabled = !hasPrevious;
  detailNextButton.disabled = !hasNext;
  detailPrevButton.setAttribute("aria-disabled", String(!hasPrevious));
  detailNextButton.setAttribute("aria-disabled", String(!hasNext));
}

function createAuthorMarkup(item) {
  const authorName = escapeHtml(item.author || item.source);
  const avatarUrl = item.appIcon || item.avatar || getXAvatarUrl(item.url);

  if (!avatarUrl) {
    return `
      <span class="detail-avatar is-fallback" aria-hidden="true">
        <span class="detail-avatar-dot"></span>
      </span>
      <span>${authorName}</span>
    `;
  }

  return `
    <span class="detail-avatar" aria-hidden="true">
      <img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="detail-avatar-dot"></span>
    </span>
    <span>${authorName}</span>
  `;
}

function bindAuthorAvatar(root) {
  const image = root.querySelector(".detail-avatar img");
  if (!image) return;

  image.addEventListener(
    "error",
    () => {
      image.closest(".detail-avatar")?.classList.add("is-fallback");
    },
    { once: true },
  );
}

function isAppRecapItem(item) {
  return item.section === "app-recap" || item.layout === "app-recap";
}

function normalizeMaterials(item) {
  if (!Array.isArray(item.materials)) return [];
  return item.materials
    .map((material) => {
      if (typeof material === "string") return { file: material };
      return material || {};
    })
    .filter((material) => material.file);
}

function getXAvatarUrl(url) {
  if (!url) return "";

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    if (hostname !== "x.com" && hostname !== "twitter.com") return "";

    const handle = parsedUrl.pathname.split("/").filter(Boolean)[0];
    return handle ? `https://unavatar.io/x/${encodeURIComponent(handle)}` : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDetailRows(item) {
  if (item.details?.length) return item.details.map((row) => [row.label, row.value]);

  return [
    ["Source", item.source],
    ["Category", item.type],
    ["Style", normalizeList(item.tags).filter((tag) => tag !== "X" && tag !== "𝕏").join(", ")],
    ["Added", formatter.format(new Date(item.dateAdded))],
  ];
}

function getDetailLabel(label) {
  return DETAIL_LABELS[label] || label;
}

function getDetailValue(value) {
  return DETAIL_VALUE_LABELS[value] || value || "";
}

function getFilterLabel(filter) {
  return FILTER_LABELS[filter] || filter;
}

function renderMasonry(filtered) {
  gallery.className = "gallery is-masonry";
  const galleryMetrics = getGalleryMetrics();
  const columnCount = Math.min(galleryMetrics.columnCount, Math.max(filtered.length, 1));
  const columns = Array.from({ length: columnCount }, () => ({ height: 0, cards: [] }));

  filtered.forEach((item) => {
    const target = columns.reduce((shortest, column) =>
      column.height < shortest.height ? column : shortest,
    );
    target.cards.push(createCard(item));
    target.height += getCardEstimate(item);
  });

  gallery.style.setProperty("--gallery-columns", columnCount);
  gallery.style.maxWidth = `${getGalleryMaxWidth(columnCount)}px`;
  gallery.innerHTML = columns
    .map((column) => `<div class="gallery-column">${column.cards.join("")}</div>`)
    .join("");
  bindVideoFallbacks(gallery);
  bindAppRecapImageRatios(gallery);
}

function renderUniformGrid(filtered) {
  gallery.className = "gallery is-uniform";
  const galleryMetrics = getGalleryMetrics();
  const columnCount = Math.min(galleryMetrics.columnCount, Math.max(filtered.length, 1));
  gallery.style.setProperty("--gallery-columns", columnCount);
  gallery.style.maxWidth = `${getGalleryMaxWidth(columnCount)}px`;
  gallery.innerHTML = filtered.map((item) => createCard(item)).join("");
  bindVideoFallbacks(gallery);
  bindAppRecapImageRatios(gallery);
}

function renderSingleColumn(filtered) {
  gallery.className = "gallery is-single";
  gallery.style.setProperty("--gallery-columns", 1);
  gallery.style.maxWidth = filtered.length ? `${getGalleryMaxWidth(1, SINGLE_CARD_MAX_WIDTH)}px` : "";
  gallery.innerHTML = filtered.map((item) => createCard(item)).join("");
  bindVideoFallbacks(gallery);
  bindAppRecapImageRatios(gallery);
}

function bindVideoFallbacks(root) {
  root.querySelectorAll("video[data-video-path]").forEach((video) => {
    const fallback = video.nextElementSibling;
    const showFallback = () => {
      video.hidden = true;
      if (fallback) fallback.hidden = false;
    };

    video.addEventListener("error", showFallback, { once: true });
    video.querySelector("source")?.addEventListener("error", showFallback, { once: true });
  });
}

function bindAppRecapImageRatios(root) {
  const applyRatio = (image, targetSelector, property) => {
    const target = image.closest(targetSelector);
    if (!target) return;

    const setRatio = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) return;

      target.style.setProperty(property, `${width} / ${height}`);
    };

    image.addEventListener("load", setRatio, { once: true });
    if (image.complete) setRatio();
  };

  root
    .querySelectorAll(".app-recap-cover")
    .forEach((image) => applyRatio(image, ".media-frame", "--card-aspect"));
  root
    .querySelectorAll(".app-recap-shot-image")
    .forEach((image) => applyRatio(image, ".app-recap-shot", "--shot-aspect"));
}

function bindDetailPreviewRatio() {
  if (detailPreview.classList.contains("is-app-recap-preview")) {
    detailPreview.style.removeProperty("--detail-aspect");
    detailPreview.style.width = "100%";
    delete detailPreview.dataset.ratio;
    return;
  }

  const media = detailPreview.querySelector("img, video");

  detailPreview.style.removeProperty("--detail-aspect");
  detailPreview.style.removeProperty("width");
  delete detailPreview.dataset.ratio;

  if (!media) {
    updateDetailPreviewSize();
    return;
  }

  const applyRatio = () => {
    const width = media.videoWidth || media.naturalWidth;
    const height = media.videoHeight || media.naturalHeight;
    if (!width || !height) return;

    detailPreview.dataset.ratio = String(width / height);
    detailPreview.style.setProperty("--detail-aspect", `${width} / ${height}`);
    updateDetailPreviewSize();
  };

  if (media.tagName === "VIDEO") {
    media.addEventListener("loadedmetadata", applyRatio, { once: true });
    if (media.readyState >= 1) applyRatio();
  } else {
    media.addEventListener("load", applyRatio, { once: true });
    if (media.complete) applyRatio();
  }

  updateDetailPreviewSize();
}

function updateDetailPreviewSize() {
  if (detailViewer.hidden || !detailPreview.isConnected) return;
  if (detailPreview.classList.contains("is-app-recap-preview")) {
    detailPreview.style.width = "100%";
    return;
  }

  const stage = detailPreview.closest(".detail-stage");
  const stageRect = stage?.getBoundingClientRect();
  if (!stageRect?.width || !stageRect?.height) return;

  const stageStyle = window.getComputedStyle(stage);
  const horizontalPadding =
    Number.parseFloat(stageStyle.paddingLeft) + Number.parseFloat(stageStyle.paddingRight);
  const verticalPadding =
    Number.parseFloat(stageStyle.paddingTop) + Number.parseFloat(stageStyle.paddingBottom);
  const availableWidth = Math.max(220, stageRect.width - horizontalPadding);
  const availableHeight = Math.max(
    180,
    Math.min(window.innerHeight - DETAIL_PREVIEW_VERTICAL_GUTTER, stageRect.height - verticalPadding),
  );
  const ratio = Number(detailPreview.dataset.ratio) || 16 / 9;
  const minimumWidth = Math.min(220, availableWidth, availableHeight * ratio);
  const width = Math.min(DETAIL_PREVIEW_MAX_WIDTH, availableWidth, availableHeight * ratio);

  detailPreview.style.width = `${Math.max(minimumWidth, width)}px`;
}

function getGalleryMetrics() {
  const galleryConfig = getGalleryConfig();
  const container = gallery.parentElement;
  const width = container?.clientWidth || window.innerWidth;
  const maxColumnsForWidth = Math.max(
    1,
    Math.floor((width + GALLERY_GAP) / (galleryConfig.minCardWidth + GALLERY_GAP)),
  );
  const columnCount = Math.min(galleryConfig.defaultColumns, maxColumnsForWidth);
  const cardWidth = (width - Math.max(columnCount - 1, 0) * GALLERY_GAP) / columnCount;

  return {
    columnCount,
    cardWidth,
    width,
  };
}

function getGalleryMaxWidth(columnCount, maxCardWidth = getGalleryConfig().maxCardWidth) {
  return columnCount * maxCardWidth + Math.max(columnCount - 1, 0) * GALLERY_GAP;
}

function getGalleryConfig() {
  if (state.section === "app-recap") {
    return {
      defaultColumns: APP_RECAP_COLUMNS,
      minCardWidth: APP_RECAP_MIN_CARD_WIDTH,
      maxCardWidth: APP_RECAP_MAX_CARD_WIDTH,
    };
  }

  return {
    defaultColumns: GALLERY_DEFAULT_COLUMNS,
    minCardWidth: GALLERY_MIN_CARD_WIDTH,
    maxCardWidth: GALLERY_MAX_CARD_WIDTH,
  };
}

function getCardEstimate(item) {
  if (isAppRecapItem(item)) return 2.18;

  const sizeEstimate = {
    wide: 0.82,
    square: 1.06,
    tall: 1.42,
    portrait: 1.58,
    standard: 1.18,
  };

  return sizeEstimate[item.size] || sizeEstimate.standard;
}

function createMotionCover(item) {
  if (item.motionCover === "hydrangea") {
    return `
      <div class="motion-cover motion-cover--hydrangea" aria-hidden="true">
        <span class="motion-orbit orbit-a"></span>
        <span class="motion-orbit orbit-b"></span>
        <span class="motion-orbit orbit-c"></span>
        <span class="motion-petal petal-a"></span>
        <span class="motion-petal petal-b"></span>
        <span class="motion-petal petal-c"></span>
        <span class="motion-petal petal-d"></span>
        <span class="motion-core"></span>
        <span class="motion-line line-a"></span>
        <span class="motion-line line-b"></span>
      </div>
    `;
  }

  return `
    <div class="motion-cover motion-cover--ampersand" aria-hidden="true">
      <span class="type-grid"></span>
      <span class="amp amp-back">&amp;</span>
      <span class="amp amp-front">&amp;</span>
      <span class="type-pill pill-in">In</span>
      <span class="type-pill pill-out">Out</span>
      <span class="type-line line-one"></span>
      <span class="type-line line-two"></span>
    </div>
  `;
}

function getRecentDate(sourceItems) {
  if (!sourceItems.length) return null;
  return sourceItems
    .map(getCreatedAt)
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
}

function formatUpdatedText(date) {
  const age = Date.now() - date.getTime();
  if (age >= 0 && age < DAY_MS) {
    const hours = Math.max(1, Math.floor(age / HOUR_MS));
    return `最后更新于 ${hours} 小时前`;
  }

  return `更新于 ${formatter.format(date)}`;
}

function isNewItem(item) {
  const createdAt = getCreatedAt(item);
  if (!createdAt) return false;
  const age = Date.now() - createdAt.getTime();
  return age >= 0 && age <= NEW_WINDOW_MS;
}

function getCreatedAt(item) {
  const value = item.createdAt || dateToCreatedAt(item.dateAdded);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToCreatedAt(value) {
  if (!value) return "";
  if (String(value).includes("T")) return value;
  return `${value}T00:00:00.000Z`;
}

function startOnlineCountMonitoring() {
  renderOnlineCount(0);
  refreshOnlineCount();
  window.addEventListener("pagehide", sendPresenceLeave);
}

async function refreshOnlineCount() {
  let shouldContinue = true;

  try {
    const response = await fetch(ONLINE_COUNT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: getPresenceSessionId() }),
    });

    if (response.status === 404) {
      shouldContinue = false;
      return;
    }

    if (!response.ok) return;

    const payload = await response.json();
    renderOnlineCount(getRealtimeVisitorCount(payload));
  } catch {
    renderOnlineCount(0);
  } finally {
    window.clearTimeout(onlineCountTimer);
    if (shouldContinue) {
      onlineCountTimer = window.setTimeout(refreshOnlineCount, ONLINE_COUNT_REFRESH_MS);
    }
  }
}

function getRealtimeVisitorCount(payload) {
  const value = payload?.online ?? payload?.activeVisitors ?? payload?.count ?? 0;
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function getPresenceSessionId() {
  const existing = window.sessionStorage.getItem(ONLINE_SESSION_KEY);
  if (existing) return existing;

  const nextId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(ONLINE_SESSION_KEY, nextId);
  return nextId;
}

function sendPresenceLeave() {
  const id = window.sessionStorage.getItem(ONLINE_SESSION_KEY);
  if (!id || typeof navigator.sendBeacon !== "function") return;

  const payload = JSON.stringify({ id, status: "leave" });
  navigator.sendBeacon(
    ONLINE_COUNT_ENDPOINT,
    new Blob([payload], { type: "application/json" }),
  );
}

function renderOnlineCount(realtimeVisitors) {
  if (!onlineCount) return;
  onlineCount.textContent = String(ONLINE_BASE_COUNT + realtimeVisitors);
}

init().catch((error) => {
  gallery.innerHTML = `
    <section class="empty-state">
      <h2>Could not load collection</h2>
      <p>${error.message}</p>
    </section>
  `;
});
