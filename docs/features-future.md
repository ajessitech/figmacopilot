review @OpenAI Agents SDK  and use @Web  to figure out how i can introduct multimodal webbrowsing capability to my agent. so that i can do @ web or past @ url and it can get context 

## Chat Sessions: Unique Channel IDs, Auto-Discovery, New Chat, and History

### Current behavior snapshot
- **Plugin** (`plugin/ui.html`): `generateChannelId()` returns a constant `figma-copilot-default`, so multiple runs reuse the same channel.
- **Bridge** (`bridge/index.ts`): Routes messages 1:1 between exactly one `plugin` and one `agent` per `channel`.
- **Agent** (`backend/main.py`): Uses `SQLiteSession` keyed by channel, with `db_path=":memory:"`. As long as the agent process lives, the session persists for that channel.

### Goals
- **Unique channelId per run**: Eliminate cross-run collisions.
- **Agent auto-discovery/handshake**: Agent finds and joins the plugin’s channel without manual setup.
- **New Chat**: Button to start a fresh conversation.
- **Persistent chat history**: Users can revisit and resume previous chats (Cursor-like UX).

### Key concepts
- **channelId (ephemeral transport)**: A short-lived rendezvous identifier used by the bridge to pair one plugin and one agent during a live session.
- **chatId (durable conversation)**: A stable identifier for storing/retrieving conversation history and agent memory across sessions.
- **Join token (optional hardening)**: Short-lived secret authorizing both parties to join a channel.
- **User identity**: Minimal `figma.currentUser?.id` now; later upgrade to JWT/OAuth for multi-tenant auth and RLS.

### Approach 1: Orchestrated ephemeral agent per chat (recommended for "Cursor-like")
- **Flow**
  - Plugin generates `channelId` (crypto-random) on New Chat or when resuming.
  - Plugin calls a public Orchestrator API: `POST /chats` (new) or `POST /chats/{chatId}/connect` (resume) → returns `{ chatId, channelId, joinToken? }`.
  - Orchestrator boots an agent worker (serverless/container) with env `{ chatId, channelId, joinToken }`. Agent connects to the bridge as `agent` on that channel.
  - Plugin joins the same channel as `plugin`. Messages stream via the bridge; agent persists to DB keyed by `chatId`.
  - Resuming a chat always creates a fresh `channelId` while reusing the same `chatId`.
- **Pros**
  - Strong isolation, simple mental model, clean lifecycle per chat.
  - Naturally multi-tenant; elastic scalability.
- **Cons**
  - Cold starts, orchestration complexity, infra cost per worker.

### Approach 2: Single long-lived agent handling many channels via a Registry (no bridge changes)
- **Flow**
  - Plugin generates `channelId`, registers a join request `{ chatId, channelId, joinToken? }` with a public Registry API (HTTP).
  - Agent runs a watcher loop (polling or pub/sub) to claim join requests, opens a new WebSocket connection to the bridge, and joins as `agent` on that channel.
  - Agent persists messages keyed by `chatId` (not `channelId`).
- **Pros**
  - Cost-efficient; leverages a single agent process; no bridge changes.
- **Cons**
  - One process multiplexes many sockets; careful resource management and backpressure needed.
  - Requires a small external Registry service reachable by both plugin and agent.

### Approach 3: Bridge-level control-plane (agent pool) with request routing (bridge changes)
- **Flow**
  - Agent connects once as a special manager/pool.
  - Plugin joins its channel and sends a control message (e.g., `request_agent`) via the bridge with `{ chatId, channelId, joinToken? }`.
  - Bridge forwards the control message to the agent manager; the agent opens a second socket to join that plugin’s channel as `agent`.
- **Pros**
  - No extra external services beyond the bridge.
  - Low-latency rendezvous.
- **Cons**
  - Protocol/role changes to the bridge; larger security surface.
  - Makes the bridge both data-plane and control-plane.

### Recommended separation: channelId vs chatId
- **Do not reuse channelId** across runs; treat it purely as transport.
- **Persist by chatId**: Agent memory and messages should be keyed by `chatId`, not `channelId`.

### Data model (server-side)
- **users**: `id`, `figma_user_id`, `created_at`
- **chats**: `id`, `user_id`, `title`, `created_at`, `updated_at`, `last_message_at`
- **messages**: `id`, `chat_id`, `role`, `content`, `tool_calls`, `annotations`, `created_at`
- Optional **runs**: `id`, `chat_id`, `channel_id`, `started_at`, `ended_at`, `status` (audit/debug)

### UI/UX
- **New Chat button**: Creates a new `chatId`, generates a fresh `channelId`, connects, and clears the transcript panel.
- **Chat switcher**: Lists prior chats (title defaults to first user message; editable). Selecting a chat creates a fresh `channelId` bound to the existing `chatId` and rehydrates transcript from server.
- **Local caching**: Optionally cache chat list in `clientStorage` for fast UI; server remains source of truth.

### Handshake specifics
- **Plugin**
  - Creates or selects a `chatId` via API.
  - Generates (or receives) a `channelId` and optional `joinToken`.
  - Joins the bridge as `plugin` with `{ type: 'join', role: 'plugin', channel: channelId }` (extend later to include `joinToken`).
- **Agent**
  - Approach 1: Worker launches with `{ chatId, channelId, joinToken }` and immediately joins as `agent`.
  - Approach 2: Watches the Registry, then joins the requested `channelId` as `agent`.
  - Approach 3: Receives a `request_agent` via the bridge and joins the plugin’s channel as `agent`.
- **On connect**: Both sides verify they agree on `chatId` and protocol version before streaming user messages.

### Security and auth
- **Unpredictable channelIds** (crypto-random) to mitigate guessing.
- **Join tokens** (short-lived) presented by both agent and plugin to the bridge (future hardening).
- **User identity**: Start with `figma.currentUser?.id`; upgrade to JWT/OAuth for RLS and per-user access to chats.
- **Rate limiting and quotas** per user or per organization.

### Operational considerations
- **Scaling**: 
  - Approach 1 scales by workers. 
  - Approach 2 scales a single agent process; consider sharding by user or chat count.
- **Observability**: Collect per-chat logs, latency metrics, token usage, and tool-call outcomes keyed by `chatId` and `channelId`.
- **Lifecycle/cleanup**: Bridge already cleans idle channels; also tidy stale Registry entries (Approach 2) and expired join tokens.
- **Storage**: Start with Postgres/Supabase; evolve to cold archive for long-lived chats.

### Migration path (incremental)
- **Phase A**: Split `chatId` vs `channelId`. Persist agent memory by `chatId` (file-backed SQLite or Postgres). Add “New Chat” in the UI to allocate a new `chatId` and `channelId`.
- **Phase B**: Introduce server-side `messages` DB and a Chat List API; show history and resume flows in the UI.
- **Phase C**: Add discovery/auto-join:
  - Start with Approach 2 (Registry) for minimal bridge changes; or
  - Jump to Approach 1 (Orchestrator) if isolation is preferred.
- **Phase D**: Hardening (join tokens, auth, rate limits) and production observability.