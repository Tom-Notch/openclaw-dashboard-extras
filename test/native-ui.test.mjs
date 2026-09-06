import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { createContext, Script } from 'node:vm';
import MarkdownIt from 'markdown-it';
import { buildProductionArtifact } from './helpers/load-production.mjs';

let bundled;
const plain = new MarkdownIt({ html: false, breaks: true });
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function fixture(t, options = {}) {
  bundled ??= buildProductionArtifact({ entryPoints: ['src/control-ui.ts'], platform: 'browser', format: 'iife', globalName: 'Plugin' });
  const w = new Window();
  const sandbox = createContext({ window:w, document:w.document, navigator:w.navigator, MutationObserver:w.MutationObserver, Node:w.Node, Element:w.Element, HTMLElement:w.HTMLElement, localStorage:w.localStorage, atob, btoa, URL, setTimeout, clearTimeout, queueMicrotask }, { codeGeneration: { strings:false, wasm:false } });
  const artifact = await bundled;
  new Script(artifact.code, { filename:artifact.path }).runInContext(sandbox);
  w.document.body.innerHTML = '<openclaw-chat-pane><div id="native"></div><textarea aria-label="composer">unsent draft</textarea><div id="side"></div></openclaw-chat-pane><aside id="outside">unrelated</aside>';
  const container = w.document.querySelector('#native');
  const scope = { sessionKey:'agent:fixture:test', agentId:'fixture' };
  const abort = new AbortController(); const registrations=[]; const actions=[]; const selections=[]; const calls=[]; const listeners=new Set();
  const caps = { nativeOpen:true, sessionId:'incarnation', root:'/workspace' };
  const host = { apiVersion:1, signal:abort.signal, locale:'en', connection:{ connected:true, canRead:true, canAdmin:options.admin ?? true },
    request:async (method,params) => { calls.push({ method,params:structuredClone(params) }); if(method==='dashboardExtras.capabilities'&&!params)return caps; if(options.request)return options.request(method,params); if(method==='dashboardExtras.capabilities')return caps; if(method==='sessions.files.get')return { ...scope,root:'/workspace',file:{path:params.path,missing:false} }; if(method==='dashboardExtras.openLocalFile')return {opened:true}; throw Error('Unexpected RPC'); },
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    ui:{ registerReplacement:r=>{registrations.push(r);return()=>{};},registerAction:r=>{actions.push(r);return()=>{};},registerPanel:()=>()=>{},selectReplacement:(surface,id)=>selections.push({surface,id}) }
  };
  const activation = await sandbox.Plugin.default.activate(host);
  const registration = registrations.find(r=>r.surface==='transcript'); assert.ok(registration);
  let mounts=0,unmounts=0;
  const context = { host,signal:abort.signal,props:{...scope,messages:[],stream:null,loading:false},presented:true,
    mountDefault(root){ mounts++; root.innerHTML='<div class="chat-thread"><div class="chat-group assistant"><div id="bubble" class="chat-bubble" data-message-text=""><div class="chat-text"></div><button id="copy">Copy</button><details id="tool"><summary>Tool activity</summary><pre>TOOL_RESULT</pre></details></div></div></div>';return()=>{unmounts++;root.replaceChildren();}; }
  };
  const handle=registration.mount(container,context);
  t.after(()=>{handle?.dispose?.();activation?.();abort.abort();w.happyDOM.abort();});
  assert.equal(mounts,1,'the real native transcript must be mounted, not replaced with plugin messages');
  const bubble=container.querySelector('#bubble');
  const setText=source=>{bubble.dataset.messageText=source;bubble.querySelector('.chat-text').innerHTML=plain.render(source);};
  const sidebar=(path='demo.txt')=>{const side=w.document.querySelector('#side'); side.innerHTML='<section class="sidebar-file-view"><div class="sidebar-file-view__path-bar"><span class="sidebar-file-view__path"></span><div class="sidebar-file-view__actions"><button id="edit">Edit</button></div></div><pre id="file-content">NATIVE_PREVIEW</pre><div class="sidebar-file-view__footer"><button id="raw">View Raw Text</button></div></section>';side.querySelector('.sidebar-file-view__path').setAttribute('title',path);side.querySelector('.sidebar-file-view__path').textContent=path;return side;};
  return {w,container,bubble,setText,sidebar,handle,context,host,caps,calls,actions,selections,listeners,abort,unmounts:()=>unmounts};
}

