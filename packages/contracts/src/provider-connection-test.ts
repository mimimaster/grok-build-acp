/**
 * Structured verdict for a provider row's "Test connection" (`models/test-connection`).
 *
 * The command itself succeeds whenever the Host could run the probe; the
 * *outcome* says what the provider answered. Shells map outcomes to tone and
 * copy — they never parse error strings to guess whether "404" meant "no
 * catalog" (harmless) or "wrong URL" (real failure).
 */
import type { ModelProviderConfig, ProviderChatApi } from './config.js';

/**
 * - `chat-ok` — a real minimal generation request to a configured model succeeded.
 * - `catalog-ok` — no model to chat with yet; `/models` answered with a list.
 * - `catalog-unavailable` — no model yet; endpoint reachable but exposes no
 *   usable `/models` (404/405/non-list). Add model IDs manually, then re-test.
 * - `auth-failed` — 401/403 from the provider.
 * - `model-rejected` — the chat request reached the provider but was refused
 *   (404 path/model, 400 body, 429, 5xx…). `httpStatus` + `detail` explain.
 * - `unreachable` — DNS/TLS/connect failure or timeout.
 * - `invalid-config` — the row cannot be probed (no/invalid Base URL…).
 */
export type ProviderConnectionTestOutcome =
  | 'chat-ok'
  | 'catalog-ok'
  | 'catalog-unavailable'
  | 'auth-failed'
  | 'model-rejected'
  | 'unreachable'
  | 'invalid-config';

/** Which probe produced the verdict. */
export type ProviderConnectionTestMethod = 'model-test' | 'discovery';

export type ProviderConnectionTestResult = {
  providerId: string;
  protocol: ModelProviderConfig['protocol'];
  outcome: ProviderConnectionTestOutcome;
  method: ProviderConnectionTestMethod;
  durationMs: number;
  /** Chat transport the probe mirrored (only for `method: 'model-test'`). */
  chatApi?: ProviderChatApi;
  /** Model used for `model-test`. */
  modelId?: string;
  /** Models returned by `discovery` when `catalog-ok`. */
  modelCount?: number;
  /** Provider HTTP status when the provider answered. */
  httpStatus?: number;
  /** URL the probe hit (never carries credentials). */
  endpoint?: string;
  /** Short provider/transport message for non-ok outcomes. */
  detail?: string;
};

/** Outcomes that mean "this row can be used as configured". */
export function isProviderConnectionUsable(outcome: ProviderConnectionTestOutcome): boolean {
  return outcome === 'chat-ok' || outcome === 'catalog-ok';
}
