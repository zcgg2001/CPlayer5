/** Bind an optional settings panel to any desktop-pet instance. Returns cleanup. */
export function bindDesktopPetSettings(root, pet) {
  if (!root || !pet) return () => {};
  const enabled = root.querySelector('[data-pet-enabled]');
  const mode = root.querySelector('[data-pet-mode]');
  const recall = root.querySelector('[data-pet-recall]');
  const status = root.querySelector('[data-pet-status]');
  const labels = { butterfly: '追逐蝴蝶', cursor: '跟随鼠标', rest: '原地休息', sleep: '趴着睡觉' };
  const unsubscribe = pet.subscribe(state => {
    if (enabled) enabled.checked = state.enabled;
    if (mode) {
      mode.value = state.mode;
      mode.disabled = !state.enabled;
      const cursor = mode.querySelector('[value="cursor"]');
      if (cursor) cursor.disabled = state.mobile;
    }
    if (status) status.textContent = !state.enabled
      ? '小猫已隐藏，可随时重新开启。'
      : state.reducedMotion
        ? '已开启 · 按系统偏好减少动态效果。'
        : `已开启 · ${labels[state.mode]} · 自动保存在此浏览器。`;
  });
  const onEnabled = () => pet.setEnabled(enabled.checked);
  const onMode = () => pet.setMode(mode.value);
  const onRecall = () => {
    pet.recall();
    if (status) status.textContent = '小猫已回到屏幕右下方休息，关闭设置即可看到。';
  };
  enabled?.addEventListener('change', onEnabled);
  mode?.addEventListener('change', onMode);
  recall?.addEventListener('click', onRecall);
  return () => {
    unsubscribe();
    enabled?.removeEventListener('change', onEnabled);
    mode?.removeEventListener('change', onMode);
    recall?.removeEventListener('click', onRecall);
  };
}
