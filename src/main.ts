import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, ViewStateResult, EditorSelection } from 'obsidian';
import { DEFAULT_ROOT, inside, NotesStore, Session, Settings, settings, StorageConflict, vaultPath, RenameTracker } from './model';
const VIEW = 'murmuration-scene-notes';
type Position = { selections: EditorSelection[]; scroll: { left: number; top: number } };

class Confirm extends Modal {
  constructor(app: App, private question: string, private action: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.createEl('h2', {text: 'Resolve unsaved Scene Notes'});
    this.contentEl.createEl('p', {text: this.question});
    new Setting(this.contentEl).addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Confirm').setWarning().onClick(async () => { this.close(); try { await this.action(); } catch (error) { new Notice(String(error), 10000); } }));
  }
  onClose(): void { this.contentEl.empty(); }
}

class SceneNotesView extends MarkdownView {
  notesSession: Session | null = null;
  private notesBanner!: HTMLElement;
  private notesStatus!: HTMLElement;
  private notesSourceLabel!: HTMLElement;
  private notesOpenButton!: HTMLButtonElement;
  private notesRecovery!: HTMLElement;
  private notesPositions = new Map<string, Position>();
  private notesLoading = true;
  private notesClosed = false;
  private notesTurn = 0;
  private notesAttaching = false;
  private notesLoadError: string | null = null;
  private notesWork: Promise<void> = Promise.resolve();
  constructor(leaf: WorkspaceLeaf, readonly sceneNotesPlugin: SceneNotesPlugin) {
    super(leaf); this.allowNoFile = true;
    // Public TextFileView save hooks: capture the bound notesSession, never the later
    // active source. Native Markdown editing itself remains entirely Obsidian's.
    this.requestSave = () => this.capture();
  }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'Scene Notes'; }
  getIcon(): string { return 'notebook-pen'; }
  async onOpen(): Promise<void> {
    this.notesClosed = false; await super.onOpen(); this.contentEl.addClass('scene-notes');
    this.notesBanner = this.contentEl.createDiv({cls:'scene-notes-banner'}); this.contentEl.prepend(this.notesBanner);
    this.notesBanner.createEl('strong', {text:'Scene Notes'});
    this.notesSourceLabel = this.notesBanner.createDiv({cls:'scene-notes-source'});
    this.notesOpenButton = this.notesBanner.createEl('button', {text:'Open note as document'});
    this.notesOpenButton.addEventListener('click', () => {
      const file = this.notesSession && this.app.vault.getAbstractFileByPath(this.notesSession.path);
      if (file instanceof TFile) void this.app.workspace.getLeaf('tab').openFile(file);
    });
    this.notesStatus = this.notesBanner.createDiv({cls:'scene-notes-status', attr:{role:'status'}});
    this.notesRecovery = this.notesBanner.createDiv({cls:'scene-notes-recovery'});
    this.notesRecovery.createEl('button', {text:'Use saved version…'}).addEventListener('click', () => {
      const s = this.notesSession; if (!s) return;
      new Confirm(this.app, 'Discard this local draft and load the saved sidecar? Compare or copy your draft first.', async () => { await this.sceneNotesPlugin.store.useSaved(s); this.sync(); }).open();
    });
    this.notesRecovery.createEl('button', {text:'Keep my draft…'}).addEventListener('click', () => {
      const s = this.notesSession; if (!s) return;
      new Confirm(this.app, `Replace the saved contents of ${s.path} with this draft? This is an explicit conflict resolution.`, async () => { await this.sceneNotesPlugin.store.keepDraft(s); this.sync(); }).open();
    });
    this.notesRecovery.createEl('button', {text:'Retry save'}).addEventListener('click', () => { if (this.notesSession) void this.sceneNotesPlugin.store.save(this.notesSession); });
    this.notesLoading = false; this.sync();
  }
  getState(): Record<string, unknown> {
    return {...super.getState(), sceneNotesSource: this.notesSession?.source || this.sceneNotesPlugin.store.config.lastSource, sceneNotesPosition: this.notesSession && !this.notesClosed ? this.position() : null};
  }
  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const value = state as {sceneNotesSource?: string; sceneNotesPosition?: Position};
    const source = value?.sceneNotesSource || this.notesSession?.source || this.sceneNotesPlugin.store.config.lastSource;
    if (source && this.sceneNotesPlugin.store.isSource(source)) {
      if (value?.sceneNotesPosition) this.notesPositions.set(source, value.sceneNotesPosition);
      await this.follow(source);
    }
  }
  private position(): Position { return {selections: this.editor.listSelections(), scroll: this.editor.getScrollInfo()}; }
  capture(): void {
    if (this.notesClosed || this.notesLoading || !this.notesSession) return;
    const text = this.getViewData();
    if (text !== this.notesSession.text) void this.sceneNotesPlugin.store.edit(this.notesSession, text);
  }
  async save(): Promise<void> { this.capture(); if (this.notesSession) await this.sceneNotesPlugin.store.save(this.notesSession); }
  // Native file refreshes must not replace a dirty notesSession. The store performs
  // conflict detection and calls sync after its serial read/compare completes.
  setViewData(data: string, clear: boolean): void {
    if (!this.notesLoading && this.notesSession && data !== this.notesSession.text) { void this.sceneNotesPlugin.refresh(this.notesSession.path); return; }
    super.setViewData(data, clear);
  }
  follow(source: string): Promise<void> {
    if (this.notesClosed) return Promise.resolve();
    const notesTurn = ++this.notesTurn;
    this.capture();
    this.notesWork = this.notesWork.catch(() => {}).then(async () => {
      if (notesTurn !== this.notesTurn || this.notesSession?.source === source) { this.sync(); return; }
      if (this.notesSession) { this.notesPositions.set(this.notesSession.source, this.position()); await this.sceneNotesPlugin.store.save(this.notesSession); }
      const notesSession = await this.sceneNotesPlugin.store.load(source);
      if (notesTurn !== this.notesTurn) return;
      this.notesLoading = true; this.contentEl.addClass('scene-notes-loading'); this.contentEl.setAttribute('aria-busy','true');
      try {
        const old = this.file;
        if (old) await super.onUnloadFile(old);
        this.file = null; this.notesSession = notesSession; this.notesLoadError = null;
        const file = this.app.vault.getAbstractFileByPath(notesSession.path);
        if (file instanceof TFile) await super.setState({file: file.path, mode:'source'}, {history:false});
        super.setViewData(notesSession.text, true); this.data = notesSession.text;
        const position = this.notesPositions.get(source);
        if (position && Array.isArray(position.selections)) {
          try { this.editor.setSelections(position.selections); this.editor.scrollTo(position.scroll.left, position.scroll.top); } catch { /* shorter external document: native default cursor */ }
        }
      } finally { this.notesLoading = false; this.contentEl.removeClass('scene-notes-loading'); this.contentEl.removeAttribute('aria-busy'); }
      this.sync(); this.app.workspace.requestSaveLayout();
    }).catch(error => { this.notesLoading = false; this.notesSession = null; this.notesLoadError = `Could not open notes for ${source}: ${String(error)}`; this.sync(); new Notice(this.notesLoadError, 10000); });
    return this.notesWork;
  }
  sync(): void {
    if (this.notesClosed || !this.notesBanner || this.notesLoading) return;
    const s = this.notesSession;
    if (s && this.getViewData() !== s.text) {
      const position = this.position(); this.notesLoading = true;
      try { super.setViewData(s.text, false); this.data = s.text; this.editor.setSelections(position.selections); this.editor.scrollTo(position.scroll.left, position.scroll.top); } finally { this.notesLoading = false; }
    }
    this.notesSourceLabel.setText(s ? s.source : 'Open a Markdown document, then write here.');
    this.notesSourceLabel.title = s ? `Sidecar: ${s.path}` : '';
    const file = s && this.app.vault.getAbstractFileByPath(s.path);
    this.notesOpenButton.disabled = !(file instanceof TFile);
    const missingSource = s && !(this.app.vault.getAbstractFileByPath(s.source) instanceof TFile);
    this.notesStatus.setText(!s ? this.notesLoadError || 'Scene Notes follows the most recently active Markdown source outside the notes root.' : s.error ? `Unsaved: ${s.error}` : s.conflict ? 'Unsaved conflict. Compare the saved note and your draft.' : missingSource ? 'Source is missing. Its notes are retained.' : s.base === null ? `No sidecar yet. Start writing to create ${s.path}.` : s.dirty ? 'Saving…' : `Saved · ${s.path}`);
    this.notesRecovery.hidden = !s || (!s.error && !s.conflict);
    this.contentEl.toggleClass('scene-notes-no-source', !s);
    if (s && file instanceof TFile && this.file !== file && !this.notesAttaching) {
      const notesTurn = this.notesTurn; this.notesAttaching = true;
      this.notesWork = this.notesWork.catch(() => {}).then(async () => {
        if (this.notesSession !== s || notesTurn !== this.notesTurn || this.notesLoading) return;
        const position = this.position();
        await super.setState({file: file.path, mode:'source'}, {history:false});
        if (this.notesSession === s && notesTurn === this.notesTurn) {
          this.editor.setSelections(position.selections); this.editor.scrollTo(position.scroll.left, position.scroll.top);
        }
      }).catch(error => { new Notice(`Scene Notes could not bind its native document: ${String(error)}`, 10000); })
        .finally(() => { this.notesAttaching = false; });
    }
  }
  async onClose(): Promise<void> { this.capture(); this.notesClosed = true; ++this.notesTurn; await this.notesWork; await this.save(); await this.sceneNotesPlugin.persist(); await super.onClose(); }
}

