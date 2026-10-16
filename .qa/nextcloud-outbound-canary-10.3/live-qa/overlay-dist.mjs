// CI-owned official managed plugin only. Not a production canary activator.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function overlayQualifiedDist({root, pluginRoot, evidence}) {
  assert.equal(process.env.GITHUB_ACTIONS,'true');
  const plugin = path.resolve(pluginRoot);
  assert.equal(await fs.realpath(plugin),plugin,'managed plugin root must not be a symlink');
  assert(plugin.startsWith(root+path.sep) && plugin.includes('/npm/projects/'),'plugin must be the isolated canonical managed install');
  const admission = JSON.parse(await fs.readFile(path.join(root,'admitted/admission.json')));
  assert.equal(admission.status,'PASS');
  assert.equal(admission.baselineCommit,'59cb44796b0f1f0daa0e37af8b1495abb45d9bc1');
  const source = path.join(root,'admitted/dist');
  assert.equal(admission.admittedDist,source);
  const manifest = new Map(admission.distManifest.files.map(item=>[item.path,item]));
  const target = path.join(plugin,'dist');
  const beforeModes = new Map();
  async function inventory(base, relative='', output={}) {
    for(const item of await fs.readdir(path.join(base,relative),{withFileTypes:true})) {
      const rel=path.posix.join(relative,item.name), full=path.join(base,rel), st=await fs.lstat(full);
      if(rel==='dist' || rel.startsWith('dist/')) continue;
      output[rel]={mode:st.mode & 0o777,uid:st.uid,gid:st.gid,
        ...(item.isSymbolicLink()?{link:await fs.readlink(full)}:item.isFile()?{sha256:sha(await fs.readFile(full))}:{}),
        directory:item.isDirectory()};
      if(item.isDirectory()) await inventory(base,rel,output);
    }
    return output;
  }
  async function collectModes(base,relative='') {
    const st=await fs.lstat(path.join(base,relative));
    assert(!st.isSymbolicLink(),'stock dist symlink refused');
    beforeModes.set(relative,st.mode & 0o777);
    if(st.isDirectory()) for(const name of await fs.readdir(path.join(base,relative))) await collectModes(base,path.posix.join(relative,name));
  }
  const before = await inventory(plugin);
  const stockPackage=await fs.readFile(path.join(plugin,'package.json'));
  const stockManifest=await fs.readFile(path.join(plugin,'openclaw.plugin.json'));
  assert.equal(JSON.parse(stockPackage).name,'@openclaw/nextcloud-talk');
  assert.equal(JSON.parse(stockPackage).version,'2026.10.3');
  await collectModes(target);
  await fs.cp(target,path.join(root,'stock-plugin-dist'),{recursive:true,preserveTimestamps:true,errorOnExist:true,force:false});
  await fs.rm(target,{recursive:true});
  await fs.cp(source,target,{recursive:true,preserveTimestamps:true});
  // Preserve the official modes for shared paths. New compiled files use their
  // qualified manifest mode, not archive-controlled ownership or broad chmod.
  const observed=[];
  async function verify(relative='') {
    const full=path.join(target,relative), st=await fs.lstat(full);
    assert(!st.isSymbolicLink(),'candidate dist symlink refused');
    const isDirectory=st.isDirectory();
    assert(isDirectory || st.isFile(),'unexpected dist file kind');
    const entry=manifest.get(path.posix.join('dist',relative));
    const mode=beforeModes.get(relative) ?? (isDirectory?0o755:entry?.mode);
    assert.equal(typeof mode,'number');
    await fs.chmod(full,mode);
    if(isDirectory) for(const name of await fs.readdir(full)) await verify(path.posix.join(relative,name));
    else {
      assert(entry,'unmanifested compiled file');
      assert.equal(sha(await fs.readFile(full)),entry.sha256);
      observed.push({path:entry.path,sha256:entry.sha256,mode});
    }
  }
  await verify();
  assert.deepEqual(new Set(observed.map(item=>item.path)),new Set(manifest.keys()));
  assert.deepEqual(await inventory(plugin),before,'non-dist package/dependency files changed');
  assert.deepEqual(await fs.readFile(path.join(plugin,'package.json')),stockPackage);
  assert.deepEqual(await fs.readFile(path.join(plugin,'openclaw.plugin.json')),stockManifest);
  const receipt={status:'PASS',scope:'CI-owned plugin dist overlay only',pluginRoot:plugin,packageVersion:'2026.10.3',
    packageSha256:sha(stockPackage),manifestSha256:sha(stockManifest),nonDistUnchanged:true,
    stockSharedModesPreserved:true,producerRun:admission.producerRun,sourceManifestSha256:admission.sourceManifestSha256,
    distArtifactSha256:admission.distArtifactSha256,files:observed.sort((a,b)=>a.path.localeCompare(b.path))};
  await fs.writeFile(path.join(evidence,'plugin-overlay.json'),JSON.stringify(receipt,null,2));
  return receipt;
}
