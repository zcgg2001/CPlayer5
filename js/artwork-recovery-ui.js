import { artworkChoiceKey, originalArtworkTrack } from './artwork-recovery.js';
import { artworkUrl } from './artwork.js?v=1';

export function initArtworkRecovery({ root, recovery, onApplied }) {
  if (!root || !recovery) return null;
  const auto = root.querySelector('[data-cover-auto]'), search = root.querySelector('[data-cover-search]');
  const restore = root.querySelector('[data-cover-restore]'), status = root.querySelector('[data-cover-status]');
  const title = root.querySelector('[data-cover-track]'), results = root.querySelector('[data-cover-results]');
  let song = null, identity = '', controller = null, busy = false;
  auto.checked = recovery.enabled();
  const message = text => { status.textContent = text; };
  function controls() {
    search.disabled = !identity || busy;
    restore.disabled = !identity;
    results.setAttribute('aria-busy', String(busy));
    results.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  }
  function sync() {
    if (busy) return;
    const choice = recovery.get(song);
    message(choice?.cover ? `${choice.manual ? '已选择' : '已自动匹配'} iTunes · ${choice.album || '专辑封面'}`
      : choice?.original ? '此歌曲使用原封面，已停止自动补图' : '仅自动采用同歌曲、同专辑的封面；也可以手动更换。');
  }
  function cancel() { controller?.abort(); controller = null; busy = false; }
  async function choose(candidate) {
    cancel(); controller = new AbortController();
    const current = controller, selectedSong = song;
    busy = true; controls(); message('正在加载所选封面…');
    try {
      const result = await recovery.choose(selectedSong, candidate, { signal: current.signal });
      if (!result || current.signal.aborted) return;
      await onApplied(selectedSong);
      if (!current.signal.aborted) message(result.saved ? '已记住此歌曲的封面选择' : '已应用本次选择，本机存储暂不可用');
    } catch { if (!current.signal.aborted) message('这张封面暂时无法加载，请选择其他封面或稍后重试'); }
    finally { if (controller === current) { busy = false; controls(); } }
  }
  function render(candidates) {
    results.replaceChildren();
    for (const candidate of candidates) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cover-choice';
      button.setAttribute('aria-label', `使用《${candidate.album || '未知专辑'}》封面`);
      const image = document.createElement('img'); image.width = image.height = 72; image.alt = '';
      image.referrerPolicy = 'no-referrer'; image.src = artworkUrl(candidate.cover, 160);
      image.onerror = () => { image.hidden = true; };
      const copy = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = candidate.album || '未知专辑';
      detail.textContent = `${candidate.artist} · iTunes · ${candidate.sameAlbum ? '同专辑' : '请核对专辑'}`;
      copy.append(name, detail); button.append(image, copy);
      button.addEventListener('click', () => void choose(candidate)); results.append(button);
    }
  }
  search.addEventListener('click', async () => {
    if (!identity) return;
    cancel(); controller = new AbortController(); const current = controller;
    busy = true; controls(); results.replaceChildren(); message('正在查找这首歌的封面…');
    try {
      const candidates = await recovery.search(song, { signal: current.signal });
      if (current.signal.aborted) return;
      render(candidates);
      message(candidates.length ? '选择与当前歌曲发行版本相符的专辑封面' : '没有找到同歌名、同歌手、同版本的封面，可稍后重试');
    } catch { if (!current.signal.aborted) message('封面查询暂时不可用，请稍后重试'); }
    finally { if (controller === current) { busy = false; controls(); } }
  });
  restore.addEventListener('click', () => {
    if (!identity) return;
    cancel(); const saved = recovery.restore(song); results.replaceChildren(); controls();
    void onApplied(song);
    message(saved ? '已恢复原封面，此歌曲不再自动补图' : '本次已恢复原封面，本机存储暂不可用');
  });
  auto.addEventListener('change', () => { recovery.setEnabled(auto.checked); });
  controls();
  return {
    sync,
    update(value) {
      const next = artworkChoiceKey(value);
      song = value;
      const track = originalArtworkTrack(song);
      title.textContent = next ? `${track.name || '未命名歌曲'} · ${track.artist || '未知歌手'}` : '播放歌曲后可更换封面';
      if (next !== identity) { identity = next; cancel(); results.replaceChildren(); sync(); }
      controls();
    },
  };
}
