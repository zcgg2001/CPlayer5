// Local presentation preferences; artwork itself continues through the shared resolver.
export function initPlayerAppearance(dom, storage = globalThis.localStorage) {
  let saved;
  try { saved = JSON.parse(storage.getItem('zp_player_appearance')); } catch { /* Use defaults. */ }
  const value = { shape: ['rounded', 'circle', 'petal'].includes(saved?.shape) ? saved.shape : 'rounded', ambient: saved?.ambient !== false };
  function render() {
    document.documentElement.dataset.coverShape = value.shape;
    document.documentElement.dataset.coverAmbient = String(value.ambient);
    dom.androidCoverShapes.querySelectorAll('[data-cover-shape]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.coverShape === value.shape));
    });
    dom.androidCoverAmbient.checked = value.ambient;
  }
  function save() {
    try { storage.setItem('zp_player_appearance', JSON.stringify(value)); } catch { /* Current session still works. */ }
    render();
  }
  dom.androidCoverShapes.addEventListener('click', event => {
    const button = event.target.closest('[data-cover-shape]');
    if (!button) return;
    value.shape = button.dataset.coverShape; save();
  });
  dom.androidCoverAmbient.addEventListener('change', () => { value.ambient = dom.androidCoverAmbient.checked; save(); });
  render();
}
