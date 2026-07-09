# Inspo Bites

A lightweight static collection site for design inspiration and UX notes.

## Edit Content

You can manage content in two ways:

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
- The published URL will be `https://zhanglaosanexd-hub.github.io/inspo-bites/`

Cloudflare Pages is still a free alternative:

- Framework preset: None
- Build command: leave empty
- Build output directory: `.`
