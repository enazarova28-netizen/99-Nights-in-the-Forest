class Camera {
  constructor() {
    this.x  = 0;
    this.y  = 0;
    this.sx = 0; // shake offset x
    this.sy = 0; // shake offset y
    this._shakeDur   = 0;
    this._shakeTot   = 0;
    this._shakeMag   = 0;
  }

  update(target, dt) {
    const tx = target.x + target.w / 2 - CANVAS_W / 2;
    const ty = target.y + target.h / 2 - CANVAS_H / 2;
    this.x = clamp(tx, 0, MAP_COLS * TILE_SIZE - CANVAS_W);
    this.y = clamp(ty, 0, MAP_ROWS * TILE_SIZE - CANVAS_H);

    if (this._shakeDur > 0) {
      this._shakeDur -= dt;
      const m = this._shakeMag * (this._shakeDur / this._shakeTot);
      this.sx = randFloat(-m, m);
      this.sy = randFloat(-m, m);
    } else {
      this.sx = 0; this.sy = 0;
    }
  }

  shake(duration, magnitude) {
    this._shakeDur = duration;
    this._shakeTot = duration;
    this._shakeMag = magnitude;
  }

  // World coords → screen coords
  toScreen(wx, wy) {
    return { x: wx - this.x + this.sx, y: wy - this.y + this.sy };
  }

  // Screen coords → world coords (for mouse)
  toWorld(sx, sy) {
    return { x: sx + this.x - this.sx, y: sy + this.y - this.sy };
  }
}
