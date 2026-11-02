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

function createProductButton(doc, product, products, onOpen, index, duplicate = false) {
  // Visual copies are pointer targets; only the original buttons enter the
  // accessibility tree and keyboard order.
  const button = element(doc, duplicate ? "span" : "button", "app-icon-button");
  if (duplicate) {
    button.classList.add("app-icon-copy");
    button.setAttribute("aria-hidden", "true");
  } else {
    button.type = "button";
    button.dataset.appIconOriginal = "true";
  }
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

  button.append(icon);
  button.addEventListener("click", () => {
    if (typeof onOpen === "function") onOpen(product, products);
  });
  return button;
}

/**
 * Render two continuous, opposite-moving icon rows. Reduced-motion and keyboard
 * browsing expose the original icons as ordinary horizontally scrollable rows.
 * The owner provides the modal; no screenshot details are loaded here.
 */
export function renderAppIconWall(container, {
  records = [], iconItems = records, icons = {}, onOpen, hidden = false,
} = {}) {
  if (!container) return [];
  const previous = wallStates.get(container);
  previous?.cleanup?.();
  container.classList.add("app-icon-wall");
  container.classList.remove("is-keyboard-browsing", "is-looping", "is-icon-page-hidden");
  container.hidden = Boolean(hidden);

  if (hidden) {
    wallStates.delete(container);
    return [];
  }

  const products = groupAppRecapProducts(records, { icons, iconItems });
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  container.replaceChildren();
  container.setAttribute("aria-label", "按 App 浏览年度回顾");

  if (!products.length) {
    container.hidden = true;
    wallStates.delete(container);
    return products;
  }

  const header = element(doc, "div", "app-icon-header");
  const heading = element(doc, "div", "app-icon-heading");
  heading.append(
    element(doc, "h2", "app-icon-title", "按 App 浏览"),
    element(doc, "span", "app-icon-total", `${products.length} 个 App`),
  );
  header.append(heading);
  const lanes = element(doc, "div", "app-icon-lanes");
  container.append(header, lanes);
  const originals = new Map();
  const rows = [];

  const revealButton = (button) => {
    if (!button) return;
    container.classList.add("is-keyboard-browsing");
    const row = button.closest(".app-icon-row");
    const bounds = row.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    if (target.left < bounds.left + 4) row.scrollLeft += target.left - bounds.left - 4;
    else if (target.right > bounds.right - 4) row.scrollLeft += target.right - bounds.right + 4;
  };
  const openProduct = (product, collection, duplicate) => {
    if (duplicate) {
      const original = originals.get(product.key);
      revealButton(original);
      original?.focus({ preventScroll: true });
    }
    if (typeof onOpen === "function") onOpen(product, collection);
  };

  for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
    const row = element(doc, "div", `app-icon-row${rowIndex ? " is-reversed" : ""}`);
    const track = element(doc, "div", "app-icon-track");
    const segment = element(doc, "div", "app-icon-segment");
    const copySegment = element(doc, "div", "app-icon-segment app-icon-repeat");
    copySegment.setAttribute("aria-hidden", "true");
    let entries = products.map((product, index) => ({ product, index }))
      .filter(({ index }) => index % 2 === rowIndex);
    const onlyCopies = !entries.length;
    if (onlyCopies) entries = [{ product: products[0], index: 0 }];
    const makeSet = (duplicate) => {
      const set = element(doc, "div", `app-icon-set${duplicate ? " app-icon-repeat" : ""}`);
      if (duplicate) set.setAttribute("aria-hidden", "true");
      entries.forEach(({ product, index }) => {
        const button = createProductButton(doc, product, products,
          (selected, collection) => openProduct(selected, collection, duplicate), index, duplicate);
        if (!duplicate) originals.set(product.key, button);
        set.append(button);
      });
      return set;
    };
    const originalSet = makeSet(onlyCopies);
    segment.append(originalSet);
    track.append(segment, copySegment);
    row.append(track);
    lanes.append(row);
    rows.push({ row, track, segment, copySegment, originalSet, makeSet, repeats: 0 });
  }

  lanes.addEventListener("focusin", (event) => {
    const button = event.target.closest?.("[data-app-icon-original]");
    if (button?.matches(":focus-visible")) revealButton(button);
  });
  lanes.addEventListener("keydown", (event) => {
    const button = event.target.closest?.(".app-icon-button");
    if (!button || !lanes.contains(button)) return;
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
    const targetButton = originals.get(products[target].key);
    revealButton(targetButton);
    targetButton.focus({ preventScroll: true });
  });

  let frame = 0;
  const updateRepeats = () => {
    frame = 0;
    if (container.hidden || !container.isConnected) return;
    rows.forEach((model) => {
      const setWidth = model.originalSet.getBoundingClientRect().width;
      if (!setWidth) return;
      const repeats = Math.max(1, Math.ceil(model.row.clientWidth / setWidth));
      if (repeats !== model.repeats) {
        while (model.segment.children.length > 1) model.segment.lastElementChild.remove();
        model.copySegment.replaceChildren();
        for (let index = 1; index < repeats; index += 1) model.segment.append(model.makeSet(true));
        for (let index = 0; index < repeats; index += 1) model.copySegment.append(model.makeSet(true));
        model.repeats = repeats;
      }
      model.track.style.setProperty("--app-icon-cycle-duration", `${Math.max(20, setWidth * repeats / 24)}s`);
    });
    container.classList.add("is-looping");
  };
  const scheduleResize = () => {
    if (!frame) frame = win.requestAnimationFrame(updateRepeats);
  };
  const resumeAfterFocus = () => {
    if (container.contains(doc.activeElement)) return;
    container.classList.remove("is-keyboard-browsing");
    rows.forEach(({ row }) => { row.scrollLeft = 0; });
  };
  container.addEventListener("focusout", resumeAfterFocus);
  const onVisibility = () => container.classList.toggle("is-icon-page-hidden", doc.hidden);
  doc.addEventListener("visibilitychange", onVisibility);
  onVisibility();
  let observer;
  if (win?.ResizeObserver) {
    observer = new win.ResizeObserver(scheduleResize);
    observer.observe(container);
  } else {
    win?.addEventListener("resize", scheduleResize);
  }
  updateRepeats();
  wallStates.set(container, {
    cleanup() {
      observer?.disconnect();
      win?.cancelAnimationFrame(frame);
      win?.removeEventListener("resize", scheduleResize);
      container.removeEventListener("focusout", resumeAfterFocus);
      doc.removeEventListener("visibilitychange", onVisibility);
      container.classList.remove("is-looping");
    },
  });
  return products;
}
