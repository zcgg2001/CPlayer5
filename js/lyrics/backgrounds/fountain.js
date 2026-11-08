// A low, transparent fountain. Every jet's height comes from a real FFT band.
export function createMusicFountain(host) {
  const canvas = document.createElement('canvas'); canvas.className = 'lyric-music-fountain'; canvas.setAttribute('aria-hidden', 'true'); host.append(canvas);
  const ctx = canvas.getContext('2d'); let width = 0, height = 0, settings = {}, lastTime = -Infinity, visible = true;
  function clear() { ctx?.clearRect(0, 0, width, height); lastTime = -Infinity; }
  function syncVisibility() { canvas.hidden = !visible || !settings.fountain || !settings.motion || !settings.audioReactive; }
  function resize() {
    width = canvas.clientWidth; height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, settings.quality === 'high' ? 2 : 1.5);
    canvas.width = width * dpr; canvas.height = height * dpr; ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); lastTime = -Infinity;
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  function update(time, bands) {
    if (!ctx || !width || !height || canvas.hidden) return;
    const spectrum = bands?.spectrum;
    if (!spectrum?.length || !settings.motion || !settings.audioReactive) { clear(); return; }
    if (time >= lastTime && time - lastTime < (width < 600 ? 32 : 16)) return;
    lastTime = time; ctx.clearRect(0, 0, width, height);
    const jets = width < 600 || settings.quality === 'low' ? 24 : 48;
    const t = time / 1000, strength = settings.fountainStrength ?? .45;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let jet = 0; jet < jets; jet++) {
      const position = (jet + .5) / jets, distance = Math.abs(position - .5) * 2;
      const bin = Math.floor((.02 + distance * distance * .6) * (spectrum.length - 1));
      const energy = Math.max(0, (spectrum[bin] / 255 - .06) / .94);
      if (energy < .015) continue;
      const peak = Math.pow(energy, 1.35) * height * .88 * (.45 + strength) * (1 - distance * .35);
      const originX = width * (.06 + position * .88), baseline = height - 6;
      const spread = (position - .5) * peak * .3;
      const color = settings.color || '#edbda5';
      const gradient = ctx.createLinearGradient(originX, baseline, originX + spread, baseline - peak);
      gradient.addColorStop(0, color + '02'); gradient.addColorStop(.45, color + '35'); gradient.addColorStop(1, color + 'a0');
      ctx.strokeStyle = gradient; ctx.lineWidth = width < 600 ? 1 : 1.3; ctx.globalAlpha = .6 * strength;
      ctx.beginPath(); ctx.moveTo(originX, baseline); ctx.quadraticCurveTo(originX + spread * .3, baseline - peak * .6, originX + spread, baseline - peak); ctx.stroke();
      for (let drop = 0; drop < 6; drop++) {
        const phase = ((t * (1.1 + energy * .8) + drop / 6 + jet * .137) % 1 + 1) % 1;
        const arc = 4 * phase * (1 - phase);
        const x = originX + spread * phase, y = baseline - peak * arc;
        ctx.fillStyle = color; ctx.globalAlpha = (1 - phase) * energy * strength * .85;
        ctx.beginPath(); ctx.arc(x, y, .6 + energy * 1.1, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  return {
    setSettings(value) { settings = value; syncVisibility(); resize(); },
    setVisible(value) { if (visible !== value) { visible = value; syncVisibility(); clear(); } },
    update, destroy() { observer.disconnect(); canvas.remove(); },
  };
}
