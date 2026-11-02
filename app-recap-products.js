const PRODUCT_ALIASES = new Map([
  ["滴滴", "滴滴出行"],
  ["携程旅行", "携程旅游"],
  ["somno", "元气睡眠"],
  ["新浪", "微博"],
]);

const wallStates = new WeakMap();

function cleanName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** A stable display name shared by the icon wall and the App screenshot modal. */
export function getRecapProductName(item) {
  const name = cleanName(typeof item === "string"
    ? item
    : item?.productName || item?.title || item?.author);
  return PRODUCT_ALIASES.get(name.toLowerCase()) || name;
}

/** Product identity does not include the year, so reports from different years stay together. */
export function getRecapProductKey(item) {
  return getRecapProductName(item).toLowerCase();
}

function getReportYear(item) {
  const year = String(item?.appYear || item?.dateAdded || "").match(/\b(20\d{2})\b/);
  return year ? Number(year[1]) : 0;
}

function getImageCount(item) {
  const count = Number(item?.imageCount);
  if (Number.isFinite(count) && count >= 0) return Math.floor(count);
  return Array.isArray(item?.materials) ? item.materials.length : 0;
}

function getIconSource(value) {
  const source = typeof value === "string" ? value : value?.icon || value?.src || value?.url;
  if (typeof source !== "string") return "";
  const trimmed = source.trim();
  if (!trimmed || /^(?:javascript|vbscript):/i.test(trimmed)) return "";
  return trimmed;
}

/**
 * Group lightweight report records without fetching any screenshot details.
 * `records` selects the reports in each product; `iconItems` may contain all years
 * so a filtered year can reuse the newest real App icon. Explicit icons win.
 */
export function groupAppRecapProducts(records, { icons = {}, iconItems = records } = {}) {
  const iconLookup = new Map();
  for (const [name, value] of icons instanceof Map ? icons : Object.entries(icons || {})) {
    const source = getIconSource(value);
    if (source) iconLookup.set(getRecapProductKey(name), source);
  }

  const reportIcons = new Map();
  const candidates = (Array.isArray(iconItems) ? iconItems : [])
    .filter((item) => item && typeof item === "object")
    .slice().sort((a, b) => getReportYear(b) - getReportYear(a));
  for (const item of candidates) {
    const key = getRecapProductKey(item);
    const icon = getIconSource(item.appIcon);
    if (key && icon && !reportIcons.has(key)) reportIcons.set(key, icon);
  }

  const groups = new Map();
  for (const item of Array.isArray(records) ? records : []) {
    if (!item || typeof item !== "object") continue;
    const key = getRecapProductKey(item);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: getRecapProductName(item),
        icon: iconLookup.get(key) || reportIcons.get(key) || "",
        reports: [],
        imageCount: 0,
      });
    }
    const group = groups.get(key);
    group.reports.push(item);
    group.imageCount += getImageCount(item);
  }

  return Array.from(groups.values()).map((group) => {
    group.reports.sort((a, b) => getReportYear(b) - getReportYear(a));
    return group;
  }).sort((a, b) => getReportYear(b.reports[0]) - getReportYear(a.reports[0]));
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createPager(doc, direction) {
  const button = element(doc, "button", "app-icon-page", direction < 0 ? "←" : "→");
  button.type = "button";
  button.setAttribute("aria-label", direction < 0 ? "查看上一页 App" : "查看下一页 App");
  return button;
}

function createProductButton(doc, product, products, onOpen, index) {
  const button = element(doc, "button", "app-icon-button");
  button.type = "button";
  button.dataset.appIconIndex = String(index);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-label", `查看${product.name}的全部年度回顾截图，共 ${product.imageCount} 张`);
  button.title = `${product.name} · ${product.imageCount} 张截图`;

  const icon = element(doc, "span", "app-icon-picture");
  const fallback = element(doc, "span", "app-icon-fallback", product.name);
  fallback.setAttribute("aria-hidden", "true");
  icon.append(fallback);
  if (product.icon) {
    const image = doc.createElement("img");
    image.width = 56;
    image.height = 56;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      image.remove();
      icon.classList.add("has-icon-error");
    }, { once: true });
    image.src = product.icon;
    icon.append(image);
  }

  const name = element(doc, "span", "app-icon-name", product.name);
  button.append(icon, name);
  button.addEventListener("click", () => {
    if (typeof onOpen === "function") onOpen(product, products);
  });
  return button;
}

