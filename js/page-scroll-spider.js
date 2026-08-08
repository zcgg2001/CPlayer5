const DESKTOP_MEDIA = '(min-width: 1024px)';
const MIN_SCROLL_RANGE = 6;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getScrollProgress({ scrollTop, scrollHeight, clientHeight }) {
  const maximum = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  if (maximum <= 0) return 0;
  return clamp(Number(scrollTop) / maximum, 0, 1);
}

export function getHandlePosition({ progress, trackHeight, handleHeight }) {
  const travel = Math.max(0, Number(trackHeight) - Number(handleHeight));
  return clamp(Number(progress), 0, 1) * travel;
}

export function getWebCurve({ width, height, handleY, sway = 0 }) {
  const anchorX = Number(width) / 2;
  const endY = clamp(Number(handleY) + 13, 0, Number(height));
  const endX = anchorX + clamp(Number(sway) * 0.42, -7, 7);
  const bend = clamp(Number(sway) * 0.66, -11, 11);

  return {
    start: { x: anchorX, y: 0 },
    control1: { x: anchorX - bend * 0.22, y: endY * 0.34 },
    control2: { x: endX + bend, y: endY * 0.76 },
    end: { x: endX, y: endY },
  };
}

function getElementScrollTop(element) {
  if (element === document.scrollingElement) return window.scrollY || element.scrollTop || 0;
  return element.scrollTop || 0;
}

function setElementScrollTop(element, top, behavior = 'auto') {
  if (element === document.scrollingElement) {
    window.scrollTo({ top, behavior });
    return;
  }
  if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior });
  else element.scrollTop = top;
}

function getTargetRect(element) {
  if (element === document.scrollingElement) {
    return { top: 0, right: window.innerWidth, width: window.innerWidth, height: window.innerHeight };
  }
  return element.getBoundingClientRect();
}

