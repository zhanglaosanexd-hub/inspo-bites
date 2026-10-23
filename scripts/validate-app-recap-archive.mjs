import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async relative=>JSON.parse(await readFile(path.join(root,relative),'utf8'));
const script=await readFile(path.join(root,'data/app-recap-index.js'),'utf8');
const index=JSON.parse(script.slice(script.indexOf('=')+1).trim().replace(/;$/,''));
const report=await read('data/app-recap-details/import-report.json');
assert.equal(index.version,'20261023-recap-archive');
assert.equal(index.items.length,189);
const ids=new Set(),materials=new Set(),assetPaths=new Set();
const years={};
async function verifyAsset(url){
  assert.ok(url.startsWith('./assets/'),`Non-local production asset: ${url}`);
  const filename=path.resolve(root,url);
  assert.ok(filename.startsWith(root+path.sep),'Asset path escaped site');
  if(assetPaths.has(filename))return;
  const info=await stat(filename);
  assert.ok(info.isFile()&&info.size>0&&info.size<=25*1024*1024,`Invalid Pages asset: ${url}`);
  assetPaths.add(filename);
}
for(const item of index.items){
  assert.ok(!ids.has(item.id),`Duplicate card id: ${item.id}`);ids.add(item.id);
  assert.ok(item.productName&&item.title&&item.coverWidth>0&&item.coverHeight>0,'Missing product/aspect data');
  assert.ok(!item.materials,'Images must stay outside the initial catalog');
  assert.ok([2025,2024,2023,2022].includes(Number(item.appYear)),'Missing report year');
  assert.ok(item.tags.includes(String(item.appYear)),'Missing year filter');
  await verifyAsset(item.cover);await verifyAsset(item.preview);
  if(item.appIcon)await verifyAsset(item.appIcon);
  const detailsPath=path.resolve(root,item.materialsUrl);
  assert.ok(detailsPath.startsWith(path.join(root,'data/app-recap-details')+path.sep));
  const data=JSON.parse(await readFile(detailsPath,'utf8'));
  assert.equal(data.id,item.id);assert.equal(String(data.appYear),String(item.appYear));
  assert.equal(data.materials.length,item.imageCount);
  assert.ok((await stat(detailsPath)).size<100*1024,'Oversized per-app metadata');
  for(const material of data.materials){
    assert.equal(material.kind,'image');
    assert.ok(material.width>0&&material.height>0&&material.caption.includes(String(item.appYear)),'Missing image metadata');
    assert.ok(!materials.has(material.file),`Repeated image across app/year groups: ${material.file}`);materials.add(material.file);
    await verifyAsset(material.file);
  }
  years[item.appYear]??={products:0,images:0};
  years[item.appYear].products++;years[item.appYear].images+=item.imageCount;
}
for(const [year,counts]of Object.entries(years)){
  assert.equal(counts.products,report.years[year].products);
  assert.equal(counts.images,report.years[year].images);
}
assert.equal(materials.size,3807);
assert.equal(report.sourceImagesMapped,2974);
assert.equal(report.missingFiles.length,0);
const sources=report.sourceMapping;
assert.equal(sources.length,2974);assert.equal(new Set(sources.map(i=>i.source)).size,2974);
console.log(JSON.stringify({cards:ids.size,images:materials.size,checkedAssets:assetPaths.size,years,missing:0,externalImageDependencies:0},null,2));
