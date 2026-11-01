import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadArchivePolicy} from './archive-policy.mjs';
import {createHash} from 'node:crypto';
const directory=process.argv[2];if(!directory)throw new Error('Pass review directory');
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));
const policy=await loadArchivePolicy(manifest.metadataPath);
if(manifest.scope!=='unarchived-only'||policy.digest!==manifest.metadataDigest||manifest.sources.some(item=>!policy.allowed.has(item.id))) {
  throw new Error('Archive status changed or unknown; do not read/use the packet');
}
if(!manifest.packetDigests?.['agent-packet.json'])throw new Error('Packet provenance missing; rebuild the review');
for(const [name,digest]of Object.entries(manifest.packetDigests)) {
  if(!/^[a-z-]+\.json$/.test(name))throw new Error('Invalid packet filename');
  const bytes=await readFile(resolve(directory,name));
  if(createHash('sha256').update(bytes).digest('hex')!==digest)throw new Error('Review packet changed; do not use previous judgments');
}
console.log(JSON.stringify({approved:true,unarchivedSessions:manifest.sources.length}));
