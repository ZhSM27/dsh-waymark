import {zstdDecompressSync} from 'node:zlib';

/** Read exactly one v4 header frame, never request bytes from the next event frame.
 * Frame layout verified against the installed dsh JSONL scanner (scanZstdFrames).
 */
export async function readHeaderFrame(handle) {
  const chunks=[];let position=0;
  async function take(length) {
    if(position+length>65536)throw new Error('Header frame exceeds metadata bound');
    const buffer=Buffer.alloc(length);let received=0;
    while(received<length){const {bytesRead}=await handle.read(buffer,received,length-received,position+received);if(!bytesRead)throw new Error('Incomplete header frame');received+=bytesRead;}
    position+=length;chunks.push(buffer);return buffer;
  }
  const magic=await take(4);if(magic.readUInt32LE()!==0xfd2fb528)throw new Error('Unsupported header-frame encoding');
  const descriptor=(await take(1))[0];
  if(descriptor&24)throw new Error('Reserved header-frame flags');
  const single=!!(descriptor&32),dictionary=descriptor&3,sizeFlag=descriptor>>>6;
  const remainder=(single?0:1)+(dictionary===3?4:dictionary)+(sizeFlag===0?(single?1:0):1<<sizeFlag);
  if(remainder)await take(remainder);
  for(;;){
    const block=(await take(3)).readUIntLE(0,3),type=(block>>>1)&3;
    if(type===3)throw new Error('Reserved frame block');
    const length=type===1?1:block>>>3;if(length)await take(length);
    if(block&1)break;
  }
  if(descriptor&4)await take(4);
  const frame=Buffer.concat(chunks),plain=zstdDecompressSync(frame,{maxOutputLength:65536});
  if(!plain.length||plain.indexOf(10)!==plain.length-1)throw new Error('First frame must be exactly one independent header line');
  return {frame,value:JSON.parse(plain.toString('utf8'))};
}
