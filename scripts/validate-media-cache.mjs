import {readFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={window:{}};vm.createContext(context);
for(const file of ['data/content.js','data/inspiration-media.js'])vm.runInContext(await readFile(path.join(root,file),'utf8'),context);
const data=context.window.INSPO_STATIC_DATA,manifest=context.window.INSPO_INSPIRATION_MEDIA;
const json=value=>JSON.parse(JSON.stringify(value));
const previous={window:{}};vm.runInNewContext(execFileSync('git',['show','HEAD:data/content.js'],{cwd:root,encoding:'utf8',maxBuffer:5*1024*1024}),previous);
assert.deepEqual(json(data.sections),json(previous.window.INSPO_STATIC_DATA.sections));
assert.deepEqual(json(data.items.items.filter(i=>i.section!=='inspiration')),json(previous.window.INSPO_STATIC_DATA.items.items.filter(i=>i.section!=='inspiration')));
function atoms(bytes,start=0,end=bytes.length){
  const found=[];for(let at=start;at+8<=end;){let size=bytes.readUInt32BE(at),header=8;if(size===1){size=Number(bytes.readBigUInt64BE(at+8));header=16;}if(size===0)size=end-at;if(size<header||at+size>end)break;found.push({name:bytes.toString('ascii',at+4,at+8),start:at+header,end:at+size,at});at+=size;}return found;
}
function info(bytes){const top=atoms(bytes),moov=top.find(a=>a.name==='moov'),mdat=top.find(a=>a.name==='mdat');assert.ok(moov&&mdat);const mvhd=atoms(bytes,moov.start,moov.end).find(a=>a.name==='mvhd');const version=bytes[mvhd.start];const offset=mvhd.start+(version===1?20:12);const scale=bytes.readUInt32BE(offset),duration=version===1?Number(bytes.readBigUInt64BE(offset+4)):bytes.readUInt32BE(offset+4);return{fast:moov.at<mdat.at,duration:duration/scale,h264:bytes.subarray(moov.start,moov.end).includes(Buffer.from('avc1'))};}
let before=0,after=0,needsFullRemux=[];
for(const [source,asset] of Object.entries(manifest.previews)){
 const old=await readFile(path.join(root,source)),preview=await readFile(path.join(root,asset.file));
 const original=info(old),encoded=info(preview);assert.ok(encoded.fast&&encoded.h264,`Invalid preview ${source}`);
 assert.ok(Math.abs(original.duration-encoded.duration)<0.15,`Changed duration ${source}: ${original.duration} -> ${encoded.duration}`);
 if(!original.fast)needsFullRemux.push(source);
 assert.equal(preview.length,asset.bytes);assert.equal(old.length,asset.sourceBytes);
 before+=old.length;after+=preview.length;
}
const inspiration=data.items.items.filter(i=>i.section==='inspiration');
for(const item of inspiration){assert.ok(item.cover.startsWith('./assets/inspiration-previews/'));assert.ok((await stat(path.join(root,item.cover))).size>0);if(item.video){assert.ok(manifest.previews[item.video]);assert.ok((await stat(path.join(root,item.video))).size>0);}}
const ux=data.items.items.filter(i=>i.section==='ux-bites');for(const item of ux)assert.ok((await stat(path.join(root,item.cover))).size>0);
console.log(JSON.stringify({inspiration:inspiration.length,videos:Object.keys(manifest.previews).length,sourceMB:+(before/1024**2).toFixed(1),previewMB:+(after/1024**2).toFixed(1),reductionPercent:+((1-after/before)*100).toFixed(1),allPreviewsFastStart:true,fullVideosNeedingRemux:needsFullRemux,uxBites:ux.length,otherContentUnchanged:true},null,2));
