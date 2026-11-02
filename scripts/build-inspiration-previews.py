"""Build same-content, fast-start gallery videos and optimized local covers.

Usage: python3 scripts/build-inspiration-previews.py --source-json content.json --ffmpeg /path/to/ffmpeg
The source JSON is the current /api/content response. Original videos remain
unchanged for the detail viewer. Output names include a content digest so the
browser can keep immutable assets without confusing different releases.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://inspo-design.pages.dev/"
OUTPUT = ROOT / "assets" / "inspiration-previews"


def download(url, destination):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.yuque.com/"})
    with urlopen(request, timeout=45) as response:
        data = response.read()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def duration_seconds(data):
    def boxes(start, end):
        position = start
        while position + 8 <= end:
            size, kind = struct.unpack_from(">I4s", data, position)
            header = 8
            if size == 1:
                size = struct.unpack_from(">Q", data, position + 8)[0]
                header = 16
            if size == 0:
                size = end - position
            if size < header or position + size > end:
                break
            yield kind, position + header, position + size
            position += size
    for kind, start, end in boxes(0, len(data)):
        if kind != b"moov":
            continue
        for child, offset, _ in boxes(start, end):
            if child == b"mvhd":
                version = data[offset]
                at = offset + (20 if version == 1 else 12)
                scale = struct.unpack_from(">I", data, at)[0]
                duration = struct.unpack_from(">Q" if version == 1 else ">I", data, at + 4)[0]
                return duration / scale
    raise ValueError("Video has no duration metadata")


def needs_faststart(data):
    at = 0
    while at + 8 <= len(data):
        size, kind = struct.unpack_from(">I4s", data, at)
        if kind == b"moov":
            return False
        if kind == b"mdat":
            return True
        if size == 1:
            size = struct.unpack_from(">Q", data, at + 8)[0]
        if size < 8:
            break
        at += size
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-json", required=True)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("Provide --ffmpeg; original videos must not be replaced by still images")
    incoming = json.loads(Path(args.source_json).read_text())
    records = [item for item in incoming["items"] if item["section"] == "inspiration"]
    if len(records) < 41:
        raise ValueError("CMS response is incomplete; refusing to shrink the published snapshot")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    def build(item):
        item = dict(item)
        number = re.match(r"^(\d+)[｜|]", item["title"]).group(1).zfill(2)
        cover = item.get("cover", "")
        local_cover = ROOT / cover if cover.startswith("./assets/") else ROOT / "assets" / "inspiration-cover-cache" / f"{number}.png"
        if not local_cover.is_file():
            download(urljoin(ORIGIN, cover), local_cover)
        cover_digest = hashlib.sha256(local_cover.read_bytes()).hexdigest()[:12]
        optimized_cover = OUTPUT / f"{number}-{cover_digest}.webp"
        with Image.open(local_cover) as original:
            image = ImageOps.exif_transpose(original)
            alpha = "A" in image.getbands() or "transparency" in image.info
            image = image.convert("RGBA" if alpha else "RGB")
            if not optimized_cover.exists():
                image.save(optimized_cover, "WEBP", quality=88, method=4)
        result = {"cover": "./" + optimized_cover.relative_to(ROOT).as_posix()}
        mappings = {cover: result["cover"], "./" + local_cover.relative_to(ROOT).as_posix(): result["cover"]}
        if cover.startswith("/api/media?"):
            from urllib.parse import parse_qs
            raw = parse_qs(urlparse(cover).query).get("url", [""])[0]
            if raw:
                mappings[raw] = result["cover"]
        video = item.get("video", "")
        preview = None
        if video:
            local_video = ROOT / video if video.startswith("./assets/") else ROOT / "assets" / "inspiration-video-cache" / f"{number}-x-preview.mp4"
            if not local_video.is_file():
                raise ValueError(f"{number}: mirror the original video before building its preview")
            source_bytes = local_video.read_bytes()
            duration = duration_seconds(source_bytes)
            digest = hashlib.sha256(source_bytes + b"preview-v2-640-960-24-crf29-duration").hexdigest()[:12]
            destination = OUTPUT / f"{number}-{digest}.mp4"
            if not destination.exists():
                subprocess.run([
                    args.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                    "-i", str(local_video), "-map", "0:v:0", "-an",
                    "-vf", f"scale=w='min(640,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24,tpad=stop_mode=clone:stop_duration={duration}",
                    "-t", str(duration),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "29",
                    "-maxrate", "400k", "-bufsize", "800k", "-threads", "2",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)
                ], check=True, timeout=240)
            if needs_faststart(source_bytes):
                full_digest = hashlib.sha256(source_bytes + b"full-v1-faststart").hexdigest()[:12]
                full = OUTPUT / f"{number}-{full_digest}.full.mp4"
                if not full.exists():
                    subprocess.run([
                        args.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(local_video), "-map", "0:v:0", "-map", "0:a?",
                        "-c", "copy", "-movflags", "+faststart", str(full)
                    ], check=True, timeout=60)
                local_video = full
            original_path = "./" + local_video.relative_to(ROOT).as_posix()
            result["video"] = original_path
            mappings[video] = original_path
            preview = {
                "source": original_path,
                "file": "./" + destination.relative_to(ROOT).as_posix(),
                "bytes": destination.stat().st_size,
                "sourceBytes": local_video.stat().st_size,
            }
        item.update(result)
        return number, item, result, mappings, preview

    built = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(build, item) for item in records]
        for future in as_completed(futures):
            built.append(future.result())
            if len(built) % 8 == 0:
                print(f"Built {len(built)}/{len(records)} inspiration records", flush=True)
    by_id = {item["id"]: item for _, item, _, _, _ in built}
    server = {number: result for number, _, result, _, _ in sorted(built)}
    media_map = {source: target for _, _, _, mappings, _ in built for source, target in mappings.items() if source != target}
    previews = {preview["source"]: preview for *_, preview in built if preview}
    static_file = ROOT / "data" / "content.js"
    current = json.loads(static_file.read_text().split("=", 1)[1].strip().removesuffix(";"))
    preserved = [item for item in current["items"]["items"] if item["section"] != "inspiration"]
    current["items"]["items"] = preserved + [by_id[item["id"]] for item in records]
    static_file.write_text("window.INSPO_STATIC_DATA = " + json.dumps(current, ensure_ascii=False, separators=(",", ":")) + ";\n")
    browser = {"previews": previews, "urls": media_map}
    (ROOT / "data" / "inspiration-media.js").write_text("window.INSPO_INSPIRATION_MEDIA = " + json.dumps(browser, ensure_ascii=False, separators=(",", ":")) + ";\n")
    (ROOT / "functions" / "_shared" / "inspiration-media.js").write_text("export const CACHED_INSPIRATION_MEDIA = " + json.dumps(server, ensure_ascii=False, indent=2) + ";\n")
    before = sum(item["sourceBytes"] for item in previews.values())
    after = sum(item["bytes"] for item in previews.values())
    print(f"Complete: {len(records)} covers, {len(previews)} videos; {before / 1024**2:.1f} -> {after / 1024**2:.1f} MB; originals unchanged", flush=True)


if __name__ == "__main__":
    main()
