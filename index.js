/**
 * MailRambo - email verification API client for Node.js 18+ (zero dependencies).
 * Docs: https://www.mailrambo.com/developers
 */

const DEFAULT_BASE_URL = "https://www.mailrambo.com/v1";
const RETRYABLE = new Set([429, 502, 503, 504]);

export class MailRamboError extends Error {
  /**
   * @param {number} status HTTP status (0 for network errors)
   * @param {string} code machine-readable error code, e.g. "insufficient_credits"
   * @param {string} message human-readable message
   * @param {object} [body] full error body from the API
   */
  constructor(status, code, message, body = {}) {
    super(message);
    this.name = "MailRamboError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MailRambo {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] defaults to process.env.MAILRAMBO_API_KEY
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout] per-request timeout in ms (default 30000)
   * @param {number} [options.maxRetries] retries on 429/5xx/network errors (default 2)
   * @param {typeof fetch} [options.fetch] custom fetch implementation
   */
  constructor(options = {}) {
    const apiKey = options.apiKey ?? globalThis.process?.env?.MAILRAMBO_API_KEY;
    if (!apiKey) {
      throw new MailRamboError(0, "missing_api_key", "Pass { apiKey } or set MAILRAMBO_API_KEY.");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this._fetch = options.fetch ?? globalThis.fetch;
    if (typeof this._fetch !== "function") {
      throw new Error("No fetch implementation found. Use Node 18+ or pass options.fetch.");
    }
  }

  /** True when using a free test key (mr_test_...). */
  get isTestMode() {
    return this.apiKey.startsWith("mr_test_");
  }

  async _request(method, path, { body, headers = {}, query } = {}) {
    let url = this.baseUrl + path;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null));
      if ([...qs].length) url += `?${qs}`;
    }
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "User-Agent": "mailrambo-node/0.1.0",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this._fetch(url, { ...init, signal: AbortSignal.timeout(this.timeout) });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new MailRamboError(0, "network_error", err?.message ?? "Network error");
      }

      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new MailRamboError(res.status, data.error ?? "http_error", data.message ?? `HTTP ${res.status}`, data);
      }
      return data;
    }
  }

  /**
   * Verify one address. 1 credit (invalid syntax is free).
   * @param {string} email
   * @param {{ detail?: boolean }} [options] detail: include grade, flags and DNS auth data
   */
  verify(email, options = {}) {
    return this._request("POST", "/verify", {
      body: { email },
      query: options.detail ? { detail: "full" } : undefined,
    });
  }

  /**
   * Start a batch of up to 200 addresses. An idempotency key is generated
   * automatically so retries never charge twice; pass your own to make
   * retries safe across process restarts.
   * @param {string[]} emails
   * @param {{ name?: string, idempotencyKey?: string }} [options]
   */
  createBatch(emails, options = {}) {
    const key = options.idempotencyKey ?? globalThis.crypto.randomUUID();
    return this._request("POST", "/verify/batch", {
      body: { emails, ...(options.name ? { name: options.name } : {}) },
      headers: { "Idempotency-Key": key },
    });
  }

  /** Get a batch's status (and results once completed). */
  getBatch(batchId) {
    return this._request("GET", `/verify/batch/${encodeURIComponent(batchId)}`);
  }

  /**
   * Poll a batch until it completes.
   * @param {string} batchId
   * @param {{ interval?: number, timeout?: number }} [options] ms (defaults 3000 / 600000)
   */
  async waitForBatch(batchId, options = {}) {
    const interval = options.interval ?? 3000;
    const deadline = Date.now() + (options.timeout ?? 600_000);
    for (;;) {
      const batch = await this.getBatch(batchId);
      if (batch.status === "completed") return batch;
      if (Date.now() + interval > deadline) {
        throw new MailRamboError(0, "timeout", `Batch ${batchId} did not complete in time.`, batch);
      }
      await sleep(interval);
    }
  }

  /**
   * Verify any number of addresses: splits into batches of 200, runs them
   * and returns one result per address in input order.
   * @param {string[]} emails
   * @param {{ name?: string, interval?: number, timeout?: number }} [options]
   */
  async verifyMany(emails, options = {}) {
    const results = [];
    for (let i = 0; i < emails.length; i += 200) {
      const chunk = emails.slice(i, i + 200);
      const { batch_id } = await this.createBatch(chunk, { name: options.name });
      const batch = await this.waitForBatch(batch_id, options);
      results.push(...batch.results);
    }
    return results;
  }

  /** Plan, remaining credits and period end. Free. */
  account() {
    return this._request("GET", "/account");
  }
}

export default MailRambo;
