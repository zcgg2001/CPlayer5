# 桌宠小猫模块

播放器设置中的「桌宠小猫」提供独立显示开关、追逐蝴蝶 / 跟随鼠标 / 原地休息 / 趴着睡觉四种行为，以及「找回小猫」。找回会开启小猫并让它回到安全区域休息。小猫可拖动，单击切换追逐目标，双击睡觉或唤醒；手机上不提供跟随鼠标。

小猫默认在普通浏览页和沉浸页显示，与滚动蜘蛛分别管理。打开应用对话框时暂时隐藏并暂停，关闭对话框自动恢复；后台标签页与系统「减少动态效果」也会暂停动画。触摸区域至少 44px，默认活动区避开底部播放栏。

## 文件边界

- `js/desktop-pet/index.js`：宠物 DOM、行为、拖动、动画、状态订阅和完整生命周期，无播放器选择器；导入没有自动挂载副作用。
- `js/desktop-pet/model.js`：位置、布局、模式转换与精灵方向纯函数。
- `js/desktop-pet/settings.js`：可选的设置面板绑定，返回解绑函数。
- `css/oneko-butterfly.css` 与 `img/oneko-tora.gif`：独立桌宠样式及精灵素材。
- `css/desktop-pet-settings.css`：可选设置面板样式。
- `js/oneko-butterfly.js`：CPlayer 入口，负责自动初始化、播放器进度条睡眠锚点、弹窗暂停与设置绑定。

## 在其他页面复用

保留 `css/` 与 `img/` 的相对目录，加载样式后显式创建实例：

```html
<link rel="stylesheet" href="./css/oneko-butterfly.css">
<script type="module">
  import { createDesktopPet } from './js/desktop-pet/index.js';
  const pet = createDesktopPet({
    mount: document.body,
    storageKey: 'my-app:pet',
    resolveSleepAnchor: () => document.querySelector('.player-progress'),
  });
  pet.setMode('butterfly');
  // 页面卸载或移除模块时：pet.destroy();
</script>
```

`mount` 应位于未施加 transform 的文档顶层；小猫使用视口坐标。可注入 `resolveLayout(width, height, reducedMotion)` 返回 `{ size, bounds, catStart, butterflyStart }`，自定义活动区域。`resolveSleepAnchor` 可返回元素或矩形；锚点不可见时退回默认安全区。`storage` 支持注入 Storage 兼容对象，读写失败仍可运行。

实例提供 `element`、`getState()`、`subscribe(callback)`（返回取消订阅函数）、`setEnabled(boolean)`、`setMode(mode)`、`recall()`、`setSuspended(boolean)`、`refresh()` 和 `destroy()`。销毁幂等，清理动画帧、延迟点击、指针捕获、所有监听器和 DOM。`setSuspended` 仅暂时暂停，不覆盖用户的显示偏好。

设置面板可通过 `bindDesktopPetSettings(root, pet)` 绑定到带有 `data-pet-enabled`、`data-pet-mode`、`data-pet-recall`、`data-pet-status` 的控件；CPlayer 的示例位于 `index.html`。页面集成层使用 `window.desktopPet` 持有唯一实例，重复初始化不会重复挂载。

## 兼容与验证

CPlayer 沿用 `cplayer5:oneko` 存储键，并兼容原来的 `mode`、`previousMode` 和归一化 `position`；新增 `enabled` 字段，旧设置缺少该字段时默认显示。所有模块、样式和精灵图都加入 Service Worker 预缓存。

```sh
node --test tests/desktop-pet.test.js tests/oneko-butterfly.test.js tests/page-scroll-spider-assets.test.js
npm test
npm run cf:check
```

精灵方向坐标沿用 [adryd325/oneko.js](https://github.com/adryd325/oneko.js)，保留 MIT 署名。
