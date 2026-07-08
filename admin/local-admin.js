const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const root = document.querySelector("#local-admin-root");

const state = {
  connected: false,
  items: [],
  sections: [],
  activeTab: "items",
  selectedItem: 0,
  selectedSection: 0,
  status: "正在连接本地后台服务...",
  statusType: "",
};

connect();

async function connect() {
  try {
    await loadData();
  } catch (error) {
    state.connected = false;
    state.status = error.message;
    state.statusType = "error";
    render();
  }
}

function render() {
  if (!state.connected) {
    root.innerHTML = `
      <main class="start-panel">
        <h2>本地后台服务未连接</h2>
        <p>请用本地后台服务打开项目，而不是普通静态服务器。</p>
        <ol>
          <li>我会帮你启动 <strong>local-server.mjs</strong>。</li>
          <li>然后重新打开 <strong>http://127.0.0.1:4174/admin/</strong>。</li>
          <li>后台会直接读取和保存本地文件。</li>
        </ol>
        <button class="admin-button primary" type="button" data-action="reload">重新连接</button>
        <p class="status ${state.statusType}">${escapeHtml(state.status)}</p>
      </main>
    `;
    bindRootEvents();
    return;
  }

  root.innerHTML = `
    <div class="admin-shell">
      <header class="admin-topbar">
        <div class="admin-brand">
          <span class="admin-mark">IB</span>
          <div>
            <h1>Inspo Bites Admin</h1>
            <p>本地编辑模式 / 媒体暂定 10MB 以内</p>
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-button" type="button" data-action="reload">重新读取</button>
          <button class="admin-button primary" type="button" data-action="save-all">保存全部</button>
          <a class="admin-button" href="../" target="_blank" rel="noreferrer">打开前台</a>
        </div>
      </header>

      <div class="admin-layout">
        <aside class="admin-sidebar">
          <div class="tabs">
            <button class="tab-button ${state.activeTab === "items" ? "active" : ""}" type="button" data-action="switch-tab" data-tab="items">内容</button>
            <button class="tab-button ${state.activeTab === "sections" ? "active" : ""}" type="button" data-action="switch-tab" data-tab="sections">Tab</button>
          </div>
          ${renderEntryList()}
        </aside>
        <main class="admin-main">
          ${state.activeTab === "items" ? renderItemEditor() : renderSectionEditor()}
        </main>
      </div>
    </div>
  `;

  bindRootEvents();
}

