class LRUCache {
  map = /* @__PURE__ */ new Map();
  maxSize;
  constructor(maxSize) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error(
        `[next-fluent] LRUCache size must be a positive integer (received ${maxSize}).`
      );
    }
    this.maxSize = maxSize;
  }
  get(key) {
    const val = this.map.get(key);
    if (val !== void 0) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }
  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== void 0) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }
  has(key) {
    return this.map.has(key);
  }
  delete(key) {
    return this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}
export {
  LRUCache
};
