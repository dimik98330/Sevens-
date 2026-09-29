// In-memory sliding-window rate limiter (06 section 5).
// Single-instance state by design; a multi-server deployment must move this
// to shared state or a gateway. Limits are demo starting points, not norms.
export class RateLimiter {
  constructor() {
    this.hits = new Map();
  }

  // Returns null when allowed, or retryAfterSeconds when limited.
  check(key, limit, windowSeconds, nowSeconds = Date.now() / 1000) {
    const cutoff = nowSeconds - windowSeconds;
    let entries = this.hits.get(key) || [];
    entries = entries.filter((t) => t > cutoff);
    if (entries.length >= limit) {
      this.hits.set(key, entries);
      return Math.max(1, Math.ceil(entries[0] + windowSeconds - nowSeconds));
    }
    entries.push(nowSeconds);
    this.hits.set(key, entries);
    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) {
        if (v.length === 0 || v[v.length - 1] <= cutoff) this.hits.delete(k);
        if (this.hits.size <= 10000) break;
      }
    }
    return null;
  }

  // Record a failure without counting a success (login throttle).
  fail(key, windowSeconds, nowSeconds = Date.now() / 1000) {
    const entries = (this.hits.get(key) || []).filter((t) => t > nowSeconds - windowSeconds);
    entries.push(nowSeconds);
    this.hits.set(key, entries);
  }
}

export const loginLimiter = new RateLimiter();
export const registerLimiter = new RateLimiter();
export const submitLimiter = new RateLimiter();
export const uploadLimiter = new RateLimiter();
