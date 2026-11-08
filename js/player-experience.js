// UI feedback follows media events; resolving a URL does not mean audio is playing.
export function createPlayerExperience({ document, audio, onSearch, onDiscover, onImport, onNext, onChooseSource, onResume, onChange = () => {} }) {
  let phase = 'idle', song = null, retry = null, errorMessage = '', hasResolved = false, hasStarted = false;
  const node = (tag, className, text) => {
    const element = document.createElement(tag); element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const button = (text, action, className = '') => {
    const element = node('button', `experience-button ${className}`, text);
    element.type = 'button'; element.addEventListener('click', event => { event.stopPropagation(); action(); }); return element;
  };
  const welcome = node('section', 'mobile-welcome'); welcome.id = 'mobileWelcome';
  welcome.setAttribute('aria-labelledby', 'mobileWelcomeTitle');
  const mark = node('span', 'welcome-mark'); mark.setAttribute('aria-hidden', 'true');
  const glyph = node('i', ''); glyph.dataset.lucide = 'Headphones'; mark.append(glyph);
  const title = node('h2', '', '从一首喜欢的歌开始'); title.id = 'mobileWelcomeTitle';
  welcome.append(mark, title, node('p', '', '搜索熟悉的旋律，或发现今天的新声音。'));
  const actions = node('div', 'welcome-actions');
  actions.append(button('搜索歌曲', onSearch, 'is-primary'), button('浏览推荐', onDiscover), button('导入歌单', onImport));
  welcome.append(actions, node('p', 'welcome-note', '选好歌曲后，播放控制和歌词会出现在这里。'));
  document.getElementById('mobileMainView').append(welcome);

  const panels = ['desktopPlayerBar', 'mobile-control-deck', 'mobileBrowsePlayer'].map(id => {
    const host = id === 'mobile-control-deck' ? document.querySelector(`.${id}`) : document.getElementById(id);
    const panel = node('div', 'playback-feedback'); panel.dataset.playerFeedback = ''; panel.hidden = true;
    const status = node('p', 'playback-feedback-message'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const controls = node('div', 'playback-feedback-actions');
    const again = button('重试', () => retry?.());
    const next = button('下一首', onNext), source = button('选择音源', onChooseSource), resume = button('开始播放', onResume);
    controls.append(again, source, next, resume); panel.append(status, controls); host.prepend(panel);
    return { panel, status, controls, again, next, source, resume };
  });

  const statusText = () => ({
    resolving: '正在解析播放地址…', buffering: '正在缓冲音频…', blocked: '歌曲已就绪，点击开始播放',
    error: errorMessage || '播放失败，请重试或选择其他音源',
  })[phase] || '';
  function render() {
    const empty = phase === 'idle';
    document.getElementById('mobileLayout').dataset.playerEmpty = String(empty);
    welcome.hidden = !empty;
    document.getElementById('mobileMetaContainer').hidden = !hasResolved;
    for (const view of panels) {
      view.panel.hidden = !statusText(); view.panel.dataset.phase = phase;
      view.status.textContent = `${song?.name ? `${song.name} · ` : ''}${statusText()}`;
      view.controls.hidden = !['error', 'blocked'].includes(phase);
      view.again.hidden = phase !== 'error' || !retry;
      view.next.hidden = view.source.hidden = phase !== 'error';
      view.resume.hidden = phase !== 'blocked';
    }
    const pending = phase === 'resolving' || (phase === 'buffering' && !hasStarted);
    for (const id of ['mobilePlayBtn', 'mobileBrowsePlay']) {
      const control = document.getElementById(id);
      control.disabled = pending || phase === 'error';
      control.setAttribute('aria-busy', String(pending));
    }
    onChange();
  }
  const set = next => { phase = next; render(); };
  audio.addEventListener('waiting', () => {
    if (song && !audio.paused && !['resolving', 'error', 'blocked'].includes(phase)) set('buffering');
  });
  audio.addEventListener('playing', () => {
    if (song && phase !== 'resolving' && phase !== 'error' && !audio.paused) { hasStarted = true; set('playing'); }
  });
  audio.addEventListener('pause', () => {
    if (song && !['resolving', 'error', 'blocked'].includes(phase)) set('paused');
  });
  audio.addEventListener('error', () => {
    if (song && phase !== 'resolving') { errorMessage = '音频连接中断，请重试或选择其他音源'; set('error'); }
  });
  render();
  return {
    statusText, get phase() { return phase; }, get song() { return song; },
    loading(selected, retryAction) {
      song = selected; retry = retryAction; errorMessage = ''; hasResolved = false; hasStarted = false; set('resolving');
      document.getElementById('mobileTitle').textContent = selected?.name || '正在加载歌曲';
      document.getElementById('mobileArtist').textContent = selected?.artist || '请稍候';
    },
    resolved(selected) {
      song = selected; hasResolved = true;
      document.getElementById('mobileSongIdTag').textContent = `ID: ${selected.sourceId || selected.id}`;
      set('buffering');
    },
    blocked() { set('blocked'); },
    failed(message) { errorMessage = message; set('error'); },
  };
}
