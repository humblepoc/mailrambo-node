# mailrambo

Official Node.js client for the [MailRambo](https://www.mailrambo.com) email verification API.

One call answers one question - **can I send to this address without bouncing?** `deliverable` is `true` only when the mailbox is confirmed; catch-all, disposable and unverifiable addresses are `false`, with a `reason` you can branch on.

- Zero dependencies, Node 18+, ESM, TypeScript types included
- Automatic retries on 429/5xx with backoff
- Retry-safe batches (idempotency keys added for you)
- Free test keys (`mr_test_...`) - build and run CI without spending credits

## Install

```bash
npm install mailrambo
```

Get a free API key (100 verifications/month, API on every plan) at [mailrambo.com](https://www.mailrambo.com/auth/signup?src=npm).

## Quick start

```js
import { MailRambo } from "mailrambo";

const mr = new MailRambo({ apiKey: process.env.MAILRAMBO_API_KEY });

const { deliverable, reason } = await mr.verify("jane@acme.com");
if (!deliverable) {
  console.log("Don't send:", reason); // "mailbox_not_found", "disposable", "catch_all", ...
}
```

## Block fake signups

```js
const BLOCK = new Set(["disposable", "mailbox_not_found", "invalid_syntax", "spamtrap"]);

export async function isAllowedSignup(email) {
  try {
    const { reason } = await mr.verify(email);
    return !BLOCK.has(reason);
  } catch {
    return true; // fail open: never lose a real user to a timeout
  }
}
```

## Fast mode for signup forms (free)

```js
const r = await mr.verify("jane@gmial.com", { mode: "fast" }); // < 1s, no credit
r.deliverable; // false = reject (invalid_syntax, possible_typo, disposable, no_mx); null = looks fine, mailbox not checked
r.suggestion;  // "jane@gmail.com"
```

Repeat checks of the same address within 24 hours are also free (`cached: true`).

## Better Auth integration

For Better Auth email/password signup, use the separately published [`better-auth-mailrambo`](https://www.npmjs.com/package/better-auth-mailrambo) plugin and [complete setup guide](https://www.mailrambo.com/blog/block-disposable-emails-better-auth). Version 0.1.0 requires Better Auth 1.7.7 and Node >=22; check compatibility before upgrading an existing auth framework.

The plugin uses free fast mode with a 2,000 ms remote timeout and zero automatic retries, rather than this SDK's ordinary defaults. Runtime screening errors allow signup to continue; email confirmation is unchanged. It does not cover OAuth, OTP, magic links or email changes. A passed fast check does not confirm mailbox existence.

## Full detail

```js
const r = await mr.verify("jane@acme.com", { detail: true });
r.detail.grade;             // "A"
r.detail.inbox_provider;    // "Google Workspace"
r.detail.dns.dmarc_policy;  // "reject"
```

Same price (1 credit).

## Lists

```js
// Any size: split into batches of 200, polled until done, results in input order
const rows = await mr.verifyMany(emails, { name: "Q4 import" });
const good = rows.filter((r) => r.deliverable).map((r) => r.email);

// Or manage batches yourself
const { batch_id } = await mr.createBatch(emails.slice(0, 200), { idempotencyKey: "import-42" });
const batch = await mr.waitForBatch(batch_id);
```

## Credits

```js
const { credits_remaining, plan } = await mr.account(); // free
```

## Errors

Every API error throws `MailRamboError` with `status`, `code` and `message`:

```js
import { MailRamboError } from "mailrambo";

try {
  await mr.verify(email);
} catch (e) {
  if (e instanceof MailRamboError && e.code === "insufficient_credits") {
    // top up at https://www.mailrambo.com/pricing
  }
}
```

| status | code | meaning |
|---|---|---|
| 401 | `invalid_api_key`, `api_key_revoked` | Check your key |
| 402 | `insufficient_credits`, `subscription_inactive` | Top up or reactivate |
| 429 | `rate_limited` | Retried automatically, then thrown |
| 503 | `provider_unavailable` | Retried automatically; charged credits are refunded |

## Test mode

Create a `mr_test_...` key on the [API Keys page](https://www.mailrambo.com/api-keys). No credits are used, and the answer depends on the part before the `@`:

Those canned answers apply to full mailbox checks. Both live and test keys run real fast checks when `{ mode: "fast" }` is requested.

```js
await mr.verify("deliverable@example.com"); // true,  "mailbox_exists"
await mr.verify("disposable@example.com");  // false, "disposable"
await mr.verify("catch_all@example.com");   // false, "catch_all"
await mr.verify("anything@example.com");    // false, "mailbox_not_found"
```

## Options

```js
new MailRambo({
  apiKey,           // default: process.env.MAILRAMBO_API_KEY
  timeout: 30000,   // ms per request
  maxRetries: 2,    // on 429, 5xx and network errors
  fetch,            // custom fetch implementation
});
```

## Links

- [API reference](https://www.mailrambo.com/developers) · [OpenAPI spec](https://www.mailrambo.com/v1/openapi.json)
- [Free email & DNS tools](https://www.mailrambo.com/tools)
- [Pricing](https://www.mailrambo.com/pricing)

MIT License
