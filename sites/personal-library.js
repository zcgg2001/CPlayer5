import { cleanPlaylist } from '../js/library-data.js';
import { sqlDB, json, opsError, config, blockedText } from './operations-store.js';
const idOK = id => /^[\w-]{1,80}$/.test(id);
const projected = (row,role) => ({ id:row.id, revision:row.revision, visibility:row.visibility, ...JSON.parse(row.body), role, createdAt:row.createdAt, updatedAt:row.updatedAt });
export async function exportSharedLibrary(env,userId) {
  const db=sqlDB(env);
  const owned=(await db.prepare('SELECT * FROM cplayer_shared_playlists WHERE ownerId=?').bind(userId).all()).results;
  const joined=(await db.prepare("SELECT p.*,m.role FROM cplayer_shared_playlists p JOIN cplayer_playlist_members m ON m.playlistId=p.id WHERE m.userId=? AND m.status='accepted'").bind(userId).all()).results;
  return [...owned.map(row=>projected(row,'owner')),...joined.map(row=>projected(row,row.role))];
}
export async function publicPlaylist(request,env) {
  const path=new URL(request.url).pathname, id=path.split('/').at(-1);
  if (!/^\/api\/library\/public\//.test(path)) return null;
  if(request.method!=='GET')return opsError(405,'method','请使用 GET');
  if(!idOK(id))return opsError(404,'not_found','歌单不存在或已设为私密');
  const row=await sqlDB(env)?.prepare("SELECT * FROM cplayer_shared_playlists WHERE id=? AND visibility='public'").bind(id).first();
  if(!row)return opsError(404,'not_found','歌单不存在或已设为私密');
  const value=projected(row,'viewer'), settings=await config(env);
  if(blockedText(`${value.name} ${value.description} ${value.songs.map(s=>s.name+' '+s.artist).join(' ')}`,settings))return opsError(404,'not_found','歌单暂不可用');
  return json(value);
}
export async function handlePersonalLibrary(request,env,userId,body) {
  const path=new URL(request.url).pathname, db=sqlDB(env), method=request.method;
  if(!path.startsWith('/api/library/'))return null;
  const fail=(status,code,message)=>opsError(status,code,message);
  if(path==='/api/library/playlists' && method==='GET') {
    const lists=await exportSharedLibrary(env,userId);
    const invitations=(await db.prepare("SELECT p.id,p.body,u.username FROM cplayer_playlist_members m JOIN cplayer_shared_playlists p ON p.id=m.playlistId JOIN user u ON u.id=p.ownerId WHERE m.userId=? AND m.status='pending' LIMIT 100").bind(userId).all()).results.map(row=>({id:row.id,name:JSON.parse(row.body).name,from:row.username}));
    return json({lists,invitations});
  }
  let clean;
  const validate=async input=>{
    const value=cleanPlaylist(input); delete value.sharedId;
    if(new TextEncoder().encode(JSON.stringify(value)).length>1_500_000)throw new Error('歌单数据过大');
    const settings=await config(env);if(blockedText(`${value.name} ${value.description} ${value.songs.map(s=>s.name+' '+s.artist).join(' ')}`,settings))throw new Error('歌单包含暂不支持的内容');
    return value;
  };
  if(path==='/api/library/playlists' && method==='POST') {
    try { clean=await validate(body); } catch(error) {return fail(400,'invalid_playlist',error.message);}
    const id=crypto.randomUUID(),now=Date.now();
    // Creation is always private; publication is a separate, explicit owner action.
    const result=await db.prepare("INSERT INTO cplayer_shared_playlists(id,ownerId,body,createdAt,updatedAt) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM cplayer_shared_playlists WHERE ownerId=?)<100 RETURNING id").bind(id,userId,JSON.stringify(clean),now,now,userId).first();
    return result?json({id,revision:1,visibility:'private'},201):fail(409,'playlist_limit','最多创建 100 个云端协作歌单');
  }
  const match=/^\/api\/library\/playlists\/([\w-]{1,80})(?:\/(members|invitation))?$/.exec(path);
  if(!match)return fail(404,'not_found','接口不存在');
  const [,id,action]=match;
  const row=await db.prepare('SELECT * FROM cplayer_shared_playlists WHERE id=?').bind(id).first();
  const member=await db.prepare('SELECT role,status FROM cplayer_playlist_members WHERE playlistId=? AND userId=?').bind(id,userId).first();
  const owner=row?.ownerId===userId, role=owner?'owner':member?.status==='accepted'?member.role:null;
  if(action==='invitation' && method==='POST' && row && member) {
    if(body?.accept===true)await db.prepare("UPDATE cplayer_playlist_members SET status='accepted' WHERE playlistId=? AND userId=?").bind(id,userId).run();
    else await db.prepare('DELETE FROM cplayer_playlist_members WHERE playlistId=? AND userId=?').bind(id,userId).run();
    return json({ok:true});
  }
  if(!row || !role)return fail(404,'not_found','歌单不存在或你没有访问权限');
  if(action==='members') {
    if(!owner)return fail(403,'owner_required','只有创建者可以管理成员');
    if(method==='GET')return json({members:(await db.prepare('SELECT u.username,m.role,m.status FROM cplayer_playlist_members m JOIN user u ON u.id=m.userId WHERE playlistId=?').bind(id).all()).results});
    const username=typeof body?.username==='string'?body.username.trim().toLowerCase():'';
    const target=await db.prepare('SELECT id FROM user WHERE username=?').bind(username).first();
    if(!target || target.id===userId)return fail(400,'invalid_member','请填写已注册的其他用户名');
    if(method==='DELETE') {await db.prepare('DELETE FROM cplayer_playlist_members WHERE playlistId=? AND userId=? AND EXISTS(SELECT 1 FROM cplayer_shared_playlists WHERE id=? AND ownerId=?)').bind(id,target.id,id,userId).run();return json({ok:true});}
    if(method==='POST' && ['editor','viewer'].includes(body.role)) {
      const result=await db.prepare("INSERT INTO cplayer_playlist_members(playlistId,userId,role,status) SELECT ?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM cplayer_shared_playlists WHERE id=? AND ownerId=?) AND (SELECT COUNT(*) FROM cplayer_playlist_members WHERE playlistId=?)<20 ON CONFLICT(playlistId,userId) DO UPDATE SET role=excluded.role RETURNING userId").bind(id,target.id,body.role,id,userId,id).first();
      return result?json({ok:true}):fail(409,'member_limit','每个歌单最多 20 位协作者');
    }
    return fail(400,'invalid_member','成员操作无效');
  }
  if(method==='GET')return json(projected(row,role));
  if(method==='DELETE') {
    if(!owner)return fail(403,'owner_required','只有创建者可以删除歌单');
    if(body?.revision!==row.revision)return fail(409,'conflict','歌单已有更新，请刷新后重试');
    const removed=await db.prepare('DELETE FROM cplayer_shared_playlists WHERE id=? AND ownerId=? AND revision=? RETURNING id').bind(id,userId,body.revision).first();
    return removed?json({ok:true}):fail(409,'conflict','歌单已有更新，请刷新后重试');
  }
  if(method==='PUT') {
    if(role==='viewer')return fail(403,'editor_required','你拥有只读权限');
    if(!Number.isSafeInteger(body?.revision) || body.revision<1)return fail(400,'invalid_revision','版本号无效');
    if(body.visibility!==undefined && (!owner || !['public','private'].includes(body.visibility)))return fail(403,'owner_required','只有创建者可以更改公开状态');
    try {clean=await validate(body);}catch(error){return fail(400,'invalid_playlist',error.message);}
    const permission=owner?'ownerId=?':"EXISTS (SELECT 1 FROM cplayer_playlist_members WHERE playlistId=cplayer_shared_playlists.id AND userId=? AND role='editor' AND status='accepted')";
    const updated=await db.prepare(`UPDATE cplayer_shared_playlists SET body=?, ${owner?'visibility=?, ':''}revision=revision+1,updatedAt=? WHERE id=? AND revision=? AND ${permission} RETURNING revision`).bind(JSON.stringify(clean),...(owner?[body.visibility||row.visibility]:[]),Date.now(),id,body.revision,userId).first();
    return updated?json({revision:updated.revision}):fail(409,'conflict','歌单或权限已更新，编辑仍保留，请刷新后重试');
  }
  return fail(405,'method','不支持此操作');
}
