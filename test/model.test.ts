import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_ROOT, inside, notePath, NotesStore, settings, Storage, StorageConflict, RenameTracker} from '../src/model';
class Disk implements Storage {
  files = new Map<string,string>(); writes: string[] = [];
  gate: Promise<void> = Promise.resolve();
  async read(path: string) { return this.files.get(path) ?? null; }
  async create(path: string, text: string) { await this.gate; if(this.files.has(path)) throw new StorageConflict('Destination exists'); this.files.set(path,text);this.writes.push(path); }
  async replace(path: string, expected: string, text: string) { await this.gate; if(this.files.get(path)!==expected) throw new StorageConflict('Saved note changed');this.files.set(path,text);this.writes.push(path); }
  async move(from: string,to:string){await this.gate;if(this.files.has(to))throw Error('Destination exists');if(!this.files.has(from))throw Error('Missing');this.files.set(to,this.files.get(from)!);this.files.delete(from);this.writes.push(to);}
}
function fixture() {const disk=new Disk(),store=new NotesStore(settings(null),disk);return{disk,store};}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
test('full vault-relative paths distinguish equal filenames and remain ordinary Markdown',()=>{
 assert.equal(notePath(DEFAULT_ROOT,'Books/First/Art.md'),'Scene Notes/Books/First/Art.md');
 assert.notEqual(notePath(DEFAULT_ROOT,'A/Art.md'),notePath(DEFAULT_ROOT,'B/Art.md'));
 assert.equal(notePath('Plans/Notes','空 間/Été.md'),'Plans/Notes/空 間/Été.md');
 assert.equal(notePath(DEFAULT_ROOT,' Leading/Title .md'),'Scene Notes/ Leading/Title .md');
});
test('reject invalid roots, traversal and non-Markdown; root exclusion respects segment boundaries',()=>{
 for(const root of ['','../notes','/notes','.obsidian','A/../B','A//B','C:/notes','A/./B'])assert.throws(()=>notePath(root,'A.md'));
 assert.throws(()=>notePath(DEFAULT_ROOT,'A.canvas'));assert.throws(()=>notePath(DEFAULT_ROOT,'Scene Notes/A.md'));
 assert.equal(inside('Scene Notes','Scene Notes Extra/A.md'),false);
 const{store}=fixture();assert.equal(store.isSource('Scene Notes/A.md'),false);assert.equal(store.isSource('A/Scene Notes.md'),true);
});
test('opening and switching are read-only; create only on first nonempty deliberate edit',async()=>{
 const{disk,store}=fixture();const a=await store.load('A/One.md');await store.load('B/One.md');await store.flushAll();assert.equal(disk.files.size,0);
 await store.edit(a,'');assert.equal(disk.files.size,0);await store.edit(a,'# Questions\n\nWhat next? [[B/One]]\n');assert.equal(disk.files.get(a.path),a.text);assert.equal(a.dirty,false);
 assert.ok(!a.text.startsWith('---'));assert.equal(disk.writes.length,1);
});
test('rapid switching and in-flight edits never cross session paths or drop later characters',async()=>{
 const{disk,store}=fixture();const a=await store.load('A/One.md'),b=await store.load('B/One.md');const gate=deferred();disk.gate=gate.promise;
 const first=store.edit(a,'A');await Promise.resolve();const second=store.edit(a,'A plus later text');const third=store.edit(b,'B only');gate.resolve();await Promise.all([first,second,third]);
 assert.equal(disk.files.get(a.path),'A plus later text');assert.equal(disk.files.get(b.path),'B only');assert.equal(a.dirty,false);assert.equal(b.dirty,false);
});
test('intentional empty existing notes remain files; replaying a clean session never writes',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/A.md','Keep');const s=await store.load('A.md');await store.edit(s,'');assert.equal(disk.files.get(s.path),'');const writes=disk.writes.length;await store.save(s);await store.load('A.md');assert.equal(disk.writes.length,writes);
});
test('rename/move follows a source, retaining text and leaving unrelated files untouched',async()=>{
 const{disk,store}=fixture();const s=await store.load('Books/Art.md');await store.edit(s,'Intentions.');disk.files.set('Scene Notes/Other.md','Other');
 assert.equal(await store.rename('Books/Art.md','Drafts/Renamed.md'),null);assert.equal(s.source,'Drafts/Renamed.md');assert.equal(s.path,'Scene Notes/Drafts/Renamed.md');assert.equal(disk.files.get(s.path),'Intentions.');assert.equal(disk.files.has('Scene Notes/Books/Art.md'),false);assert.equal(disk.files.get('Scene Notes/Other.md'),'Other');
});
test('rename without prior open finds existing notes and never creates absent notes',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/Old.md','Existing');await store.rename('Old.md','New.md');assert.equal(disk.files.get('Scene Notes/New.md'),'Existing');await store.rename('Unused.md','Unopened.md');assert.equal(disk.files.has('Scene Notes/Unopened.md'),false);
});
test('rename collision keeps both files and persists an exception association, including subsequent renames',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/Old.md','Old notes');disk.files.set('Scene Notes/New.md','New notes');const s=await store.load('Old.md');
 assert.match((await store.rename('Old.md','New.md'))!,/Destination already exists|Destination exists/);assert.equal(s.path,'Scene Notes/Old.md');assert.equal(store.pathFor('New.md'),s.path);assert.equal(disk.files.get('Scene Notes/New.md'),'New notes');await store.edit(s,'Retained association');assert.equal(disk.files.get('Scene Notes/Old.md'),'Retained association');
 const restored=new NotesStore(settings(store.snapshot()),disk);assert.equal((await restored.load('New.md')).text,'Retained association');await restored.rename('New.md','After.md');assert.equal(disk.files.get('Scene Notes/After.md'),'Retained association');assert.equal(disk.files.get('Scene Notes/New.md'),'New notes');
});
test('a new source with no prior sidecar cannot inherit an unrelated collision target on rename',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/New.md','Unrelated');await store.rename('Old.md','New.md');const s=await store.load('New.md');assert.equal(s.text,'');assert.equal(s.path,'Scene Notes/Old.md');assert.equal(disk.files.get('Scene Notes/New.md'),'Unrelated');
});
test('external changes refresh clean notes; unsaved changes cannot silently overwrite a changed file',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/A.md','Initial');const s=await store.load('A.md');disk.files.set(s.path,'External');await store.refresh(s.path);assert.equal(s.text,'External');
 disk.files.set(s.path,'Concurrent change');await store.edit(s,'My draft');assert.equal(s.conflict,true);assert.equal(s.dirty,true);assert.equal(disk.files.get(s.path),'Concurrent change');await store.refresh(s.path);assert.equal(s.text,'My draft');
 await store.edit(s,'My longer draft');assert.equal(disk.files.get(s.path),'Concurrent change');await store.keepDraft(s);assert.equal(disk.files.get(s.path),'My longer draft');assert.equal(s.dirty,false);
});
test('explicit reload discards a conflicted draft only after caller chooses it; deleted notes are not silently recreated',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/A.md','Initial');const s=await store.load('A.md');disk.files.delete(s.path);await store.edit(s,'Draft');assert.equal(s.conflict,true);assert.equal(disk.files.has(s.path),false);await store.useSaved(s);assert.equal(s.text,'');assert.equal(s.base,null);assert.equal(s.dirty,false);await store.save(s);assert.equal(disk.files.has(s.path),false);
});
test('failed saves preserve recoverable drafts and failed creation never overwrites a newly appeared sidecar',async()=>{
 const{disk,store}=fixture();const s=await store.load('A.md');disk.files.set(s.path,'Appeared');await store.edit(s,'Draft');assert.equal(s.conflict,true);assert.equal(disk.files.get(s.path),'Appeared');
 const restored=new NotesStore(settings(store.snapshot()),disk),draft=await restored.load('A.md');assert.equal(draft.text,'Draft');assert.equal(draft.conflict,true);
});
test('a durable checkpoint precedes each write; save failure leaves the bound draft available for retry',async()=>{
 const disk=new Disk();let fail=true;const checkpoints:string[]=[];let store:NotesStore;
 store=new NotesStore(settings(null),disk,()=>{},async()=>{checkpoints.push(JSON.stringify(store.snapshot()));if(fail)throw Error('Cannot persist recovery draft');});const s=await store.load('A.md');await store.edit(s,'Important');assert.equal(disk.files.size,0);assert.equal(s.dirty,true);assert.match(s.error!,/Cannot persist/);assert.match(checkpoints[0],/Important/);fail=false;await store.save(s);assert.equal(disk.files.get(s.path),'Important');
});
test('restored already-saved recovery records do not introduce false conflicts',async()=>{
 const disk=new Disk();disk.files.set('Scene Notes/A.md','Latest');const config=settings({drafts:{'A.md':{path:'Scene Notes/A.md',base:'Old',text:'Latest'}}});const store=new NotesStore(config,disk),s=await store.load('A.md');assert.equal(s.dirty,false);assert.equal(s.conflict,false);assert.deepEqual(Object.keys(store.snapshot().drafts),[]);
});
test('settings ignore unsafe persisted paths and preserve configured roots/exclusion history',()=>{
 const config=settings({root:'Plans',excludedRoots:['Scene Notes','../bad'],associations:{'A.md':'Scene Notes/Old.md','B.md':'../outside.md'},drafts:{'A.md':{path:'../bad',base:null,text:'No'}}});assert.equal(config.root,'Plans');assert.deepEqual(config.excludedRoots,['Plans','Scene Notes']);assert.equal(config.associations['A.md'],'Scene Notes/Old.md');assert.equal(config.associations['B.md'],undefined);assert.equal(config.drafts['A.md'],undefined);
});

