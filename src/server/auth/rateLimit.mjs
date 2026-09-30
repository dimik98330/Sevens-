// In-memory sliding-window rate limiter (06 section 5).
// Single-instance state by design; a multi-server deployment must move this
// to shared state or a gateway. Limits are demo starting points, not norms.
export class RateLimiter {
  constructor({ maxKeys = 10000, maxHitsPerKey = 256 } = {}) {
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1
      || !Number.isSafeInteger(maxHitsPerKey) || maxHitsPerKey < 1) {
      throw new RangeError('Rate limiter capacity must be positive');
    }
    this.hits = new Map();
    this.expires = new Map();
    this.maxKeys = maxKeys;
    this.maxHitsPerKey = maxHitsPerKey;
  }

  liveEntries(key, windowSeconds, nowSeconds) {
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0 || !Number.isFinite(nowSeconds)) {
      throw new RangeError('Rate limiter window and time must be finite');
    }
    const entries = (this.hits.get(key) || []).filter((t) => t > nowSeconds - windowSeconds);
    if (entries.length) this.hits.set(key, entries);
    else this.clear(key);
    return entries;
  }

  capacityRetryAfter(key, nowSeconds) {
    if (this.hits.has(key) || this.hits.size < this.maxKeys) return null;
    let firstExpiry = Infinity;
    for (const [k, expiresAt] of this.expires) {
      if (expiresAt <= nowSeconds) this.clear(k);
      else firstExpiry = Math.min(firstExpiry, expiresAt);
    }
    // Fail closed while all buckets are live. Evicting an active bucket would
    // let new attacker-controlled keys erase another user's protection.
    return this.hits.size < this.maxKeys ? null : Math.max(1, Math.ceil(firstExpiry - nowSeconds));
  }

  // Non-consuming admission check; call BEFORE password verification.
  retryAfter(key, limit, windowSeconds, nowSeconds = Date.now() / 1000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.maxHitsPerKey) {
      throw new RangeError('Rate limit exceeds bucket capacity');
    }
    const entries = this.liveEntries(key, windowSeconds, nowSeconds);
    if (entries.length >= limit) {
      return Math.max(1, Math.ceil(entries[0] + windowSeconds - nowSeconds));
    }
    return this.capacityRetryAfter(key, nowSeconds);
  }

  // Consuming check retained for registrations, submissions and uploads.
  check(key, limit, windowSeconds, nowSeconds = Date.now() / 1000) {
    const retry = this.retryAfter(key, limit, windowSeconds, nowSeconds);
    if (retry) return retry;
    return this.fail(key, windowSeconds, nowSeconds);
  }

  fail(key, windowSeconds, nowSeconds = Date.now() / 1000) {
    const entries = this.liveEntries(key, windowSeconds, nowSeconds);
    const retry = this.capacityRetryAfter(key, nowSeconds);
    if (retry) return retry;
    entries.push(nowSeconds);
    if (entries.length > this.maxHitsPerKey) entries.shift();
    this.hits.set(key, entries);
    this.expires.set(key, nowSeconds + windowSeconds);
    return null;
  }

  clear(key) {
    this.hits.delete(key);
    this.expires.delete(key);
  }
}

export const loginLimiter = new RateLimiter();
export const registerLimiter = new RateLimiter();
export const submitLimiter = new RateLimiter();
export const uploadLimiter = new RateLimiter();
export const demoLoginLimiter = new RateLimiter({maxKeys:1000});