/**
 * Render a two-row, manually scrollable App shortcut wall. The owner provides
 * the modal callback; no report manifest or screenshot is loaded by this module.
 */
export function renderAppIconWall(container, {
  records = [], iconItems = records, icons = {}, onOpen, hidden = false,
} = {}) {
  if (!container) return [];
  const previous = wallStates.get(container);
  const previousScroll = previous?.viewport?.scrollLeft || previous?.scrollLeft || 0;
  previous?.cleanup?.();
  container.classList.add("app-icon-wall");
  container.hidden = Boolean(hidden);

  if (hidden) {
    wallStates.set(container, { keys: previous?.keys || "", scrollLeft: previousScroll });
    return [];
  }

  const products = groupAppRecapProducts(records, { icons, iconItems });
  const keys = JSON.stringify(products.map((product) => product.key));
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  container.replaceChildren();
  container.setAttribute("aria-label", "按 App 浏览年度回顾");

  if (!products.length) {
    container.hidden = true;
    wallStates.set(container, { keys, scrollLeft: 0 });
    return products;
  }

  const header = element(doc, "div", "app-icon-header");
  const heading = element(doc, "div", "app-icon-heading");
  heading.append(
    element(doc, "h2", "app-icon-title", "按 App 浏览"),
    element(doc, "span", "app-icon-total", `${products.length} 个 App`),
  );
  const controls = element(doc, "div", "app-icon-pages");
  const previousPage = createPager(doc, -1);
  const nextPage = createPager(doc, 1);
  controls.append(previousPage, nextPage);
  header.append(heading, controls);

  const viewport = element(doc, "div", "app-icon-viewport");
  const grid = element(doc, "div", "app-icon-grid");
  products.forEach((product, index) => {
    grid.append(createProductButton(doc, product, products, onOpen, index));
  });
  viewport.append(grid);
  container.append(header, viewport);

  const updateControls = () => {
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    previousPage.disabled = viewport.scrollLeft <= 1;
    nextPage.disabled = viewport.scrollLeft >= maximum - 1;
    controls.hidden = maximum <= 1;
  };
  const page = (direction) => {
    const reducedMotion = win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({
      left: direction * Math.max(80, viewport.clientWidth * 0.85),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };
  previousPage.addEventListener("click", () => page(-1));
  nextPage.addEventListener("click", () => page(1));
  viewport.addEventListener("scroll", updateControls, { passive: true });
  viewport.addEventListener("keydown", (event) => {
    const button = event.target.closest?.(".app-icon-button");
    if (!button || !viewport.contains(button)) return;
    const index = Number(button.dataset.appIconIndex);
    let target = index;
    if (event.key === "ArrowLeft") target = Math.max(0, index - 2);
    else if (event.key === "ArrowRight") target = Math.min(products.length - 1, index + 2);
    else if (event.key === "ArrowUp" && index % 2 === 1) target = index - 1;
    else if (event.key === "ArrowDown" && index % 2 === 0) target = Math.min(products.length - 1, index + 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = products.length - 1;
    else if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const targetButton = grid.children[target];
    targetButton.focus({ preventScroll: true });
    targetButton.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  let observer;
  if (win?.ResizeObserver) {
    observer = new win.ResizeObserver(updateControls);
    observer.observe(viewport);
  } else {
    win?.addEventListener("resize", updateControls);
  }
  viewport.scrollLeft = previous?.keys === keys ? previousScroll : 0;
  updateControls();
  wallStates.set(container, {
    keys,
    viewport,
    cleanup() {
      observer?.disconnect();
      win?.removeEventListener("resize", updateControls);
    },
  });
  return products;
}
