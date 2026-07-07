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
const detailTitle = document.querySelector("#detail-title");
const detailSection = document.querySelector("#detail-section");
const detailAuthor = document.querySelector("#detail-author");
const detailDescription = document.querySelector("#detail-description");
const detailMeta = document.querySelector("#detail-meta");
const detailTags = document.querySelector("#detail-tags");
const detailSourceLink = document.querySelector("#detail-source-link");
const clickSparkCanvas = document.querySelector("#click-spark-canvas");

const formatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const NEW_WINDOW_MS = 36 * 60 * 60 * 1000;
const GALLERY_GAP = 14;
const GALLERY_MIN_CARD_WIDTH = 286;
const GALLERY_MAX_CARD_WIDTH = 430;

async function init() {
  const [sectionsResponse, itemsResponse] = await Promise.all([
    fetch("./data/sections.json"),
    fetch("./data/items.json"),
  ]);
  const sectionsData = await sectionsResponse.json();
  const itemsData = await itemsResponse.json();

  sectionList = normalizeSections(sectionsData);
  sections = Object.fromEntries(sectionList.map((section) => [section.id, section]));
  items = normalizeItems(itemsData);
  state.section = sections[state.section]?.id || sectionList[0]?.id || "";

  setOnlineCount();
  renderSidebar();
  bindEvents();
  initClickSpark();
  render();
}

