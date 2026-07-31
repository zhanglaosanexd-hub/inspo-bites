# Inspo.design

A lightweight static collection site for design inspiration and UX notes.

## Edit Content

You can manage content in two ways:

- Use Yuque as the CMS source. This is the recommended production workflow.
- Edit `data/items.json` and `data/sections.json` directly.
- Open the admin UI at `/admin/` and manage content visually.

The admin is intended for the site owner only.

Local editing uses the included local server:

```bash
node local-server.mjs
```

Then open:

- Front-end: `http://127.0.0.1:4174/`
- Local admin: `http://127.0.0.1:4174/admin/`

The local admin can edit JSON content and upload media into `assets/uploads`.

In production, `/admin/` falls back to Decap CMS and writes changes back to the Git repository after GitHub authentication is configured.

## Yuque CMS

The production site can read content from Yuque through the Cloudflare Pages Function at `/api/content`.

Recommended flow:

```text
Yuque table/docs -> Cloudflare Pages Function -> /api/content -> front-end gallery
```

For the design inspiration table, the site reads Yuque's public table endpoint directly, so no Yuque account password is needed. Keep any Yuque token on Cloudflare only. Do not put it in front-end code.

### Cloudflare Environment Variables

Set this in Cloudflare Pages -> Settings -> Environment variables when reading private Yuque docs:

```text
YUQUE_TOKEN=your_yuque_token
```

Optional custom sources:

```json
[
  {
    "section": "inspiration",
    "repo": "zhanglaosan-bz7nq/gmzg15",
    "slug": "wv0ye00q7degi1zp",
    "docId": 275023108,
    "sheetId": "dzc40vyctnvwkye53i06uxotu7kghrgh",
    "reference": "https://www.yuque.com/zhanglaosan-bz7nq/gmzg15/wv0ye00q7degi1zp?singleDoc#"
  },
  {
    "section": "ux-bites",
    "repo": "zhanglaosan-bz7nq/blot0b",
    "slug": "gknnx9dn7fs4pa3p",
    "reference": "https://www.yuque.com/zhanglaosan-bz7nq/blot0b/gknnx9dn7fs4pa3p?singleDoc#"
  }
]
```

Put that JSON into:

```text
YUQUE_CMS_SOURCES=[...]
```

If `YUQUE_CMS_SOURCES` is not configured, the site reads the default Yuque sources above. The inspiration source uses the Yuque table view as the CMS; newly added table rows are merged into the local gallery on refresh.

### Yuque Content Format

The parser supports two formats.

Format 1: a JSON code block:

```json
{
  "items": [
    {
      "id": "pinckus-hydrangea",
      "section": "inspiration",
      "title": "09｜Pinckus：Motion Graphics「绣球」",
      "author": "Pinckus",
      "source": "𝕏 / Pinckus",
      "url": "https://x.com/Pinckus102xz/status/2059978237921644784",
      "video": "https://example.com/video.mp4",
      "cover": "https://example.com/cover.webp",
      "type": "Motion",
      "tags": ["Motion", "Graphic", "Culture", "𝕏"],
      "dateAdded": "2026-07-07",
      "details": [
        { "label": "Category", "value": "Motion" },
        { "label": "Style", "value": "Floral / Light 3D" }
      ]
    }
  ]
}
```

Format 2: regular Yuque headings and fields:

```markdown
## 09｜Pinckus：Motion Graphics「绣球」

作者：Pinckus
来源：𝕏 / Pinckus
链接：https://x.com/Pinckus102xz/status/2059978237921644784
视频：https://example.com/video.mp4
封面：https://example.com/cover.webp
分类：Motion
标签：Motion, Graphic, Culture, 𝕏
风格：Floral / Light 3D
色彩：Bright / Soft gradient
交互：Looping motion
收录时间：2026-07-07

这是详情描述正文，可以换行。
```

For UX Bites, a heading plus image is enough. If there is no detail text, the site will use the collected image and basic metadata.

The front-end always loads local JSON first, then lets Yuque replace the sections that were successfully fetched. If Yuque is unavailable or the token expires, the current static content still renders.

## Media Storage

The recommended production storage split is:

```text
Cloudflare R2 -> image/video files
Yuque table -> title, author, tags, detail text, original URL, and R2 media URLs
Cloudflare Pages -> static front-end and /api/content
```

This keeps large media out of GitHub/Pages and avoids relying on Yuque attachment hotlinks for public traffic.

Recommended R2 setup:

1. Create a Cloudflare R2 bucket, for example `inspo-media`.
2. Connect a public custom domain, for example `media.inspo.design`.
3. Create R2 S3 API credentials in Cloudflare. Keep them in your shell or Cloudflare settings only; do not commit them.
4. Upload media to R2, then paste the public R2 URL into the Yuque `cover` / `video` / `materials` fields.

The front-end and `/api/content` already understand a shared media base URL and URL map:

```text
R2_PUBLIC_BASE_URL=https://media.inspo.design
MEDIA_BASE_URL=https://media.inspo.design
MEDIA_URL_MAP={"https://www.yuque.com/attachments/...mp4":"https://media.inspo.design/yuque/...mp4"}
```

For local fallback content, `data/media-config.js` can also provide the same public base URL and URL map:

```js
window.INSPO_MEDIA_BASE_URL = "https://media.inspo.design";
window.INSPO_MEDIA_URL_MAP = {
  "https://www.yuque.com/attachments/yuque/0/2026/mp4/example.mp4":
    "https://media.inspo.design/yuque/example.mp4",
};
```

There is a helper script for one-time migration:

```bash
R2_ACCOUNT_ID=... \
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
R2_BUCKET=inspo-media \
R2_PUBLIC_BASE_URL=https://media.inspo.design \
node tools/r2-media-migrate.mjs --upload --write-config
```

Without `--upload`, the script is a dry run. It scans `data/items.json`, plans uploads for referenced `./assets/...` files and Yuque attachment URLs, and can generate `data/media-map.json` plus `data/media-config.js`.

After migration, the shortest ongoing workflow is: upload the new image/video to R2, paste the R2 URL in Yuque, then let `/api/content` refresh from Yuque.

### Admin Setup

`admin/config.yml` is already pointed at:

```yaml
backend:
  name: github
  repo: zhanglaosanexd-hub/inspo-bites
  branch: main
```

For local CMS testing, Decap CMS uses `local_backend: true`. For production, use GitHub authentication or a small OAuth proxy. The front-end remains static and free to host.

### Sections

Left sidebar tabs are managed in `data/sections.json`.

Each section supports:

- `id`: stable section key, used by content items
- `label`: left sidebar English label
- `title`: left sidebar Chinese label and page title
- `eyebrow`, `description`
- `filters`: filter chips shown in that section

### Items

Each item supports:

- `section`: must match a section `id`
- `title`, `description`, `longDescription`, `source`, `url`
- `author`, `avatar`
- `tags`: used by the filter chips
- `cover`: optional image path
- `video`: optional MP4 preview path
- `materials`: optional extra image/video assets
- `details`: custom detail rows, such as category, style, color, interaction
- `size`: `wide`, `tall`, `square`, or `standard`

Media files are currently planned at **10MB or less**. Cloudflare Pages has a larger per-file asset limit, but keeping files around 10MB makes uploads and page loading more predictable.

## Deploy Free

GitHub Pages free setup:

- Go to the repository `Settings` -> `Pages`
- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`
- The published URL will be `https://inspo-design.pages.dev/`

Cloudflare Pages is still a free alternative:

- Framework preset: None
- Build command: leave empty
- Build output directory: `.`
