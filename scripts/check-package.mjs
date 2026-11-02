import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
const destination=resolve('.research/packages');await mkdir(destination,{recursive:true});
const npm=[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].find(path=>existsSync(path));
if(!npm)throw new Error('Cannot locate the npm CLI shipped with Node.js');
const run=spawnSync(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination',destination],{encoding:'utf8'});
if(run.status!==0)throw new Error('Local npm pack failed');
const [manifest]=JSON.parse(run.stdout);
for(const file of manifest.files) {
  if(!/^(?:lib\/|docs\/|README\.md$|LICENSE$|package\.json$|cordis\.patch\.yml$)/.test(file.path))throw new Error('Unexpected packed content');
}
for(const required of ['lib/plugin.js','lib/plugin.d.ts','lib/core/index.js','lib/core/index.d.ts','LICENSE','cordis.patch.yml']) {
  if(!manifest.files.some(file=>file.path===required))throw new Error(`Missing ${required}`);
}
console.log(JSON.stringify({filename:manifest.filename,files:manifest.files.length,unpackedBytes:manifest.unpackedSize,sha512Integrity:manifest.integrity,localOnly:true}));