function normalizeSections(data) {
  const source = Array.isArray(data) ? data : data.sections || [];
  return source
    .filter((section) => section.id)
    .map((section) => ({
      ...section,
      label: section.label || section.eyebrow || section.title || section.id,
      title: section.title || section.label || section.id,
      eyebrow: section.eyebrow || section.label || "Collection",
      description: section.description || "",
      filters: normalizeList(section.filters, ["All"]),
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
    resizeFrame = requestAnimationFrame(renderGallery);
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
  document.querySelector("#detail-prev").addEventListener("click", () => moveDetail(-1));
  document.querySelector("#detail-next").addEventListener("click", () => moveDetail(1));
  detailViewer.addEventListener("click", (event) => {
    if (event.target === detailViewer) closeDetail();
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

  renderFilters(section.filters.length ? section.filters : ["All"]);
  renderGallery();
}

function renderFilters(filters) {
  filterStrip.innerHTML = filters
    .map(
      (filter) => `
        <button class="filter-chip ${filter === state.filter ? "is-active" : ""}" type="button" data-filter="${filter}">
          ${filter}
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
  itemCount.textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`;

  const recentDate = getRecentDate(items.filter((item) => item.section === state.section));
  if (recentDate) {
    lastUpdated.textContent = `Last updated ${formatter.format(recentDate)}`;
    sidebarUpdated.textContent = formatter.format(recentDate);
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
  const visible = items.filter((item) => {
    const tags = normalizeList(item.tags);
    const inSection = item.section === state.section;
    const inFilter = state.filter === "All" || tags.includes(state.filter);
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
  const media = createMediaMarkup(item);
  const itemUrl = escapeHtml(item.url || "");
  const itemTitle = escapeHtml(item.title || "Untitled");
  const newBadge = isNewItem(item) ? `<span class="new-badge" aria-label="New item">NEW</span>` : "";
  const externalAction = item.url
    ? `
        <a
          class="card-action"
          href="${itemUrl}"
          target="_blank"
          rel="noreferrer"
          aria-label="Open ${itemTitle} original link"
        ></a>
      `
    : "";

  return `
    <article class="work-card is-${item.size || "standard"}">
      <div class="media-frame">
        <button class="media-link" type="button" data-detail-id="${escapeHtml(item.id)}" aria-label="View ${itemTitle} details">
          ${media}
        </button>
        ${newBadge}
        ${externalAction}
      </div>
    </article>
  `;
}

function createMediaMarkup(item) {
  const itemTitle = escapeHtml(item.title || "Untitled");

  if (item.motionCover) return createMotionCover(item);
  if (item.video) {
    const poster = item.cover ? ` poster="${item.cover}"` : "";
    return `
      <video muted autoplay loop playsinline preload="metadata"${poster} data-video-path="${item.video}">
        <source src="${item.video}" type="video/mp4" />
      </video>
      <span class="media-missing" hidden>
        <strong>Video file needed</strong>
        <small>${item.video.replace("./assets/", "assets/")}</small>
      </span>
    `;
  }

  if (item.cover) return `<img src="${escapeHtml(item.cover)}" alt="${itemTitle}" loading="lazy" />`;

  return `
    <span class="media-missing">
      <strong>Media needed</strong>
      <small>Add a cover or video in /admin</small>
    </span>
  `;
}

function openDetail(itemId) {
  const nextIndex = visibleItems.findIndex((item) => item.id === itemId);
  if (nextIndex < 0) return;

  activeDetailIndex = nextIndex;
  renderDetail();
  detailViewer.hidden = false;
  document.body.classList.add("detail-open");
  document.querySelector("#detail-close").focus();
}

function closeDetail() {
  detailViewer.hidden = true;
  document.body.classList.remove("detail-open");
}

function moveDetail(direction) {
  if (!visibleItems.length) return;
  activeDetailIndex = (activeDetailIndex + direction + visibleItems.length) % visibleItems.length;
  renderDetail();
}

function renderDetail() {
  const item = visibleItems[activeDetailIndex];
  if (!item) return;

  detailSection.textContent = sections[item.section]?.title || "Design";
  detailTitle.textContent = item.title;
  detailAuthor.innerHTML = createAuthorMarkup(item);
  bindAuthorAvatar(detailAuthor);
  detailDescription.textContent = item.longDescription || item.description;
  detailPreview.innerHTML = createMediaMarkup(item);
  bindVideoFallbacks(detailPreview);
  detailSourceLink.hidden = !item.url;
  detailSourceLink.href = item.url || "#";
  detailTags.innerHTML = normalizeList(item.tags)
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");
  detailMeta.innerHTML = getDetailRows(item)
    .map(
      ([label, value]) => `
        <div class="detail-meta-row">
          <dt>${label}</dt>
          <dd>${value}</dd>
        </div>
      `,
    )
    .join("");
}

function createAuthorMarkup(item) {
  const authorName = escapeHtml(item.author || item.source);
  const avatarUrl = item.avatar || getXAvatarUrl(item.url);

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
    ["Style", normalizeList(item.tags).filter((tag) => tag !== "X").join(", ")],
    ["Added", formatter.format(new Date(item.dateAdded))],
  ];
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
}

function renderUniformGrid(filtered) {
  gallery.className = "gallery is-uniform";
  const galleryMetrics = getGalleryMetrics();
  const columnCount = Math.min(galleryMetrics.columnCount, Math.max(filtered.length, 1));
  gallery.style.setProperty("--gallery-columns", columnCount);
  gallery.style.maxWidth = `${getGalleryMaxWidth(columnCount)}px`;
  gallery.innerHTML = filtered.map((item) => createCard(item)).join("");
  bindVideoFallbacks(gallery);
}

function renderSingleColumn(filtered) {
  gallery.className = "gallery is-single";
  gallery.style.setProperty("--gallery-columns", 1);
  gallery.style.maxWidth = filtered.length ? "min(100%, 960px)" : "";
  gallery.innerHTML = filtered.map((item) => createCard(item)).join("");
  bindVideoFallbacks(gallery);
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

function getGalleryMetrics() {
  const container = gallery.parentElement;
  const width = container?.clientWidth || window.innerWidth;
  const maxColumnsForMinWidth = Math.max(
    1,
    Math.floor((width + GALLERY_GAP) / (GALLERY_MIN_CARD_WIDTH + GALLERY_GAP)),
  );
  const minColumnsForMaxWidth = Math.max(
    1,
    Math.ceil((width + GALLERY_GAP) / (GALLERY_MAX_CARD_WIDTH + GALLERY_GAP)),
  );
  const columnCount = Math.min(maxColumnsForMinWidth, minColumnsForMaxWidth);
  const cardWidth = (width - Math.max(columnCount - 1, 0) * GALLERY_GAP) / columnCount;

  return {
    columnCount,
    cardWidth,
    width,
  };
}

function getGalleryMaxWidth(columnCount) {
  return columnCount * GALLERY_MAX_CARD_WIDTH + Math.max(columnCount - 1, 0) * GALLERY_GAP;
}

function getCardEstimate(item) {
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
    .map((item) => new Date(item.dateAdded))
    .sort((a, b) => b - a)[0];
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

function setOnlineCount() {
  const seed = new Date().getDate() + new Date().getHours();
  document.querySelector("#online-count").textContent = 18 + (seed % 27);
}

init().catch((error) => {
  gallery.innerHTML = `
    <section class="empty-state">
      <h2>Could not load collection</h2>
      <p>${error.message}</p>
    </section>
  `;
});
