// Keep a referenced timeout while fetch is pending (AbortSignal.timeout alone
// is unref'ed and can let a CLI exit with unsettled top-level await).
export async function waitForReady(url, { timeoutMs = 90_000, requestTimeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, deadline - Date.now()));
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* A starting/restarting service is not ready yet. */ }
    finally { clearTimeout(timer); }
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Isolated release did not become ready');
}
