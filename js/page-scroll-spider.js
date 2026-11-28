// CPlayer integration. The reusable module has no knowledge of player views.
import { PageScrollSpider } from './scroll-spider/index.js?v=1';
import { DESKTOP_SHELL_MEDIA } from './app-shell.js?v=23';
export { PageScrollSpider, clamp, getHandlePosition, getScrollProgress, getWebCurve } from './scroll-spider/index.js?v=1';

export function initPageScrollSpider() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (document.getElementById('pageScrollSpider')) return window.pageScrollSpider || null;
  const enabledKey = 'cp_scrollSpider_enabled';
  let savedEnabled = null;
  try { savedEnabled = localStorage.getItem(enabledKey); } catch { /* Optional local preference. */ }
  let enabled = savedEnabled === 'true';
  const resolveTarget = () => {
    if (!enabled) return null;
    if (document.documentElement.classList.contains('android-player')) return null;
    if (window.matchMedia(DESKTOP_SHELL_MEDIA).matches) {
      return document.documentElement.classList.contains('desktop-immersive-open')
        ? null : document.getElementById('desktopLibraryView');
    }
    const lyricsPage = document.getElementById('mobileLyricsPage');
    return lyricsPage?.classList.contains('opacity-100')
      ? document.getElementById('mobileLyricsScroller') : null;
  };
  const spider = new PageScrollSpider({
    resolveTarget,
    onInteract: target => target.dispatchEvent(new Event('scroll-mascot-interaction')),
  });
  const settingsButton = document.getElementById('scrollSpiderSettingsBtn');
  const settingsPreview = document.getElementById('scrollSpiderSettingsPreview');
  const settingsToggle = document.getElementById('scrollSpiderEnabled');
  const syncEnabled = () => {
    if (settingsToggle) settingsToggle.checked = enabled;
    spider.scheduleLayout();
  };
  const toggle = () => {
    enabled = settingsToggle.checked;
    savedEnabled = String(enabled);
    try { localStorage.setItem(enabledKey, savedEnabled); } catch { /* Keep session preference. */ }
    syncEnabled();
  };
  settingsToggle?.addEventListener('change', toggle);
  // Keep existing custom mascots visible; fresh installs begin with a quiet UI.
  spider.appearance.ready.then(() => {
    if (savedEnabled === null && spider.appearance.state.custom) enabled = true;
    syncEnabled();
  });
  syncEnabled();
  const unsubscribe = spider.appearance.subscribe(state => { if (settingsPreview) settingsPreview.src = state.src; });
  const open = () => spider.openAppearance();
  settingsButton?.addEventListener('click', open);
  const viewObserver = new MutationObserver(() => spider.scheduleLayout());
  [document.documentElement, document.getElementById('mobileLyricsPage')].filter(Boolean).forEach(element => {
    viewObserver.observe(element, { attributes: true, attributeFilter: ['class'] });
  });
  const destroy = spider.destroy.bind(spider);
  spider.destroy = () => {
    unsubscribe();
    viewObserver.disconnect();
    settingsButton?.removeEventListener('click', open);
    settingsToggle?.removeEventListener('change', toggle);
    destroy();
    if (window.pageScrollSpider === spider) window.pageScrollSpider = null;
  };
  window.pageScrollSpider = spider;
  return spider;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageScrollSpider, { once: true });
  } else initPageScrollSpider();
}
