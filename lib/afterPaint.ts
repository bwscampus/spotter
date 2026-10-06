/**
 * Runs `callback` right after the browser paints the next frame, passing the
 * time it ran. rAF fires just before paint; a message posted from there is
 * delivered once that frame has been rendered.
 *
 * A hidden page (background tab, minimized window) does not paint, so the
 * callback runs on the next task with `null` instead of waiting until the page
 * is shown again.
 */
export function afterPaint(callback: (paintedAt: number | null) => void) {
  if (document.hidden) {
    setTimeout(() => callback(null), 0);
    return;
  }
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      callback(performance.now());
    };
    channel.port2.postMessage(null);
  });
}
