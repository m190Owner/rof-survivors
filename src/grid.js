// Spatial hash grid for broad-phase collision queries (projectiles vs enemies,
// enemy separation, target finding). Rebuilt each frame from the active set.

export class SpatialGrid {
  constructor(cell = 96) {
    this.cell = cell;
    this.map = new Map();
  }

  key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }

  clear() { this.map.clear(); }

  insert(obj) {
    const cx = Math.floor(obj.x / this.cell);
    const cy = Math.floor(obj.y / this.cell);
    const k = this.key(cx, cy);
    let bucket = this.map.get(k);
    if (!bucket) { bucket = []; this.map.set(k, bucket); }
    bucket.push(obj);
  }

  rebuild(items) {
    this.clear();
    for (const it of items) if (it.alive) this.insert(it);
  }

  // Run `fn(obj)` for every object within `radius` of (x, y). Approximate:
  // visits all cells the radius overlaps; caller does the exact distance test.
  queryRadius(x, y, radius, fn) {
    const c = this.cell;
    const minX = Math.floor((x - radius) / c);
    const maxX = Math.floor((x + radius) / c);
    const minY = Math.floor((y - radius) / c);
    const maxY = Math.floor((y + radius) / c);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.map.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
    }
  }
}
