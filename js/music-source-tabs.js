// A shared select/change contract keeps all four source pickers synchronized.
export const SOURCE_PLATFORMS = Object.freeze([
  ['netease', '网易云'], ['qq', 'QQ 音乐'], ['applemusic', 'Apple Music'], ['kuwo', '酷我'], ['kugou', '酷狗'], ['bilibili', 'Bilibili'],
]);
export const sourcePlatform = (source, options) => options[source]?.platform || (source === 'bilibili' ? 'bilibili' : 'netease');

export function createMusicSourceTabs(select, options) {
  const document = select.ownerDocument;
  const root = document.createElement('div');
  root.className = 'music-source-filter';
  const platforms = document.createElement('div');
  platforms.className = 'music-platform-tabs';
  platforms.setAttribute('role', 'radiogroup');
  platforms.setAttribute('aria-label', '音乐平台');
  const navigation = document.createElement('div');
  navigation.className = 'music-source-navigation';
  const group = document.createElement('div');
  group.className = 'music-source-tabs';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', '音源渠道');
  const description = select.getAttribute('aria-describedby');
  if (description) group.setAttribute('aria-describedby', description);
  const remembered = new Map();
  const reveal = button => {
    if (!group.clientWidth || !button) return;
    const parent = group.getBoundingClientRect(), child = button.getBoundingClientRect();
    group.scrollLeft += child.left < parent.left ? child.left - parent.left : child.right > parent.right ? child.right - parent.right : 0;
  };
  const scrollButton = direction => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'music-source-scroll';
    button.title = direction < 0 ? '向左查看更多渠道' : '向右查看更多渠道';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction < 0 ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'}"/></svg>`;
    button.addEventListener('click', () => group.scrollBy({left: direction * group.clientWidth * .75, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}));
    return button;
  };
  const previous = scrollButton(-1), next = scrollButton(1);
  navigation.append(previous, group, next);
  root.append(platforms, navigation);
  const updateScroll = () => {
    const overflow = group.scrollWidth > group.clientWidth + 1;
    previous.hidden = next.hidden = !overflow;
    previous.disabled = group.scrollLeft <= 1;
    next.disabled = group.scrollLeft + group.clientWidth >= group.scrollWidth - 1;
    group.classList.toggle('fade-start', overflow && !previous.disabled);
    group.classList.toggle('fade-end', overflow && !next.disabled);
  };
  const selected = select.value;
  select.replaceChildren(...Object.entries(options).map(([value, option]) => {
    const item = document.createElement('option'); item.value = value; item.textContent = option.label; return item;
  }));
  select.value = selected;
  const choose = source => {
    if (source === select.value) return;
    select.value = source; sync(); select.dispatchEvent(new Event('change', {bubbles:true}));
  };
  const keyboard = (container, handler) => container.addEventListener('keydown', event => {
    const buttons = [...container.querySelectorAll('[role="radio"]')].filter(button => !button.hidden);
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : ['ArrowRight','ArrowDown'].includes(event.key) ? (index + 1) % buttons.length
      : ['ArrowLeft','ArrowUp'].includes(event.key) ? (index + buttons.length - 1) % buttons.length : null;
    if (next === null) return;
    event.preventDefault(); buttons[next].focus({preventScroll:true}); handler(buttons[next]);
  });
  const platformButtons = SOURCE_PLATFORMS.map(([value,label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.platform = value;
    button.setAttribute('role','radio'); button.textContent = label; button.title = `${label}音乐渠道`;
    platforms.append(button); return button;
  });
  const buttons = Object.entries(options).map(([source,option]) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'music-source-tab';
    button.dataset.musicSource = source; button.setAttribute('role','radio');
    button.textContent = option.label.split(' · ')[0]; button.title = `${option.label} · ${option.detail}`;
    button.setAttribute('aria-label', option.label);
    button.addEventListener('click', () => choose(source));
    button.addEventListener('focus', () => reveal(button)); group.append(button); return button;
  });
  const selectPlatform = button => {
    const platform = button.dataset.platform;
    choose(remembered.get(platform) || Object.keys(options).find(source => sourcePlatform(source, options) === platform));
  };
  platformButtons.forEach(button => button.addEventListener('click', () => selectPlatform(button)));
  keyboard(platforms, selectPlatform); keyboard(group, button => choose(button.dataset.musicSource));
  const sync = () => {
    const platform = sourcePlatform(select.value, options); remembered.set(platform, select.value);
    platformButtons.forEach(button => {
      const active = button.dataset.platform === platform;
      button.setAttribute('aria-checked', String(active)); button.tabIndex = active ? 0 : -1;
    });
    buttons.forEach(button => {
      const active = button.dataset.musicSource === select.value;
      button.hidden = sourcePlatform(button.dataset.musicSource, options) !== platform;
      button.setAttribute('aria-checked', String(active)); button.tabIndex = active ? 0 : -1;
    });
    reveal(buttons.find(button => button.dataset.musicSource === select.value)); updateScroll();
  };
  group.addEventListener('scroll', updateScroll, {passive:true});
  new ResizeObserver(() => { reveal(group.querySelector('[aria-checked="true"]')); updateScroll(); }).observe(group);
  select.before(root); select.hidden = true; select.parentElement.classList.add('music-source-enhanced');
  select.addEventListener('change', sync); sync();
  return {sync};
}
