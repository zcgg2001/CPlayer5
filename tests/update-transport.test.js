import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateTransport, updateDownloadUrl } from '../js/update-transport.js';
import { latestAndroidRelease, initAndroidUpdates } from '../js/android-updates.js';

const url='https://github.com/zcgg2001/CPlayer5/releases/download/v1.13.0/ZPlayer-android-preview-17.apk';
test('mirror routing keeps the original release address and rejects arbitrary downloads',()=>{
  assert.equal(updateDownloadUrl(url,'auto'),'https://gh-proxy.com/'+url);
  assert.equal(updateDownloadUrl(url,'mirror2'),'https://gh-proxy.org/'+url);
  assert.equal(updateDownloadUrl(url,'direct'),url);
  for(const invalid of [url.replace('zcgg2001','someone'),url+'?token=private',url+'.zip','http://example.com/a.apk']) assert.equal(updateDownloadUrl(invalid,'auto'),'');
});
test('native feed transport and download progress stay scoped to the matching request; cancellation ignores late results',async()=>{
  const sent=[],bridge={postMessage:raw=>sent.push(JSON.parse(raw))},transport=createUpdateTransport(bridge);
  const feed=transport.fetch('https://api.github.com/repos/zcgg2001/CPlayer5/releases?per_page=100&page=2',{},'mirror2');
  assert.deepEqual(sent[0],{id:'update_1',op:'feed',page:2,source:'mirror2'});
  bridge.onmessage({data:JSON.stringify({id:'update_1',status:'complete',httpStatus:200,headers:{Link:'next'},body:'[]'})});
  assert.deepEqual(await (await feed).json(),[]);
  const controller=new AbortController(),progress=[];
  const task=transport.download({download:url,code:17,size:100,sha256:'a'.repeat(64)},'auto',{signal:controller.signal,progress:v=>progress.push(v)});
  bridge.onmessage({data:JSON.stringify({id:'update_2',status:'progress',phase:'downloading',received:20,total:100})});
  controller.abort(); await assert.rejects(task,{name:'AbortError'});
  bridge.onmessage({data:JSON.stringify({id:'update_2',status:'ready'})});
  assert.equal(progress.length,1); assert.deepEqual(sent.at(-1),{id:'update_2',op:'cancel'});
});
test('release metadata includes a valid SHA-256 and displays notes as bounded plain text',async()=>{
  const result=await latestAndroidRelease(()=>Response.json([{tag_name:'v1.13.0',name:'ZPlayer',published_at:'2026-11-23',body:'<script>x</script>',assets:[{name:'ZPlayer-android-preview-17.apk',browser_download_url:url,state:'uploaded',size:1024,digest:'sha256:'+'a'.repeat(64)}]}]));
  assert.equal(result.sha256,'a'.repeat(64)); assert.equal(result.size,1024); assert.equal(result.description,'<script>x</script>');
});
test('cached update UI exposes progress, cancellation, verification and explicit installation',async()=>{
  const keys=['navigator','window','document','localStorage'],saved=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const cached={tag:'v1.13.0',code:17,asset:'ZPlayer-android-preview-17.apk',checked:Date.now(),size:1024,sha256:'a'.repeat(64),description:'新版封面'};
  const listeners={};
  const names=['androidUpdateSettings','androidInstalledVersion','androidUpdateTitle','androidUpdateBanner','androidUpdateStatus','androidReleaseName','androidUpdateCheck','androidUpdateLinks','androidUpdateDownload','androidSettingsDownload','androidReleaseNotes','androidUpdateDismiss','androidUpdateSource','androidUpdateProgress','androidUpdateMeter','androidUpdateTransfer','androidUpdateCancel','androidUpdateInstall','androidUpdateDescription'];
  const dom=Object.fromEntries(names.map(key=>[key,{setAttribute(){},addEventListener:(type,fn)=>listeners[key+type]=fn}]));
  let finish,progress,installCount=0;
  const transport={download:(_,source,options)=>{assert.equal(source,'auto');progress=options.progress;return new Promise(resolve=>finish=resolve);},install:async()=>{installCount++;return {status:'permission'};}};
  try {
    const values={navigator:{userAgent:'CPlayerAndroid/1.12.2-preview CPlayerPreview/16'},window:{CPlayerNative:{postMessage(){}},addEventListener(){}},document:{hidden:true,addEventListener(){}},localStorage:{getItem:key=>key==='cp_android_release'?JSON.stringify(cached):null,setItem(){}}};
    for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,value});
    initAndroidUpdates(dom,{transport});
    assert.equal(dom.androidUpdateInstall.hidden,true);
    const pending=listeners.androidSettingsDownloadclick({preventDefault(){},currentTarget:dom.androidSettingsDownload});
    progress({phase:'downloading',received:512,total:1024,route:'gh-proxy.com'});
    assert.equal(dom.androidUpdateMeter.value,.5); assert.equal(dom.androidUpdateCheck.disabled,true); assert.equal(installCount,0);
    progress({phase:'verifying',received:1024,total:1024});finish({status:'ready'});await pending;
    assert.equal(dom.androidUpdateInstall.hidden,false);assert.equal(installCount,0);
    await listeners.androidUpdateInstallclick();assert.equal(installCount,1);assert.match(dom.androidUpdateStatus.textContent,/允许/);
  } finally { for(const [key,value] of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];} }
});