function renderEntryList() {
  const entries = state.activeTab === "items" ? state.items : state.sections;
  const selected = state.activeTab === "items" ? state.selectedItem : state.selectedSection;
  const addAction = state.activeTab === "items" ? "add-item" : "add-section";

  return `
    <div class="entry-list">
      <button class="admin-button primary" type="button" data-action="${addAction}">
        新增${state.activeTab === "items" ? "内容" : "Tab"}
      </button>
      ${entries
        .map(
          (entry, index) => `
            <button class="entry-button ${index === selected ? "active" : ""}" type="button" data-action="select-entry" data-index="${index}">
              <strong>${escapeHtml(entry.title || entry.label || entry.id || "Untitled")}</strong>
              <span>${escapeHtml(entry.id || "no-id")}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderItemEditor() {
  const item = state.items[state.selectedItem];
  if (!item) {
    return `
      <section>
        <h2>还没有内容</h2>
        <p class="helper">点击左侧“新增内容”创建第一条记录。</p>
      </section>
    `;
  }

  return `
    <form data-form="item">
      <div class="editor-head">
        <div>
          <h2>${escapeHtml(item.title || "Untitled")}</h2>
          <p class="status ${state.statusType}">${escapeHtml(state.status)}</p>
        </div>
        <div class="admin-actions">
          <button class="admin-button danger" type="button" data-action="delete-item">删除</button>
          <button class="admin-button primary" type="submit">保存内容</button>
        </div>
      </div>

      <div class="editor-grid">
        ${field("唯一 ID", "id", item.id)}
        ${field("标题", "title", item.title)}
        ${selectField("所属 Tab", "section", item.section, state.sections)}
        ${field("内容分类", "type", item.type)}
        ${field("作者", "author", item.author)}
        ${field("内容来源", "source", item.source)}
        ${field("原文链接", "url", item.url, "url")}
        ${selectSizeField(item.size)}
        ${dateField("添加日期", "dateAdded", item.dateAdded)}
        ${mediaField("作者头像", "avatar", item.avatar, "image/*")}
        ${mediaField("封面图片", "cover", item.cover, "image/*")}
        ${mediaField("封面视频", "video", item.video, "video/mp4,video/*")}
        ${textareaField("短描述", "description", item.description)}
        ${textareaField("详情描述", "longDescription", item.longDescription)}
        ${textareaField("标签", "tagsText", listToText(item.tags), "一行一个或用逗号分隔，例如 Motion, Graphic, 𝕏")}
        ${textareaField("详情字段", "detailsText", detailsToText(item.details), "每行一个：字段名: 字段值")}
        ${textareaField("内容素材", "materialsText", materialsToText(item.materials), "每行一个：文件路径 | 说明")}
        <div class="field full">
          <label>上传内容素材</label>
          <div class="field-row">
            <input data-material-caption type="text" placeholder="素材说明，可选" />
            <label class="admin-button file-button">
              选择素材
              <input type="file" data-upload-material />
            </label>
          </div>
          <p class="helper">素材会复制到 assets/uploads，限制 10MB 以内。</p>
        </div>
      </div>
    </form>
  `;
}

function renderSectionEditor() {
  const section = state.sections[state.selectedSection];
  if (!section) {
    return `
      <section>
        <h2>还没有 Tab</h2>
        <p class="helper">点击左侧“新增 Tab”创建第一项。</p>
      </section>
    `;
  }

  return `
    <form data-form="section">
      <div class="editor-head">
        <div>
          <h2>${escapeHtml(section.label || section.title || "Untitled")}</h2>
          <p class="status ${state.statusType}">${escapeHtml(state.status)}</p>
        </div>
        <div class="admin-actions">
          <button class="admin-button danger" type="button" data-action="delete-section">删除</button>
          <button class="admin-button primary" type="submit">保存 Tab</button>
        </div>
      </div>

      <div class="editor-grid">
        ${field("唯一 ID", "id", section.id)}
        ${field("左侧英文名", "label", section.label)}
        ${field("左侧中文名 / 页面标题", "title", section.title)}
        ${field("页面 Eyebrow", "eyebrow", section.eyebrow)}
        ${textareaField("页面描述", "description", section.description)}
        ${textareaField("筛选标签", "filtersText", listToText(section.filters), "一行一个或用逗号分隔，建议保留 All")}
      </div>
    </form>
  `;
}

function bindRootEvents() {
  root.onclick = async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;

    if (action === "reload") await loadData();
    if (action === "save-all") await saveAll();
    if (action === "switch-tab") {
      state.activeTab = target.dataset.tab;
      render();
    }
    if (action === "select-entry") {
      selectEntry(Number(target.dataset.index));
      render();
    }
    if (action === "add-item") addItem();
    if (action === "add-section") addSection();
    if (action === "delete-item") deleteItem();
    if (action === "delete-section") deleteSection();
  };

  root.onchange = async (event) => {
    if (event.target.matches("[data-upload-field]")) {
      await uploadToField(event.target.dataset.uploadField, event.target.files?.[0]);
    }

    if (event.target.matches("[data-upload-material]")) {
      const caption = root.querySelector("[data-material-caption]")?.value || "";
      await uploadMaterial(event.target.files?.[0], caption);
    }
  };

  root.onsubmit = async (event) => {
    event.preventDefault();
    if (event.target.matches('[data-form="item"]')) await saveCurrentItem(event.target);
    if (event.target.matches('[data-form="section"]')) await saveCurrentSection(event.target);
  };
}

async function loadData() {
  try {
    const response = await fetch("/api/admin/content");
    if (!response.ok) throw new Error("本地后台服务没有启动。");
    const data = await response.json();
    state.items = normalizeItems(data.items);
    state.sections = normalizeSections(data.sections);
    state.selectedItem = Math.min(state.selectedItem, Math.max(state.items.length - 1, 0));
    state.selectedSection = Math.min(state.selectedSection, Math.max(state.sections.length - 1, 0));
    state.connected = true;
    setStatus("已读取本地内容。", "ok");
    render();
  } catch (error) {
    state.connected = false;
    setStatus(`连接失败：${error.message}`, "error");
    render();
  }
}

