/** Only host-owned, already initialized registry metadata is consulted. */
export interface WorkspaceRegistry {
  readonly archivedSessionIds: readonly string[];
  list(): readonly { readonly path: string; readonly sessionIds: readonly string[] }[];
}
export function admitted(registry: WorkspaceRegistry | undefined, id: string): boolean {
  try { return !!registry && Array.isArray(registry.archivedSessionIds) && !registry.archivedSessionIds.includes(id)
    && registry.list().some(workspace => workspace.sessionIds.includes(id)); } catch { return false; }
}
export function candidates(registry: WorkspaceRegistry | undefined, cwd: string): string[] {
  if (!registry) throw new Error('Workspace registry unavailable');
  return [...new Set(registry.list().filter(workspace => workspace.path === cwd).flatMap(workspace => [...workspace.sessionIds]))]
    .filter(id => admitted(registry, id));
}
