// Keep the native select as a fallback and as the single source-change event.
export function createMusicSourceTabs(select, options) {
  const document = select.ownerDocument;
  const group = document.createElement('div');
  group.className = 'music-source-tabs';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', '音乐源');
  const description = select.getAttribute('aria-describedby');
  if (description) group.setAttribute('aria-describedby', description);
  const navigation = document.createElement('div');
  navigation.className = 'music-source-navigation';
  const scrollButton = direction => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'music-source-scroll';
    button.setAttribute('aria-label', direction < 0 ? '向左查看更多音源' : '向右查看更多音源');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', direction < 0 ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6');
    svg.append(path); button.append(svg);
    button.addEventListener('click', () => {
      group.scrollBy({ left: direction * group.clientWidth * .75,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return button;
  };
  const previous = scrollButton(-1), next = scrollButton(1);
  navigation.append(previous, group, next);
  const updateScroll = () => {
    const overflow = group.scrollWidth > group.clientWidth + 1;
    previous.hidden = next.hidden = !overflow;
    previous.disabled = group.scrollLeft <= 1;
    next.disabled = group.scrollLeft + group.clientWidth >= group.scrollWidth - 1;
  };
  group.addEventListener('scroll', updateScroll, { passive: true });
  const observer = new ResizeObserver(() => {
    const selected = group.querySelector('[aria-checked="true"]');
    if (selected) reveal(selected);
    updateScroll();
  });
  observer.observe(group);

  const selected = select.value;
  select.replaceChildren(...Object.entries(options).map(([value, option]) => {
    const item = document.createElement('option');
    item.value = value; item.textContent = option.label;
    return item;
  }));
  select.value = selected;

  const buttons = Object.entries(options).map(([source, option]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'music-source-tab';
    button.dataset.musicSource = source;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', option.label);
    button.title = `${option.label} · ${option.detail}`;
    const [name, platform] = option.label.split(' · ');
    const title = document.createElement('span');
    title.textContent = name;
    button.append(title);
    if (platform) {
      const subtitle = document.createElement('span');
      subtitle.className = 'music-source-platform';
      subtitle.textContent = platform;
      button.append(subtitle);
    }
    group.append(button);
    return button;
  });

  const reveal = button => {
    if (!group.clientWidth) return;
    const parent = group.getBoundingClientRect();
    const child = button.getBoundingClientRect();
    const offset = child.left < parent.left ? child.left - parent.left
      : child.right > parent.right ? child.right - parent.right : 0;
    if (offset) group.scrollLeft += offset;
  };

  const sync = () => {
    buttons.forEach(button => {
      const selected = button.dataset.musicSource === select.value;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) reveal(button);
    });
    updateScroll();
  };

  const choose = button => {
    if (button.dataset.musicSource === select.value) return;
    select.value = button.dataset.musicSource;
    sync();
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => choose(button));
    button.addEventListener('focus', () => reveal(button));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next].focus({ preventScroll: true });
      choose(buttons[next]);
    });
  });
  select.before(navigation);
  select.hidden = true;
  select.parentElement.classList.add('music-source-enhanced');
  select.addEventListener('change', sync);
  sync();
  return { sync };
}