async function saveAll() {
  try {
    const response = await fetch("/api/admin/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: state.items, sections: state.sections }),
    });
    if (!response.ok) throw new Error(await getErrorMessage(response));
    setStatus("已保存全部内容。刷新前台即可看到更新。", "ok");
    render();
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "error");
    render();
  }
}

async function saveCurrentItem(form) {
  const item = state.items[state.selectedItem];
  if (!item) return;

  const data = new FormData(form);
  const createdAt = item.createdAt || dateToCreatedAt(item.dateAdded) || new Date().toISOString();
  Object.assign(item, {
    id: cleanId(data.get("id")),
    section: data.get("section") || "",
    title: data.get("title") || "",
    description: data.get("description") || "",
    longDescription: data.get("longDescription") || "",
    author: data.get("author") || "",
    source: data.get("source") || "",
    url: data.get("url") || "",
    type: data.get("type") || "",
    avatar: data.get("avatar") || "",
    cover: data.get("cover") || "",
    video: data.get("video") || "",
    size: data.get("size") || "wide",
    dateAdded: data.get("dateAdded") || today(),
    createdAt,
    tags: textToList(data.get("tagsText")),
    details: textToDetails(data.get("detailsText")),
    materials: textToMaterials(data.get("materialsText")),
  });

  await saveAll();
}

async function saveCurrentSection(form) {
  const section = state.sections[state.selectedSection];
  if (!section) return;

  const data = new FormData(form);
  Object.assign(section, {
    id: cleanId(data.get("id")),
    label: data.get("label") || "",
    title: data.get("title") || "",
    eyebrow: data.get("eyebrow") || "",
    description: data.get("description") || "",
    filters: textToList(data.get("filtersText")),
  });

  await saveAll();
}

function selectEntry(index) {
  if (state.activeTab === "items") state.selectedItem = index;
  if (state.activeTab === "sections") state.selectedSection = index;
}

function addItem() {
  state.items.unshift({
    id: `new-item-${Date.now()}`,
    section: state.sections[0]?.id || "inspiration",
    title: "New item",
    description: "",
    longDescription: "",
    author: "",
    source: "",
    type: "",
    tags: ["All"],
    cover: "",
    video: "",
    url: "",
    dateAdded: today(),
    createdAt: new Date().toISOString(),
    details: [],
    materials: [],
    size: "wide",
  });
  state.selectedItem = 0;
  state.activeTab = "items";
  setStatus("已新增内容，编辑后点击保存。", "ok");
  render();
}

function addSection() {
  state.sections.push({
    id: `section-${Date.now()}`,
    label: "New Tab",
    title: "新标签",
    eyebrow: "Collection",
    description: "",
    filters: ["All"],
  });
  state.selectedSection = state.sections.length - 1;
  state.activeTab = "sections";
  setStatus("已新增 Tab，编辑后点击保存。", "ok");
  render();
}

function deleteItem() {
  if (!confirm("确定删除这条内容吗？")) return;
  state.items.splice(state.selectedItem, 1);
  state.selectedItem = Math.max(state.selectedItem - 1, 0);
  saveAll();
}

function deleteSection() {
  if (!confirm("确定删除这个 Tab 吗？内容里的 section 字段不会自动修改。")) return;
  state.sections.splice(state.selectedSection, 1);
  state.selectedSection = Math.max(state.selectedSection - 1, 0);
  saveAll();
}

async function uploadToField(fieldName, file) {
  if (!file) return;

  try {
    const path = await uploadFile(file);
    const item = state.items[state.selectedItem];
    if (item) item[fieldName] = path;
    setStatus(`已上传 ${file.name}。记得点击保存内容。`, "ok");
    render();
  } catch (error) {
    setStatus(error.message, "error");
    render();
  }
}

