import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Explicit exports only, constrained to a workspace-owned directory and no overwrite. */
export async function exportMarkdown(cwd:string,filename:string,body:string,signal:AbortSignal):Promise<string> {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.md$/.test(filename)||filename.toLowerCase()==='agents.md') throw new TypeError('Use a simple Markdown filename');
  signal.throwIfAborted();
  const workspace=await realpath(cwd);
  let directory=workspace;
  for(const part of ['.waymark','reports']) {
    directory=join(directory,part);
    await mkdir(directory,{recursive:true});
    const info=await lstat(directory);
    if(info.isSymbolicLink()||!info.isDirectory()||await realpath(directory)!==directory) throw new Error('Linked export directory refused');
  }
  signal.throwIfAborted();
  const target=join(directory,filename);
  await writeFile(target,body,{encoding:'utf8',flag:'wx',signal});
  return target;
}
