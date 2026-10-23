"""Mirror App Recap images and build small covers plus a browser media manifest.

Run with Python 3 and Pillow. Originals stay in the temporary cache so reruns do
not depend on the upstream host or recompress files that are already mirrored.
"""

import hashlib
import io
import json
from pathlib import Path
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ORIGINALS = Path(tempfile.gettempdir()) / "inspo-app-recap-originals"
OUTPUT = ROOT / "assets" / "app-recap-cache"
SOURCE_HOST = "2025app.designstroll.space"


def read_items():
    source = (ROOT / "data" / "content.js").read_text()
    data = json.loads(source.split("=", 1)[1].strip().removesuffix(";"))
    return [item for item in data["items"]["items"] if item["section"] == "app-recap"]


def mirror(source, is_cover):
    parsed = urlparse(source)
    if parsed.scheme != "https" or parsed.hostname != SOURCE_HOST:
        raise ValueError(f"Unexpected App Recap image host: {source}")
    relative = Path(unquote(parsed.path.removeprefix("/public/")))
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Invalid image path: {source}")
    original = ORIGINALS / hashlib.sha256(source.encode()).hexdigest()
    if not original.exists():
        for attempt in range(3):
            try:
                request = Request(source, headers={"User-Agent": "Mozilla/5.0"})
                with urlopen(request, timeout=45) as response:
                    raw = response.read()
                with Image.open(io.BytesIO(raw)) as image:
                    image.verify()
                original.write_bytes(raw)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)

    with Image.open(original) as opened:
        if getattr(opened, "n_frames", 1) != 1:
            raise ValueError(f"Animated image needs a separate preservation path: {source}")
        has_alpha = "A" in opened.getbands() or "transparency" in opened.info
        image = ImageOps.exif_transpose(opened).convert("RGBA" if has_alpha else "RGB")
        is_icon = relative.name.lower().startswith("icon")
        image.thumbnail((128, 128) if is_icon else (1600, 16380), Image.Resampling.LANCZOS)
        destination = OUTPUT / relative.with_name(relative.name + ".webp")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            image.save(destination, "WEBP", quality=85, method=4)
        result = {
            "file": "./" + destination.relative_to(ROOT).as_posix(),
            "width": image.width,
            "height": image.height,
        }
        if is_cover:
            preview = destination.with_name(relative.name + ".preview.webp")
            if not preview.exists():
                thumbnail = image.copy()
                thumbnail.thumbnail((640, 6000), Image.Resampling.LANCZOS)
                thumbnail.save(preview, "WEBP", quality=82, method=4)
            result["preview"] = "./" + preview.relative_to(ROOT).as_posix()
        result["sourceBytes"] = original.stat().st_size
        result["bytes"] = destination.stat().st_size
        return result


def main():
    ORIGINALS.mkdir(parents=True, exist_ok=True)
    items = read_items()
    sources = {}
    for item in items:
        for field in ("cover", "appIcon", "avatar"):
            if item.get(field):
                sources[item[field]] = sources.get(item[field], False) or field == "cover"
        for material in item.get("materials", []):
            source = material if isinstance(material, str) else material.get("file")
            if source:
                sources.setdefault(source, False)

    manifest = {}
    errors = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        pending = {pool.submit(mirror, source, cover): source for source, cover in sources.items()}
        for future in as_completed(pending):
            source = pending[future]
            try:
                manifest[source] = future.result()
            except Exception as error:
                errors.append(f"{source}: {error}")
            if (len(manifest) + len(errors)) % 40 == 0:
                print(f"Mirrored {len(manifest)}/{len(sources)} images; errors={len(errors)}", flush=True)
    if errors:
        raise RuntimeError("\n".join(errors))

    ordered = {source: manifest[source] for source in sorted(manifest)}
    browser_manifest = {
        source: {key: value for key, value in asset.items() if key not in ("sourceBytes", "bytes")}
        for source, asset in ordered.items()
    }
    output = "window.INSPO_APP_RECAP_MEDIA = " + json.dumps(browser_manifest, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "data" / "app-recap-media.js").write_text(output)
    before = sum(asset["sourceBytes"] for asset in ordered.values())
    after = sum(asset["bytes"] for asset in ordered.values())
    print(f"Complete: {len(items)} apps, {len(ordered)} images, {before / 1024**2:.1f} -> {after / 1024**2:.1f} MB ({1 - after / before:.1%} smaller)", flush=True)


if __name__ == "__main__":
    main()
