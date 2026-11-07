# 滚动挂件模块

默认形象是原创矢量文件 `img/scroll-spider-anime.svg`（小织）。
点击挂件右下角的图片按钮，或进入「播放器设置 → 滚动挂件 → 更换形象」，可以上传替换。
支持 PNG、JPG、WebP、GIF、SVG，最大 5 MB；保持原图比例和透明背景。
上传的图片仅保存在当前浏览器的 IndexedDB，不会发送到服务器。恢复默认会删除这个自定义记录。

## 独立接入

保留以下目录结构即可复用，不需要播放器、Lucide、Tailwind 或其他依赖：

- `js/scroll-spider/index.js`：滚动、拖动、键盘操作、蛛丝绘制与组件生命周期。
- `js/scroll-spider/appearance.js`：图片校验、浏览器存储、图片替换与资源释放。
- `js/scroll-spider/editor.js`：上传预览和恢复默认弹窗。
- `css/page-scroll-spider.css`：组件样式；未提供站点主题变量时使用内置配色。
- `img/scroll-spider-anime.svg`：默认形象。

```html
<link rel="stylesheet" href="./css/page-scroll-spider.css">
<script type="module">
  import { PageScrollSpider } from './js/scroll-spider/index.js';

  const spider = new PageScrollSpider({
    resolveTarget: () => document.querySelector('#scrollable-content'),
  });

  // 可选 API：
  // spider.openAppearance();      // 打开形象设置
  // await spider.setImage(file);  // File / Blob，返回 { persisted }
  // await spider.resetImage();    // 恢复默认形象并清除已保存图片
  // spider.scheduleLayout();     // 切换目标可见性后刷新位置
  // spider.destroy();            // 释放监听器、观察器、图片 URL 与弹窗
</script>
```

`resolveTarget` 返回滚动容器；返回 `null` 会隐藏挂件。拖动之前和键盘操作时会调用可选的 `onInteract(target)`。
主项目只通过 `js/page-scroll-spider.js` 适配桌面音乐库、移动端歌词和设置入口。
用户拖动歌词挂件时会暂停歌词自动跟随，避免播放器抢回滚动位置。