function isRendered(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

export class PageScrollSpider {
  constructor() {
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.desktopPreference = window.matchMedia(DESKTOP_MEDIA);
    this.target = null;
    this.frame = null;
    this.layoutFrame = null;
    this.idleTimer = null;
    this.dragging = false;
    this.sway = 0;
    this.swayTarget = 0;
    this.lastScrollTop = 0;
    this.handleY = 0;
    this.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.onScroll = this.onScroll.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onMediaChange = this.onMediaChange.bind(this);
    this.renderFrame = this.renderFrame.bind(this);

    this.createElements();
    this.attachTarget();
    this.bindEvents();
    this.scheduleLayout();
  }

  createElements() {
    this.root = document.createElement('aside');
    this.root.id = 'pageScrollSpider';
    this.root.className = 'page-scroll-spider';
    this.root.setAttribute('aria-label', '页面滚动挂件');
    this.root.dataset.visible = 'false';
    this.root.dataset.moving = 'false';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'page-scroll-spider__web';
    this.canvas.setAttribute('aria-hidden', 'true');

    this.handle = document.createElement('div');
    this.handle.className = 'page-scroll-spider__handle';
    this.handle.setAttribute('role', 'scrollbar');
    this.handle.setAttribute('aria-label', '页面滚动进度');
    this.handle.setAttribute('aria-orientation', 'vertical');
    this.handle.setAttribute('aria-valuemin', '0');
    this.handle.setAttribute('aria-valuemax', '100');
    this.handle.setAttribute('aria-valuenow', '0');
    this.handle.tabIndex = 0;

    const image = document.createElement('img');
    image.className = 'page-scroll-spider__sprite';
    image.src = './img/key-spider-scroll.png';
    image.alt = '';
    image.width = 96;
    image.height = 96;
    image.draggable = false;
    image.decoding = 'async';

    this.handle.append(image);
    this.root.append(this.canvas, this.handle);
    document.body.append(this.root);
    this.context = this.canvas.getContext('2d');
  }

  findTarget() {
    const selector = this.desktopPreference.matches
      ? '#desktopLibraryView'
      : '#mobileLyricsScroller';
    const preferred = document.querySelector(selector);
    if (isRendered(preferred)) return preferred;
    return document.scrollingElement;
  }

  attachTarget() {
    const nextTarget = this.findTarget();
    if (!nextTarget || nextTarget === this.target) return;

    this.target?.removeEventListener('scroll', this.onScroll);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();

    this.target = nextTarget;
    this.lastScrollTop = getElementScrollTop(this.target);
    this.handle.setAttribute('aria-controls', this.target.id || 'document');
    this.target.addEventListener('scroll', this.onScroll, { passive: true });

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleLayout());
      this.resizeObserver.observe(this.target);
    }
    if (typeof MutationObserver === 'function') {
      this.mutationObserver = new MutationObserver(() => this.scheduleLayout());
      this.mutationObserver.observe(this.target, { childList: true, subtree: true });
    }
  }

  bindEvents() {
    window.addEventListener('resize', this.onResize, { passive: true });
    this.handle.addEventListener('pointerdown', this.onPointerDown);
    this.handle.addEventListener('pointermove', this.onPointerMove);
    this.handle.addEventListener('pointerup', this.onPointerUp);
    this.handle.addEventListener('pointercancel', this.onPointerUp);
    this.handle.addEventListener('lostpointercapture', this.onPointerUp);
    this.handle.addEventListener('keydown', this.onKeyDown);
    this.desktopPreference.addEventListener?.('change', this.onMediaChange);
    this.motionPreference.addEventListener?.('change', this.onMediaChange);
  }

  onMediaChange() {
    this.attachTarget();
    this.scheduleLayout();
  }

  onResize() {
    this.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.attachTarget();
    this.scheduleLayout();
  }

  onScroll() {
    const current = getElementScrollTop(this.target);
    const delta = current - this.lastScrollTop;
    this.lastScrollTop = current;
    if (!this.motionPreference.matches && !this.dragging) {
      this.swayTarget = clamp(delta * 0.28, -10, 10);
    }
    this.root.dataset.moving = 'true';
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.root.dataset.moving = 'false';
      this.swayTarget = 0;
      this.scheduleRender();
    }, 140);
    this.scheduleRender();
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragging = true;
    this.swayTarget = 0;
    this.handle.dataset.dragging = 'true';
    this.handle.setPointerCapture?.(event.pointerId);
    this.scrollFromPointer(event.clientY);
  }

  onPointerMove(event) {
    if (!this.dragging) return;
    event.preventDefault();
    this.scrollFromPointer(event.clientY);
  }

  onPointerUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    this.handle.dataset.dragging = 'false';
    if (this.handle.hasPointerCapture?.(event.pointerId)) {
      this.handle.releasePointerCapture(event.pointerId);
    }
    this.scheduleRender();
  }

  scrollFromPointer(clientY) {
    const rect = this.root.getBoundingClientRect();
    const handleHeight = this.handle.getBoundingClientRect().height;
    const travel = Math.max(1, rect.height - handleHeight);
    const progress = clamp((clientY - rect.top - handleHeight / 2) / travel, 0, 1);
    const maximum = Math.max(0, this.target.scrollHeight - this.target.clientHeight);
    setElementScrollTop(this.target, progress * maximum);
  }

  onKeyDown(event) {
    const maximum = Math.max(0, this.target.scrollHeight - this.target.clientHeight);
    const current = getElementScrollTop(this.target);
    const pageStep = Math.max(120, this.target.clientHeight * 0.78);
    let next = current;

    if (event.key === 'ArrowDown') next += 48;
    else if (event.key === 'ArrowUp') next -= 48;
    else if (event.key === 'PageDown') next += pageStep;
    else if (event.key === 'PageUp') next -= pageStep;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = maximum;
    else return;

    event.preventDefault();
    setElementScrollTop(
      this.target,
      clamp(next, 0, maximum),
      this.motionPreference.matches ? 'auto' : 'smooth',
    );
  }

  scheduleLayout() {
    if (this.layoutFrame !== null) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.updateLayout();
    });
  }

  updateLayout() {
    this.attachTarget();
    const rect = getTargetRect(this.target);
    const maximum = Math.max(0, this.target.scrollHeight - this.target.clientHeight);
    const visible = maximum >= MIN_SCROLL_RANGE && rect.height >= 120;

    this.root.style.top = `${Math.max(0, rect.top)}px`;
    this.root.style.height = `${Math.max(0, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)))}px`;
    this.root.dataset.visible = String(visible);
    this.handle.tabIndex = visible ? 0 : -1;

    const width = Math.max(1, Math.round(this.root.clientWidth));
    const height = Math.max(1, Math.round(this.root.clientHeight));
    const pixelWidth = Math.round(width * this.devicePixelRatio);
    const pixelHeight = Math.round(height * this.devicePixelRatio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.frame !== null || document.hidden) return;
    this.frame = requestAnimationFrame(this.renderFrame);
  }

  renderFrame() {
    this.frame = null;
    if (!this.target) return;

    const progress = getScrollProgress({
      scrollTop: getElementScrollTop(this.target),
      scrollHeight: this.target.scrollHeight,
      clientHeight: this.target.clientHeight,
    });
    const rootHeight = this.root.clientHeight;
    const handleHeight = this.handle.getBoundingClientRect().height;
    this.handleY = getHandlePosition({ progress, trackHeight: rootHeight, handleHeight });

    if (this.motionPreference.matches) {
      this.sway = 0;
      this.swayTarget = 0;
    } else {
      this.sway += (this.swayTarget - this.sway) * 0.22;
      if (!this.dragging) this.swayTarget *= 0.76;
    }

    this.root.style.setProperty('--page-scroll-y', `${this.handleY.toFixed(2)}px`);
    this.root.style.setProperty('--page-scroll-tilt', `${this.sway.toFixed(2)}deg`);
    this.handle.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    this.handle.setAttribute('aria-valuetext', `页面进度 ${Math.round(progress * 100)}%`);
    this.drawWeb();

    if (Math.abs(this.swayTarget) > 0.04 || Math.abs(this.sway - this.swayTarget) > 0.04) {
      this.scheduleRender();
    }
  }

  drawWeb() {
    if (!this.context) return;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const curve = getWebCurve({ width, height, handleY: this.handleY, sway: this.sway });
    const context = this.context;
    const ratio = this.devicePixelRatio;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const traceCurve = () => {
      context.beginPath();
      context.moveTo(curve.start.x, curve.start.y);
      context.bezierCurveTo(
        curve.control1.x,
        curve.control1.y,
        curve.control2.x,
        curve.control2.y,
        curve.end.x,
        curve.end.y,
      );
    };

    traceCurve();
    context.strokeStyle = 'rgba(35, 25, 78, 0.74)';
    context.lineWidth = 4.2;
    context.stroke();

    const gradient = context.createLinearGradient(0, 0, 0, Math.max(1, curve.end.y));
    gradient.addColorStop(0, '#8b6dff');
    gradient.addColorStop(0.48, '#9be9ff');
    gradient.addColorStop(1, '#50baff');
    traceCurve();
    context.strokeStyle = gradient;
    context.lineWidth = 1.7;
    context.stroke();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.layoutFrame);
    window.clearTimeout(this.idleTimer);
    window.removeEventListener('resize', this.onResize);
    this.target?.removeEventListener('scroll', this.onScroll);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.root.remove();
  }
}

export function initPageScrollSpider() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (document.getElementById('pageScrollSpider')) return window.pageScrollSpider || null;
  window.pageScrollSpider = new PageScrollSpider();
  return window.pageScrollSpider;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageScrollSpider, { once: true });
  } else {
    initPageScrollSpider();
  }
}
