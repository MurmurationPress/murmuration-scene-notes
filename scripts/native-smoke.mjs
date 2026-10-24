// Test-only CDP driver. Product code uses no Electron/CDP/private editor APIs.
// Always allocates a disposable synthetic vault and isolated Obsidian profile.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.cwd(),id='murmuration-scene-notes';
const temp=await mkdtemp('/tmp/scene-notes-native-'),vault=path.join(temp,'vault'),profile=path.join(temp,'profile');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sourceA='# First scene\n\nA fictional lamp in a storm.\n\n[[Scene Notes/Scenes/One|Planning]]\n',sourceB='# Second scene\n\nAnother fictional lamp.\n';
for(const dir of ['Scenes','Other','.obsidian/plugins/'+id])await mkdir(path.join(vault,dir),{recursive:true});await mkdir(profile);
await writeFile(path.join(vault,'Scenes/One.md'),sourceA);await writeFile(path.join(vault,'Other/One.md'),sourceB);
await writeFile(path.join(vault,'Board.canvas'),'{}');
for(const name of ['main.js','manifest.json','styles.css'])await copyFile(path.join(root,name),path.join(vault,'.obsidian/plugins',id,name));
const mwc=process.env.SCENE_NOTES_WITH_MWC;
if(mwc){const folder=path.join(vault,'.obsidian/plugins/murmuration-writing-companion');await mkdir(folder,{recursive:true});for(const name of ['main.js','manifest.json','styles.css'])await copyFile(path.join(mwc,name),path.join(folder,name));}
await writeFile(path.join(vault,'.obsidian/community-plugins.json'),JSON.stringify(mwc?[id,'murmuration-writing-companion']:[id]));
await writeFile(path.join(profile,'obsidian.json'),JSON.stringify({vaults:{5273100000000001:{path:vault,ts:1,open:true}}}));
const leaf=(id,type,state={})=>({id,type:'leaf',state:{type,state}});
await writeFile(path.join(vault,'.obsidian/workspace.json'),JSON.stringify({main:{id:'main',type:'split',children:[{id:'tabs',type:'tabs',children:[leaf('source','markdown',{file:'Scenes/One.md',mode:'source'})]}],direction:'vertical'},left:{id:'left',type:'split',children:[],direction:'horizontal',width:250,collapsed:true},right:{id:'right',type:'split',children:[],direction:'horizontal',width:300,collapsed:false},active:'source',lastOpenFiles:['Scenes/One.md']}));
const evidence={method:'Actual Obsidian on Linux in a disposable synthetic vault; public Editor API plus CDP input/DOM observation',checks:[],unverified:['actual mobile/iPad','Windows/macOS','physical keyboard/touch','assistive technology']};
for(const file of ['main.js','manifest.json','styles.css']){evidence.artifacts??={};evidence.artifacts[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}
evidence.MWC=mwc?{manifest:JSON.parse(await readFile(path.join(mwc,'manifest.json'),'utf8')),mainSHA256:createHash('sha256').update(await readFile(path.join(mwc,'main.js'))).digest('hex')}:false;
let child,ws,seq=0;const pending=new Map(),errors=[];let stage='launch';
async function send(method,params={}){const id=++seq;const request=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,data=>{clearTimeout(timer);data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result);});});ws.send(JSON.stringify({id,method,params}));return request;}
async function run(code){const r=await send('Runtime.evaluate',{expression:`(async()=>{if(globalThis.app&&app.vault.adapter.basePath!==${JSON.stringify(vault)})throw Error('Wrong vault');${code}})()`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
async function until(fn,label,ms=15000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(error){last=error;}await sleep(100);}throw last||Error('Timed out: '+label);}
async function launch(){child=spawn(process.env.OBSIDIAN_EXECUTABLE||'/opt/Obsidian/obsidian',[`--user-data-dir=${profile}`,'--no-sandbox','--disable-gpu','--ozone-platform=x11','--remote-debugging-port=19439'],{stdio:'ignore'});const page=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:19439/json/list')).json();return pages.find(p=>p.type==='page'&&p.url.startsWith('app://obsidian.md'));},'native page',40000);ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.id)pending.get(data.id)?.(data);else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);};await send('Runtime.enable');await until(()=>run(`const trust=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Trust author'));if(trust)trust.click();return app?.workspace?.layoutReady&&!!app.plugins.plugins['${id}']&&(!${Boolean(mwc)}||!!app.plugins.plugins['murmuration-writing-companion']);`),'plugin',45000);}
async function stop(){try{await run('await app.workspace.saveLayout();return true;');}catch{}ws?.close();child?.kill('SIGTERM');if(child)await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2500)]);if(child?.exitCode===null)child.kill('SIGKILL');await sleep(600);}
const plugin=`app.plugins.plugins['${id}']`,view=`${plugin}.views()[0]`;
async function source(file){await run(`const file=app.vault.getAbstractFileByPath(${JSON.stringify(file)});const leaf=app.workspace.getLeavesOfType('markdown').find(l=>!l.view.file?.path.startsWith('Scene Notes/'))||app.workspace.getLeaf('tab');await app.workspace.setActiveLeaf(leaf,{focus:true});await leaf.openFile(file);return true;`);await until(()=>run(`return ${view}?.notesSession?.source===${JSON.stringify(file)}&&!${view}.contentEl.hasAttribute('aria-busy')&&${view}.getViewData()===${view}.notesSession.text;`),'follow '+file);assert.equal(await run('return app.workspace.getActiveFile()?.path;'),file,'following must retain source focus');}
async function type(text){await run(`${view}.editor.focus();return true;`);await send('Input.insertText',{text});await until(()=>run(`return ${view}.notesSession.text.includes(${JSON.stringify(text)});`),'native edit');await run(`await ${plugin}.store.flushAll();return true;`);}
try{
 await launch();stage='open';await run(`app.commands.executeCommandById('${id}:open-scene-notes');return true;`);await until(()=>run(`return ${view}?.notesSession?.source==='Scenes/One.md';`),'initial follow');
 const empty=await run(`return {source:${view}.notesSession.source,text:${view}.getViewData(),file:${view}.file?.path,editor:!!${view}.editor,body:document.querySelector('.scene-notes')?.textContent};`);console.log('EMPTY',JSON.stringify(empty));
 assert.equal(await run(`return app.vault.getAbstractFileByPath('Scene Notes')===null;`),true);
 stage='first edit';await type('# Intentions\n\nKeep **the lamp** alight. [[Other/One]]\n');
 assert.match(await readFile(path.join(vault,'Scene Notes/Scenes/One.md'),'utf8'),/Keep \*\*the lamp\*\* alight/);
 await until(()=>run(`return ${view}.file?.path==='Scene Notes/Scenes/One.md';`),'native sidecar binding');
 assert.equal(await run(`return ${view}.notesSession.source;`),'Scenes/One.md');evidence.checks.push('lazy first edit through native editor creates exact mirrored Markdown sidecar and binds native file context without following the notes');
 stage='second source';await source('Other/One.md');await type('Ask about the second lamp.\n');
 stage='return';await source('Scenes/One.md');assert.match(await run(`return ${view}.getViewData();`),/Keep \*\*the lamp\*\* alight/);

 evidence.checks.push('two same-basename sources switch correctly; notes focus retains source');
 stage='rapid switching';const expected={};
 for(let i=0;i<8;i++){
  const file=i%2?'Other/One.md':'Scenes/One.md';await source(file);
  expected[file]=await run(`${view}.editor.replaceSelection(${JSON.stringify(' Rapid '+i)});return ${view}.getViewData();`);
 }
 await run(`await ${plugin}.store.flushAll();return true;`);
 for(const[file,text]of Object.entries(expected))assert.equal(await readFile(path.join(vault,'Scene Notes',file),'utf8'),text);
 evidence.checks.push('rapid source switches during native edits preserve each sidecar independently');
 stage='selection and scroll';await source('Scenes/One.md');
 await run(`${view}.editor.setValue(${JSON.stringify('# Long plan\n\n'+Array(80).fill('A fictional continuity reminder.').join('\n\n'))});${view}.editor.setSelections([{anchor:{line:4,ch:2},head:{line:4,ch:8}}]);${view}.editor.scrollTo(0,300);return true;`);await sleep(200);
 const position=await run(`return {selections:${view}.editor.listSelections(),top:${view}.editor.getScrollInfo().top};`);
 await source('Other/One.md');await source('Scenes/One.md');
 const restored=await run(`return {selections:${view}.editor.listSelections(),top:${view}.editor.getScrollInfo().top};`);
 assert.deepEqual(restored.selections,position.selections);assert.ok(Math.abs(restored.top-position.top)<10,JSON.stringify({position,restored}));
 evidence.position={position,restored};evidence.checks.push('native selection and scroll retained when revisiting a scene');
 stage='source rename';await run(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath('Scenes/One.md'),'Scenes/Renamed.md');return true;`);
 await until(()=>run(`return ${view}.notesSession.source==='Scenes/Renamed.md'&&${view}.notesSession.path==='Scene Notes/Scenes/Renamed.md';`),'rename association');
 assert.equal(await readFile(path.join(vault,'Scenes/Renamed.md'),'utf8'),sourceA);assert.match(await readFile(path.join(vault,'Scene Notes/Scenes/Renamed.md'),'utf8'),/Long plan/);
 stage='folder move';await run(`await app.fileManager.renameFile(app.vault.getAbstractFileByPath('Scenes'),'Drafts');return true;`);
 await until(()=>run(`return ${view}.notesSession.source==='Drafts/Renamed.md'&&${view}.notesSession.path==='Scene Notes/Drafts/Renamed.md';`),'folder move association');
 assert.equal(await readFile(path.join(vault,'Drafts/Renamed.md'),'utf8'),sourceA);
 evidence.checks.push('source file rename and folder move relocate sidecars without source text changes');
 stage='collision';await source('Other/One.md');await run(`await app.vault.create('Scene Notes/Other/Collision.md','Pre-existing unrelated notes');await app.fileManager.renameFile(app.vault.getAbstractFileByPath('Other/One.md'),'Other/Collision.md');return true;`);
 await until(()=>run(`return ${view}.notesSession.source==='Other/Collision.md'&&${view}.notesSession.path==='Scene Notes/Other/One.md';`),'collision association');
 assert.equal(await readFile(path.join(vault,'Scene Notes/Other/Collision.md'),'utf8'),'Pre-existing unrelated notes');assert.equal(await readFile(path.join(vault,'Other/Collision.md'),'utf8'),sourceB);
 evidence.checks.push('rename collision preserves both files and visibly reports retained exception association');
 stage='ordinary note edit';await run(`document.querySelector('.scene-notes-banner button').click();return true;`);
 await until(()=>run(`return app.workspace.getLeavesOfType('markdown').some(l=>l.view.file?.path==='Scene Notes/Other/One.md'&&l.view.getViewData()===${view}.notesSession.text);`),'normal note document');
 await run(`const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path==='Scene Notes/Other/One.md');await app.workspace.setActiveLeaf(leaf,{focus:true});leaf.view.editor.setValue(${JSON.stringify('Edited as an ordinary Markdown document.\n')});await leaf.view.save();return true;`);
 await until(()=>run(`return ${view}.getViewData()===${JSON.stringify('Edited as an ordinary Markdown document.\n')};`),'ordinary external note refresh');
 assert.equal(await run(`return ${view}.notesSession.source;`),'Other/Collision.md');
 await source('Other/Collision.md');evidence.checks.push('underlying normal Markdown editor saves, panel refreshes and keeps its manuscript association');
 stage='external filesystem';const external='Filesystem watcher update.\n';
 await writeFile(path.join(vault,'Scene Notes/Other/One.md'),external);
 await until(()=>run(`return ${view}.getViewData()===${JSON.stringify(external)};`),'filesystem refresh');
 evidence.checks.push('actual external filesystem writes refresh the clean panel through Obsidian vault events');
 stage='unsaved conflict';
 await run(`const store=${plugin}.store,original=store.checkpoint.bind(store);globalThis.__notesGate={entered:false};__notesGate.promise=new Promise(resolve=>{__notesGate.release=resolve;});store.checkpoint=async()=>{if(!__notesGate.entered){__notesGate.entered=true;await __notesGate.promise;}await original();};${view}.editor.setValue('A local draft kept during a slow save.');return true;`);
 await until(()=>run('return __notesGate.entered;'),'controlled save delay');
 const concurrent='Concurrent external edit.\n';await writeFile(path.join(vault,'Scene Notes/Other/One.md'),concurrent);
 await until(()=>run(`return (await app.vault.read(app.vault.getAbstractFileByPath('Scene Notes/Other/One.md')))===${JSON.stringify(concurrent)};`),'external data visible to vault');
 await run(`__notesGate.release();await ${plugin}.store.flushAll();return true;`);
 await until(()=>run(`return ${view}.notesSession.conflict&&${view}.getViewData()==='A local draft kept during a slow save.';`),'preserved conflict');
 assert.equal(await readFile(path.join(vault,'Scene Notes/Other/One.md'),'utf8'),concurrent);
 await run(`document.querySelector('.scene-notes-recovery button').click();return true;`);
 await run(`const cancel=[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Cancel');if(!cancel)throw Error('No confirmation');cancel.click();return true;`);
 assert.equal(await run(`return ${view}.getViewData();`),'A local draft kept during a slow save.');
 await run(`document.querySelector('.scene-notes-recovery button').click();return true;`);
 await run(`[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='Confirm').click();return true;`);
 await until(()=>run(`return !${view}.notesSession.dirty&&${view}.getViewData()===${JSON.stringify(concurrent)};`),'explicit conflict reload');
 await writeFile(path.join(vault,'Scene Notes/Other/One.md'),'Edited as an ordinary Markdown document.\n');
 await until(()=>run(`return ${view}.getViewData()===${JSON.stringify('Edited as an ordinary Markdown document.\n')};`),'restore ordinary note text');
 evidence.checks.push('injected slow-save checkpoint plus actual external write preserves both versions; confirmation Cancel retains draft, explicit reload resolves');
 stage='non-Markdown';await run(`await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath('Board.canvas'));return true;`);await sleep(200);assert.equal(await run(`return ${view}.notesSession.source;`),'Other/Collision.md');
 evidence.checks.push('non-Markdown tab retains most recent source');
 stage='delete source';await source('Drafts/Renamed.md');await run(`await app.workspace.setActiveLeaf(${view}.leaf,{focus:true});await app.vault.delete(app.vault.getAbstractFileByPath('Drafts/Renamed.md'));return true;`);await sleep(200);assert.match(await readFile(path.join(vault,'Scene Notes/Drafts/Renamed.md'),'utf8'),/Long plan/);const afterDelete=await run(`return {source:${view}.notesSession.source,status:document.querySelector('.scene-notes-status').textContent,active:app.workspace.getActiveFile()?.path};`);if(afterDelete.source==='Drafts/Renamed.md')assert.match(afterDelete.status,/Source is missing/);else assert.equal(afterDelete.source,'Other/Collision.md');evidence.deletion=afterDelete;
 evidence.checks.push('deleting a source leaves its notes intact');
 assert.equal(await run(`return ${plugin}.store.config.associations['Drafts/Renamed.md']??null;`),null);
 stage='configured root';await run(`await ${plugin}.changeRoot('Plans/Scene Notes');await app.vault.create('Fresh.md','# A new fictional scene\\n');return true;`);
 assert.equal(await run(`return app.vault.getAbstractFileByPath('Plans')===null;`),true);
 await source('Fresh.md');await type('A new-root intention.');assert.equal(await readFile(path.join(vault,'Plans/Scene Notes/Fresh.md'),'utf8'),'A new-root intention.');
 stage='close during editing';await run(`${view}.editor.replaceSelection(' Final edit before closing.');${view}.leaf.detach();return true;`);
 await until(async()=>{try{return (await readFile(path.join(vault,'Plans/Scene Notes/Fresh.md'),'utf8')).includes('Final edit before closing.');}catch{return false;}},'close-time save');
 await run(`app.commands.executeCommandById('${id}:open-scene-notes');return true;`);await until(()=>run(`return ${view}?.notesSession?.source==='Fresh.md'&&${view}.getViewData().includes('Final edit before closing.');`),'reopened notes');
 evidence.checks.push('closing during a native edit flushes the bound draft; Open command reuses one restored panel with saved text');
 await source('Other/Collision.md');assert.equal(await run(`return ${view}.notesSession.path;`),'Scene Notes/Other/One.md');
 assert.equal(await run(`return ${plugin}.store.config.associations['Other/One.md']??null;`),null);
 evidence.checks.push('configured root creates lazily; old notes and their exclusions/associations remain intact');
 await run(`await ${plugin}.store.flushAll();await ${plugin}.persist();return true;`);
 evidence.userAgent=await run('return navigator.userAgent;');
 evidence.narrow=await run(`const element=document.querySelector('.scene-notes');return {width:element.clientWidth,overflow:element.scrollWidth-element.clientWidth};`);assert.ok(evidence.narrow.overflow<=1,JSON.stringify(evidence.narrow));
 stage='restart';await stop();await launch();await until(()=>run(`return ${view}?.notesSession?.source==='Other/Collision.md'&&!${view}.contentEl.hasAttribute('aria-busy')&&${view}.getViewData()===${view}.notesSession.text;`),'restored Scene Notes panel');
 assert.equal(await run(`return ${plugin}.views().length;`),1);assert.equal(await run(`return ${view}.getViewData();`),'Edited as an ordinary Markdown document.\n');
 evidence.checks.push('cold restart restores one sidebar and the saved collision association through workspace state');
 assert.equal(await readFile(path.join(vault,'Other/Collision.md'),'utf8'),sourceB);assert.deepEqual(errors,[]);evidence.exceptions=errors;
 await writeFile(path.join(temp,'evidence.json'),JSON.stringify(evidence,null,2));
 if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(evidence,null,2)+'\n');
 console.log('PASS complete native checks',temp);

}catch(error){console.error('FAIL',stage,temp,error);try{await writeFile(path.join(temp,'failure.json'),JSON.stringify({stage,error:String(error),errors,dom:await run('return {text:document.body.innerText,active:app.workspace.getActiveFile()?.path,notes:app.plugins.plugins["murmuration-scene-notes"].views().map(v=>({session:v.notesSession,state:v.getState(),loading:v.notesLoading,turn:v.notesTurn})),leaves:app.workspace.getLeavesOfType("markdown").map(l=>l.view.file?.path)};')},null,2));}catch{}process.exitCode=1;}
finally{await stop();}
