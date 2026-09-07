import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApi, invoke, loadBackend } from './backend-fixture.mjs';

const backend=await loadBackend();
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dashboard-extras-download-'));
after(()=>fs.rm(root,{recursive:true,force:true}));
const request=(extra={})=>({sessionKey:'agent:main:test',agentId:'main',path:'binary.unknown',expectedSessionId:'session-1',expectedRoot:root,offset:0,...extra});
const bytes=Buffer.alloc(600000);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
await fs.writeFile(path.join(root,'binary.unknown'),bytes);

test('native opening requires server-attested locality; remote and forged wire flags cannot launch',async()=>{
 const {api,methods}=createApi(root);
 backend.registerDashboardExtras(api,{platform:'darwin',launch:async()=>assert.fail('remote caller must not launch')});
 for(const client of [null,{}, {clientIp:'127.0.0.1'}, {connect:{isLocalClient:true}}, {internal:{isLocalClient:true},invalidated:true}]){
  const caps=await invoke(methods,'dashboardExtras.capabilities',{sessionKey:'agent:main:test',isLocalClient:true},client);
  assert.equal(caps.nativeOpen,false);assert.equal(caps.localClient,false);assert.equal(caps.download,true);
  const opened=await invoke(methods,'dashboardExtras.openLocalFile',request({isLocalClient:true}),client);
  assert.equal(opened.code,'remote-client');
 }
 const local=await invoke(methods,'dashboardExtras.capabilities',{sessionKey:'agent:main:test'});
 assert.equal(local.nativeOpen,true);assert.equal(local.localClient,true);
});

test('authenticated download RPC supports arbitrary bytes on Mac and non-Mac gateways',async()=>{
 for(const platform of ['darwin','linux']){
  const {api,methods}=createApi(root);backend.registerDashboardExtras(api,{platform});
  assert.deepEqual(methods.get('dashboardExtras.readLocalFile').policy,{scope:'operator.admin',profileAccess:'required'});
  const caps=await invoke(methods,'dashboardExtras.capabilities',{sessionKey:'agent:main:test'},{});
  assert.equal(caps.download,true);assert.equal(caps.sessionId,'session-1');
  const chunks=[];let offset=0,revision;
  do {
   const result=await invoke(methods,'dashboardExtras.readLocalFile',request({offset,...revision?{expectedRevision:revision}:{}}),{});
   assert.equal(result.read,true);assert.equal(result.name,'binary.unknown');assert.equal(result.offset,offset);assert.equal(result.size,bytes.length);
   assert.ok(result.nextOffset>offset);assert.ok(result.nextOffset-offset<=512*1024);assert.match(result.revision,/^[a-f0-9]{64}$/);
   chunks.push(Buffer.from(result.data,'base64'));offset=result.nextOffset;revision=result.revision;
  }while(offset<bytes.length);
  assert.deepEqual(Buffer.concat(chunks),bytes);assert.ok(chunks.length>1);
 }
});

test('downloads preserve empty files and deny invalid offsets, replaced files and escaped roots',async()=>{
 const {api,methods}=createApi(root);backend.registerDashboardExtras(api,{platform:'linux'});
 await fs.writeFile(path.join(root,'LICENSE'),'');
 const empty=await invoke(methods,'dashboardExtras.readLocalFile',request({path:'LICENSE'}),{});
 assert.equal(empty.read,true);assert.equal(empty.data,'');assert.equal(empty.size,0);assert.equal(empty.nextOffset,0);
 for(const extra of [{offset:-1},{offset:0.5},{offset:1},{offset:999999,expectedRevision:'a'.repeat(64)},{expectedRevision:'invalid'},{expectedSessionId:'stale'},{path:'../outside.unknown'},{path:'.'},{path:'missing.unknown'}]){
  const denied=await invoke(methods,'dashboardExtras.readLocalFile',request(extra),{});
  assert.equal(denied.read,false);assert.equal(denied.data,undefined);
 }
 const file=path.join(root,'changing.bin');await fs.writeFile(file,bytes);
 const first=await invoke(methods,'dashboardExtras.readLocalFile',request({path:'changing.bin'}),{});
 await fs.rename(file,file+'.old');await fs.writeFile(file,bytes);
 const second=await invoke(methods,'dashboardExtras.readLocalFile',request({path:'changing.bin',offset:first.nextOffset,expectedRevision:first.revision}),{});
 assert.equal(second.read,false);assert.equal(second.code,'file-changed');assert.equal(second.data,undefined);
});

test('download reads recheck session incarnation after awaited file IO',async()=>{
 const {api,state,methods}=createApi(root);const get=api.runtime.agent.session.getSessionEntry;let reads=0;
 api.runtime.agent.session.getSessionEntry=params=>{if(++reads>1)state.entry={...state.entry,sessionId:'new-incarnation'};return get(params);};
 backend.registerDashboardExtras(api,{platform:'linux'});
 const result=await invoke(methods,'dashboardExtras.readLocalFile',request(),{});
 assert.equal(result.read,false);assert.equal(result.code,'stale-preview');assert.equal(result.data,undefined);
});
