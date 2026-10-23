#!/usr/bin/env python3
"""Build a small App Recap index and on-demand, year/product image collections.

Original downloads and page PNGs remain untouched. Run with Python + Pillow:
  python3 scripts/import-app-recap-archive.py --source-root ../年度报告素材
The 2025 archive reuses its already mirrored images. This script performs no
network access, video transcoding, or deployment.
"""

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
VERSION = "20261023-recap-archive"
DETAILS = ROOT / "data" / "app-recap-details"
ASSETS = ROOT / "assets" / "app-recap-archive"


def read_assignment(path):
    return json.loads(path.read_text().split("=", 1)[1].strip().removesuffix(";"))


def canonical_product(name, year):
    compact = re.sub(r"\s+", "", name)
    if year == 2023 and name == "未标注产品图集":
        # All five original images explicitly show Raycast Wrapped 2023.
        return "Raycast"
    if year == 2023 and name == "Music":
        # Original frames show Apple Music / Replay 23 and replay.music.apple.com.
        return "Apple Music"
    aliases = {"keep": "Keep", "StressWatch": "StressWatch", "高德出行": "高德地图"}
    if compact in aliases:
        return aliases[compact]
    for prefix, product in (
        ("网易云", "网易云音乐"), ("豆瓣", "豆瓣"), ("哔哩哔哩", "哔哩哔哩"),
        ("抖音", "抖音"), ("微信读书", "微信读书"), ("钉钉", "钉钉"),
        ("小红书", "小红书"), ("美团", "美团"), ("支付宝", "支付宝"),
    ):
        if compact.startswith(prefix):
            return product
    return compact if compact in {"QQ音乐", "StressWatch", "TapTap"} else name.strip()


def product_slug(name):
    readable = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    digest = hashlib.sha256(name.encode()).hexdigest()[:10]
    return f"{readable[:35]}-{digest}" if readable else f"app-{digest}"


def category_for(product, known):
    if product in known:
        return known[product].get("type") or "其他"
    groups = {
        "音乐": {"Apple Music", "QQ音乐", "酷狗音乐", "波点音乐", "喜马拉雅", "咪哒"},
        "图书": {"蜗牛读书", "得到", "帆书", "不背单词"},
        "效率": {"钉钉", "金山文档", "Raycast", "企业微信", "GitHub", "目标地图", "网易邮箱", "字节跳动", "瑞云渲染", "月纬figma年度报告"},
        "健康健美": {"Keep", "华为运动健康", "训记", "StressWatch", "PeakWatch", "Gentler Streak", "Somno"},
        "旅游": {"滴滴", "携程旅行", "航旅纵横", "百度地图"},
        "财务": {"京东金融", "掌上生活", "OKX"},
        "社交": {"QQ", "新浪", "玩吧", "伊的家"},
        "娱乐": {"芒果TV", "爱奇艺", "淘票票", "微赞直播", "小鹅通"},
        "游戏": {"PS5", "TapTap", "喜加一", "光遇", "Delysium", "千岛"},
        "生活": {"饿了么", "菜鸟裹裹"},
        "购物": {"得物", "京东健康"},
        "新闻": {"网易新闻", "36氪", "华盛顿邮报", "央视-种花家年度报告"},
        "教育": {"多邻国"},
        "设计": {"站酷"},
    }
    return next((category for category, names in groups.items() if product in names), "其他")


def local_url(path):
    return "./" + path.relative_to(ROOT).as_posix()


def timestamp(seconds):
    minutes, rest = divmod(seconds, 60)
    return f"{int(minutes):02d}:{rest:06.3f}".rstrip("0").rstrip(".")


