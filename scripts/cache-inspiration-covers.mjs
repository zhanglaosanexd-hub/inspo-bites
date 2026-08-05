import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.resolve("assets/inspiration-cover-cache");
const COVERS = [
  ["09.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1782294704637-67d6bba0-b5dc-448c-bab1-f7ce3a56c78b.png"],
  ["01.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1782294914918-1a6e19fa-0ace-407c-9d3c-4908a9034359.png"],
  ["12.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783415676734-615921b9-b917-4ed1-bb64-bf7df6a3872e.png"],
  ["13.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783415846872-6828d883-7dce-4e30-b950-da29bdb220d9.png"],
  ["14.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783416928473-f2dc337f-88ff-469e-ab28-f1aee63c7518.png"],
  ["15.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783417007845-afd21fb5-a2d7-4d9a-8cfd-866faaef8e9b.png"],
  ["16.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783417035460-29407c20-f257-49d0-8ee7-d5b8a94e4b67.png"],
  ["17.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783669388920-b2d28310-acb4-48ef-be3c-2536be39d02e.png"],
  ["11.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783669753472-ef301b90-9282-4219-a0bb-ae9e041484b2.png"],
  ["18.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1783672553988-3daaef90-d997-4110-9106-c0e204f3a731.png"],
  ["19.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785144582604-7450f675-74ec-4ad8-b2e2-04e7dc976a34.png"],
  ["20.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785144604852-aac0c3a0-2677-4b7b-953a-afba9cc77f71.png"],
  ["21.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785144772977-8ce6e369-237c-4394-a238-b9142a7774b6.png"],
  ["22.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785202830097-6d22f09f-c974-452c-b346-2c2f0b379990.png"],
  ["23.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785480666235-6d0117ec-5514-409d-a6b8-798655fef0be.png"],
  ["24.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785483159817-c1a45611-d275-4857-bb20-73d4eddfb24c.png"],
  ["25.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785483794748-ef076fb3-ecc7-4606-92ad-f056f6db53b0.png"],
  ["26.png", "https://cdn.nlark.com/yuque/0/2026/png/23205200/1785490271318-92ecd789-b2e9-4b8e-9c22-bad60d3d7f13.png"],
];

await mkdir(OUTPUT_DIR, { recursive: true });

for (const [filename, url] of COVERS) {
  const response = await fetch(url, { headers: { Referer: "https://www.yuque.com/" } });
  if (!response.ok) throw new Error(`${filename}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path.join(OUTPUT_DIR, filename), bytes);
  console.log(`${filename}: ${Math.round(bytes.byteLength / 1024)}KB`);
}
