import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
let files=0;
async function walk(folder){for(const item of await readdir(folder,{withFileTypes:true})){const full=path.join(folder,item.name);if(item.isDirectory())await walk(full);else if(item.name.endsWith('.js')){const result=spawnSync(process.execPath,['--check',full],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);files++;}}}
for(const folder of ['src','scripts','tests'])await walk(path.join(root,folder));
const app=await readFile(path.join(root,'src/app.js'),'utf8');
if(/innerHTML|eval\(|new Function/.test(app))throw new Error('Unsafe UI sink found');
console.log(`Syntax checked ${files} JavaScript files. UI uses text-only data rendering.`);
