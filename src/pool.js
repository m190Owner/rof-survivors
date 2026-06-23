// Generic object pool. Keeps allocations flat when hundreds of enemies /
// projectiles / gems churn every second.

export class Pool {
  constructor(factory, reset) {
    this.factory = factory;   // () => newObject
    this.reset = reset;       // (obj, ...args) => void
    this.active = [];
    this.free = [];
  }

  spawn(...args) {
    const obj = this.free.pop() || this.factory();
    obj.alive = true;
    this.reset(obj, ...args);
    this.active.push(obj);
    return obj;
  }

  // Sweep dead objects back into the free list. Call once per frame after
  // updates have flipped `alive` to false on anything that should despawn.
  sweep() {
    const a = this.active;
    let w = 0;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o.alive) {
        a[w++] = o;
      } else {
        this.free.push(o);
      }
    }
    a.length = w;
  }

  clear() {
    for (const o of this.active) { o.alive = false; this.free.push(o); }
    this.active.length = 0;
  }

  get count() { return this.active.length; }
}