test('enhancement is automatic, without mode buttons, and preserves native owners',async t=>{
 const v=await fixture(t); assert.equal(v.actions.length,0);assert.ok(v.selections.some(x=>x.surface==='transcript'&&x.id));
 const copy=v.container.querySelector('#copy'),tool=v.container.querySelector('#tool');
 v.setText(String.raw`Native **reply** with $x^2$ and \(a_b\).`);await pause();
 assert.equal(v.container.querySelectorAll('math').length,2);assert.equal(v.container.querySelector('#copy'),copy);assert.equal(tool.open,false);assert.equal(v.w.document.querySelector('textarea').value,'unsent draft');assert.equal(v.container.querySelector('.extras-shell'),null);
});

test('four math delimiters render inside existing bubbles, not a second transcript',async t=>{
 const v=await fixture(t);v.setText(String.raw`$x^2$ and \(a*b*c\).

$$\frac{1}{2}$$

\[\frac{2}{3}\]`);await pause();
 assert.equal(v.container.querySelectorAll('math').length,4);assert.equal(v.container.querySelectorAll('mfrac').length,2);assert.equal(v.container.querySelectorAll('.chat-thread').length,1);
});

test('code, prices, web/file links, tool disclosure and native rich blocks are preserved',async t=>{
 const v=await fixture(t);v.setText('`$code$` costs $5 to $10. Math $x^2$.\n\n```js\nconst x = "$not_math$";\n```\n\n[Web](https://example.com) [Local](./demo.txt)');
 const pre=v.bubble.querySelector('pre'),link=v.bubble.querySelector('a'),code=v.bubble.querySelector('code');await pause();
 assert.equal(v.bubble.querySelectorAll('math').length,1);assert.equal(v.bubble.querySelector('pre'),pre);assert.equal(v.bubble.querySelector('a'),link);assert.equal(v.bubble.querySelector('code'),code);assert.match(v.bubble.textContent,/\$5 to \$10/);
});

test('streaming completion, rerender and repeated formulas remain correct and idempotent',async t=>{
 const v=await fixture(t);v.setText('Start $x');await pause();assert.equal(v.container.querySelector('math'),null);
 v.setText('Start $x^2$ and $x^2$.');await pause();assert.equal(v.container.querySelectorAll('math').length,2);
 await pause();assert.equal(v.container.querySelectorAll('math').length,2);
 v.setText('New $y^3$.');await pause();assert.equal(v.container.querySelectorAll('math').length,1);assert.match(v.container.querySelector('math').textContent,/y/);
});

test('absent or changed host DOM keeps native content readable',async t=>{
 const v=await fixture(t);v.bubble.removeAttribute('data-message-text');v.bubble.querySelector('.chat-text').textContent='$x^2$';await pause();assert.match(v.bubble.textContent,/\$x\^2\$/);assert.equal(v.bubble.querySelector('math'),null);
});

test('host render boundary comments survive math spanning native markup',async t=>{
 const v=await fixture(t);v.bubble.dataset.messageText=String.raw`\(a*b*c\)`;v.bubble.querySelector('.chat-text').innerHTML='<p>(a<!--native-part--><em>b</em><!--native-end-->c)</p>';await pause();
 assert.equal(v.bubble.querySelectorAll('math').length,1);assert.match(v.bubble.innerHTML,/<!--native-part-->/);assert.match(v.bubble.innerHTML,/<!--native-end-->/);
});

test('consumed math line breaks keep native identities and become visible when reused for prose',async t=>{
 const v=await fixture(t);v.setText('$$\nx+1\n$$\n\nOutside line one.\nOutside line two.');
 const content=v.bubble.querySelector('.chat-text'),paragraph=content.querySelector('p');
 const breaks=[...paragraph.querySelectorAll('br')],outside=content.querySelector('p:last-child br');
 assert.equal(breaks.length,2);await pause();
 for(const node of breaks){assert.ok(paragraph.contains(node),'host-owned nodes must not be deleted');assert.equal(v.w.getComputedStyle(node).display,'none');}
 assert.notEqual(v.w.getComputedStyle(outside).display,'none','unrelated prose line breaks remain visible');
 v.bubble.dataset.messageText='Reused first line.\nReused second line.';
 paragraph.replaceChildren(v.w.document.createTextNode('Reused first line.'),breaks[0],v.w.document.createTextNode('Reused second line.'));
 await pause();assert.notEqual(v.w.getComputedStyle(breaks[0]).display,'none','host reuse must not inherit stale suppression');
});

