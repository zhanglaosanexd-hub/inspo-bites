# App Recap product icons

Public product artwork checked on 2026-11-02. No report images, videos, captions,
or product titles are changed by this icon archive.

- `data/app-recap-icons.js` maps 54 report product names to local icon paths.
- 53 new files use 48 official Apple App Store artworks and five
  first-party website icons (Raycast, ByteDance, PlayStation, Renderbus,
  Delysium). The remaining entry reuses the existing 小黑盒 icon for 喜加一.
- `sources.json` records the exact download URL, source page, verified store name,
  developer/bundle ID where available, output dimensions, and byte count.
- 51 new icons are 128 × 128. Renderbus and Delysium expose
  only 32 × 32 browser favicons; these stay at source resolution without invented
  detail. All new assets are decoded and re-encoded as WebP.

## Identity checks and reuse

Reuse the already mirrored product icons for these navigation aliases while
preserving each report's original name and year:

| Original report name | Product identity | Evidence |
| --- | --- | --- |
| 滴滴 | 滴滴出行 | Same ride-hailing product; annual report frames |
| 携程旅行 | 携程旅游 | Same Ctrip product; existing icon folder XieChengLvXing |
| Somno | 元气睡眠 | 2024 original explicitly labels “Somno 元气睡眠” |
| 新浪 | 微博 | 2022 cover explicitly labels “2022我的微博播报” |
| 喜加一 | Keep separate report name; reuse 小黑盒 artwork | 2023 original explicitly labels “小黑盒APP出品” and “我的2023·EPIC” |

For 支付宝, prefer the existing 2025 `ZhiFuBao/icon.png.webp`; the 2024 record
currently points to the separate 支付宝快递 icon. Different service reports such
as 抖音支付 and 抖音生活服务 should not be merged merely because their icons match.

## Branding and missing avatars

Ele.me's current official homepage and store listing have both changed to the
orange 淘宝闪购 mark. Because this does not represent the 2022–2024 historical
Ele.me identity, it is deliberately excluded. Keep the 饿了么 text fallback
until a verified historical blue icon is available.

No verified original avatars were located for `派大鑫的2023回顾` and
`月纬figma年度报告`; keep a readable text fallback rather than assigning an
unrelated application's logo. With the four aliases above and the 喜加一 reuse,
184 of 189 annual-report records have a real local product icon; the five
remaining records are these two personal reports plus the three 饿了么 years.

## Regeneration

The mirrored source manifest can be used as the reviewed selection input:

```sh
python3 scripts/cache-app-recap-icons.py --selection assets/app-recap-icons/sources.json
```

Use Python with Pillow installed. Existing files are verified and reused; only
missing approved sources are downloaded. Store searches are separate and never
auto-approve a same-named app. Review the returned product and developer before
adding a new source to the selection.
