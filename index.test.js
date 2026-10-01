import { test } from "node:test";
import assert from "node:assert/strict";
import { MailRambo, MailRamboError } from "./index.js";

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    });
  };
  fn.calls = calls;
  return fn;
}

const client = (responses, opts = {}) => {
  const fetch = mockFetch(responses);
  return { mr: new MailRambo({ apiKey: "mr_test_x", fetch, ...opts }), fetch };
};

test("requires an api key", () => {
  const saved = process.env.MAILRAMBO_API_KEY;
  delete process.env.MAILRAMBO_API_KEY;
  assert.throws(() => new MailRambo({ fetch: () => {} }), MailRamboError);
  if (saved) process.env.MAILRAMBO_API_KEY = saved;
});

test("verify posts the email with bearer auth", async () => {
  const { mr, fetch } = client([{ body: { email: "a@b.co", deliverable: true, reason: "mailbox_exists", credits_remaining: 9 } }]);
  const r = await mr.verify("a@b.co");
  assert.equal(r.deliverable, true);
  const { url, init } = fetch.calls[0];
  assert.equal(url, "https://www.mailrambo.com/v1/verify");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer mr_test_x");
  assert.deepEqual(JSON.parse(init.body), { email: "a@b.co" });
  assert.equal(mr.isTestMode, true);
});

test("detail option adds ?detail=full", async () => {
  const { mr, fetch } = client([{ body: {} }]);
  await mr.verify("a@b.co", { detail: true });
  assert.equal(fetch.calls[0].url, "https://www.mailrambo.com/v1/verify?detail=full");
});

test("API errors become MailRamboError with code and status", async () => {
  const { mr } = client([{ status: 402, body: { error: "insufficient_credits", message: "Out of credits", credits_remaining: 0 } }]);
  await assert.rejects(mr.verify("a@b.co"), (e) =>
    e instanceof MailRamboError && e.status === 402 && e.code === "insufficient_credits" && e.body.credits_remaining === 0);
});

test("retries 503 then succeeds, reusing the same idempotency key", async () => {
  const { mr, fetch } = client([
    { status: 503, body: { error: "provider_unavailable" }, headers: { "retry-after": "0" } },
    { status: 202, body: { batch_id: "b1", emails_submitted: 1, status: "processing" } },
  ]);
  mr.maxRetries = 2;
  const r = await mr.createBatch(["a@b.co"], { name: "x" });
  assert.equal(r.batch_id, "b1");
  assert.equal(fetch.calls.length, 2);
  const [k1, k2] = fetch.calls.map((c) => c.init.headers["Idempotency-Key"]);
  assert.ok(k1 && k1 === k2);
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { emails: ["a@b.co"], name: "x" });
});

test("does not retry 4xx", async () => {
  const { mr, fetch } = client([{ status: 401, body: { error: "invalid_api_key", message: "Unknown API key." } }]);
  await assert.rejects(mr.account(), { code: "invalid_api_key" });
  assert.equal(fetch.calls.length, 1);
});

test("verifyMany chunks into batches of 200 and preserves order", async () => {
  const emails = Array.from({ length: 250 }, (_, i) => `u${i}@b.co`);
  const rows = (list) => list.map((email) => ({ email, deliverable: true, reason: "mailbox_exists" }));
  const { mr, fetch } = client([
    { status: 202, body: { batch_id: "b1" } },
    { body: { batch_id: "b1", status: "completed", results: rows(emails.slice(0, 200)) } },
    { status: 202, body: { batch_id: "b2" } },
    { body: { batch_id: "b2", status: "completed", results: rows(emails.slice(200)) } },
  ]);
  const out = await mr.verifyMany(emails, { interval: 1 });
  assert.equal(out.length, 250);
  assert.equal(out[249].email, "u249@b.co");
  assert.equal(JSON.parse(fetch.calls[0].init.body).emails.length, 200);
  assert.equal(JSON.parse(fetch.calls[2].init.body).emails.length, 50);
});

test("waitForBatch polls until completed", async () => {
  const { mr, fetch } = client([
    { body: { batch_id: "b1", status: "processing" } },
    { body: { batch_id: "b1", status: "completed", results: [] } },
  ]);
  const b = await mr.waitForBatch("b1", { interval: 1 });
  assert.equal(b.status, "completed");
  assert.equal(fetch.calls.length, 2);
});

test("mode option adds ?mode=fast", async () => {
  const { mr, fetch } = client([{ body: { deliverable: null, reason: "fast_check_passed" } }]);
  await mr.verify("a@b.co", { mode: "fast", detail: true });
  assert.equal(fetch.calls[0].url, "https://www.mailrambo.com/v1/verify?detail=full&mode=fast");
});
