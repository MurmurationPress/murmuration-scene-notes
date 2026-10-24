import {mkdtemp,mkdir,readFile,copyFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=process.cwd(),manifest=JSON.parse(await readFile('manifest.json','utf8'));
if(!/^[a-z0-9-]+$/.test(manifest.id)||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('Invalid package identity');
const temp=await mkdtemp(path.join(os.tmpdir(),'scene-notes-package-'));
try{
 const staging=path.join(temp,manifest.id);await mkdir(staging);await mkdir('dist',{recursive:true});
 for(const file of ['main.js','manifest.json','styles.css','LICENSE','LICENSING.md'])await copyFile(file,path.join(staging,file));
 const output=path.join(root,'dist',`${manifest.id}-${manifest.version}.zip`);
 await rm(output,{force:true});execFileSync('zip',['-qr',output,manifest.id],{cwd:temp});console.log(output);
}finally{await rm(temp,{recursive:true,force:true});}