def convert_image(task):
    path, destination, preview_path = task
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.thumbnail((1600, 12000), Image.Resampling.LANCZOS)
        # Sources currently max 7176px tall, but ordered tiling keeps future
        # unusually tall screenshots readable rather than dropping content.
        if image.height > 12000:
            raise ValueError(f"Unexpected oversized image: {path}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            image.save(destination, "WEBP", quality=84, method=4)
        with Image.open(destination) as check:
            if check.size != image.size:
                raise ValueError(f"Cached image size mismatch: {destination}")
            check.load()
        result = {"file": local_url(destination), "width": image.width, "height": image.height}
        if preview_path:
            preview = image.copy()
            preview.thumbnail((360, 900), Image.Resampling.LANCZOS)
            if not preview_path.exists():
                preview.save(preview_path, "WEBP", quality=78, method=4)
            with Image.open(preview_path) as check:
                if check.size != preview.size:
                    raise ValueError(f"Cached preview size mismatch: {preview_path}")
                check.load()
            result["preview"] = local_url(preview_path)
            result["previewWidth"] = preview.width
            result["previewHeight"] = preview.height
        result["bytes"] = destination.stat().st_size
        return result


def make_existing_items(existing, media):
    items = []
    details = {}
    local_media = {asset["file"].removeprefix("./"): asset for asset in media.values()}

    def asset_for(source, fallback=None):
        asset = media.get(source) or local_media.get(source.removeprefix("./"))
        if asset:
            return asset
        path = ROOT / source.removeprefix("./")
        if not source.startswith(("./", "assets/")) or not path.is_file():
            raise ValueError(f"Unmirrored 2025 image: {source}")
        fallback = fallback or {}
        width, height = fallback.get("width"), fallback.get("height")
        if not width or not height:
            with Image.open(path) as image:
                width, height = image.size
        return {"file": local_url(path), "width": width, "height": height}

    for old in existing:
        year = str(old.get("appYear", "2025"))
        item = {k: v for k, v in old.items() if k not in {"materials", "avatar", "longDescription"}}
        saved_detail = {}
        source_materials = old.get("materials", [])
        if not source_materials and old.get("materialsUrl"):
            detail_path = (ROOT / old["materialsUrl"].removeprefix("./")).resolve()
            if not detail_path.is_relative_to(ROOT):
                raise ValueError(f"Invalid detail path: {old['materialsUrl']}")
            saved_detail = json.loads(detail_path.read_text())
            source_materials = saved_detail.get("materials", [])
        if not source_materials or len(source_materials) != old["imageCount"]:
            raise ValueError(f"Incomplete existing 2025 collection: {old['id']}")
        materials = []
        for material in source_materials:
            value = {"file": material} if isinstance(material, str) else material
            asset = asset_for(value["file"], value)
            caption = value.get("caption") or old["title"]
            if not caption.startswith(f"{year} · "):
                caption = f"{year} · {caption}"
            materials.append({**value, "file": asset["file"], "width": asset["width"], "height": asset["height"], "caption": caption, "kind": "image"})
        cover = asset_for(old["cover"], {"width": old.get("coverWidth"), "height": old.get("coverHeight")})
        cover_path = ROOT / cover["file"].removeprefix("./")
        cover_digest = hashlib.sha256(cover_path.read_bytes()).hexdigest()[:20]
        preview_path = ASSETS / "2025" / old["id"] / f"{cover_digest}.preview.webp"
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(cover_path) as opened:
            preview = ImageOps.exif_transpose(opened).convert("RGB")
            preview.thumbnail((360, 900), Image.Resampling.LANCZOS)
            if not preview_path.exists():
                preview.save(preview_path, "WEBP", quality=78, method=4)
            with Image.open(preview_path) as check:
                if check.size != preview.size:
                    raise ValueError(f"Cached 2025 preview size mismatch: {preview_path}")
                check.load()
        icon_source = old.get("appIcon", "")
        icon = asset_for(icon_source) if icon_source else {}
        item.update({"productName": old["title"], "appYear": year, "cover": cover["file"], "coverWidth": cover["width"], "coverHeight": cover["height"], "preview": local_url(preview_path), "appIcon": icon.get("file", ""), "dateAdded": f"{year}-12-31", "tags": list(dict.fromkeys([*old.get("tags", []), year])), "imageCount": len(materials), "materialsUrl": f"./data/app-recap-details/{old['id']}.json"})
        items.append(item)
        details[item["id"]] = {**saved_detail, "id": item["id"], "productName": item["productName"], "appYear": year, "materials": materials}
    return items, details


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT.parent / "年度报告素材")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    data = read_assignment(ROOT / "data" / "content.js")
    existing = [item for item in data["items"]["items"] if item.get("section") == "app-recap" and str(item.get("appYear")) == "2025"]
    media = read_assignment(ROOT / "data" / "app-recap-media.js")
    index, details = make_existing_items(existing, media)
    known = {canonical_product(item["title"], 2025): item for item in index}
    groups = {}
    skipped = []
    name_mappings = []
    source_counts = Counter()
    for year in (2024, 2023, 2022):
        year_root = source_root / str(year)
        manifest = json.loads((year_root / "素材清单.json").read_text())
        for entry in manifest["entries"]:
            if not entry["assets"]:
                skipped.append({"year": year, "product": entry["product"], "reason": "原文只有标题，没有媒体"})
                continue
            product = canonical_product(entry["product"], year)
            if product != entry["product"]:
                name_mappings.append({"year": year, "original": entry["product"], "product": product})
            key = (year, product)
            if key not in groups:
                groups[key] = {"year": year, "product": product, "entries": [], "images": []}
            group = groups[key]
            group["entries"].append(entry)
            # Each video folder has a verified chronological, deduplicated page list.
            page_manifest = year_root / entry["folder"] / "页面截图" / "截图清单.json"
            if page_manifest.exists():
                for screen in json.loads(page_manifest.read_text())["screens"]:
                    path = page_manifest.parent / screen["file"]
                    group["images"].append({"path": path, "variant": entry["product"], "time": round(screen["time"], 3), "source": entry["source"], "sourceKind": "video-page"})
                    source_counts[f"{year}:pages"] += 1
            for asset in entry["assets"]:
                if asset["kind"] != "image":
                    continue
                group["images"].append({"path": year_root / asset["path"], "variant": entry["product"], "source": entry["source"], "sourceKind": "original-image"})
                source_counts[f"{year}:images"] += 1

    tasks = {}
    source_mapping = []
    source_bytes = Counter()
    dimensions = []
    for (year, product), group in groups.items():
        slug = product_slug(product)
        group["id"] = f"app-recap-{year}-{slug}"
        # Prefer an actual page after the initial app/report launch screen.
        group["coverIndex"] = min(2, len(group["images"]) - 1)
        for number, material in enumerate(group["images"]):
            path = material["path"]
            if not path.is_file():
                raise FileNotFoundError(path)
            raw = path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            destination = ASSETS / str(year) / slug / f"{digest[:20]}.webp"
            preview = destination.with_name(f"{destination.stem}.preview.webp") if number == group["coverIndex"] else None
            task_key = (str(path), str(destination))
            material["taskKey"] = task_key
            if task_key in tasks and preview:
                tasks[task_key] = (path, destination, preview)
            elif task_key not in tasks:
                tasks[task_key] = (path, destination, preview)
            with Image.open(path) as image:
                dimensions.append({"year": year, "width": image.width, "height": image.height, "source": path.relative_to(source_root).as_posix()})
            source_bytes[year] += len(raw)
            source_mapping.append({"year": year, "product": product, "variant": material["variant"], "source": path.relative_to(source_root).as_posix(), "sha256": digest, "file": local_url(destination)})

    results = {}
    print(f"Importing {len(groups)} product/year collections, {len(tasks)} images with {min(4,args.workers)} workers", flush=True)
    with ThreadPoolExecutor(max_workers=max(1, min(4, args.workers))) as pool:
        pending = {pool.submit(convert_image, task): key for key, task in tasks.items()}
        for future in as_completed(pending):
            key = pending[future]
            results[key] = future.result()
            if len(results) % 100 == 0 or len(results) == len(tasks):
                print(f"Converted {len(results)}/{len(tasks)}", flush=True)

    DETAILS.mkdir(parents=True, exist_ok=True)
    for (year, product), group in groups.items():
        category = category_for(product, known)
        materials = []
        for number, material in enumerate(group["images"], 1):
            asset = results[material["taskKey"]]
            caption = f"{year} · {material['variant']} · "
            caption += f"{timestamp(material['time'])}" if "time" in material else f"原图 {number:02d}"
            result = {"file": asset["file"], "width": asset["width"], "height": asset["height"], "caption": caption, "kind": "image", "variant": material["variant"], "sourceKind": material["sourceKind"]}
            if "time" in material:
                result["time"] = material["time"]
            materials.append(result)
        cover = results[group["images"][group["coverIndex"]]["taskKey"]]
        icon = known.get(product, {}).get("appIcon", "")
        item = {"id": group["id"], "section": "app-recap", "layout": "app-recap", "title": product, "productName": product, "appYear": str(year), "type": category, "tags": [category, str(year)], "author": product, "source": "语雀 · 各平台年终报告", "url": group["entries"][0]["source"], "dateAdded": f"{year}-12-31", "createdAt": f"{year}-12-31T00:00:00.000Z", "description": f"{len(materials)} 张 {year} 年度回顾截图", "cover": cover["file"], "coverWidth": cover["width"], "coverHeight": cover["height"], "preview": cover["preview"], "imageCount": len(materials), "appIcon": icon, "materialsUrl": f"./data/app-recap-details/{group['id']}.json", "details": [{"label": "年份", "value": str(year)}, {"label": "产品", "value": product}, {"label": "类别", "value": category}], "size": "portrait"}
        index.append(item)
        details[item["id"]] = {"id": item["id"], "productName": product, "appYear": str(year), "sources": [{"title": e["product"], "url": e["source"]} for e in group["entries"]], "materials": materials}

    index.sort(key=lambda item: -int(item["appYear"]))
    for item_id, detail in details.items():
        (DETAILS / f"{item_id}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")) + "\n")
    (ROOT / "data" / "app-recap-index.js").write_text("window.INSPO_APP_RECAP_INDEX = " + json.dumps({"version": VERSION, "items": index}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    all_files = set()
    for item in index:
        for field in ("cover", "preview", "appIcon"):
            if item.get(field):
                all_files.add(item[field])
        all_files.update(m["file"] for m in details[item["id"]]["materials"])
    missing = [value for value in all_files if not (ROOT / value.removeprefix("./")).is_file()]
    if missing:
        raise ValueError(f"Missing local files: {missing}")
    by_year = {}
    for year in (2025, 2024, 2023, 2022):
        year_items = [i for i in index if int(i["appYear"]) == year]
        files = {m["file"] for i in year_items for m in details[i["id"]]["materials"]}
        previews = {i["preview"] for i in year_items}
        by_year[str(year)] = {"products": len(year_items), "images": sum(i["imageCount"] for i in year_items), "uniqueImageFiles": len(files), "sourceBytes": source_bytes[year] if year != 2025 else None, "imageBytes": sum((ROOT / p.removeprefix("./")).stat().st_size for p in files), "previewBytes": sum((ROOT / p.removeprefix("./")).stat().st_size for p in previews)}
    report = {"version": VERSION, "sourceRoot": "年度报告素材", "years": by_year, "sourceCounts": dict(source_counts), "sourceImagesMapped": len(source_mapping), "missingFiles": missing, "emptySourceEntries": skipped, "productNameMappings": name_mappings, "dimensionSummary": {"maxWidth": max(d["width"] for d in dimensions), "maxHeight": max(d["height"] for d in dimensions), "tiledImages": 0}, "largestDetailBytes": max((DETAILS / f"{i['id']}.json").stat().st_size for i in index), "sourceMapping": source_mapping}
    (DETAILS / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"items": len(index), "years": by_year, "mappedImages": len(source_mapping), "missing": len(missing), "largestDetailBytes": report["largestDetailBytes"]}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
