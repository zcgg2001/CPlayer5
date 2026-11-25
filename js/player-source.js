import { MUSIC_SOURCE_OPTIONS, QUALITY_DETAILS } from './music-service.js';
import { PLAYBACK_SOURCE_ORDER } from './playback-router.js';
import { SOURCE_PLATFORMS, sourcePlatform } from './music-source-tabs.js';
import { isLxSource, lxSourceLabel } from './lx-music-sources.js';

export const playerSourceLabel = provider => provider === 'gd' ? 'GD · 网易云'
    : lxSourceLabel(provider) || MUSIC_SOURCE_OPTIONS[provider]?.label || '当前音源';

// Both cover and lyrics share this header; native dialogs supply focus trapping
// and the same Android Back / Escape contract as the app's other sheets.
export function createPlayerSource({ document, playback, musicService, toast = () => {} }) {
    const trigger = document.getElementById('playerSourceButton');
    if (!trigger) return null;
    const dialog = document.createElement('dialog');
    dialog.id = 'playerSourceDialog';
    dialog.className = 'player-source-dialog';
    dialog.setAttribute('aria-labelledby', 'playerSourceTitle');
    dialog.innerHTML = `
      <div class="player-source-heading"><div><h2 id="playerSourceTitle">仅切当前歌曲</h2><p data-source-subtitle></p></div>
        <button type="button" class="player-source-close" aria-label="关闭音源选择"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <div class="player-source-platforms" role="tablist" aria-label="音乐平台" hidden></div>
      <div id="playerSourceChannels" class="player-source-list" role="group" aria-label="选择音源渠道"></div>
      <p class="player-source-status" role="status" aria-live="polite"></p>
      <div class="player-source-preference" hidden>
        <label><input type="checkbox"><span>后续播放也优先使用<small>切换成功后生效；不可用时自动尝试其他音源</small></span></label>
        <p data-source-preferred></p><button type="button" data-source-reset>恢复自动选择</button>
      </div>
      <button type="button" class="player-source-more">全部平台与渠道 <span aria-hidden="true">→</span></button>`;
    document.body.append(dialog);
    const title = dialog.querySelector('h2'), subtitle = dialog.querySelector('[data-source-subtitle]');
    const tabs = dialog.querySelector('.player-source-platforms'), list = dialog.querySelector('.player-source-list');
    const status = dialog.querySelector('.player-source-status'), preference = dialog.querySelector('.player-source-preference');
    const checkbox = preference.querySelector('input'), more = dialog.querySelector('.player-source-more');
    const reset = dialog.querySelector('[data-source-reset]');
    let expanded = false, selectedPlatform = 'netease', policy = null, message = '', failed = false;
    const actualSource = () => playback.state.currentSong?.playbackSource || playback.state.currentSong?.provider;
    const sourceLabel = provider => isLxSource(provider) ? musicService.playbackSourceLabel(provider) : playerSourceLabel(provider);
    const customChoices = () => musicService.lxSources.list({ song: playback.state.currentSong,
        defaultProvider: musicService.config.source, level: musicService.config.quality });
    const isSelected = provider => provider === actualSource() && (!isLxSource(provider)
        || !playback.state.currentSong?.playbackSourceUrl
        || customChoices().find(option => option.id === provider)?.url === playback.state.currentSong.playbackSourceUrl);
    const platformFor = provider => sourcePlatform(provider, MUSIC_SOURCE_OPTIONS);
    const reason = () => {
        const song = playback.state.currentSong;
        if (!song) return '播放一首歌曲后即可切换音源';
        if (song.offline || song.provider === 'local') return '本地或离线音频不需要切换在线音源';
        if (song.provider === 'bilibili') return '视频音轨暂不支持跨平台换源';
        if (musicService.offlineOnly?.()) return '离线模式下暂不能切换在线音源';
        if (playback.state.quality.songLoading && !playback.state.sourceSwitch) return '当前歌曲正在加载，请稍后再试';
        return '';
    };
    const unavailable = provider => {
        if (isLxSource(provider)) return customChoices().find(option => option.id === provider)?.disabledReason || '';
        if (policy?.sources?.[provider]?.enabled === false) return '暂不可用';
        const until = Math.max(policy?.sources?.[provider]?.coolingUntil || 0, musicService.playbackRouter.health()[provider]?.until || 0);
        return until > Date.now() ? '冷却中，请稍后重试' : '';
    };
    const position = () => {
        if (expanded) { dialog.style.removeProperty('top'); dialog.style.removeProperty('left'); return; }
        const rect = trigger.getBoundingClientRect(), width = Math.min(336, document.documentElement.clientWidth - 32);
        dialog.style.left = `${Math.max(16, Math.min(document.documentElement.clientWidth - width - 16, rect.left + rect.width / 2 - width / 2))}px`;
        dialog.style.top = `${rect.bottom + 8}px`;
    };
    const close = () => dialog.close();
    function render() {
        const song = playback.state.currentSong, current = actualSource(), pending = playback.state.sourceSwitch;
        const label = song?.offline ? (song.provider === 'local' ? '本地音频' : '离线缓存')
            : song ? (isLxSource(current) && song.source || sourceLabel(current)) : '选择音源';
        trigger.querySelector('[data-source-label]').textContent = label;
        trigger.setAttribute('aria-label', `${label}，${pending ? '正在切换' : '切换音源'}`);
        trigger.classList.toggle('is-switching', Boolean(pending));
        trigger.title = reason() || '切换当前歌曲的音源';
        if (!dialog.open) return;
        dialog.classList.toggle('is-expanded', expanded);
        title.textContent = expanded ? '切换音源' : '仅切当前歌曲';
        subtitle.textContent = expanded ? '同一首歌，从这里继续听' : '已导入音源与当前平台渠道';
        tabs.hidden = !expanded;
        list.setAttribute('role', expanded ? 'tabpanel' : 'group');
        if (expanded) list.setAttribute('aria-labelledby', `playerSourcePlatform-${selectedPlatform}`);
        else list.removeAttribute('aria-labelledby');
        preference.hidden = !expanded || Boolean(reason());
        more.hidden = expanded || Boolean(reason());
        tabs.querySelectorAll('button').forEach(button => {
            const selected = button.dataset.platform === selectedPlatform;
            button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        });
        // Preserve focus when a policy response or pending state refreshes rows.
        const focusProvider = document.activeElement?.dataset.playerSource;
        list.replaceChildren();
        const custom = customChoices(), platform = expanded ? selectedPlatform : platformFor(song?.provider);
        let providers = platform === 'custom' ? custom.map(option => option.id)
            : PLAYBACK_SOURCE_ORDER.filter(provider => platformFor(provider) === platform);
        if (!expanded) providers = [...custom.map(option => option.id), ...[...new Set([current, 'gd', 'netease', 'xinghai-netease', ...providers])]
            .filter(provider => MUSIC_SOURCE_OPTIONS[provider] && platformFor(provider) === platform).slice(0, 3)];
        let previousGroup;
        for (const provider of reason() ? [] : providers) {
            const option = custom.find(item => item.id === provider), group = option ? '自定义音源' : '平台渠道';
            if (!expanded && group !== previousGroup) {
                const heading = document.createElement('p'); heading.className = 'player-source-group'; heading.textContent = group;
                list.append(heading); previousGroup = group;
            }
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'player-source-row'; button.dataset.playerSource = provider;
            const selected = isSelected(provider), blocked = unavailable(provider);
            button.setAttribute('aria-pressed', String(selected));
            button.disabled = Boolean(blocked || pending?.stage === 'installing');
            const name = document.createElement('strong'), detail = document.createElement('small'), text = document.createElement('span');
            name.textContent = option ? option.label : sourceLabel(provider).split(' · ')[0];
            const note = blocked || (selected ? `当前播放 · ${QUALITY_DETAILS[song?.level]?.name || '音质待确认'}`
                : provider === 'chksz' ? '限额备用 · 仅当前歌曲'
                : option || platformFor(song?.provider) === platform ? '尝试同曲音频' : '严格匹配同一版本');
            detail.textContent = option ? `${option.role} · ${note}` : note;
            text.append(name, detail);
            const mark = document.createElement('span'); mark.className = 'player-source-mark';
            mark.textContent = pending?.provider === provider ? '准备中…' : selected ? '✓' : '切换';
            mark.setAttribute('aria-hidden', 'true');
            button.append(text, mark);
            button.addEventListener('click', () => void choose(provider));
            list.append(button);
        }
        if (focusProvider) [...list.children].find(button => button.dataset.playerSource === focusProvider && !button.disabled)?.focus({preventScroll:true});
        status.textContent = reason() || message || (expanded && selectedPlatform === 'custom' && !custom.length
            ? '尚未导入自定义音源，请前往「设置 → 音乐源」导入。'
            : expanded ? '默认仅切当前歌曲；匹配不到同一版本时保留原音源。' : '切换后接续进度');
        status.classList.toggle('is-error', failed);
        const preferred = musicService.config.playbackSource;
        dialog.querySelector('[data-source-preferred]').textContent = preferred ? `后续优先：${sourceLabel(preferred)}` : '后续播放：自动选择';
        reset.hidden = !preferred;
        checkbox.disabled = pending?.stage === 'installing';
        position();
    }
    async function choose(provider) {
        if (playback.state.sourceSwitch?.stage === 'installing') return;
        if (reason()) { message = reason(); render(); return; }
        if (unavailable(provider)) { message = unavailable(provider); render(); return; }
        const remember = expanded && checkbox.checked && provider !== 'chksz';
        if (provider === 'chksz' && checkbox.checked) { checkbox.checked = false; toast('ChKSz 仅用于当前歌曲，不设为后续默认'); }
        if (isSelected(provider) && !playback.state.sourceSwitch) {
            if (remember && musicService.setPlaybackPreference(provider)) toast(`后续优先使用 ${sourceLabel(provider)}`);
            close(); return;
        }
        await playback.changeSource(provider, {
            onStart() { failed = false; message = '正在准备新音源，保留当前播放状态…'; render(); },
            onAttempt(info) {
                message = info.stage === 'matching' ? '正在查找同一版本，保留当前播放状态…'
                    : info.stage === 'installing' ? '正在接续播放进度…' : '正在准备新音源，保留当前播放状态…'; render();
            },
            onSuccess(song) {
                if (remember) musicService.setPlaybackPreference(provider);
                message = ''; failed = false; close(); toast(`已切换至 ${isLxSource(provider) && song.source || sourceLabel(provider)}`);
            },
            onError(error, { restored }) {
                failed = true;
                message = restored ? `${error.message}。已保留原音源，可选择其他渠道。` : '换源失败，原音频也暂时无法恢复，请重新播放。';
                toast(message, true);
            },
            onSettled() { render(); },
        });
    }
    for (const [platform, label] of [['custom', '自定义'], ...SOURCE_PLATFORMS.filter(([id]) => id !== 'bilibili')]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.dataset.platform = platform; button.setAttribute('role', 'tab');
        button.id = `playerSourcePlatform-${platform}`; button.setAttribute('aria-controls', 'playerSourceChannels');
        button.addEventListener('click', () => { selectedPlatform = platform; message = ''; failed = false; render(); });
        tabs.append(button);
    }
    tabs.addEventListener('keydown', event => {
        const buttons = [...tabs.children], index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1;
        if (next < 0) return;
        event.preventDefault(); buttons[next].click(); buttons[next].focus();
    });
    trigger.addEventListener('click', () => {
        if (dialog.open) return close();
        expanded = false; selectedPlatform = isLxSource(actualSource()) ? 'custom' : platformFor(playback.state.currentSong?.provider);
        message = playback.state.sourceSwitch ? '正在准备新音源…' : ''; failed = false; checkbox.checked = false;
        dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); render();
        void musicService.getRuntimePolicy().then(value => { policy = value; render(); }).catch(() => {});
    });
    more.addEventListener('click', () => { expanded = true; render(); tabs.querySelector('[aria-selected=true]')?.focus(); });
    reset.addEventListener('click', () => { musicService.setPlaybackPreference(); checkbox.checked = false; message = '后续播放已恢复自动选择'; render(); });
    dialog.querySelector('.player-source-close').addEventListener('click', close);
    let outside = false;
    const isOutside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
    dialog.addEventListener('pointerdown', event => { outside = event.target === dialog && isOutside(event); });
    dialog.addEventListener('click', event => { if (outside && event.target === dialog && isOutside(event)) close(); outside = false; });
    dialog.addEventListener('close', () => { trigger.setAttribute('aria-expanded', 'false'); if (trigger.getBoundingClientRect().width) trigger.focus({preventScroll:true}); });
    document.defaultView.addEventListener('resize', () => { if (dialog.open) position(); });
    musicService.subscribePlaybackPreferences(render);
    render();
    return { sync: render, close };
}
