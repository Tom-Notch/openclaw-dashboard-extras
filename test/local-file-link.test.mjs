import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Window} from 'happy-dom';
import {importProductionModule} from './helpers/load-production.mjs';
const {localFileFromAnchor}=await importProductionModule({entryPoints:['src/local-file-link.ts']});
const w=new Window();
function link(href,attributes={}){const a=w.document.createElement('a');if(href!==null)a.setAttribute('href',href);for(const [k,v]of Object.entries(attributes))a.setAttribute(k,v);return a;}
test('local destinations support arbitrary names and local file URLs without extension checks',()=>{
 for(const [href,expected]of [['./LICENSE','./LICENSE'],['./opaque.longunknownsuffix','./opaque.longunknownsuffix'],['/workspace/report%20with%20spaces.xyz','/workspace/report with spaces.xyz'],['file:///workspace/report%20final','/workspace/report final'],['file://localhost/workspace/LICENSE','/workspace/LICENSE']])assert.equal(localFileFromAnchor(link(href)),expected);
 assert.equal(localFileFromAnchor(link('#',{'data-file-path':'/workspace/literal%20name'})),'/workspace/literal%20name');
});
test('web schemes, remote URLs, session links, fragments and malformed paths remain non-file links',()=>{
 for(const href of [null,'','#section','//example.com/a','https://example.com/a','mailto:example@example.com','javascript:void(0)','file://remote/a','file:///a?x=1','file:///a#fragment','file://localhost:99/a','file:///bad%00name','./bad%00name','./bad%GG','./bad\\name','x'.repeat(8193)])assert.equal(localFileFromAnchor(link(href)),null,href);
 assert.equal(localFileFromAnchor(link('/chat/fixture/session',{'data-session-key':'agent:fixture:session'})),null);
 assert.equal(localFileFromAnchor(link('#',{'data-file-path':'//remote/path'})),null);
});
