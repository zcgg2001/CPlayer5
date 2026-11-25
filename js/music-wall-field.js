// An unbounded cover plane. All layout is in cells; only the visible window is
// materialized. This geometry is independent of the reference app's templates.
const mod = (value, length) => ((value % length) + length) % length;
export const WALL_ZOOM = { min: .7, max: 1.45 };
export const clampWallZoom = value => Math.max(WALL_ZOOM.min, Math.min(WALL_ZOOM.max, Number(value) || 1));

export function wallMetrics(width, height, zoom = 1) {
  const base = Math.max(78, Math.min(112, Math.min(width, height) * .23), width / 15, height / 14);
  const pitch = base * clampWallZoom(zoom);
  return { pitch, gap: Math.max(4, pitch * .055) };
}

// Two large squares and eight small ones completely tile each 4 × 4 block.
// Alternating the split diagonal creates a continuous, irregular mosaic.
export function wallBlock(bx, by, count) {
  if (!count) return [];
  const seed = (Math.imul(bx, 73856093) ^ Math.imul(by, 19349663)) >>> 0;
  const diagonal = (seed ^ seed >>> 5) & 1;
  const cells = [];
  for (let q = 0; q < 4; q++) {
    const x = bx * 4 + q % 2 * 2, y = by * 4 + Math.floor(q / 2) * 2;
    if ((q === 0 || q === 3) === Boolean(diagonal)) cells.push({ x, y, span: 2 });
    else for (let j = 0; j < 4; j++) cells.push({ x: x + j % 2, y: y + Math.floor(j / 2), span: 1 });
  }
  return cells.map((cell, slot) => ({ ...cell, key: `${bx}:${by}:${slot}`, index: mod(bx * 10 + by * 31 + slot, count) }));
}

export function wallWindow({ width, height, camera, zoom = 1, count, overscan = 1 }) {
  if (!count || width <= 0 || height <= 0) return [];
  const { pitch, gap } = wallMetrics(width, height, zoom);
  const left = camera.x - width / (2 * pitch), top = camera.y - height / (2 * pitch);
  const right = left + width / pitch, bottom = top + height / pitch;
  const tiles = [];
  for (let by = Math.floor((top - overscan) / 4); by <= Math.floor((bottom + overscan) / 4); by++) {
    for (let bx = Math.floor((left - overscan) / 4); bx <= Math.floor((right + overscan) / 4); bx++) {
      for (const cell of wallBlock(bx, by, count)) {
        if (cell.x + cell.span <= left - overscan || cell.x >= right + overscan || cell.y + cell.span <= top - overscan || cell.y >= bottom + overscan) continue;
        const x = (cell.x - left) * pitch + gap / 2, y = (cell.y - top) * pitch + gap / 2, size = cell.span * pitch - gap;
        tiles.push({ ...cell, x, y, size, center: { x: cell.x + cell.span / 2, y: cell.y + cell.span / 2 },
          visible: x + size > 0 && y + size > 0 && x < width && y < height });
      }
    }
  }
  return tiles;
}

export function wallSongPosition(index, count) {
  if (!count) return { x: 2, y: 2 };
  const slot = mod(index, count), bx = Math.floor(slot / 10);
  const cell = wallBlock(bx, 0, count)[slot % 10];
  return { x: cell.x + cell.span / 2, y: cell.y + cell.span / 2 };
}

export function zoomWallCamera({ camera, width, height, zoom, nextZoom, anchor }) {
  const oldPitch = wallMetrics(width, height, zoom).pitch, pitch = wallMetrics(width, height, nextZoom).pitch;
  return { x: camera.x + (anchor.x - width / 2) * (1 / oldPitch - 1 / pitch),
    y: camera.y + (anchor.y - height / 2) * (1 / oldPitch - 1 / pitch) };
}

export function advanceWallMotion(camera, velocity, elapsed, pitch) {
  const dt = Math.min(32, Math.max(0, elapsed)), decay = Math.exp(-dt / 230);
  const next = { x: velocity.x * decay, y: velocity.y * decay };
  return { camera: { x: camera.x + velocity.x * 230 * (1 - decay) / pitch, y: camera.y + velocity.y * 230 * (1 - decay) / pitch },
    velocity: next, moving: Math.hypot(next.x, next.y) > .025 };
}
