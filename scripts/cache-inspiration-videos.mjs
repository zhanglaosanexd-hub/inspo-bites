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
  ["29-x-preview.mp4", "2088947032274907602"],
  ["30-x-preview.mp4", "2088657289410687111"],
  ["31-x-preview.mp4", "2089006726204789023"],
  ["32-x-preview.mp4", "2074141065104576781"],
  ["33-x-preview.mp4", "2087227155076046995"],
  ["34-x-preview.mp4", "2076290018193424792"],
  ["35-x-preview.mp4", "2033987211691970785"],
  ["36-x-preview.mp4", "2048828974508171584"],
  ["37-x-preview.mp4", "2059298839215972592"],
  ["38-x-preview.mp4", "1984767288172597703"],
  ["39-x-preview.mp4", "2056007595400527987"],
  ["40-x-preview.mp4", "2086995635526345076"],
  ["41-x-preview.mp4", "2093755003248984352"],
  ["42-x-preview.mp4", "2089706882688753782"],
  ["43-x-preview.mp4", "2095491684138180809"],
  ["44-x-preview.mp4", "2083862523640496179"],
  ["45-x-preview.mp4", "2098098246660899091"],
  ["46-x-preview.mp4", "2099386664506581042"],
  ["47-x-preview.mp4", "2095908112075206818"],
  ["48-x-preview.mp4", "2101679582734872751"],
  ["49-x-preview.mp4", "2108072499267461149", 1],
];

await mkdir(OUTPUT_DIR, { recursive: true });

for (const [filename, tweetId, videoIndex = 0] of VIDEO_SOURCES) {
  const outputPath = path.join(OUTPUT_DIR, filename);
  if ((await stat(outputPath).catch(() => null))?.size > 0) {
    console.log(`${filename}: already cached`);
    continue;
  }
  const metadataResponse = await fetch(`https://api.fxtwitter.com/status/${tweetId}`);
  if (!metadataResponse.ok) throw new Error(`${tweetId}: metadata ${metadataResponse.status}`);

  const metadata = await metadataResponse.json();
  console.log(`${filename}: ${metadata.tweet?.media?.videos?.length || 0} source video(s)`);
  const variants = metadata.tweet?.media?.videos?.[videoIndex]?.formats
    ?.filter((format) => format.container === "mp4" && format.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (!variants?.length) throw new Error(`${tweetId}: no MP4 video found`);

  let saved = false;
  for (const variant of variants) {
    const videoResponse = await fetch(variant.url);
    if (!videoResponse.ok) continue;

    const bytes = new Uint8Array(await videoResponse.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES && variants.length > 1) continue;

    await writeFile(outputPath, bytes);
    const result = await stat(outputPath);
    console.log(`${filename}: ${(result.size / 1024 / 1024).toFixed(2)}MB`);
    saved = true;
    break;
  }

  if (!saved) throw new Error(`${tweetId}: no downloadable MP4 within ${MAX_FILE_BYTES} bytes`);
}
