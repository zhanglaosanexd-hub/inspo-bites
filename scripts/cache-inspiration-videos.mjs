import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const OUTPUT_DIR = path.resolve("assets/inspiration-video-cache");
const VIDEO_SOURCES = [
  ["18-wave-card.mp4", "2000678707137036637"],
  ["19-ai-thinking-panel.mp4", "2079162374712365254"],
  ["20-ai-task-input.mp4", "2079507994124108250"],
  ["21-codex-review.mp4", "2070557463628149055"],
  ["22-fullscreen-ripple.mp4", "2069724377629765813"],
  ["23-ai-pixel-reveal.mp4", "2082481271671078928"],
  ["24-trash-delete.mp4", "2077423947004641474"],
  ["25-lego-dynamic-island.mp4", "2073734969667493914"],
  ["26-bookmark-file-box.mp4", "2080720630534865182"],
  ["27-microphone-seed-feedback.mp4", "2082482503961686075"],
  ["28-ai-answer-thinking-writing.mp4", "2084671704287310103"],
];

await mkdir(OUTPUT_DIR, { recursive: true });

for (const [filename, tweetId] of VIDEO_SOURCES) {
  const metadataResponse = await fetch(`https://api.fxtwitter.com/status/${tweetId}`);
  if (!metadataResponse.ok) throw new Error(`${tweetId}: metadata ${metadataResponse.status}`);

  const metadata = await metadataResponse.json();
  const variants = metadata.tweet?.media?.videos?.[0]?.formats
    ?.filter((format) => format.container === "mp4" && format.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (!variants?.length) throw new Error(`${tweetId}: no MP4 video found`);

  let saved = false;
  for (const variant of variants) {
    const videoResponse = await fetch(variant.url);
    if (!videoResponse.ok) continue;

    const bytes = new Uint8Array(await videoResponse.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES && variants.length > 1) continue;

    const outputPath = path.join(OUTPUT_DIR, filename);
    await writeFile(outputPath, bytes);
    const result = await stat(outputPath);
    console.log(`${filename}: ${(result.size / 1024 / 1024).toFixed(2)}MB`);
    saved = true;
    break;
  }

  if (!saved) throw new Error(`${tweetId}: no downloadable MP4 within ${MAX_FILE_BYTES} bytes`);
}
