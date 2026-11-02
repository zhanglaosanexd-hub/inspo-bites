#!/usr/bin/env python3
"""Mirror approved public product icons from Apple or first-party websites.

Review search results before adding an entry to --selection. This script never
selects a same-named app automatically. Original full-size marketing artwork is
not retained: output is a 128px WebP plus a public source manifest.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "assets" / "app-recap-icons"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; InspoIconArchive/1.0)"}


def fetch(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def search(task):
    product, term, country = task
    query = urllib.parse.urlencode({"term": term, "country": country,
                                   "entity": "software", "limit": "5"})
    url = "https://itunes.apple.com/search?" + query
    for attempt in range(3):
        try:
            result = json.loads(fetch(url))
            return {"product": product, "searchUrl": url,
                    "results": [{key: item.get(key) for key in (
                        "trackId", "trackName", "artistName", "bundleId",
                        "artworkUrl512", "artworkUrl100", "trackViewUrl",
                        "sellerUrl")} for item in result.get("results", [])]}
        except Exception as error:
            if attempt == 2:
                return {"product": product, "searchUrl": url,
                        "error": str(error), "results": []}
            time.sleep(2 + attempt * 2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--search", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--selection", type=Path)
    arguments = parser.parse_args()
    if arguments.search:
        requests = json.loads(arguments.search.read_text())
        tasks = [(item["product"], item.get("term", item["product"]),
                  item.get("country", "cn")) for item in requests]
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for result in pool.map(search, tasks):
                results.append(result)
                print(result["product"], "|", "; ".join(
                    f'{r["trackId"]} {r["trackName"]} ({r["artistName"]})'
                    for r in result["results"]), flush=True)
        arguments.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
        return
    if not arguments.selection:
        parser.error("Specify --search/--output or --selection")
    from PIL import Image, ImageOps
    selection = json.loads(arguments.selection.read_text())
    if isinstance(selection, dict):
        selection = selection["icons"]
    DESTINATION.mkdir(parents=True, exist_ok=True)
    mapping, sources, failed = {}, [], []
    for item in selection:
        product, url = item["product"], item.get("iconUrl")
        slug = re.sub(r"[^a-z0-9]+", "-", product.lower()).strip("-") or "app"
        digest = hashlib.sha256(product.encode()).hexdigest()[:10]
        reused = item.get("reusePath")
        destination = ROOT / reused.removeprefix("./") if reused else DESTINATION / f"{slug}-{digest}.webp"
        try:
            if reused and not destination.is_file():
                raise FileNotFoundError(f"Missing existing icon: {destination}")
            if not destination.exists():
                for attempt in range(3):
                    try:
                        body = fetch(url)
                        break
                    except Exception:
                        if attempt == 2:
                            raise
                        time.sleep(2 + attempt * 2)
                with Image.open(io.BytesIO(body)) as opened:
                    image = ImageOps.exif_transpose(opened).convert("RGBA")
                    if min(image.size) < 32:
                        raise ValueError(f"Icon too small: {image.size}")
                    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
                    image.save(destination, "WEBP", quality=88, method=6)
            with Image.open(destination) as check:
                check.load()
                width, height = check.size
            relative = "./" + destination.relative_to(ROOT).as_posix()
            mapping[product] = relative
            sources.append({**item, "file": relative, "width": width, "height": height,
                            "bytes": destination.stat().st_size})
            print(product, relative, flush=True)
        except Exception as error:
            failed.append({"product": product, "error": str(error)})
            print(product, "FAILED", error, flush=True)
    (ROOT / "data" / "app-recap-icons.js").write_text(
        "window.INSPO_APP_RECAP_ICONS = " + json.dumps(mapping, ensure_ascii=False, indent=2) + ";\n")
    (DESTINATION / "sources.json").write_text(json.dumps(
        {"icons": sources, "failed": failed}, ensure_ascii=False, indent=2) + "\n")
    print(f"Mapped {len(mapping)} icons; {len(failed)} failed.")


if __name__ == "__main__":
    main()
