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

## Heading with $x^2$

| Context | Formula |
| --- | --- |
| Table | $x^2$ |

Prices: $5 to $10. Literal code: CODE_FIXTURE.

[Open a local file](./opaque.unlistedverylongsuffix)

[Open extensionless file](./LICENSE) · [Open path with spaces](<./report with spaces.xyz>)

[Ordinary web link](https://example.com)

Spacing one-line before.

$$x+1$$

Spacing one-line after.

Spacing multiline before.

$$
x+1
$$

Spacing multiline after.

Spacing blank-line before.

$$
x

+1
$$

Spacing blank-line after.

Spacing same-paragraph before.
$$
x+1
$$
Spacing same-paragraph after.

$$\int_0^\infty \frac{e^{-x^2}}{1+x^2}\,dx$$

$$\left(\frac{\frac{a}{b}}{\frac{c}{d}}\right)^{\sum_{i=1}^{n}x_i}$$

$$\begin{pmatrix}a&b\\c&d\end{pmatrix}$$

$$LONG_FORMULA$$

FENCE_FIXTURE`.replace('LONG_FORMULA',()=>Array.from({length:80},(_,i)=>`x_${i+1}`).join('+')).replace('CODE_FIXTURE',()=>'`$never$`').replace('FENCE_FIXTURE','```js\nconst literal = "$not_math$";\n```');
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
 stage='four-delimiters-in-native-messages';await page.waitForFunction(()=>document.querySelectorAll('[data-dashboard-extras-native] math').length===14);
 assert.equal(await page.locator('.extras-shell').count(),0);assert.equal(await page.getByRole('button',{name:'Use Math & Files',exact:true}).count(),0);
 assert.equal(await page.locator('math mfrac').count(),8);await page.locator('code').filter({hasText:'$never$'}).waitFor();await page.locator('a[href="https://example.com"]').waitFor();
 stage='horizontal-only-formula-overflow';
 const formulaOverflow=()=>page.locator('[data-dashboard-extras-native] math[display="block"]').evaluateAll(nodes=>nodes.map(math=>{
  const viewport=math.closest('[data-dashboard-extras-math]'),box=viewport.getBoundingClientRect();
  const contentBoxes=[...math.querySelectorAll('*')].filter(node=>node.localName!=='annotation').map(node=>node.getBoundingClientRect()).filter(rect=>rect.width&&rect.height);
  const wide=viewport.scrollWidth>viewport.clientWidth;
  let firstReachable=true,lastReachable=true;
  if(wide){
   const glyphs=math.querySelectorAll('mi,mn,mo');viewport.scrollLeft=0;
   firstReachable=glyphs[0].getBoundingClientRect().left>=box.left-1;
   viewport.scrollLeft=viewport.scrollWidth;
   lastReachable=glyphs[glyphs.length-1].getBoundingClientRect().right<=box.left+viewport.clientWidth+1;
   viewport.scrollLeft=0;
  }
  const overflowY=getComputedStyle(viewport).overflowY;
  return {verticalScrollbar:overflowY==='scroll'||(overflowY==='auto'&&viewport.scrollHeight>viewport.clientHeight),wide,firstReachable,lastReachable,top:Math.min(...contentBoxes.map(rect=>rect.top))-box.top,bottom:Math.max(...contentBoxes.map(rect=>rect.bottom))-(box.top+viewport.clientHeight)};
 }));
 const checkOverflow=async()=>{
  const samples=await formulaOverflow();assert.ok(samples.some(sample=>sample.wide),'exercise an actually overflowing long formula');
  for(const sample of samples){
   // MathML's scrollHeight includes spare font metrics outside its rendered
   // bounds. Test the unwanted scrollbar and clipping independently, not that
   // browser-internal extent (which remains even with no vertical scrollbar).
   assert.equal(sample.verticalScrollbar,false,'formula must not have a vertical scrollbar');
   assert.ok(sample.top>=-1&&sample.bottom<=1,'fractions, scripts and matrix bounds must fit without clipping');
   assert.ok(sample.firstReachable&&sample.lastReachable,'both ends of long math must be reachable horizontally');
  }
 };
 await checkOverflow();
 await page.setViewportSize({width:1000,height:1000});await checkOverflow();
 await page.setViewportSize({width:1440,height:1000});
 stage='consistent-formula-base-size';
 const typography=()=>page.locator('[data-dashboard-extras-native] math').evaluateAll(nodes=>nodes.map(node=>({
  context:node.closest('h2')?'heading':node.closest('td')?'table':'body',
  size:parseFloat(getComputedStyle(node).fontSize),
  bodySize:parseFloat(getComputedStyle(node.closest('.chat-text')).fontSize),
  scriptSize:node.querySelector('msup > :last-child')?parseFloat(getComputedStyle(node.querySelector('msup > :last-child')).fontSize):null,
 })));
 const initialTypography=await typography();
 assert.ok(initialTypography.some(node=>node.context==='heading'));
 assert.ok(initialTypography.some(node=>node.context==='table'));
 for(const node of initialTypography){
  assert.equal(node.size,node.bodySize,`${node.context} formula must follow the conversation's base size`);
  if(node.scriptSize!==null)assert.ok(node.scriptSize<node.size,'superscripts retain their mathematical hierarchy');
 }
 // A user changing chat typography must not leave existing formulas at a stale
 // pixel size. Keep the host's heading/table text styling unchanged as well.
 const nativeText=page.locator('[data-dashboard-extras-native] .chat-text').last();
 const nativeSizes=()=>nativeText.evaluate(node=>Object.fromEntries(['h2','table'].map(selector=>[selector,getComputedStyle(node.querySelector(selector)).fontSize])));
 const unchangedTextSizes=await nativeSizes();
 await nativeText.evaluate(node=>node.style.setProperty('--chat-text-size','18px'));
 for(const node of await typography())assert.equal(node.size,node.bodySize);
 await checkOverflow();
 await nativeText.evaluate(node=>node.style.removeProperty('--chat-text-size'));
 assert.deepEqual(await nativeSizes(),unchangedTextSizes);
 stage='no-blank-lines-left-by-math-source';
 const spacing=await nativeText.evaluate(root=>{
  const formulas=[...root.querySelectorAll('math')].filter(node=>node.querySelector('annotation')?.textContent?.replace(/\s/g,'')==='x+1');
  const textBox=label=>{
   const walker=document.createTreeWalker(root,4);
   for(let node=walker.nextNode();node;node=walker.nextNode()){
    const index=node.textContent.indexOf(label);if(index<0)continue;
    const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+label.length);return range.getBoundingClientRect();
   }
   throw Error('Missing spacing fixture text');
  };
  return ['one-line','multiline','blank-line','same-paragraph'].map((kind,index)=>{
   const box=formulas[index].getBoundingClientRect();
   return {kind,before:box.top-textBox(`Spacing ${kind} before.`).bottom,after:textBox(`Spacing ${kind} after.`).top-box.bottom,lineHeight:parseFloat(getComputedStyle(root).lineHeight)};
  });
 });
 for(const sample of spacing){
  assert.ok(sample.before>=0&&sample.before<=sample.lineHeight,`${sample.kind}: unexpected blank space before formula (${sample.before}px)`);
  assert.ok(sample.after>=0&&sample.after<=sample.lineHeight,`${sample.kind}: unexpected blank space after formula (${sample.after}px)`);
 }
 for(const sample of spacing.slice(1,3))assert.ok(Math.abs(sample.after-spacing[0].after)<=1,'source newlines must not change rendered formula spacing');
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
 stage='reload-without-switch';await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-dashboard-extras-native] math').length===14);
 await checkOverflow();
 for(const node of await typography())assert.equal(node.size,node.bodySize);
 assert.equal(calls.some(x=>x.method==='chat.send'),false);assert.deepEqual(errors,[]);
 const result={status:'passed',hostVersion:hostPackage.packageJson.version,realInstalledDashboard:true,syntheticRpcOnly:true,formulas:14,horizontalOnlyMathScrolling:true,mathBoundsUnclipped:true,wideFormulaEndsReachable:true,consistentMathBaseSize:true,chatTextSizeChanges:true,superscriptHierarchy:true,compactFormulaSpacing:spacing,directFiles:['unlisted extension','extensionless','spaces'],explicitOpenOnly:true,draftPreserved:true,noModeSwitch:true,reload:true,pageErrors:[],actualApplicationOpened:false};
 fs.writeFileSync(path.join(artifacts,'native-browser.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){
 await page?.screenshot({path:path.join(project,'test-results/native-browser-failure.png')}).catch(()=>{});
 console.error(JSON.stringify({status:'failed',stage,error:error.message,socketEvents,body:(await page.locator('body').innerText()).slice(-2500),methods:[...new Set(calls.map(x=>x.method))],reports:calls.filter(x=>x.method==='plugins.controlUi.report'),errors}));process.exitCode=1;
}finally{await context?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));}
