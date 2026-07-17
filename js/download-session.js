/**
 * Tracks the dialog generation that owns asynchronous download UI updates.
 * Tokens returned by open() are invalidated by the next open(), so stale
 * requests cannot finish, close, or re-enable a newer dialog.
 */
export function createDownloadSession() {
  let current = 0;
  let pending = null;

  function isCurrent(token) {
    return token === current;
  }

  return {
    open() {
      current += 1;
      pending = null;
      return current;
    },

    start(token) {
      if (!isCurrent(token) || pending !== null) return false;
      pending = token;
      return true;
    },

    isCurrent,

    isPending(token) {
      return isCurrent(token) && pending === token;
    },

    canSubmit(token) {
      return isCurrent(token) && pending === null;
    },

    finish(token) {
      if (!isCurrent(token)) return false;
      pending = null;
      return true;
    },
  };
}
