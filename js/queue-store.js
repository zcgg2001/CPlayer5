// Queue state is independent of the audio element: clearing it does not stop playback.
export function createQueueStore({ random = Math.random } = {}) {
    const state = { playlist: [], currentIndex: -1, playMode: 'random', shuffledOrder: [], undoSnapshot: null };
    const songId = song => song?.id ?? song;
    const find = id => id == null ? -1 : state.playlist.findIndex(song => String(songId(song)) === String(id));

    function shuffle() {
        state.shuffledOrder = state.playlist.map((_, index) => index);
        for (let i = state.shuffledOrder.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [state.shuffledOrder[i], state.shuffledOrder[j]] = [state.shuffledOrder[j], state.shuffledOrder[i]];
        }
        return state.shuffledOrder;
    }

    function resetOrder() {
        state.shuffledOrder = state.playlist.map((_, index) => index);
        if (state.playMode === 'random') shuffle();
    }

    function neighbor(direction) {
        const count = state.playlist.length;
        if (!count) return -1;
        if (state.playMode === 'random') {
            if (state.shuffledOrder.length !== count) shuffle();
            const position = state.shuffledOrder.indexOf(state.currentIndex);
            return state.shuffledOrder[position < 0 ? 0 : (position + direction + count) % count];
        }
        if (state.currentIndex < 0 || state.currentIndex >= count) return 0;
        if (state.playMode === 'single') return state.currentIndex;
        return (state.currentIndex + direction + count) % count;
    }

    function snapshot(currentSongId = null) {
        return { songs: state.playlist.slice(), currentSongId, currentIndex: state.currentIndex };
    }

    function restore(saved, activeSongId = saved?.currentSongId) {
        if (!saved?.songs?.length) return false;
        state.playlist = saved.songs.slice();
        // The player may have switched songs while the undo toast was visible.
        state.currentIndex = find(activeSongId);
        if (activeSongId == null && saved.currentIndex >= 0 && saved.currentIndex < state.playlist.length) {
            state.currentIndex = saved.currentIndex;
        }
        state.undoSnapshot = null;
        resetOrder();
        return true;
    }

    function remove(index, activeSongId = null) {
        if (!Number.isInteger(index) || index < 0 || index >= state.playlist.length) return null;
        state.undoSnapshot = snapshot(activeSongId);
        const [removed] = state.playlist.splice(index, 1);
        state.currentIndex = find(activeSongId);
        resetOrder();
        return { removed, snapshot: state.undoSnapshot };
    }

    function clear(activeSongId = null) {
        if (!state.playlist.length) return null;
        state.undoSnapshot = snapshot(activeSongId);
        state.playlist = [];
        state.currentIndex = -1;
        resetOrder();
        return state.undoSnapshot;
    }

    function insert(song) {
        if (state.playMode === 'random' && state.shuffledOrder.length !== state.playlist.length) shuffle();
        if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) {
            state.currentIndex = Math.max(0, state.playlist.length - 1);
        }
        const index = state.playlist.length ? state.currentIndex + 1 : 0;
        state.playlist.splice(index, 0, song);
        if (state.playMode === 'random') {
            state.shuffledOrder = state.shuffledOrder.map(value => value >= index ? value + 1 : value);
            const position = state.shuffledOrder.indexOf(state.currentIndex);
            state.shuffledOrder.splice(position < 0 ? state.shuffledOrder.length : position + 1, 0, index);
        }
        return index;
    }

    return {
        state, shuffle, resetOrder, snapshot, restore, remove, clear, insert,
        next: () => neighbor(1), previous: () => neighbor(-1),
        displayOrder: () => state.playMode === 'random' && state.shuffledOrder.length === state.playlist.length
            ? state.shuffledOrder : state.playlist.map((_, index) => index),
    };
}
