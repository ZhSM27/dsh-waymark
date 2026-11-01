import test from 'node:test';
import assert from 'node:assert/strict';
import {zstdCompressSync} from 'node:zlib';
import {readHeaderFrame} from '../scripts/header-frame.mjs';
function fakeHandle(bytes) {
  let furthest=0;
  return {async read(target,offset,length,position){const size=Math.max(0,Math.min(length,bytes.length-position));bytes.copy(target,offset,position,position+size);furthest=Math.max(furthest,position+size);return{bytesRead:size};},get furthest(){return furthest;}};
}
test('header reader does not request bytes from following event frames',async()=>{
  const header=zstdCompressSync(Buffer.from(JSON.stringify({version:4,isSeeded:false,id:'synthetic'})+'\n'));
  const body=zstdCompressSync(Buffer.from('{"type":"synthetic-private-event"}\n'));
  const handle=fakeHandle(Buffer.concat([header,body]));
  const result=await readHeaderFrame(handle);
  assert.equal(result.value.id,'synthetic');assert.equal(handle.furthest,header.length);assert.deepEqual(result.frame,header);
});
test('mixed header/body frames and non-zstd input are refused',async()=>{
  const mixed=zstdCompressSync(Buffer.from('{"version":4}\n{"type":"synthetic-event"}\n'));
  await assert.rejects(readHeaderFrame(fakeHandle(mixed)),/independent header/);
  await assert.rejects(readHeaderFrame(fakeHandle(Buffer.from('not-zstd'))),/encoding/);
});
