// Password hashing: Argon2id per 06 section 4 (m=19MiB, t=2, p=1).
// Concurrency of expensive checks is bounded by a small semaphore.
import argon2 from 'argon2';

export const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const MAX_CONCURRENT = 4;
const MAX_WAITING = 64;
let active = 0;
const waiting = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  if (waiting.length >= MAX_WAITING) {
    const err = new Error('Слишком много попыток');
    err.code = 'RATE_LIMITED';
    err.retryAfterSeconds = 1;
    return Promise.reject(err);
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  active--;
  const next = waiting.shift();
  if (next) {
    active++;
    next();
  }
}

export async function hashPassword(password) {
  await acquire();
  try {
    return await argon2.hash(password, ARGON_OPTIONS);
  } finally {
    release();
  }
}

export async function verifyPassword(hash, password) {
  await acquire();
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  } finally {
    release();
  }
}
