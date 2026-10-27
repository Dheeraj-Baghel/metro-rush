// Keyboard + swipe input with small input buffer for responsiveness.
export type GameAction = 'left' | 'right' | 'jump' | 'slide' | 'pause';

export class InputSystem {
  private listeners: ((a: GameAction) => void)[] = [];
  private touchStart: { x: number; y: number; t: number } | null = null;
  private attached = false;
  private keyHandler = (e: KeyboardEvent) => {
    const map: Record<string, GameAction> = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      ArrowDown: 'slide', KeyS: 'slide',
      Escape: 'pause', KeyP: 'pause',
    };
    const a = map[e.code];
    if (a) {
      // Keep gameplay keys from scrolling the page.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.emit(a);
    }
  };
  private tsHandler = (e: TouchEvent) => {
    const t = e.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
  };
  private teHandler = (e: TouchEvent) => {
    if (!this.touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    const dt = performance.now() - this.touchStart.t;
    this.touchStart = null;
    if (dt > 600) return;
    const TH = 28;
    if (Math.abs(dx) < TH && Math.abs(dy) < TH) return;
    if (Math.abs(dx) > Math.abs(dy)) this.emit(dx > 0 ? 'right' : 'left');
    else this.emit(dy > 0 ? 'slide' : 'jump');
  };
  private tmHandler = (e: TouchEvent) => {
    // Prevent page scroll while swiping over the canvas.
    e.preventDefault();
  };

  attach(canvas: HTMLElement) {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.keyHandler);
    canvas.addEventListener('touchstart', this.tsHandler, { passive: true });
    canvas.addEventListener('touchmove', this.tmHandler, { passive: false });
    canvas.addEventListener('touchend', this.teHandler, { passive: true });
  }

  detach(canvas: HTMLElement) {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.keyHandler);
    canvas.removeEventListener('touchstart', this.tsHandler);
    canvas.removeEventListener('touchmove', this.tmHandler);
    canvas.removeEventListener('touchend', this.teHandler);
  }

  onAction(fn: (a: GameAction) => void) {
    this.listeners.push(fn);
  }

  private emit(a: GameAction) {
    for (const fn of this.listeners) fn(a);
  }
}