async function uploadMaterial(file, caption) {
  if (!file) return;

  try {
    const path = await uploadFile(file);
    const item = state.items[state.selectedItem];
    if (item) {
      item.materials = Array.isArray(item.materials) ? item.materials : [];
      item.materials.push({ file: path, caption });
    }
    setStatus(`已上传素材 ${file.name}。记得点击保存内容。`, "ok");
    render();
  } catch (error) {
    setStatus(error.message, "error");
    render();
  }
}

async function uploadFile(file) {
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(`${file.name} 超过 10MB，暂时不能上传。`);
  }

  const base64 = await fileToBase64(file);
  const response = await fetch("/api/admin/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, base64 }),
  });

  if (!response.ok) throw new Error(await getErrorMessage(response));
  const data = await response.json();
  return data.path;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败。"));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };
    reader.readAsDataURL(file);
  });
}

async function getErrorMessage(response) {
  try {
    const data = await response.json();
    return data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

function field(label, name, value = "", type = "text") {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value || "")}" />
    </div>
  `;
}

function dateField(label, name, value = "") {
  return field(label, name, value || today(), "date");
}

function textareaField(label, name, value = "", hint = "") {
  return `
    <div class="field full">
      <label for="${name}">${label}</label>
      <textarea id="${name}" name="${name}">${escapeHtml(value || "")}</textarea>
      ${hint ? `<p class="helper">${escapeHtml(hint)}</p>` : ""}
    </div>
  `;
}

function mediaField(label, name, value = "", accept = "") {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <div class="field-row">
        <input id="${name}" name="${name}" type="text" value="${escapeHtml(value || "")}" />
        <label class="admin-button file-button">
          上传
          <input type="file" accept="${escapeHtml(accept)}" data-upload-field="${name}" />
        </label>
      </div>
      <p class="helper">建议 10MB 以内。</p>
    </div>
  `;
}

function selectField(label, name, value = "", sections = []) {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <select id="${name}" name="${name}">
        ${sections
          .map(
            (section) => `
              <option value="${escapeHtml(section.id)}" ${section.id === value ? "selected" : ""}>
                ${escapeHtml(section.label || section.title || section.id)}
              </option>
            `,
          )
          .join("")}
      </select>
    </div>
  `;
}

function selectSizeField(value = "wide") {
  const options = [
    ["wide", "宽屏 16:9"],
    ["standard", "标准 4:3"],
    ["square", "方形 1:1"],
    ["tall", "竖版 4:5"],
  ];

  return `
    <div class="field">
      <label for="size">卡片比例</label>
      <select id="size" name="size">
        ${options
          .map(
            ([key, label]) => `
              <option value="${key}" ${key === value ? "selected" : ""}>${label}</option>
            `,
          )
          .join("")}
      </select>
    </div>
  `;
}

function normalizeItems(data) {
  const source = Array.isArray(data) ? data : [];
  return source.map((item) => ({
    ...item,
    createdAt: item.createdAt || dateToCreatedAt(item.dateAdded),
    tags: textToList(item.tags),
    details: Array.isArray(item.details) ? item.details : [],
    materials: Array.isArray(item.materials) ? item.materials : [],
  }));
}

function normalizeSections(data) {
  const source = Array.isArray(data) ? data : [];
  return source.map((section) => ({
    ...section,
    filters: textToList(section.filters || ["All"]),
  }));
}

function textToList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToText(value) {
  return textToList(value).join("\n");
}

function textToDetails(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split(":");
      return { label: label.trim(), value: rest.join(":").trim() };
    })
    .filter((row) => row.label || row.value);
}

function detailsToText(value = []) {
  return Array.isArray(value)
    ? value.map((row) => `${row.label || ""}: ${row.value || ""}`).join("\n")
    : "";
}

function textToMaterials(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [file, ...caption] = line.split("|");
      return { file: file.trim(), caption: caption.join("|").trim() };
    })
    .filter((row) => row.file);
}

function materialsToText(value = []) {
  return Array.isArray(value)
    ? value.map((row) => `${row.file || ""}${row.caption ? ` | ${row.caption}` : ""}`).join("\n")
    : "";
}

function setStatus(message, type = "") {
  state.status = message;
  state.statusType = type;
}

function cleanId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateToCreatedAt(value) {
  if (!value) return "";
  if (String(value).includes("T")) return value;
  return `${value}T00:00:00.000Z`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
