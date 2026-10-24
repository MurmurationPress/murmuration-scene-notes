import * as esbuild from 'esbuild';
const config={entryPoints:['src/main.ts'],outfile:'main.js',bundle:true,external:['obsidian'],format:'cjs',target:'es2020',platform:'browser',minify:false,logLevel:'info'};
if(process.argv.includes('--watch')){const context=await esbuild.context(config);await context.watch();}else await esbuild.build(config);