export default class SceneNotesPlugin extends Plugin {
  store!: NotesStore;
  private writes: Promise<void> = Promise.resolve();
  private renamedFiles = new RenameTracker();
  private opening: Promise<void> | null = null;
  async onload(): Promise<void> {
    const config = settings(await this.loadData());
    const read = async (path: string): Promise<string | null> => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return null;
      if (!(file instanceof TFile)) throw Error(`${path} is a folder, not a Markdown sidecar.`);
      return this.app.vault.read(file);
    };
    const parents = async (file: string) => {
      const bits = file.split('/'); bits.pop(); let current = '';
      for (const bit of bits) { current = current ? current + '/' + bit : bit; const entry = this.app.vault.getAbstractFileByPath(current); if (entry && !(entry instanceof TFolder)) throw Error(`${current} is not a folder.`); if (!entry) await this.app.vault.createFolder(current); }
    };
    this.store = new NotesStore(config, {
      read,
      create: async (path, text) => { await parents(path); await this.app.vault.create(path, text); },
      replace: async (path, expected, text) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new StorageConflict(`Sidecar ${path} was removed or moved; your draft is retained.`);
        await this.app.vault.process(file, current => { if (current !== expected) throw new StorageConflict(`Sidecar ${path} changed outside Scene Notes. Compare before replacing it.`); return text; });
      },
      move: async (from, to) => {
        if (this.app.vault.getAbstractFileByPath(to)) throw Error(`Destination already exists: ${to}`);
        const file = this.app.vault.getAbstractFileByPath(from); if (!(file instanceof TFile)) throw Error(`Missing sidecar: ${from}`);
        await parents(to); await this.app.vault.rename(file, to);
      }
    }, () => this.views().forEach(view => view.sync()), () => this.persist());
    this.registerView(VIEW, leaf => new SceneNotesView(leaf, this));
    this.addCommand({id:'open-scene-notes', name:'Open Scene Notes', callback: () => { void this.open(); }});
    this.addSettingTab(new SceneNotesSettings(this.app, this));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => this.track(leaf)));
    this.registerEvent(this.app.workspace.on('file-open', () => this.track(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf || null)));
    this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => { if (info instanceof SceneNotesView) info.capture(); }));
    this.registerEvent(this.app.vault.on('modify', file => { void this.refresh(file.path); }));
    this.registerEvent(this.app.vault.on('delete', file => { void this.refresh(file.path); this.views().forEach(v => v.sync()); }));
    this.registerEvent(this.app.vault.on('rename', (file, old) => { void this.renamed(file.path, old); }));
    this.app.workspace.onLayoutReady(() => { this.track(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf || null); });
  }
  views(): SceneNotesView[] { return this.app.workspace.getLeavesOfType(VIEW).map(leaf => leaf.view).filter((view): view is SceneNotesView => view instanceof SceneNotesView); }
  persist(): Promise<void> {
    const save = this.writes.catch(() => {}).then(() => this.saveData(this.store.snapshot()));
    this.writes = save; return save;
  }
  async refresh(path: string): Promise<void> { try { await this.store.refresh(path); } catch (error) { new Notice(`Scene Notes could not refresh ${path}: ${String(error)}`, 10000); } }
  private track(leaf: WorkspaceLeaf | null): void {
    const view = leaf?.view;
    if (!(view instanceof MarkdownView) || view instanceof SceneNotesView || !view.file || !this.store.isSource(view.file.path)) return;
    this.store.config.lastSource = view.file.path;
    for (const notes of this.views()) void notes.follow(view.file.path);
  }
  async open(): Promise<void> {
    if (this.opening) return this.opening;
    const request = this.openPanel(); this.opening = request;
    try { await request; } finally { this.opening = null; }
  }
  private async openPanel(): Promise<void> {
    try {
      this.track(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf || null);
      let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
      if (!leaf) { const right = this.app.workspace.getRightLeaf(false); if (!right) throw Error('No right sidebar leaf is available.'); leaf = right; await leaf.setViewState({type:VIEW, active:false}); }
      await leaf.loadIfDeferred();
      const source = this.store.config.lastSource;
      if (source && leaf.view instanceof SceneNotesView) await leaf.view.follow(source);
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { new Notice(`Scene Notes: ${String(error)}`, 10000); }
  }
  private async renamed(path: string, old: string): Promise<void> {
    if (this.store.config.excludedRoots.some(root => inside(root, old) || inside(root, path))) { await this.refresh(old); return; }
    const sources = new Set([...this.store.sessions.keys(), ...Object.keys(this.store.config.associations), ...Object.keys(this.store.config.drafts)]);
    for (const file of this.app.vault.getMarkdownFiles()) if (inside(path, file.path)) sources.add(old + file.path.slice(path.length));
    if (/\.md$/i.test(old)) sources.add(old);
    for (const source of sources) if (inside(old, source)) {
      const next = path + source.slice(old.length), file = this.app.vault.getAbstractFileByPath(next);
      if (!(file instanceof TFile) || !this.renamedFiles.claim(file, source, next)) continue;
      try { const warning = await this.store.rename(source, next); if (warning) new Notice(warning, 15000); }
      catch (error) { new Notice(`Scene Notes association needs review: ${String(error)}`, 15000); }
    }
    this.track(this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf || null);
    this.views().forEach(view => view.sync());
  }
  async changeRoot(value: string): Promise<void> {
    const root = vaultPath(value);
    if ([...this.store.sessions.keys(), this.store.config.lastSource || ''].some(source => source && inside(root, source))) throw Error('The notes root must not contain a tracked manuscript source.');
    if (root === this.store.config.root) return;
    await this.store.flushAll();
    if ([...this.store.sessions.values()].some(s => s.dirty)) throw Error('Resolve unsaved notes before changing the root.');
    // Existing associations remain usable; a new root applies to new sources.
    for (const s of this.store.sessions.values()) if (s.base !== null) this.store.config.associations[s.source] = s.path;
    const oldRoot = this.store.config.root;
    for (const file of this.app.vault.getMarkdownFiles()) if (inside(oldRoot, file.path)) { const source = file.path.slice(oldRoot.length + 1); if (/\.md$/i.test(source) && !Object.entries(this.store.config.associations).some(([other, target]) => other !== source && target === file.path)) this.store.config.associations[source] ||= file.path; }
    this.store.config.root = root;
    if (!this.store.config.excludedRoots.includes(root)) this.store.config.excludedRoots.push(root);
    for (const s of this.store.sessions.values()) if (s.base === null) s.path = this.store.pathFor(s.source);
    await this.persist(); this.views().forEach(view => view.sync());
  }
  onunload(): void { void this.store?.flushAll().catch(error => new Notice(`Scene Notes could not finish saving: ${String(error)}`, 15000)); }
}
class SceneNotesSettings extends PluginSettingTab {
  constructor(app: App, private plugin: SceneNotesPlugin) { super(app, plugin); }
  display(): void {
    this.containerEl.empty(); this.containerEl.createEl('h2', {text:'Scene Notes'});
    let value = this.plugin.store.config.root;
    new Setting(this.containerEl).setName('Notes root').setDesc(`Default: ${DEFAULT_ROOT}/. Existing associations stay where they are; new sources use the new root. Both roots remain excluded from source tracking.`)
      .addText(text => text.setValue(value).onChange(next => { value = next; }))
      .addButton(button => button.setButtonText('Apply').onClick(async () => { try { await this.plugin.changeRoot(value); new Notice('Scene Notes root saved.'); this.display(); } catch (error) { new Notice(String(error), 10000); } }));
  }
}
