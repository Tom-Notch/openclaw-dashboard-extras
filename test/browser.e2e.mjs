import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveHostPackage } from '../scripts/typecheck.mjs';

// Real installed Dashboard assets, synthetic RPCs only. No running Gateway,
// accounts, credentials, chats, persistent browser profile, or native opener.
const project = fileURLToPath(new URL('../', import.meta.url));
const hostPackage = resolveHostPackage();
const uiRoot = path.join(hostPackage.root, 'dist/control-ui');
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'openclaw.plugin.json'), 'utf8'));
const plugin = fs.readFileSync(path.join(project, manifest.controlUi.entry));
const sessionKey = 'agent:fixture:native-regression';
const workspace = '/fixture-workspace';
const session = { key:sessionKey, sessionId:'fixture-incarnation', label:'Native conversation regression', displayName:'Native conversation regression', updatedAt:Date.now(), kind:'direct', channel:'webchat', model:'fixture', modelProvider:'fixture', spawnedCwd:workspace };
const models = [{id:'fixture',name:'Fixture (no inference)',provider:'fixture',contextWindow:32000,reasoning:false}];
const message = String.raw`Native conversation, no mode switch.

Inline $x^2+y^2=z^2$ and \(e^{i\pi}+1=0\).

$$\frac{1}{2}+\frac{1}{3}=\frac{5}{6}$$

\[\frac{2}{3}\]

Prices: $5 to $10. Literal code: CODE_FIXTURE.

[Open a local file](./opaque.unlistedverylongsuffix)

[Open extensionless file](./LICENSE) · [Open path with spaces](<./report with spaces.xyz>)

[Ordinary web link](https://example.com)

FENCE_FIXTURE`.replace('CODE_FIXTURE',()=>'`$never$`').replace('FENCE_FIXTURE','```js\nconst literal = "$not_math$";\n```');
const history = [{role:'user',content:'Show the report.',timestamp:Date.now()-2000},{role:'assistant',content:[{type:'text',text:message}],timestamp:Date.now()-1000}];
const entryUrl = '/__openclaw__/plugins/control-ui/dashboard-extras/fixture/index.js';
const catalog = {revision:'fixture',diagnostics:[],plugins:[{pluginId:'dashboard-extras',name:'Dashboard Extras',revision:'fixture',entryUrl,styles:[]}]};
const methods = ['agents.list','sessions.list','sessions.resolve','sessions.describe','chat.history','chat.startup','chat.metadata','models.list','sessions.files.list','sessions.files.get','plugins.controlUi.list','plugins.controlUi.report','dashboardExtras.capabilities','dashboardExtras.openLocalFile'];
const calls=[];const socketEvents=[];
const server=http.createServer((request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 response.setHeader('Cache-Control','no-store');
 if(pathname===entryUrl){response.setHeader('Content-Type','text/javascript');response.end(plugin);return;}
 if(pathname==='/control-ui-config.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({basePath:'',assistantAgentId:'fixture',assistantName:'Assistant',assistantAvatar:'',serverVersion:hostPackage.packageJson.version,pluginAssetsRequireAuth:false,localMediaPreviewRoots:[workspace],terminalEnabled:false,cliAgentsEnabled:false,embedSandbox:'scripts'}));return;}
 if(pathname==='/favicon.ico'){response.writeHead(204);response.end();return;}
 const filename=path.resolve(uiRoot,'.'+pathname);
 if(filename.startsWith(uiRoot+path.sep)&&fs.existsSync(filename)&&fs.statSync(filename).isFile()){
  const type={'.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.html':'text/html'}[path.extname(filename)]??'application/octet-stream';response.setHeader('Content-Type',type);response.end(fs.readFileSync(filename));return;
 }
 response.setHeader('Content-Type','text/html');response.end(fs.readFileSync(path.join(uiRoot,'index.html'),'utf8').replace('<head>','<head><base href="/">'));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
function reply(method,params){
 if(method==='connect')return {type:'hello-ok',protocol:params.maxProtocol,server:{version:hostPackage.packageJson.version,connId:'fixture',bootId:'fixture'},features:{methods,events:[]},auth:{role:'operator',scopes:['operator.read','operator.write','operator.admin','operator.approvals','operator.pairing']},policy:{maxPayload:16000000,maxBufferedBytes:1048576,tickIntervalMs:30000},snapshot:{presence:[],sessionDefaults:{defaultAgentId:'fixture',mainKey:'main',mainSessionKey:sessionKey,modelConfigured:true,scope:'per-sender'}}};
 if(method==='plugins.controlUi.list')return catalog;
 if(method==='agents.list')return {agents:[{id:'fixture',name:'Assistant',identity:{name:'Assistant'},model:{primary:'fixture/fixture'},workspace,workspaceGit:false}],defaultId:'fixture',mainKey:'main',scope:'per-sender'};
 if(method==='sessions.list')return {sessions:[session],count:1,ts:Date.now(),path:'',defaults:{model:'fixture',modelProvider:'fixture',contextTokens:32000}};
 if(method==='sessions.resolve')return {ok:true,key:sessionKey,session};
 if(method==='sessions.describe')return {session};
 if(method==='chat.history'||method==='chat.startup')return {messages:history,sessionId:session.sessionId,sessionKey,sessionInfo:session,resolution:{ok:true,key:sessionKey},metadata:{models},thinkingLevel:null};
 if(method==='chat.metadata')return {models,commands:[]};
 if(method==='models.list')return {models};
 if(method==='sessions.files.list')return {sessionKey,root:workspace,files:[],browser:{entries:[],path:''}};
 if(method==='sessions.files.get')throw Error('Direct opening must not request a preview');
 if(method==='dashboardExtras.capabilities')return {nativeOpen:true,sessionId:session.sessionId,root:workspace};
 if(method==='dashboardExtras.openLocalFile')return {opened:true};
 if(method==='sessions.groups.list')return {names:[],defaults:{},sectionOrder:[]};
 if(method==='artifacts.list')return {artifacts:[]};
 if(method==='plugins.controlUi.report')return {ok:true};
 if(method==='chat.send')throw Error('The test must never send chat');
 return {};
}
let browser,context,page,stage='launch';const errors=[];
try{
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark',serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(25000);
 await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
 await page.addInitScript(()=>{window.__OPENCLAW_NATIVE_CONTROL_AUTH__={gatewayUrl:`ws://${location.host}`};});
 await page.routeWebSocket('**',socket=>{socketEvents.push('routed');socket.onMessage(message=>{const frame=JSON.parse(String(message));if(frame.type!=='req')return;calls.push({method:frame.method,params:frame.params});try{socket.send(JSON.stringify({type:'res',id:frame.id,ok:true,payload:reply(frame.method,frame.params??{})}));}catch{socket.send(JSON.stringify({type:'res',id:frame.id,ok:false,error:{code:'INVALID_REQUEST',message:'Fixture request rejected'}}));}});setTimeout(()=>socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'synthetic-test-only',ts:Date.now()}})),100);});
 page.on('pageerror',error=>errors.push({kind:'page',message:error.message}));page.on('console',message=>{if(message.type()==='error')errors.push({kind:'console',message:message.text()});});
 stage='native-conversation';await page.goto(`${origin}/chat/fixture/native-regression`);await page.locator('[data-dashboard-extras-native] .chat-thread').waitFor();
 stage='four-delimiters-in-native-messages';await page.waitForFunction(()=>document.querySelectorAll('[data-dashboard-extras-native] math').length===4);
 assert.equal(await page.locator('.extras-shell').count(),0);assert.equal(await page.getByRole('button',{name:'Use Math & Files',exact:true}).count(),0);
 assert.equal(await page.locator('math mfrac').count(),4);await page.locator('code').filter({hasText:'$never$'}).waitFor();await page.locator('a[href="https://example.com"]').waitFor();
 const composer=page.locator('.agent-chat__composer-combobox > textarea');await composer.fill('UNSENT_DRAFT');
 for(const [label,expected] of [['Open a local file','./opaque.unlistedverylongsuffix'],['Open extensionless file','./LICENSE'],['Open path with spaces','./report with spaces.xyz']]){
  stage=`direct-local-file-${label}`;const before=calls.filter(x=>x.method==='dashboardExtras.openLocalFile').length;
  await page.locator('[data-dashboard-extras-native] a').filter({hasText:label}).click();
  await page.waitForFunction(()=>!document.querySelector('a[aria-busy="true"]'));
  assert.equal(calls.filter(x=>x.method==='dashboardExtras.openLocalFile').length,before+1);
  const open=calls.filter(x=>x.method==='dashboardExtras.openLocalFile').at(-1);
  assert.equal(open.params.sessionKey,sessionKey);assert.equal(open.params.agentId,'fixture');
  assert.equal(open.params.path.replace(/^\.\//,''),expected.replace(/^\.\//,''));
  assert.equal(open.params.expectedSessionId,session.sessionId);assert.equal(open.params.expectedRoot,workspace);
 }
 assert.equal(calls.some(x=>x.method==='sessions.files.get'),false,'opening never depends on preview');
 assert.equal(await page.locator('.sidebar-file-view').count(),0);
 assert.equal(await composer.inputValue(),'UNSENT_DRAFT');
 const artifacts=path.join(project,'test-results');fs.mkdirSync(artifacts,{recursive:true});await page.locator('openclaw-chat-pane').screenshot({path:path.join(artifacts,'native-browser.png')});
 stage='reload-without-switch';await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-dashboard-extras-native] math').length===4);
 assert.equal(calls.some(x=>x.method==='chat.send'),false);assert.deepEqual(errors,[]);
 const result={status:'passed',hostVersion:hostPackage.packageJson.version,realInstalledDashboard:true,syntheticRpcOnly:true,formulas:4,directFiles:['unlisted extension','extensionless','spaces'],explicitOpenOnly:true,draftPreserved:true,noModeSwitch:true,reload:true,pageErrors:[],actualApplicationOpened:false};
 fs.writeFileSync(path.join(artifacts,'native-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){
 await page?.screenshot({path:path.join(project,'test-results/native-browser-failure.png')}).catch(()=>{});
 console.error(JSON.stringify({status:'failed',stage,error:error.message,socketEvents,body:(await page.locator('body').innerText()).slice(-2500),methods:[...new Set(calls.map(x=>x.method))],reports:calls.filter(x=>x.method==='plugins.controlUi.report'),errors}));process.exitCode=1;
}finally{await context?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));}
