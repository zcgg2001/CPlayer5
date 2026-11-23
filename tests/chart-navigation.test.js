import test from 'node:test';
import assert from 'node:assert/strict';
import { createChartsController } from '../js/charts-page.js';

// Minimal DOM surface: inspect what the controller paints, with no network image loading.
class Node {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.events = {}; this.isConnected = false; this.scrollLeft = 0; this.textContent = '';
    const classes = new Set();
    this.classList = { add: value => classes.add(value), contains: value => classes.has(value),
      toggle: value => classes.has(value) ? (classes.delete(value), false) : (classes.add(value), true) };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { for (const child of children) { if (child.tag === 'fragment') this.append(...child.children); else { this.children.push(child); child.parentElement = this; } } }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  insertBefore(child) { this.append(child); }
  addEventListener(name, callback) { this.events[name] = callback; }
  closest(selector) { return selector === '[data-chart-key]' ? this : this.parentElement; }
  querySelector() { return null; }
  contains() { return false; }
  focus() {}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key,value) => values.set(key,value) }; };
const track = name => ({ id: name, name, artist: '测试歌手', provider: 'gd', playable: true, rank: 1 });
const chart = (name, id = '3778678') => ({ chart: { name, id, fetchedAt: new Date().toISOString() }, items: [track(name)] });
const response = name => Response.json({ collection: { name }, tracks: [track(name)] });

function surface(t) {
  const ids = new Map(['mobileChartsSheet','mobileChartList','mobileChartTitle','mobileChartDescription',
    'mobileChartSource','mobileChartUpdated','mobileChartCount','mobileChartCover','mobileChartRefresh'].map(id => [id,new Node()]));
  const rail = new Node(), parent = new Node(); parent.append(rail);
  const document = { getElementById: id => ids.get(id), createElement: tag => new Node(tag),
    createDocumentFragment: () => new Node('fragment'), createTextNode: text => Object.assign(new Node('text'), {textContent:text}),
    querySelectorAll: selector => selector === '[data-chart-key]' ? rail.children : [rail] };
  const before = globalThis.document; globalThis.document = document;
  t.after(() => { globalThis.document = before; });
  return { document, rail, title: ids.get('mobileChartTitle'), list: ids.get('mobileChartList'), updated: ids.get('mobileChartUpdated') };
}

test('opening a saved chart paints its rows before a delayed refresh, and keeps them on failure and offline reopen', async t => {
  const ui = surface(t), disk = storage(); let rejectRefresh, calls = 0;
  disk.setItem('zp_chart_cache_v1', JSON.stringify([['hot',{at:0,value:chart('已保存的热歌榜')}]]));
  const controller = createChartsController({ documentRef:ui.document, storage:disk,
    fetchImpl: () => { calls++; return new Promise((_,reject) => { rejectRefresh = reject; }); } });
  t.after(() => controller.destroy());
  const loading = controller.load();
  assert.equal(ui.title.textContent,'已保存的热歌榜');
  assert.equal(ui.list.children.length,1, 'saved track is painted synchronously, without a skeleton');
  assert.equal(ui.list.attributes['aria-busy'],'false');
  await tick(); assert.equal(calls,1);
  rejectRefresh(new Error('offline')); await loading;
  assert.equal(ui.title.textContent,'已保存的热歌榜');
  assert.match(ui.updated.textContent,/刷新失败/);
  controller.destroy();
  const offline = createChartsController({documentRef:ui.document,storage:disk,onlineEnabled:()=>false,
    fetchImpl:()=>{throw Error('Offline reopening must not fetch');}});
  t.after(() => offline.destroy());
  await offline.load();
  assert.equal(ui.title.textContent,'已保存的热歌榜'); assert.equal(ui.list.children.length,1);
});

test('rapid chart selection rejects late repaint and reuses the cached selected chart without another request', async t => {
  const ui = surface(t), requests = new Map(), disk = storage(); let online = true;
  const controller = createChartsController({documentRef:ui.document,storage:disk,onlineEnabled:()=>online,
    fetchImpl:url=>new Promise(resolve=>requests.set(url,resolve))});
  t.after(() => controller.destroy());
  const first = controller.load(); await tick();
  const newTab = ui.rail.children.find(node=>node.dataset.chartKey==='new');
  ui.rail.events.click({target:newTab}); await tick(); online = false;
  requests.get('/api/v1/discovery/playlist?id=3779629')(response('最新选择的新歌榜'));
  await tick(); assert.equal(ui.title.textContent,'最新选择的新歌榜');
  requests.get('/api/v1/discovery/playlist?id=3778678')(response('迟到的热歌榜'));
  await first;
  assert.equal(ui.title.textContent,'最新选择的新歌榜');
  assert.equal(controller.current(),'new');
  requests.clear(); online = true;
  const reopening = controller.load();
  assert.equal(ui.title.textContent,'最新选择的新歌榜'); assert.equal(ui.list.children.length,1);
  online = false; await reopening; await tick();
  assert.ok(!requests.has('/api/v1/discovery/playlist?id=3779629'), 'fresh selected data is reused');
});
