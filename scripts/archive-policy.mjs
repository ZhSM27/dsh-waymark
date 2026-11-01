import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

/** Retire archive-unaware readers for user data; they may only touch isolated research roots. */
export async function assertPrivateResearchRoot(root,privateRoot=resolve('.research')) {
  const [target,base]=await Promise.all([realpath(root),realpath(privateRoot)]);
  if(target!==base&&!target.startsWith(base+sep))throw new Error('Archive-unaware reader refused user data; use prepare-unarchived-review with authoritative archive metadata');
}

/** Strict research policy, deliberately stricter than dsh's legacy schema defaults. */
export function parseWorkspacePolicy(document) {
  const state=document?.global,table=document?.tables?.workspaces;
  if(document?.unit?.name!=='workspace'||document.unit.version!==2||state?.initialized!==true||state.pendingMutation!==undefined
    ||!Array.isArray(state.archivedSessionIds)||!Array.isArray(state.workspaceIds)||!table||typeof table!=='object'||Array.isArray(table)) {
    throw new Error('Archive metadata unavailable, unknown or changing; refusing session reads');
  }
  const strings=values=>values.every(value=>typeof value==='string'&&value.length>0)&&new Set(values).size===values.length;
  if(!strings(state.archivedSessionIds)||!strings(state.workspaceIds))throw new Error('Invalid archive registry');
  const owners=new Map();
  for(const workspace of state.workspaceIds) {
    const row=table[workspace];
    if(!row||!Array.isArray(row.sessionIds)||!strings(row.sessionIds))throw new Error('Invalid workspace ownership');
    for(const id of row.sessionIds){if(owners.has(id))throw new Error('Duplicate session ownership');owners.set(id,workspace);}
  }
  if(Object.keys(table).some(key=>!state.workspaceIds.includes(key)))throw new Error('Unordered workspace record');
  const archived=new Set(state.archivedSessionIds);
  return {archived,allowed:new Set([...owners.keys()].filter(id=>!archived.has(id))),owners};
}

export async function loadArchivePolicy(path) {
  const bytes=await readFile(path);
  return {...parseWorkspacePolicy(JSON.parse(bytes.toString('utf8'))),digest:createHash('sha256').update(bytes).digest('hex')};
}

export function allowHeader(header,storedVersion,allowed) {
  return storedVersion===4&&allowed.has(header?.id)&&header?.version===4&&header.isSeeded===false
    &&header.parentSession===undefined&&header.origin===undefined&&(header.delegationDepth??0)===0;
}

export function encodeSessionSegment(raw) {
  if(!raw)throw new Error('Empty session id');
  if(raw==='.'||raw==='..')return raw.split('').map(()=>'~002E').join('');
  return raw.split('').map(ch=>ch!=='~'&&/^[A-Za-z0-9._-]$/.test(ch)?ch:'~'+ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')).join('');
}