test('a conflicted edit equal to the old baseline is still a recoverable unsaved choice',async()=>{
 const {disk,store}=fixture();disk.files.set('Scene Notes/A.md','Old');const s=await store.load('A.md');disk.files.set(s.path,'External');await store.edit(s,'Draft');await store.edit(s,'Old');assert.equal(s.conflict,true);assert.equal(s.dirty,true);assert.equal(store.snapshot().drafts['A.md'].text,'Old');assert.equal(disk.files.get(s.path),'External');
});

test('folder/child rename events deduplicate by identity without ignoring a later different file at the same path',()=>{
 const tracker=new RenameTracker(),a={},b={};assert.equal(tracker.claim(a,'Old/A.md','New/A.md'),true);assert.equal(tracker.claim(a,'Old/A.md','New/A.md'),false);assert.equal(tracker.claim(b,'Old/A.md','New/A.md'),true);assert.equal(tracker.claim(a,'New/A.md','Later/A.md'),true);
});

test('a collision-retained sidecar cannot be silently shared with a new source at its old name',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/Old.md','Old');disk.files.set('Scene Notes/New.md','New');await store.rename('Old.md','New.md');await assert.rejects(store.load('Old.md'),/retained for New.md/);assert.equal((await store.load('New.md')).text,'Old');
});
test('rename into an orphan source with an unsaved draft cannot discard that draft',async()=>{
 const{disk,store}=fixture();disk.files.set('Scene Notes/Old.md','Old');disk.files.set('Scene Notes/New.md','New');const orphan=await store.load('New.md');disk.files.set(orphan.path,'External');await store.edit(orphan,'Unsaved draft');await assert.rejects(store.rename('Old.md','New.md'),/unsaved notes draft/);assert.equal(store.snapshot().drafts['New.md'].text,'Unsaved draft');assert.equal(disk.files.get('Scene Notes/Old.md'),'Old');assert.equal(disk.files.get('Scene Notes/New.md'),'External');
});
