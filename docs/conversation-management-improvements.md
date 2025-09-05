## Migration Plan — Remaining TODOs Only

- tiktoken-based budgeting (replace heuristic):
  - Integrate `tiktoken` to estimate tokens for candidate input items using the model’s encoding.
  - Keep heuristic as a fallback when encoding is unavailable; add an env toggle `USE_TIKTOKEN=true|false`.
  - Make `INPUT_BUDGET_TOKENS` and `OUTPUT_HEADROOM_RATIO` adjustable at runtime; log effective limits per run.
  - Acceptance: budgeting logs include model encoding, estimated tokens, allowed input, reserved output; trimming decisions are reproducible.

- Thread summary generation/refresh:
  - Generate a compact `thread_summary` when trimming is triggered; refresh after N turns or when budget pressure recurs.
  - Persist via `ConversationStore.set_thread_summary(summary: str)` with a hard cap (e.g., 600–800 chars).
  - Acceptance: when K must be reduced, a summary is added/updated and included as a system item; total input fits within budget.

- State facts pipeline (tiny durable facts):
  - Provide minimal API to upsert/remove tiny `state_facts` (e.g., key-value or short list) with strict size limit (≤ 300 chars total).
  - Add simple aging/TTL and eviction policy; persist via `ConversationStore.set_state_facts`.
  - Acceptance: facts are bounded, survive turns, and appear as a single compact system item when enabled.

- Adaptation loop using usage metrics:
  - Use `UsageSnapshot` to auto-tune `last_k` and summary size per channel/thread (e.g., lower K when total_tokens high, raise when low).
  - Enforce safe bounds (`MIN_K`, `MAX_K`, `MIN_SUMMARY_CHARS`, `MAX_SUMMARY_CHARS`) with env overrides.
  - Acceptance: after several turns, logs show adaptive changes and stabilized parameters without exceeding budget.

- Usage analytics fallback for stream mode:
  - When streaming usage is missing, enable an optional non-streamed analytics pass or local estimator (feature-flagged).
  - Record and log derived usage so the adaptation loop remains functional in stream-only providers.
  - Acceptance: a run on a provider without streaming usage yields non-zero analytics metrics when the flag is on.


