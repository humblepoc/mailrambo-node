export type Reason =
  | "mailbox_exists"
  | "role_account"
  | "invalid_syntax"
  | "disposable"
  | "spamtrap"
  | "inbox_full"
  | "mailbox_disabled"
  | "catch_all"
  | "mailbox_not_found"
  | "unverifiable";

export interface VerifyDetail {
  grade: "A" | "B" | "C" | "D" | "F" | null;
  score: number | null;
  inbox_provider: string | null;
  flags: {
    free_email: boolean;
    role_account: boolean;
    disposable: boolean;
    catch_all: boolean;
    mailbox_exists: boolean | null;
  };
  dns: {
    mx: boolean;
    mx_hosts: string[];
    spf: boolean;
    dmarc_policy: "none" | "quarantine" | "reject" | null;
    dkim_selectors: string[];
    bimi: boolean;
    ptr: boolean;
  } | null;
}

export interface VerifyResult {
  email: string;
  /** true ONLY when the mailbox is confirmed; catch-all and unknown are false. */
  deliverable: boolean;
  reason: Reason;
  /** null for free answers (invalid syntax, test keys). */
  credits_remaining: number | null;
  /** present when called with { detail: true } */
  detail?: VerifyDetail;
}

export interface BatchCreated {
  batch_id: string;
  emails_submitted: number;
  status: "processing";
  credits_remaining: number | null;
}

export interface BatchRow {
  email: string;
  deliverable: boolean;
  reason: Reason;
}

export interface Batch {
  batch_id: string;
  status: "processing" | "completed";
  progress: number;
  total: number;
  checked: number;
  results: BatchRow[] | null;
}

export interface Account {
  plan: string;
  plan_name: string;
  status: string;
  credits_remaining: number;
  credits_total: number;
  pack_credits?: number;
  period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface MailRamboOptions {
  /** Defaults to process.env.MAILRAMBO_API_KEY */
  apiKey?: string;
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30000. */
  timeout?: number;
  /** Retries on 429, 5xx and network errors. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
}

export declare class MailRamboError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;
}

export declare class MailRambo {
  constructor(options?: MailRamboOptions);
  readonly isTestMode: boolean;
  verify(email: string, options?: { detail?: boolean }): Promise<VerifyResult>;
  createBatch(emails: string[], options?: { name?: string; idempotencyKey?: string }): Promise<BatchCreated>;
  getBatch(batchId: string): Promise<Batch>;
  waitForBatch(batchId: string, options?: { interval?: number; timeout?: number }): Promise<Batch & { results: BatchRow[] }>;
  verifyMany(emails: string[], options?: { name?: string; interval?: number; timeout?: number }): Promise<BatchRow[]>;
  account(): Promise<Account>;
}

export default MailRambo;
