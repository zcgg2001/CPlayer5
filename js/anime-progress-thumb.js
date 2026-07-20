/**
 * AnimeProgressThumb
 *
 * 只负责进度角色的渲染、位置和动画；音频跳转仍由原播放器处理。
 * 后续替换素材时，可修改 DEFAULT_ASSET_PATH，或在初始化时传入 assetSrc。
 */
(function exposeAnimeProgressThumb(global) {
    'use strict';

    class AnimeProgressThumb {
        static DEFAULT_ASSET_PATH = './img/doraemon-progress-thumb.png';

        constructor({
            root,
            container,
            track,
            assetSrc = AnimeProgressThumb.DEFAULT_ASSET_PATH,
            progressProvider = null,
            instruction = '拖动调整播放进度',
        }) {
            this.root = typeof root === 'string' ? document.querySelector(root) : root;
            this.container = typeof container === 'string' ? document.querySelector(container) : container;
            this.track = typeof track === 'string' ? document.querySelector(track) : track;
            this.assetSrc = assetSrc;
            this.progressProvider = progressProvider;
            this.instruction = instruction;
            this.progress = 0;
            this.currentTime = 0;
            this.duration = 0;
            this.isDragging = false;
            this.isPlaying = false;
            this.animationFrame = null;
            this.trackWidth = 0;
            this.thumbWidth = 0;

            if (!this.root || !this.container || !this.track) return;

            this.render();
            this.container.animeProgressThumb = this;
            this.resizeObserver = typeof ResizeObserver === 'function'
                ? new ResizeObserver(entries => {
                    const nextWidth = entries[0]?.contentRect?.width;
                    this.measureTrack(nextWidth);
                })
                : null;
            this.resizeObserver?.observe(this.track);
            this.boundWindowResize = () => this.measureTrack();
            if (!this.resizeObserver) window.addEventListener('resize', this.boundWindowResize);
            this.measureTrack();
        }

        render() {
            this.root.classList.add('anime-progress-thumb');
            this.root.setAttribute('aria-hidden', 'true');
            this.root.title = this.instruction;

            const character = document.createElement('span');
            character.className = 'anime-progress-thumb__character';

            const motion = document.createElement('span');
            motion.className = 'anime-progress-thumb__motion';

            this.image = document.createElement('img');
            this.image.className = 'anime-progress-thumb__image';
            this.image.src = this.assetSrc;
            this.image.alt = '';
            this.image.draggable = false;
            this.image.decoding = 'async';

            this.tooltip = document.createElement('span');
            this.tooltip.className = 'anime-progress-thumb__tooltip';
            this.tooltip.textContent = this.instruction;

            motion.append(this.image);
            character.append(motion);
            this.root.replaceChildren(character, this.tooltip);
        }

        setAssetSource(assetSrc) {
            if (!assetSrc || !this.image) return;
            this.assetSrc = assetSrc;
            this.image.src = assetSrc;
        }

        setProgress(progressPercent, currentTime = this.currentTime, duration = this.duration) {
            this.progress = Math.max(0, Math.min(100, Number(progressPercent) || 0));
            this.currentTime = Number.isFinite(currentTime) ? currentTime : 0;
            this.duration = Number.isFinite(duration) ? duration : 0;
            this.renderPosition();
            if (this.isDragging) this.renderTooltip();
        }

        setDragging(isDragging) {
            this.isDragging = Boolean(isDragging);
            this.root?.classList.toggle('is-dragging', this.isDragging);
            this.renderTooltip();
        }

        setPlaying(isPlaying) {
            const nextPlayingState = Boolean(isPlaying);
            if (this.isPlaying === nextPlayingState) return;
            this.isPlaying = nextPlayingState;
            this.root?.classList.toggle('is-playing', this.isPlaying);
            if (this.isPlaying) this.startProgressAnimation();
            else this.stopProgressAnimation();
        }

        renderPosition() {
            if (!this.root) return;
            const edgeInset = Math.min(this.thumbWidth / 2, this.trackWidth / 2);
            const travelWidth = Math.max(0, this.trackWidth - edgeInset * 2);
            const x = edgeInset + travelWidth * (this.progress / 100);
            this.root.style.setProperty('--anime-progress-x', `${x}px`);
        }

        measureTrack(measuredWidth) {
            if (!this.track) return;
            const fallbackWidth = this.track.getBoundingClientRect().width;
            this.trackWidth = Number.isFinite(measuredWidth) && measuredWidth > 0
                ? measuredWidth
                : fallbackWidth;
            this.thumbWidth = this.root?.getBoundingClientRect().width || 0;
            this.renderPosition();
        }

        renderTooltip() {
            if (!this.tooltip) return;
            this.tooltip.textContent = this.isDragging
                ? `${AnimeProgressThumb.formatTime(this.currentTime)} / ${AnimeProgressThumb.formatTime(this.duration)}`
                : this.instruction;
        }

        startProgressAnimation() {
            if (this.animationFrame !== null || typeof this.progressProvider !== 'function') return;

            const tick = () => {
                const state = this.progressProvider() || {};
                this.setProgress(state.progress, state.currentTime, state.duration);
                this.animationFrame = requestAnimationFrame(tick);
            };

            this.animationFrame = requestAnimationFrame(tick);
        }

        stopProgressAnimation() {
            if (this.animationFrame === null) return;
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        destroy() {
            this.stopProgressAnimation();
            this.resizeObserver?.disconnect();
            if (!this.resizeObserver) window.removeEventListener('resize', this.boundWindowResize);
            if (this.container?.animeProgressThumb === this) delete this.container.animeProgressThumb;
        }

        static formatTime(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.floor(seconds % 60);
            return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
        }
    }

    global.AnimeProgressThumb = AnimeProgressThumb;
})(window);
