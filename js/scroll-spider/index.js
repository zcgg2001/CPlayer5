import { createSpiderAppearance } from './appearance.js';
import { createSpiderEditor } from './editor.js';
export { DEFAULT_SPIDER_IMAGE } from './appearance.js';
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
  constructor({
    resolveTarget = () => document.scrollingElement,
    mount = document.body,
    id = 'pageScrollSpider',
    appearance = createSpiderAppearance(),
    onInteract = () => {},
  } = {}) {
    this.resolveTarget = resolveTarget;
    this.mount = mount;
    this.id = id;
    this.appearance = appearance;
    this.onInteract = onInteract;
    this.destroyed = false;
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
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
    this.unsubscribeAppearance = this.appearance.subscribe(state => { this.image.src = state.src; });
    this.editor = createSpiderEditor({ appearance: this.appearance });
    this.onConfigure = () => this.openAppearance();
    this.configureButton.addEventListener('click', this.onConfigure);
    this.attachTarget();
    this.bindEvents();
    this.scheduleLayout();
  }

  createElements() {
    this.root = document.createElement('aside');
    this.root.id = this.id;
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
    this.handle.setAttribute('aria-label', '拖动蜘蛛控制页面上下滚动');
    this.handle.setAttribute('aria-orientation', 'vertical');
    this.handle.setAttribute('aria-valuemin', '0');
    this.handle.setAttribute('aria-valuemax', '100');
    this.handle.setAttribute('aria-valuenow', '0');
    this.handle.tabIndex = 0;
    this.handle.title = '拖动蜘蛛控制页面上下；也可使用方向键、Page Up/Down、Home/End';

    const image = document.createElement('img');
    image.className = 'page-scroll-spider__sprite';
    image.src = this.appearance.state.src;
    this.image = image;
    image.alt = '';
    image.width = 96;
    image.height = 96;
    image.draggable = false;
    image.decoding = 'async';

    this.handle.append(image);
    this.configureButton = document.createElement('button');
    this.configureButton.type = 'button';
    this.configureButton.className = 'page-scroll-spider__configure';
    this.configureButton.setAttribute('aria-label', '更换滚动挂件图片');
    this.configureButton.setAttribute('aria-haspopup', 'dialog');
    this.configureButton.title = '更换挂件形象';
    this.configureButton.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>';
    this.root.append(this.canvas, this.handle, this.configureButton);
    this.mount.append(this.root);
    this.context = this.canvas.getContext('2d');
  }

  findTarget() {
    const target = this.resolveTarget();
    return isRendered(target) ? target : null;
  }

  openAppearance() { this.editor.open(); }
  setImage(file) { return this.appearance.upload(file); }
  resetImage() { return this.appearance.reset(); }

  attachTarget() {
    const nextTarget = this.findTarget();
    if (nextTarget === this.target) return;

    this.target?.removeEventListener('scroll', this.onScroll);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();

    this.target = nextTarget;
    if (!this.target) return;
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
    if (!this.target || this.destroyed) return;
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
    if (event.button !== 0 || !this.target) return;
    this.onInteract(this.target);
    event.preventDefault();
    this.handle.focus({ preventScroll: true });
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
    if (!this.target) return;
    const rect = this.root.getBoundingClientRect();
    const handleHeight = this.handle.getBoundingClientRect().height;
    const travel = Math.max(1, rect.height - handleHeight);
    const progress = clamp((clientY - rect.top - handleHeight / 2) / travel, 0, 1);
    const maximum = Math.max(0, this.target.scrollHeight - this.target.clientHeight);
    setElementScrollTop(this.target, progress * maximum);
  }

  onKeyDown(event) {
    if (!this.target) return;
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
    this.onInteract(this.target);
    setElementScrollTop(
      this.target,
      clamp(next, 0, maximum),
      this.motionPreference.matches ? 'auto' : 'smooth',
    );
  }

  scheduleLayout() {
    if (this.destroyed || this.layoutFrame !== null) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.updateLayout();
    });
  }

  updateLayout() {
    this.attachTarget();
    if (!this.target) {
      this.root.dataset.visible = 'false';
      this.handle.tabIndex = this.configureButton.tabIndex = -1;
      return;
    }
    const rect = getTargetRect(this.target);
    const maximum = Math.max(0, this.target.scrollHeight - this.target.clientHeight);
    const visible = maximum >= MIN_SCROLL_RANGE && rect.height >= 120;

    this.root.style.top = `${Math.max(0, rect.top)}px`;
    this.root.style.right = `${Math.max(0, window.innerWidth - rect.right)}px`;
    this.root.style.height = `${Math.max(0, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)))}px`;
    this.root.dataset.visible = String(visible);
    this.handle.tabIndex = this.configureButton.tabIndex = visible ? 0 : -1;

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
    if (this.destroyed || this.frame !== null || document.hidden) return;
    this.frame = requestAnimationFrame(this.renderFrame);
  }

  renderFrame() {
    this.frame = null;
    if (this.destroyed || !this.target) return;

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
    this.destroyed = true;
    this.unsubscribeAppearance();
    this.editor.destroy();
    this.appearance.destroy();
    this.configureButton.removeEventListener('click', this.onConfigure);
    this.handle.removeEventListener('pointerdown', this.onPointerDown);
    this.handle.removeEventListener('pointermove', this.onPointerMove);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => this.handle.removeEventListener(event, this.onPointerUp));
    this.handle.removeEventListener('keydown', this.onKeyDown);
    this.motionPreference.removeEventListener?.('change', this.onMediaChange);
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
