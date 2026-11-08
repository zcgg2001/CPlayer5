// Deterministic scenes: positions derive from media time, including after seeking.
const fract = n => n - Math.floor(n);
const noise = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
export function createCanvasScene(host) {
  const canvas = document.createElement('canvas'); canvas.className = 'lyric-canvas'; canvas.setAttribute('aria-hidden', 'true'); host.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  let width = 0, height = 0, settings = {}, tuning = {}, lastFrame = -Infinity;
  function resize() {
    width = host.clientWidth; height = host.clientHeight;
    const quality = settings.quality === 'auto' ? (width < 600 ? 'medium' : 'high') : settings.quality;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, quality === 'high' ? 2 : 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastFrame = -Infinity;
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  function render(time, bands = { low: 0, mid: 0, high: 0 }) {
    if (!ctx || !width || !height) return;
    const interval = settings.quality === 'low' || width < 600 ? 32 : 15;
    if (time >= lastFrame && time - lastFrame < interval) return;
    lastFrame = time;
    ctx.clearRect(0, 0, width, height);
    const motion = settings.motion || 0, t = motion ? time / 1000 : 0;
    const color = settings.color || '#edbda5', power = settings.audioReactive ? bands.low : 0;
    ctx.fillStyle = color; ctx.strokeStyle = color;
    const circle = (x, y, r, alpha) => { ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, Math.max(.2, r), 0, Math.PI * 2); ctx.fill(); };
    if (settings.background === 'sora') {
      for (let i = 0; i < 100; i++) circle(fract(noise(i) + t * .001 * (i % 3 + 1)) * width, noise(i + 100) * height, .6 + noise(i + 200) * 1.4, (.3 + .25 * Math.sin(i + t)) * settings.backgroundOpacity);
    }
    if (settings.background === 'latent') {
      for (let i = 0; i < 60; i++) {
        const x = noise(i + 80) * width, y = noise(i + 180) * height;
        ctx.globalAlpha = (.03 + (Math.sin(t * .7 + i) + 1) * .035 + power * .15) * settings.backgroundOpacity;
        const size = (12 + noise(i) * 45) * (1 + power); ctx.fillRect(x, y, size, size);
      }
    }
    const mode = settings.mode;
    if (mode === 'diorama' || mode === 'fume') {
      const total = mode === 'diorama' ? (tuning.particles || 240) : 48;
      const count = settings.quality === 'low' ? Math.min(total, 100) : total;
      const yaw = Math.sin(t * (tuning.speed || .5) * .2) * .35;
      for (let i = 0; i < count; i++) {
        // A cylinder of 3D points, projected through a moving perspective camera.
        const angle = noise(i + 10) * Math.PI * 2, radius = 260 + noise(i + 40) * 140;
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        const z = 100 + fract(noise(i + 100) - t * (tuning.speed || .5) * .04) * 1400;
        const rx = x * Math.cos(yaw) + z * Math.sin(yaw), rz = z * Math.cos(yaw) - x * Math.sin(yaw);
        const scale = Math.min(width, height) * .9 / (rz + 300);
        circle(width / 2 + rx * scale, height / 2 + y * scale, (mode === 'fume' ? 10 : 2.2) * scale * (1 + power), Math.min(.55, scale * .3));
      }
    } else if (mode === 'hanabi') {
      for (let burst = 0; burst < (tuning.density || 3); burst++) {
        const phase = fract(t * .35 + burst * .37), radius = Math.min(width, height) * (tuning.burst || .6) * phase * .5;
        const x = width * (.15 + noise(burst + 80) * .7), y = height * (.15 + noise(burst + 50) * .6);
        for (let i = 0; i < 24; i++) { const angle = i / 24 * Math.PI * 2; circle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius + phase * phase * 40, 1.5 + power * 2, (1 - phase) * .65); }
      }
    } else if (mode === 'machi' || mode === 'nebbia') {
      if (mode === 'machi') {
        for (let i = 0; i < 12; i++) {
          const x = i * width / 12, h = height * (.2 + noise(i + 8) * .4); ctx.globalAlpha = .18; ctx.fillRect(x, height - h, width / 13, h);
          for (let j = 0; j < 8; j++) { ctx.globalAlpha = (tuning.neon || .5) * noise(i * 8 + j); ctx.fillRect(x + 8 + j % 2 * 17, height - h + 18 + Math.floor(j / 2) * 25, 7, 12); }
        }
      }
      for (let i = 0; i < 100 * (tuning.rain || 0); i++) {
        const x = noise(i + 50) * width, y = fract(noise(i + 10) + t * (.03 + noise(i) * .05)) * height;
        if (mode === 'nebbia') { ctx.globalAlpha = .13; ctx.beginPath(); ctx.ellipse(x, y, 2 + noise(i) * 3, 5 + noise(i) * 6, 0, 0, Math.PI * 2); ctx.stroke(); }
        else { ctx.globalAlpha = .2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 24); ctx.stroke(); }
      }
    } else if (mode === 'pendolo') {
      const radius = Math.min(width, height) * (tuning.radius || .45), cx = width * .15, cy = height / 2;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (tuning.speed || .6) * .1);
      for (let i = 0; i < 60; i++) { const a = i * Math.PI / 30; ctx.globalAlpha = i % 5 ? .2 : .5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius); ctx.lineTo(Math.cos(a) * (radius - (i % 5 ? 7 : 20)), Math.sin(a) * (radius - (i % 5 ? 7 : 20))); ctx.stroke(); }
      ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(0, -radius * .6); ctx.lineTo(0, 0); ctx.lineTo(radius * .6, 0); ctx.stroke(); ctx.restore();
    } else if (mode === 'lumiere') {
      for (let i = 0; i < 2; i++) { ctx.save(); ctx.translate(width * (i ? .8 : .2), -20); ctx.rotate(Math.sin(t * .3 + i) * (tuning.swing || 0) / 180 * Math.PI); const gradient = ctx.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, color + '00'); gradient.addColorStop(1, color + '66'); ctx.fillStyle = gradient; ctx.globalAlpha = (tuning.beam || .4) * (1 + power); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-width * .3, height); ctx.lineTo(width * .3, height); ctx.closePath(); ctx.fill(); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }
  return { setSettings(value, params) { settings = value; tuning = params; resize(); }, render, destroy() { observer.disconnect(); canvas.remove(); } };
}