test('multi-paragraph math suppresses only its empty remnants and preserves subsequent prose',async t=>{
 const v=await fixture(t);v.setText('$$\nx\n\n+1\n$$\n\nStill here.');
 const paragraphs=[...v.bubble.querySelectorAll('.chat-text p')];assert.equal(paragraphs.length,3);
 const marker=v.w.document.createComment('native-part');paragraphs[1].prepend(marker);await pause();
 assert.equal(v.bubble.querySelectorAll('math').length,1);
 assert.equal(v.w.getComputedStyle(paragraphs[1]).display,'none');
 assert.ok(paragraphs[1].contains(marker));assert.notEqual(v.w.getComputedStyle(paragraphs[2]).display,'none');assert.equal(paragraphs[2].textContent,'Still here.');
});

test('any local filename opens directly without a preview or extension allowlist',async t=>{
 const v=await fixture(t);
 for(const file of ['./opaque.unlistedverylongsuffix','./LICENSE','./archive.custom','/fixture-workspace/my report.xyz']){
  v.setText(`[Open](<${file}>)`);const link=v.bubble.querySelector('a');assert.ok(link);
  link.dispatchEvent(new v.w.MouseEvent('click',{bubbles:true,cancelable:true,button:0}));await pause();
  const request=v.calls.filter(x=>x.method==='dashboardExtras.openLocalFile').at(-1);assert.ok(request,'file click must directly call the OS-open RPC');assert.equal(request.params.path,file);assert.equal(request.params.sessionKey,'agent:fixture:test');assert.equal(request.params.expectedSessionId,'incarnation');
 }
 assert.equal(v.calls.some(x=>x.method==='sessions.files.get'),false,'opening must not depend on Dashboard preview support');
 assert.equal(v.w.document.querySelector('#side').childElementCount,0);
});

test('web links, session links, modifier clicks and displaying messages never launch a file',async t=>{
 const v=await fixture(t);v.setText('[Web](https://example.com) [Mail](mailto:example@example.com) [File](./report.any)');await pause();assert.equal(v.calls.length,0);
 for(const link of v.bubble.querySelectorAll('a'))link.dispatchEvent(new v.w.MouseEvent('click',{bubbles:true,cancelable:true,button:0,altKey:link.textContent==='File'}));
 await pause();assert.equal(v.calls.length,0);
});

test('file click retains literal masked paths and never guesses another user',async t=>{
 const v=await fixture(t);v.setText('[Old](/fixture-workspace/***/report.pdf)');v.bubble.querySelector('a').click();await pause();
 assert.equal(v.calls.find(x=>x.method==='dashboardExtras.openLocalFile').params.path,'/fixture-workspace/***/report.pdf');
});

test('revoked permission, changed session and aborted late work cannot open a file',async t=>{
 for(const revoke of ['admin','session','abort']){
  let release;const delayed=new Promise(r=>release=r);const v=await fixture(t,{request:async method=>{if(method==='dashboardExtras.capabilities')return delayed;return {opened:true};}});
  v.setText('[File](./report)');v.bubble.querySelector('a').click();
  if(revoke==='admin')v.host.connection.canAdmin=false;
  if(revoke==='session')v.handle.update({...v.context,props:{...v.context.props,sessionKey:'agent:fixture:other'}});
  if(revoke==='abort')v.abort.abort();
  release({nativeOpen:true,sessionId:'incarnation',root:'/workspace'});await pause();assert.equal(v.calls.some(x=>x.method==='dashboardExtras.openLocalFile'),false);
 }
});

test('double clicks coalesce and unavailable native opening reports an inline failure',async t=>{
 const v=await fixture(t,{request:async method=>method==='dashboardExtras.capabilities'?{nativeOpen:false}:{opened:true}});v.setText('[File](./report)');const link=v.bubble.querySelector('a');link.click();link.click();await pause();
 assert.equal(v.calls.filter(x=>x.method==='dashboardExtras.capabilities').length,1);assert.equal(v.calls.some(x=>x.method==='dashboardExtras.openLocalFile'),false);assert.ok(v.bubble.querySelector('[role="status"]'));assert.equal(v.w.document.querySelector('textarea').value,'unsent draft');
});
