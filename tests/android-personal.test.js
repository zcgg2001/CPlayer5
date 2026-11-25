import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSummary } from '../js/android-profile.js';
import { androidBuildLabel } from '../js/android-settings.js';

const account = (user=null, signedIn=false, offline=false) => ({user:()=>user,isSignedIn:()=>signedIn,isOffline:()=>offline});
const store = {favorites:()=>[{id:'one'},{id:'two'}],lists:()=>[{name:'My list'}],history:()=>[]};

test('profile counts distinct songs for the local day without confusing matching IDs on different platforms',()=>{
  const now=new Date(2026,10,25,14,20);
  const records=[
    {at:new Date(2026,10,25,1).getTime(),song:{id:'gd:1',sourceId:'1',provider:'gd'}},
    {at:new Date(2026,10,25,2).getTime(),song:{id:'1',sourceId:'1',provider:'gd'}},
    {at:new Date(2026,10,25,3).getTime(),song:{id:'1',provider:'qq'}},
    {at:new Date(2026,10,24,23,59).getTime(),song:{id:'2',provider:'gd'}},
  ];
  const value=profileSummary({account:account(),store:{...store,history:()=>records},now});
  assert.equal(value.today,2);assert.equal(value.favorites,2);assert.equal(value.lists.length,1);
});

test('offline and expired identities never claim an authenticated sync state',()=>{
  const user={username:'Listener'};
  const summary=(signedIn,offline)=>profileSummary({account:account(user,signedIn,offline),store});
  assert.match(summary(false,true).identity,/离线/);
  assert.match(summary(false,false).identity,/失效/);
  assert.match(summary(true,false).identity,/已登录/);
  assert.match(profileSummary({account:account(),store}).identity,/游客/);
  assert.equal(summary(true,false).name,'Listener');
});

test('about page uses the installed Android build and distinguishes a browser preview',()=>{
  assert.equal(androidBuildLabel('Mozilla/5.0 CPlayerAndroid/1.18.0-preview CPlayerPreview/24'),'ZPlayer 1.18.0-preview · 构建 24');
  assert.equal(androidBuildLabel('Mozilla/5.0 Chrome/130'),'ZPlayer · Android 预览界面');
});
