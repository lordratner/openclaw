// Fork-only configured Talk installed-path proof. No production imports or state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'GitHub-only qualification');
const repo=process.cwd();
const tools=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(process.env.RUNNER_TEMP,'nextcloud-compat-installed');
const candidate=process.env.CANDIDATE_TARBALL;
assert(candidate?.startsWith(process.env.RUNNER_TEMP+path.sep));
const evidence=path.join(process.env.RUNNER_TEMP,'nextcloud-compat-evidence');
await fs.mkdir(root,{recursive:true,mode:0o700});
await fs.mkdir(evidence,{recursive:true,mode:0o700});
const processes=new Set();
const steps=[];
let phase='initialization';
const baseEnv={PATH:process.env.PATH,LANG:'C.UTF-8',CI:'true',GITHUB_ACTIONS:'true',
  RUNNER_TEMP:process.env.RUNNER_TEMP,HOME:root,TMPDIR:root,
  OPENCLAW_DISABLE_BONJOUR:'1',OPENCLAW_GATEWAY_TOKEN:undefined,
  OPENAI_API_KEY:'public-nextcloud-compat-fixture-only'};
const sha=data=>createHash('sha256').update(data).digest('hex');
const rows=async file=>{try{return(await fs.readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return[];throw e;}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function run(command,args,label,env=baseEnv,timeout=180000){
  const out=[],err=[];const started=Date.now();
  const child=spawn(command,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});processes.add(child);
  child.stdout.on('data',x=>out.push(x));child.stderr.on('data',x=>err.push(x));
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}).finally(()=>{clearTimeout(timer);processes.delete(child);});
  const stdout=Buffer.concat(out).toString(),stderr=Buffer.concat(err).toString();
  await fs.writeFile(path.join(evidence,label+'.log'),stdout+'\nSTDERR:\n'+stderr);
  steps.push({label,...result,wallMs:Date.now()-started});
  assert.equal(result.code,0,`${label}: ${stderr.slice(-4000)} ${stdout.slice(-2500)}`);
  return stdout;
}
async function service(args,label,env){
  const logfile=await fs.open(path.join(evidence,label+'.log'),'a');
  const child=spawn(process.execPath,args,{cwd:repo,env,stdio:['ignore',logfile.fd,logfile.fd]});
  await logfile.close();processes.add(child);child.once('exit',()=>processes.delete(child));
  return child;
}
async function stop(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
  await Promise.race([done,delay(15000)]);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await done;}
}
async function until(fn,label,timeout=120000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await fn())return;await delay(250);}
  throw Error('Timed out: '+label);
}
const mockPort=await port();
const mockLog=path.join(evidence,'provider.jsonl');
const modelConfig=await import(pathToFileURL(path.join(repo,'scripts/e2e/lib/fixtures/mock-openai-config.mjs')).href);
const walk=(value,test)=>{if(!value||typeof value!=='object')return[];return[...(test(value)?[value]:[]),...Object.values(value).flatMap(v=>walk(v,test))];};
async function install(prefix,spec,label){
  assert(prefix.startsWith(root+path.sep));
  await run('npm',['install','--global','--prefix',prefix,spec,'--no-fund','--no-audit'],label,baseEnv,600000);
}
function cli(leg,args,label,timeout){return run(process.execPath,[leg.entry,...args],label,leg.env,timeout);}
async function inspect(leg,label){
  const info=JSON.parse(await cli(leg,['plugins','inspect','nextcloud-talk','--runtime','--json'],label));
  const plugin=info.plugin??info;
  assert.equal(plugin.id,'nextcloud-talk');assert.equal(plugin.status,'loaded');
  assert(plugin.origin==='bundled'||plugin.trustedOfficialInstall===true,'missing official/bundled trust');
  assert.equal(plugin.version,leg.expectedVersion);
  const compiled=path.join(leg.prefix,'lib/node_modules/openclaw/dist/extensions/nextcloud-talk');
  if(leg.candidate){
    const liveRoot=plugin.root??path.dirname(path.dirname(plugin.source));
    const manifest=JSON.parse(await fs.readFile(path.join(compiled,'package.json'),'utf8'));
    assert.equal(manifest.openclaw.build.bundledDist,true);
    // Ensure runtime actually selected the matching packaged owner, not a stale managed override.
    async function inventory(directory,relative=''){
      const result={};
      for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        const file=path.join(directory,entry.name),key=path.posix.join(relative,entry.name);
        assert(!entry.isSymbolicLink(),'unexpected runtime-dist symlink');
        if(entry.isDirectory())Object.assign(result,await inventory(file,key));
        else{assert(entry.isFile());result[key]=sha(await fs.readFile(file));}
      }
      return result;
    }
    assert.deepEqual(await inventory(path.join(liveRoot,'dist')),await inventory(path.join(compiled,'dist')),'selected Talk runtime differs from paired package');
    for(const file of ['openclaw.plugin.json','package.json']){
      assert.equal(sha(await fs.readFile(path.join(liveRoot,file))),sha(await fs.readFile(path.join(compiled,file))),`different installed Talk ${file}`);
    }
  }
  return info;
}
async function start(leg,label){
  leg.gateway=await service([leg.entry,'gateway','run','--bind','loopback','--port',String(leg.port)],label+'-gateway',leg.env);
  await until(async()=>{
    assert(leg.gateway.exitCode===null&&leg.gateway.signalCode===null,'Gateway exited before readiness');
    try{const response=await fetch(`http://127.0.0.1:${leg.port}/healthz`,{signal:AbortSignal.timeout(1000)});return response.ok;}catch{return false;}
  },label+' health');
  await cli(leg,['gateway','health','--json'],label+'-health');
  const status=JSON.parse(await cli(leg,['channels','status','--json'],label+'-channels'));
  const accounts=walk(status,x=>x.accountId==='default'&&x.running===true);
  assert(accounts.length>0,'configured Talk account not running');
  assert(accounts.some(x=>x.connected!==false&&x.lifecycleState!=='failed'),'Talk account failed/disconnected');
  await inspect(leg,label+'-plugin');
}
async function snapshot(leg,label){
  const config=JSON.parse(await cli(leg,['config','get','channels.nextcloud-talk','--json'],label+'-config'));
  const sessions=JSON.parse(await cli(leg,['sessions','--json'],label+'-sessions'));
  await fs.writeFile(path.join(evidence,label+'-config.json'),JSON.stringify(config,null,2));
  await fs.writeFile(path.join(evidence,label+'-sessions.json'),JSON.stringify(sessions,null,2));
  return{config,sessions};
}
let eventId=81000;
async function turn(leg,kind,mode,marker,label){
  const cloudLog=path.join(leg.artifact,'nextcloud.jsonl');
  const checkpoint=path.join(evidence,label+'-checkpoint.json');
  const beforeCloud=(await rows(cloudLog)).length,beforeModel=(await rows(mockLog)).length;
  await run(process.execPath,[path.join(tools,'assert-evidence.mjs'),'checkpoint',cloudLog,mockLog,checkpoint],label+'-checkpoint');
  const senderEnv={...leg.env,QA_NEXTCLOUD_ORIGIN:leg.cloudOrigin,QA_WEBHOOK_URL:leg.webhook,QA_WEBHOOK_RECEIPT:path.join(evidence,label+'-admission.json')};
  const admission=JSON.parse(await run(process.execPath,[path.join(tools,'send-webhook.mjs'),kind,String(++eventId),marker],label+'-send',senderEnv));
  if(leg.candidate)assert.equal(admission.durableAdmission,true,'candidate did not durably admit event');
  await until(async()=>{
    const cloud=(await rows(cloudLog)).slice(beforeCloud);
    const model=(await rows(mockLog)).slice(beforeModel);
    return cloud.some(x=>x.kind==='bot-reply')&&model.some(x=>JSON.stringify(x.body).includes(marker));
  },label+' provider and Talk reply',180000);
  await run(process.execPath,[path.join(tools,'assert-evidence.mjs'),'delivery',mode,checkpoint,cloudLog,mockLog,marker],label+'-delivery');
  return(await rows(mockLog)).slice(beforeModel);
}
async function optIn(leg,label){
  await stop(leg.gateway);
  const before=JSON.parse(await fs.readFile(leg.configPath,'utf8')).channels['nextcloud-talk'].accounts.default;
  await cli(leg,['config','set','channels.nextcloud-talk.mediaAllowFrom','["users/alice"]','--strict-json','--expect-current-absent'],label+'-set-media');
  await cli(leg,['config','validate'],label+'-validate');
  const after=JSON.parse(await fs.readFile(leg.configPath,'utf8')).channels['nextcloud-talk'];
  assert.deepEqual(after.accounts.default,before,'opt-in changed existing account sender/settings');
  assert.deepEqual(after.mediaAllowFrom,['users/alice']);
  await start(leg,label);
}
async function createLeg(name,spec,version,candidateMode){
  const legRoot=path.join(root,name);await fs.mkdir(legRoot,{recursive:true});
  const prefix=path.join(legRoot,'prefix'),state=path.join(legRoot,'state'),workspace=path.join(legRoot,'workspace');
  await fs.mkdir(state,{recursive:true});await fs.mkdir(workspace,{recursive:true});
  const gatewayPort=await port();
  const webhook=`http://127.0.0.1:${gatewayPort}/nextcloud-talk-webhook`;
  const artifact=path.join(evidence,'nextcloud-compat-'+name);await fs.mkdir(artifact,{recursive:true});
  const cloud=await service([path.join(tools,'fake-nextcloud.mjs')],name+'-cloud',{...baseEnv,QA_ARTIFACT_DIR:artifact,QA_WEBHOOK_URL:webhook});
  const ready=path.join(artifact,'nextcloud-ready.json');
  await until(async()=>{try{await fs.access(ready);return true;}catch{return false;}},name+' cloud');
  const cloudOrigin=JSON.parse(await fs.readFile(ready,'utf8')).origin;
  const configPath=path.join(state,'openclaw.json');
  const env={...baseEnv,HOME:legRoot,OPENCLAW_HOME:legRoot,OPENCLAW_STATE_DIR:state,OPENCLAW_CONFIG_PATH:configPath,
    PATH:path.join(prefix,'bin')+path.delimiter+baseEnv.PATH};
  const leg={name,prefix,state,workspace,port:gatewayPort,webhook,artifact,cloud,cloudOrigin,configPath,env,
    entry:path.join(prefix,'lib/node_modules/openclaw/openclaw.mjs'),expectedVersion:version,candidate:candidateMode};
  await install(prefix,spec,name+'-install');
  const cfg={gateway:{mode:'local',bind:'loopback',port:gatewayPort,auth:{mode:'none'},controlUi:{enabled:false}},
    agents:{entries:{main:{}},defaults:{workspace,heartbeat:{every:'0m'}}},
    plugins:{allow:['nextcloud-talk'],entries:{'nextcloud-talk':{enabled:true}}},tools:{profile:'minimal'}};
  modelConfig.applyMockOpenAiModelConfig(cfg,{mockPort});
  await fs.writeFile(configPath,JSON.stringify(cfg,null,2));
  await cli(leg,['plugins','install','nextcloud-talk','--force'],name+'-select-plugin',600000);
  const botSecretFile=path.join(legRoot,'bot-secret'),apiPasswordFile=path.join(legRoot,'api-password');
  await fs.writeFile(botSecretFile,'nextcloud-compat-fixture-only',{mode:0o600});
  await fs.writeFile(apiPasswordFile,'qa-password-fixture-only',{mode:0o600});
  const channel={enabled:true,accounts:{default:{baseUrl:cloudOrigin,botSecretFile,apiUser:'qa-bot',apiPasswordFile,
    dmPolicy:'allowlist',allowFrom:['users/alice'],groupPolicy:'allowlist',groupAllowFrom:['users/alice'],
    webhookPath:'/nextcloud-talk-webhook',webhookPublicUrl:webhook,legacyWebhook:false,
    network:{dangerouslyAllowPrivateNetwork:true}}}};
  await cli(leg,['config','set','channels.nextcloud-talk',JSON.stringify(channel),'--strict-json'],name+'-configure');
  await cli(leg,['config','validate'],name+'-validate');
  const sentinel=path.join(workspace,'existing-authored.txt');
  await fs.writeFile(sentinel,'Synthetic authored workspace file; preserve through upgrade.\n');leg.sentinel=sentinel;leg.sentinelHash=sha(await fs.readFile(sentinel));
  return leg;
}
try{
  phase='mock-provider';
  await service(['--import','./scripts/tsx.mjs','scripts/e2e/mock-openai-server.mjs'],'mock-provider',
    {...baseEnv,MOCK_PORT:String(mockPort),MOCK_REQUEST_LOG:mockLog,SUCCESS_MARKER:'OPENCLAW_E2E_COMPAT_OK'});
  await until(async()=>{try{return(await fetch(`http://127.0.0.1:${mockPort}/health`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'mock provider');
  const baseline=JSON.parse(await fs.readFile(process.env.BASELINE_METADATA,'utf8'));
  assert.equal(baseline.version,'2026.10.3','stable moved: explicitly reselect and review baseline');
  phase='fresh';
  const fresh=await createLeg('fresh',candidate,'2026.10.3',true);
  await start(fresh,'fresh');
  await turn(fresh,'text','text','COMPAT_FRESH_TEXT','fresh-text');
  await turn(fresh,'image','denied-image','COMPAT_FRESH_CLOSED','fresh-closed');
  await optIn(fresh,'fresh-opt-in');
  await turn(fresh,'image','allowed-image','COMPAT_FRESH_IMAGE','fresh-image');
  await stop(fresh.gateway);
  phase='stable-created';
  const upgraded=await createLeg('upgrade',process.env.BASELINE_TARBALL,baseline.version,false);
  await start(upgraded,'stable');
  const baselineMarker='COMPAT_EXISTING_STABLE_CONVERSATION';
  await turn(upgraded,'text','text',baselineMarker,'stable-text');
  const before=await snapshot(upgraded,'stable-before');
  const session=walk(before.sessions,x=>typeof x.sessionId==='string'&&String(x.key??x.sessionKey??'').includes('nextcloud-talk'));
  assert.equal(session.length,1,'expected one actual stable Talk session');
  const key=session[0].key??session[0].sessionKey;
  await stop(upgraded.gateway);
  phase='upgrade';
  await cli(upgraded,['backup','create','--verify','--output',path.join(root,'stable-backup.tar.gz'),'--json'],'stable-backup',180000);
  await install(upgraded.prefix,candidate,'upgrade-candidate-install');
  upgraded.candidate=true;upgraded.expectedVersion='2026.10.3';
  await cli(upgraded,['plugins','install','nextcloud-talk','--force','--no-enable'],'upgrade-select-matching-plugin',600000);
  await cli(upgraded,['doctor','--fix','--non-interactive'],'upgrade-doctor',180000);
  await cli(upgraded,['config','validate'],'upgrade-validate');
  await start(upgraded,'upgraded');
  const after=await snapshot(upgraded,'upgraded-before-turn');
  assert.deepEqual(after.config,before.config,'authored Talk settings changed');
  await run(process.execPath,[path.join(tools,'assert-evidence.mjs'),'config-survived',path.join(evidence,'stable-before-config.json'),path.join(evidence,'upgraded-before-turn-config.json')],'upgrade-config-survived');
  await run(process.execPath,[path.join(tools,'assert-evidence.mjs'),'session-survived',path.join(evidence,'stable-before-sessions.json'),path.join(evidence,'upgraded-before-turn-sessions.json'),key],'upgrade-session-survived');
  assert.equal(sha(await fs.readFile(upgraded.sentinel)),upgraded.sentinelHash);
  const postRequests=await turn(upgraded,'text','text','COMPAT_AFTER_UPGRADE','upgraded-text');
  assert(postRequests.some(x=>JSON.stringify(x.body).includes(baselineMarker)),'stable-created conversation not carried to provider');
  await turn(upgraded,'image','denied-image','COMPAT_UPGRADE_CLOSED','upgraded-closed');
  await optIn(upgraded,'upgraded-opt-in');
  await turn(upgraded,'image','allowed-image','COMPAT_UPGRADE_IMAGE','upgraded-image');
  const final=await snapshot(upgraded,'upgraded-final');
  const finalSession=walk(final.sessions,x=>(x.key??x.sessionKey)===key);assert.equal(finalSession.length,1);
  assert.equal(finalSession[0].sessionId,session[0].sessionId);
  await stop(upgraded.gateway);
  phase='complete';
  await fs.writeFile(path.join(evidence,'qualification.json'),JSON.stringify({status:'PASS',
    sourceHead:process.env.CANDIDATE_SHA,candidatePackageSha256:sha(await fs.readFile(candidate)),baseline,
    scope:'configured fresh paired PR host/plugin and published stable external-package-manager upgrade',
    gates:{freshText:true,freshMediaClosed:true,freshOptInImage:true,stableCreatedConversation:true,
      sameSessionId:true,authoredChannelSettingsPreserved:true,workspaceSentinelPreserved:true,
      stableHistoryAtProvider:true,upgradedMediaClosed:true,upgradedOptInImage:true,senderListsPreserved:true},
    limitations:['Not in-process updater proof','Not unmodified old-host plugin compatibility',
      'Not a published candidate release','Existing accepted cleanup/cancellation proof retained, not repeated',
      'Maintainer contract acceptance remains unresolved','No production activation'],steps},null,2)+'\n',{flag:'wx'});
}catch(error){
  await fs.writeFile(path.join(evidence,'failure.json'),JSON.stringify({status:'FAIL',phase,error:String(error),stack:error.stack,steps},null,2)+'\n',{flag:'wx'});
  throw error;
}finally{for(const child of [...processes].reverse())await stop(child);}
