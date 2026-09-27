export function createPlaybackSession() {
  let version = 0;
  let controller = null;

  const isCurrent = session => Boolean(
    session
      && session.version === version
      && !session.signal.aborted,
  );

  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      version += 1;
      return { version, signal: controller.signal };
    },
    isCurrent,
    cancel() {
      version += 1;
      controller?.abort();
      controller = null;
    },
  };
}
