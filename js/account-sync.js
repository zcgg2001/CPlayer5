import { cleanRecords, mergeRecords, same } from './account-data.js';

// Sync exchanges complete, revisioned snapshots. Missing and null are equivalent
// in the three-way merge, so expired history/stat rows need no lasting tombstone.
const compact = records => Object.fromEntries(Object.entries(records).filter(([key,value]) => value !== null || !/^(history:|listen:)/.test(key)));

export function createAccountSync({ storage, request, onApply = () => {}, onStatus = () => {} }) {
  let userId = null, state = null, epoch = 0, running = null;
  const key = () => `cp_cloud_v1:${userId}`;
  const persist = () => { storage.setItem(key(), JSON.stringify(state)); };
  const status = (message, error = false, unauthorized = false) => onStatus({ message, error, unauthorized, conflicts: state?.conflicts || [], pending: Boolean(state && !same(state.base, state.local)) });
  return {
    connect(id) {
      epoch++; userId = id; running = null;
      try { state = JSON.parse(storage.getItem(key())); } catch { state = null; }
      if (!state || !state.base || !state.local) state = { base: {}, local: {}, revision: 0, conflicts: [] };
      state.local = cleanRecords(compact(state.local)); state.base = cleanRecords(compact(state.base));
      onApply(state.local); status('正在连接云端');
    },
    disconnect({ erase = false } = {}) { if (erase && userId) storage.removeItem(key()); epoch++; userId = null; state = null; running = null; },
    capture(records) {
      if (!state) return;
      const clean = cleanRecords(records), local = { ...state.local };
      for (const k of new Set([...Object.keys(local), ...Object.keys(clean)])) local[k] = clean[k] ?? null;
      if (same(local, state.local)) return;
      state.local = compact(local); persist(); status('修改已保存在此设备，等待同步');
    },
    import(records) { if (state) { state.local = cleanRecords({ ...state.local, ...records }); persist(); onApply(state.local); status('已导入此设备的资料'); } },
    resolve(key, choice) {
      if (!state?.conflicts.includes(key)) return;
      if (choice === 'remote') state.local[key] = state.base[key] ?? null;
      state.conflicts = state.conflicts.filter(k => k !== key); persist(); onApply(state.local); status('已保留所选版本');
    },
    records: () => state?.local || {},
    pending: () => Boolean(state && !same(state.base, state.local)),
    async sync() {
      if (!state || running) return running;
      const generation = epoch;
      const work = async () => {
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            const remote = await request('/api/sync');
            if (generation !== epoch) return;
            const merged = mergeRecords(state.base, state.local, cleanRecords(remote.records));
            // Preserve unresolved conflicts across pulls and page reloads.
            state.conflicts = [...new Set([...state.conflicts.filter(k => !same(state.local[k], remote.records[k])), ...merged.conflicts])];
            state.local = compact(merged.records); state.base = remote.records; state.revision = remote.revision;
            persist(); onApply(state.local);
            if (state.conflicts.length) { status('有冲突，请选择要保留的版本'); return; }
            if (same(state.local, state.base)) { status('已与云端同步'); return; }
            const sent = structuredClone(state.local);
            try {
              const result = await request('/api/sync', { method: 'PUT', body: { revision: state.revision, records: sent } });
              if (generation !== epoch) return;
              state.base = sent; state.revision = result.revision; persist();
              if (same(state.local, sent)) { status('已与云端同步'); return; }
            } catch (error) { if (error.status !== 409) throw error; }
          }
          status('其他设备正在更新，稍后会再次同步');
        } catch (error) { if (generation === epoch) status(error.status === 401 ? '登录已失效，修改已保留；请重新登录' : `暂未同步，修改已保留：${error.message}`, true, error.status === 401); }
      };
      running = work();
      try { await running; } finally { if (generation === epoch) running = null; }
    },
  };
}
