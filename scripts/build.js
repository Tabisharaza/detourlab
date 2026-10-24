import { cp, mkdir, readdir, writeFile, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const destination=path.join(root,'dist');
await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
for(const file of ['index.html','src','public','examples','LICENSE','THIRD_PARTY_NOTICES.md'])await cp(path.join(root,file),path.join(destination,file),{recursive:true});
const hashes={};
async function walk(folder,relative=''){
  for(const item of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const full=path.join(folder,item.name);
    // Manifest names are portable logical paths, not host filesystem paths.
    // Keep literal entry names intact; a POSIX filename may contain a backslash.
    const name=relative?`${relative}/${item.name}`:item.name;
    if(item.isDirectory())await walk(full,name);
    else hashes[name]=createHash('sha256').update(await readFile(full)).digest('hex');
  }
}
await walk(destination);await writeFile(path.join(destination,'manifest.json'),JSON.stringify({version:1,files:hashes},null,2)+'\n');
console.log(`Built ${Object.keys(hashes).length} static files. No compilation, external downloads or runtime dependencies.`);
