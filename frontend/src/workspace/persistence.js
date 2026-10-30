// Each open document keeps the disk version separate from its normalized editor data.
export function documentPersistence(version, saved, write) {
  let queue = Promise.resolve();
  const state = {
    saved,
    pending: 0,
    save(data) {
      state.pending++;
      const next = queue.catch(() => {}).then(async () => {
        if (data === state.saved) return;
        version = await write(data, version);
        state.saved = data;
      });
      queue = next.finally(() => { state.pending--; });
      return queue;
    },
  };
  return state;
}
