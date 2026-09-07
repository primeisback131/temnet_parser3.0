/**
 * Keeps requestAnimationFrame alive where the browser never delivers frames.
 *
 * In some remote-desktop sessions (RDP into a VM without a GPU) the browser
 * paints the page but never fires animation-frame callbacks. antd popups
 * (Select, DatePicker, Modal) step their open animation on those callbacks
 * and only position themselves once it finishes, so they stay parked at
 * -1000vw forever: the DOM is there, the screen shows nothing. When the first
 * frame does not arrive in time, animation frames fall back to a timer.
 */
export function ensureAnimationFrames(): void {
  const probe = () => {
    if (document.hidden) {
      return; // background tabs legitimately pause frames; probe when shown
    }
    let fired = false;
    window.requestAnimationFrame(() => {
      fired = true;
    });
    window.setTimeout(() => {
      if (fired) {
        return;
      }
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(performance.now()), 16);
      window.cancelAnimationFrame = (id) => window.clearTimeout(id);
      console.warn("Кадры анимации не приходят (RDP?): requestAnimationFrame заменён таймером");
    }, 1000);
  };
  probe();
  document.addEventListener("visibilitychange", probe, { once: true });
}
