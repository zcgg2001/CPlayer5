// CPlayer integration. The reusable module has no knowledge of player views.
import { PageScrollSpider } from './scroll-spider/index.js?v=1';
import { DESKTOP_SHELL_MEDIA } from './app-shell.js?v=23';
export { PageScrollSpider, clamp, getHandlePosition, getScrollProgress, getWebCurve } from './scroll-spider/index.js?v=1';

export function initPageScrollSpider() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (document.getElementById('pageScrollSpider')) return window.pageScrollSpider || null;
  const resolveTarget = () => {
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
