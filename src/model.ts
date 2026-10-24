/** Vault-independent association and serial, compare-before-write storage. */
export const DEFAULT_ROOT = 'Scene Notes';
export function vaultPath(value: string): string {
  const path = value.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!path.trim() || path.startsWith('/') || /[\x00-\x1f:]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw Error('Use a non-hidden, vault-relative folder/path without . or .. segments.');
  return path;
}
export function inside(root: string, file: string): boolean { return file === root || file.startsWith(root + '/'); }
export function notePath(root: string, source: string): string {
  root = vaultPath(root); source = vaultPath(source);
  if (!/\.md$/i.test(source) || inside(root, source)) throw Error('Choose a Markdown source outside the notes root.');
  return `${root}/${source}`;
}
export interface Draft { path: string; base: string | null; text: string; }
export interface Settings { root: string; excludedRoots: string[]; associations: Record<string, string>; drafts: Record<string, Draft>; lastSource: string | null; }
export function settings(raw: unknown): Settings {
  const value = raw as Partial<Settings> | null;
  let root = DEFAULT_ROOT;
  try { if (typeof value?.root === 'string') root = vaultPath(value.root); } catch { /* safe default */ }
  const excludedRoots = [root];
  for (const r of Array.isArray(value?.excludedRoots) ? value.excludedRoots : []) { try { const valid = vaultPath(r); if (!excludedRoots.includes(valid)) excludedRoots.push(valid); } catch { /* ignore unsafe old settings */ } }
  const associations: Record<string, string> = Object.create(null), drafts: Record<string, Draft> = Object.create(null);
  for (const [source, path] of Object.entries(value?.associations || {})) {
    try { if (vaultPath(source) === source && vaultPath(path) === path && excludedRoots.some(r => inside(r, path))) associations[source] = path; } catch { /* unsafe persisted value */ }
  }
  for (const [source, draft] of Object.entries(value?.drafts || {})) {
    try { if (vaultPath(source) === source && typeof draft.text === 'string' && (draft.base === null || typeof draft.base === 'string') && vaultPath(draft.path) === draft.path && excludedRoots.some(r => inside(r, draft.path))) drafts[source] = draft; } catch { /* unsafe persisted value */ }
  }
  return { root, excludedRoots, associations, drafts, lastSource: typeof value?.lastSource === 'string' ? value.lastSource : null };
}
export class StorageConflict extends Error {}
export interface Storage {
  read(path: string): Promise<string | null>;
  create(path: string, text: string): Promise<void>;
  replace(path: string, expected: string, text: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
}
export interface Session { source: string; path: string; text: string; base: string | null; dirty: boolean; conflict: boolean; error: string | null; }
export class NotesStore {
  readonly sessions = new Map<string, Session>();
  private chain: Promise<unknown> = Promise.resolve();
  constructor(public config: Settings, private disk: Storage, private changed: () => void = () => {}, private checkpoint: () => Promise<void> = async () => {}) {}
  private serial<T>(action: () => Promise<T>): Promise<T> { const work = this.chain.then(action); this.chain = work.catch(() => {}); return work; }
  isSource(path: string): boolean { return /\.md$/i.test(path) && !this.config.excludedRoots.some(root => inside(root, path)); }
  pathFor(source: string): string {
    const target = this.config.associations[source] || notePath(this.config.root, source);
    const owner = Object.entries(this.config.associations).find(([other, path]) => other !== source && path === target);
    if (owner) throw Error(`Sidecar ${target} is retained for ${owner[0]} after a rename collision. Resolve that association before creating notes for ${source}.`);
    return target;
  }
  snapshot(): Settings {
    const drafts: Record<string, Draft> = Object.create(null);
    for (const [source, draft] of Object.entries(this.config.drafts)) drafts[source] = draft;
    for (const s of this.sessions.values()) { if (s.dirty) drafts[s.source] = { path: s.path, base: s.base, text: s.text }; else delete drafts[s.source]; }
    return { ...this.config, excludedRoots: [...this.config.excludedRoots], associations: { ...this.config.associations }, drafts };
  }
  load(source: string): Promise<Session> {
    return this.serial(async () => {
      if (!this.isSource(source)) throw Error('This document is not a scene-notes source.');
      const existing = this.sessions.get(source); if (existing) return existing;
      const path = this.pathFor(source), base = await this.disk.read(path), draft = this.config.drafts[source];
      const restored = draft && draft.path === path && draft.text !== base;
      const session: Session = {source, path, base: restored ? draft.base : base, text: restored ? draft.text : base || '', dirty: Boolean(restored), conflict: Boolean(restored && base !== draft.base), error: null};
      this.sessions.set(source, session); return session;
    });
  }
  edit(s: Session, text: string): Promise<void> {
    s.text = text; s.dirty = s.conflict || (s.base === null ? text !== '' : text !== s.base); s.error = null; this.changed();
    return this.serial(() => this.flushOne(s));
  }
  private async flushOne(s: Session): Promise<void> {
    while (s.dirty && !s.conflict) {
      const text = s.text;
      try {
        await this.checkpoint();
        if (s.base === null) {
          if (await this.disk.read(s.path) !== null) { s.conflict = true; throw Error('A sidecar appeared while you were editing. Compare the saved note before replacing it.'); }
          await this.disk.create(s.path, text);
        } else await this.disk.replace(s.path, s.base, text);
        s.base = text; s.dirty = s.text !== text; s.error = null;
      } catch (error) { if (error instanceof StorageConflict) s.conflict = true; s.error = error instanceof Error ? error.message : String(error); this.changed(); return; }
    }
    this.changed();
  }
  save(s: Session): Promise<void> { return this.serial(() => this.flushOne(s)); }
  flushAll(): Promise<void> { return this.serial(async () => { for (const s of this.sessions.values()) await this.flushOne(s); await this.checkpoint(); }); }
  refresh(path: string): Promise<void> {
    return this.serial(async () => {
      for (const s of this.sessions.values()) if (s.path === path) {
        const actual = await this.disk.read(path);
        if (actual === s.base) continue;
        if (s.dirty && actual !== s.text) { s.conflict = true; s.error = 'Saved notes changed outside this panel. Your unsaved draft is preserved; compare before choosing a version.'; }
        else { s.base = actual; s.text = actual || ''; s.dirty = false; s.conflict = false; s.error = null; }
      }
      this.changed(); await this.checkpoint();
    });
  }
  useSaved(s: Session): Promise<void> { return this.serial(async () => { s.base = await this.disk.read(s.path); s.text = s.base || ''; s.dirty = false; s.conflict = false; s.error = null; this.changed(); await this.checkpoint(); }); }
  keepDraft(s: Session): Promise<void> { return this.serial(async () => { s.base = await this.disk.read(s.path); s.conflict = false; s.dirty = s.text !== (s.base ?? ''); await this.flushOne(s); await this.checkpoint(); }); }
  rename(oldSource: string, source: string): Promise<string | null> {
    return this.serial(async () => {
      if (!this.isSource(oldSource) || !this.isSource(source)) return null;
      const s = this.sessions.get(oldSource), destination = this.sessions.get(source);
      if (destination && destination !== s && destination.dirty) throw Error(`Destination ${source} has an unsaved notes draft. Resolve it first; notes for ${oldSource} remain at ${this.pathFor(oldSource)}.`);
      if (s) { await this.flushOne(s); if (s.dirty) { this.config.associations[source] = s.path; } }
      const from = this.pathFor(oldSource), to = notePath(this.config.root, source);
      let warning: string | null = null, resolved = from;
      if (from !== to && await this.disk.read(from) !== null) {
        try { await this.disk.move(from, to); resolved = to; }
        catch (error) { warning = `Notes retained at ${from}; could not move to ${to}: ${error instanceof Error ? error.message : String(error)}. Neither file was overwritten.`; }
      } else if (from === to || await this.disk.read(to) === null) resolved = to;
      else warning = `Existing notes at ${to} do not belong to the renamed source. The association remains ${from}; neither file was overwritten.`;
      delete this.config.associations[oldSource]; if (resolved !== to) this.config.associations[source] = resolved; else delete this.config.associations[source];
      if (s) { this.sessions.delete(oldSource); s.source = source; s.path = resolved; this.sessions.set(source, s); }
      if (this.config.drafts[oldSource]) { this.config.drafts[source] = {...this.config.drafts[oldSource], path: resolved}; delete this.config.drafts[oldSource]; }
      if (this.config.lastSource === oldSource) this.config.lastSource = source;
      this.changed(); await this.checkpoint(); return warning;
    });
  }
}

/** A folder move can also produce child-file events. Deduplicate by the actual
 * host file identity, not its title/path (a later replacement file is distinct). */
export class RenameTracker {
  private seen = new WeakMap<object, string>();
  claim(file: object, from: string, to: string): boolean {
    const pair = `${from}\0${to}`;
    if (this.seen.get(file) === pair) return false;
    this.seen.set(file, pair); return true;
  }
}
