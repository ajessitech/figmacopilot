Moving from a generic MCP layer to a direct, dedicated agent-to-plugin architecture simplifies the system, reduces latency, and allows for tighter integration.

Here is the `architecture.md` and `plan.md` for converting your system into a minimal, direct-control agent.

***

### **`architecture.md`**

## **Architecture: Direct-Control Figma Agent**

### **1. Executive Summary**

This document outlines a simplified, high-performance architecture for a Figma design copilot. We are replacing the Model Context Protocol (MCP) abstraction layer with a direct, dedicated communication channel between a backend AI agent (built with the OpenAI Agents SDK) and a lightweight Figma plugin.

This direct-control model treats the Figma plugin as a set of "remote hands" (an RPC server), while the backend agent acts as the "brain," performing all planning, reasoning, and tool invocation. Communication is handled by a lean WebSocket bridge, ensuring low-latency, stateful interaction. The initial goal is to implement the functionality required to execute a user's request to "create a button."

### **2. Core Principles**

*   **Simplicity & Performance:** By removing the MCP middleman, we reduce complexity and network overhead, leading to faster, more responsive actions.
*   **Clear Separation of Concerns:**
    *   **Agent (Brain):** Handles all reasoning, planning, and language understanding. It is environment-agnostic and knows nothing about the Figma DOM.
    *   **Plugin (Hands):** A "dumb" but capable executor. It knows how to perform atomic Figma API actions but makes no decisions.
*   **Idempotent & Atomic Tools:** Agent tools correspond to simple, repeatable actions in Figma (`create_frame`, `set_fill_color`). This makes the system resilient and easier to debug.
*   **Direct RPC over WebSockets:** The agent's tools are implemented as RPC clients that send commands to the Figma plugin, which acts as the RPC server.

### **3. System Components & Data Flow**

The architecture consists of three core components connected in a linear flow.

```
+--------------------------+           +-------------------------+           +----------------------------+
|  Figma Plugin (UI &      |           |   WebSocket Bridge      |           |  Agent Backend (Python)    |
|  Executor)               |           |   (Bun/TypeScript)      |           |  (OpenAI Agents SDK)       |
|                          |           |                         |           |                            |
|  - User Input Field      <-----------> - Routes messages       <-----------> - Main Agent (Planner)       |
|  - Renders Agent Status  |           - Manages channels        |           | - Function Tools (RPC Calls) |
|  - Executes Figma API    |           - Connects Plugin <> Agent|           | - WebSocket Client         |
+--------------------------+           +-------------------------+           +----------------------------+
```

#### **A. The Agent Backend (Python)**

*   **Framework:** OpenAI Agents SDK.
*   **Core:** A primary `Agent` responsible for interpreting the user's prompt and orchestrating the task.
*   **Tools (`@function_tool`):** The core of the refactor. Instead of exposing tools via an MCP server, we define standard Python functions decorated with `@function_tool`.
    *   **Crucially, these tool functions DO NOT contain Figma logic.** They are thin clients that serialize a command and send it to the WebSocket Bridge. They then `await` a response from the plugin before returning the result to the agent.
*   **Communication:** A Python WebSocket client library (e.g., `websockets`) connects to the WebSocket Bridge.

#### **B. The WebSocket Bridge (Bun/TypeScript)**

*   **Role:** A simple, high-performance message router. It is the spiritual successor to `socket.ts`.
*   **Functionality:**
    1.  Listens for incoming connections from both the Figma Plugin and the Python Agent Backend.
    2.  Uses a "channel" system (as in the original `socket.ts`) to pair one plugin instance with one agent instance.
    3.  Receives a message from one client (e.g., a `user_prompt` from the plugin) and forwards it to the other client on the same channel.
    4.  Receives a `tool_call` from the agent backend and forwards it to the plugin.
    5.  Receives a `tool_response` from the plugin and forwards it back to the agent backend.

#### **C. The Figma Plugin (TypeScript/HTML)**

*   **UI (`ui.html`):** Modified to include a user input field, a "send" button, and a display area for agent status/responses. The existing WebSocket client logic is adapted to send user prompts and handle incoming tool calls.
*   **Executor (`code.js`):** The existing `handleCommand` function is perfectly suited for its new role as an RPC endpoint. It requires minimal changes. It receives a command from the UI (forwarded by the bridge), executes the corresponding Figma API call, and posts the result (`command-result` or `command-error`) back to the UI, which then sends it back over the WebSocket.

### **4. Communication Protocol (JSON)**

A simple, explicit JSON protocol will govern communication:

1.  **User Prompt (Plugin -> Agent):**
    ```json
    { "type": "user_prompt", "id": "uuid1", "prompt": "Create a blue button that says 'Submit'" }
    ```
2.  **Tool Call (Agent -> Plugin):**
    ```json
    { "type": "tool_call", "id": "uuid2", "command": "create_frame", "params": { ... } }
    ```
3.  **Tool Response (Plugin -> Agent):**
    ```json
    // Success
    { "type": "tool_response", "id": "uuid2", "result": { "id": "123:456", ... } }
    // Error
    { "type": "tool_response", "id": "uuid2", "error": "Node not found" }
    ```
4.  **Agent Response (Agent -> Plugin):** (For streaming thoughts or final confirmation)
    ```json
    { "type": "agent_response", "id": "uuid1", "content": "Okay, I'm creating the button frame now." }
    ```

### **5. Example Flow: "Create a button"**

1.  **User:** Runs the plugin. The plugin UI connects to the WebSocket Bridge, joins a channel, and waits. The Python Agent Backend is also running and connected to the same channel.
2.  **User:** Types "Create a primary button that says 'Click me'" into the plugin UI and clicks "Send".
3.  **Plugin UI:** Sends a `user_prompt` message to the WebSocket Bridge.
4.  **Bridge:** Forwards the message to the Agent Backend.
5.  **Agent:** Receives the prompt. The LLM reasons: "To create a button, I need a frame for the body and a text node for the label. I should use the `create_button` tool."
6.  **Agent:** Calls its internal `create_button(text="Click me", type="primary")` tool.
7.  **`create_button` Tool (Python):**
    a. Sends a `tool_call` message (`command: "create_frame", params: { ... }`) to the bridge.
    b. Awaits the response.
    c. Receives the `tool_response` with the new frame's ID (`"123:456"`).
    d. Sends a `tool_call` message (`command: "create_text", params: { text: "Click me", parentId: "123:456" }`).
    e. Awaits and receives the response.
    f. Sends subsequent `tool_call` messages for styling (`set_fill_color`, `set_corner_radius`, etc.).
    g. Once all steps are complete, the tool returns a success message to the agent.
8.  **Agent:** Receives the tool's success message and formulates a final response.
9.  **Agent:** Sends an `agent_response` message to the bridge: `"Done! I've created the button for you."`
10. **Bridge:** Forwards the final response to the Plugin UI, which displays it to the user.

***

### **`plan.md`**

## **Migration Plan: From MCP to Direct-Control Agent**

This plan details the phased migration from the current MCP-based architecture to a simplified, direct-control agent architecture. The goal is a working proof-of-concept capable of creating a button in Figma based on a user prompt from within the plugin's UI.

### **Definition of Done**

A user can open the Figma plugin, type "Create a blue button with the text 'Submit'", and see the corresponding button created on the Figma canvas. The agent's final confirmation message is displayed in the plugin UI.

---

### **Phase 1: Backend Refactoring - Creating the Agent's Brain**

**Goal:** Replace the Node.js MCP server (`server.ts`) with a Python-based agent using the OpenAI Agents SDK.

1.  **Setup Python Environment:**
    *   Create a new Python project (`/backend` or similar).
    *   Initialize a virtual environment (`python -m venv .venv`).
    *   Install necessary libraries: `pip install openai-agents websockets`.

2.  **Define the Core Agent:**
    *   Create a `main.py` file.
    *   Define the main `Agent` with instructions geared towards Figma design tasks.

3.  **Implement the Communication Layer:**
    *   Create a `figma_communicator.py` module.
    *   This module will manage the WebSocket connection to the Bun Bridge.
    *   Implement a core function: `async def send_command_to_figma(command: str, params: dict) -> dict:`. This function will send a `tool_call` message over the socket and `await` a `tool_response`. It will handle message IDs to correlate requests and responses.

4.  **Translate MCP Tools to Python Function Tools:**
    *   Create a `figma_tools.py` module.
    *   For each required command in `code.js` (e.g., `create_frame`, `create_text`, `set_fill_color`), create a corresponding Python function decorated with `@function_tool`.
    *   **Example Translation (`create_rectangle`):**

        *   **Old (MCP - `server.ts`):**
            ```typescript
            server.tool(
              "create_rectangle",
              "Create a new rectangle in Figma",
              { /* z.object schema */ },
              async (params) => {
                const result = await sendCommandToFigma("create_rectangle", params);
                return { content: [{ type: "text", text: JSON.stringify(result) }] };
              }
            );
            ```

        *   **New (Direct Agent Tool - `figma_tools.py`):**
            ```python
            from agents import function_tool
            from .figma_communicator import send_command_to_figma

            @function_tool
            async def create_rectangle(x: int, y: int, width: int, height: int, name: str = "Rectangle") -> str:
                """Creates a new rectangle in Figma at the specified coordinates and dimensions."""
                params = {"x": x, "y": y, "width": width, "height": height, "name": name}
                result = await send_command_to_figma("create_rectangle", params)
                if result.get("error"):
                    return f"Error creating rectangle: {result['error']}"
                return f"Successfully created rectangle with ID: {result.get('id')}"
            ```
5.  **Create a High-Level Composite Tool:**
    *   In `figma_tools.py`, create a composite tool like `create_button(text: str, color: str)`.
    *   This tool will call the other, more granular tools (`create_frame`, `create_text`, etc.) in sequence, demonstrating the agent's ability to execute a multi-step plan within a single tool call.

### **Phase 2: Bridge Adaptation - The Message Switchboard**

**Goal:** Modify the existing `socket.ts` to route messages between the Python backend and the Figma plugin.

1.  **Simplify `socket.ts`:** Remove any MCP-specific logic. The server's only job is to manage channels and forward messages.
2.  **Implement Routing Logic:**
    *   When a message is received, check its `type`.
    *   If `type` is `user_prompt`, forward it from the plugin to the agent.
    *   If `type` is `tool_call`, forward it from the agent to the plugin.
    *   If `type` is `tool_response`, forward it from the plugin to the agent.
    *   If `type` is `agent_response`, forward it from the agent to the plugin.
    *   Ensure messages are only sent to the other client within the *same channel*.

### **Phase 3: Plugin UI/UX Enhancement**

**Goal:** Adapt the Figma plugin to serve as the primary user interface for the agent.

1.  **Modify `ui.html`:**
    *   Add an `<input type="text">` for the user's prompt.
    *   Add a `<button>` to send the prompt.
    *   Add a `<div>` to display status updates and final responses from the agent.
2.  **Update UI Logic (`<script>` block in `ui.html`):**
    *   On button click, grab the input value and construct a `user_prompt` JSON message.
    *   Send this message via the existing `state.socket.send()`.
    *   In the `state.socket.onmessage` handler, add logic to handle incoming messages:
        *   If `type` is `agent_response`, display the `content` in the response `div`.
        *   If `type` is `tool_call`, pass the message to the plugin's main thread (`code.js`) for execution using `parent.postMessage`.
3.  **Adapt `code.js`:**
    *   The `handleCommand` function is already well-suited to act as an RPC endpoint. No major changes are needed here.
    *   Ensure the `figma.ui.onmessage` handler correctly receives `tool_call` messages and passes them to `handleCommand`.
    *   Ensure the `command-result` and `command-error` messages posted back to the UI are then sent back over the WebSocket as `tool_response` messages.

### **Phase 4: Integration and Testing**

**Goal:** Run all three components and validate the end-to-end flow.

1.  **Run Services:**
    *   Start the WebSocket Bridge: `bun run socket.ts`.
    *   Start the Agent Backend: `python main.py`.
    *   Run the development plugin in Figma.
2.  **Test Case:**
    *   In the plugin UI, type: "Create a button".
    *   Click "Send".
3.  **Expected Outcome:**
    *   A default-styled frame with the text "Button" appears on the canvas.
    *   A confirmation message appears in the plugin UI.
4.  **Debugging:**
    *   Use `console.log` extensively in the plugin's `code.js` and `ui.html`.
    *   Use `console.log` in the Bun `socket.ts` to trace message flow.
    *   Use `print()` statements in the Python backend to see agent reasoning and tool calls.

### **Phase 5: Containerization – One-Click Development & Test Environment**

**Goal:** Provide a single Docker image that bundles **all server-side pieces** (Python Agent backend + Bun WebSocket Bridge) so contributors can spin up the system with *one* command. The Figma Plugin still runs inside the Figma desktop app, but it can now connect to the bridge running in Docker on `localhost:3000`.

#### **A. Dockerfile (root of repo)**

```Dockerfile
# --- Base image with both Bun (Node runtime) and Python 3.11 -----------------
FROM oven/bun:1.1 AS base

# Install Python and pip (oven/bun images are Debian-based)
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends python3 python3-venv python3-pip && \
    rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN adduser --disabled-password --gecos "" app
USER app
WORKDIR /app

# -------------------------- Install dependencies ----------------------------
COPY --chown=app package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY --chown=app src/ src/

# Python deps live in /app/py
COPY --chown=app backend/requirements.txt backend/
RUN python3 -m venv /app/py && \
    /app/py/bin/pip install --no-cache-dir -r backend/requirements.txt

# --------------------------- Runtime commands ------------------------------
# Expose the WebSocket bridge port
EXPOSE 3000

# Use tini for proper signal forwarding
RUN bun add -g tini@latest

# Entrypoint launches the bridge and agent in parallel
#   • bun run socket.ts  (Bun WebSocket bridge)
#   • python main.py     (Python agent)
# We rely on `bash -c` & `wait` so both processes share the same container.
ENTRYPOINT ["tini", "--", "bash", "-c", "bun run src/socket.ts & /app/py/bin/python backend/main.py"]
```

**Why a single container?**  –  The bridge and agent have no conflicting runtimes once Bun and Python live side-by-side. Keeping them together avoids Docker-Compose complexity and guarantees they share `localhost` for quick IPC.

#### **B. Build & Run**

```bash
# 1. Build the image
docker build -t figma-agent .

# 2. Run it, mapping the bridge port so the plugin can reach it
docker run --rm -it -p 3000:3000 figma-agent
```

You should see two logs interleaved:
1. `bun run socket.ts` printing "Bridge listening on :3000".
2. `python main.py` printing "Agent ready, awaiting user prompts…".

#### **C. Connecting the Figma Plugin**

1. Load/start the development version of the plugin inside Figma.
2. Ensure the plugin’s WebSocket URL is `ws://localhost:3000` (already the default in `ui.html`).
3. With the Docker container running, type "Create a button" in the plugin UI – the full two-way flow should execute.

> **Note:** If you run Docker on macOS with Docker Desktop, `localhost` maps correctly. On Linux you may need to allow external connections if Figma runs on a different machine – adjust the `-p` flag accordingly.

#### **D. Live-Reload (Optional for Devs)**

During active development, use *two* containers:

*One* container for the bridge (`bun --hot src/socket.ts`) and *one* for the agent (`ptvsd` or `watchdog` reload). For the MVP we keep the Dockerfile minimal; feel free to add `air`/`fresh`/`nodemon` inside a derived image.

---

### **Next Steps (Post-MVP)**

*   Implement streaming of agent thoughts/actions to the plugin UI for a better user experience.
*   Build more sophisticated, multi-step composite tools (e.g., `create_login_form`).
*   Enhance error handling and retry logic within the Python tools.

---

## **Incremental Connection Roadmap **

> This supersedes earlier high-level descriptions with **strict, testable milestones** focused on the WebSocket protocol and tooling. Each phase must pass its success criteria before the next begins.

### **Phase 1 — Chat-Only Round-Trip**

**Objective:** Prove the two-way WebSocket path between **Plugin ⇄ Bridge ⇄ Agent** with the smallest possible surface area – plain text echo via an LLM.

Component work:
1. **Plugin (UI & client)**
   *   `ui.html` contains:
       *   `<input id="prompt" placeholder="Ask…" />`
       *   `<button id="send">Send</button>`
       *   `<pre id="log"></pre>` (auto-scrolling)
   *   On load, attempts `new WebSocket(getWSURL())` where `getWSURL()` returns:
       *   `ws://localhost:3000` by default.
       *   If running inside Figma desktop (no origin access), allow override via hidden settings (`?bridge=<url>` query param).
   *   **Handshake:** Immediately send
     ```json
     { "type": "hello", "role": "plugin", "channel": "${uuid}" }
     ```
   *   On send button click:
     ```json
     { "type": "user_prompt", "id": "${uuid}", "prompt": "…" }
     ```
   *   On `agent_response` append to `#log`.

2. **Bridge (Bun `socket.ts`)**
   *   Maintains `Map<channel, { plugin?: ws, agent?: ws }>`.
   *   Forwards all non-hello frames to *the opposite role* in same channel.
   *   30-second `ping` / `pong` heartbeat; if a client misses 2 heartbeats it is pruned and counterpart is closed with 4408 code (`peer-gone`).
   *   Structured logging: `console.info(JSON.stringify({ dir:"→", type, channel }))` for replay in Kibana later.

3. **Agent (Python `echo_agent.py`)**
   *   Env: `BRIDGE_URL=ws://bridge:3000`, `OPENAI_API_KEY=…`.
   *   Connect, send `hello` with `role=agent` + same `channel` (passed via CLI arg).
   *   On `user_prompt` call OpenAI `chat.completions` with `system="Echo the user exactly."` and return result:
     ```json
     { "type": "agent_response", "id": "${orig.id}", "content": "You said: …" }
     ```

🔎 **Acceptance Tests**
*   Manual: run bridge, agent, load plugin, send "Ping" → receive "You said: Ping".
*   Automated (optional): Cypress test harness that injects WebSocket mock.

### **Phase 2 — One-Click Docker Developer Bundle**

**Objective:** Encapsulate Phase 1 bridge + agent inside a single Docker image so newcomers only `docker run -p 3000:3000 figma-agent` and then load the plugin.

Tasks:
1. **Finalize Dockerfile** (see Phase 5 below, but entrypoint points to `echo_agent.py`).
2. Provide `scripts/dev.sh` that rebuilds image, prints final instructions, and tails logs.
3. Document proxy / firewall caveats in `docs/troubleshooting.md`.

🚦 **Success Criteria**
*   Fresh checkout → `docker build && docker run` → Plugin chat round-trip works in ≤5 min on macOS + Windows + Linux.

### **Phase 3 — First Atomic Tool: `create_frame`**

**Objective:** Extend protocol to support a single tool call so the agent can create a frame in Figma and handle success or error.

Protocol additions:
* **Tool Call** Agent → Plugin:
  ```json
  { "type": "tool_call", "id": "${uuid}", "command": "create_frame", "params": { "x": 0, "y": 0, "width": 120, "height": 40 } }
  ```
* **Tool Response** Plugin → Agent (success):
  ```json
  { "type": "tool_response", "id": "${same}", "result": { "nodeId": "456:789" } }
  ```
* **Tool Response** (error):
  ```json
  { "type": "tool_response", "id": "${same}", "error": "Node not found" }
  ```

Implementation steps:
1. **Plugin Executor (`code.js`)** – Map `command` to existing frame API, return result/error.
2. **Agent Tool (`figma_tools.py`)**
   ```python
   @function_tool
   async def create_frame(x:int=0,y:int=0,width:int=100,height:int=40,name:str='Frame') -> str:
       resp = await send_command_to_figma('create_frame', locals())
       if 'error' in resp:
           raise RuntimeError(resp['error'])
       return resp['result']['nodeId']
   ```
3. **Agent Logic** – On any user prompt, *always* attempt `create_frame` as smoke test.
4. **Retry Strategy** – If bridge disconnects mid-tool, retry once with same `id` but `retryCount++` header.

🧪 **Success Criteria**
*   User types "make a frame" → Frame appears at (0,0) in Figma.
*   If plugin throws error, agent surfaces it in UI and retries once.

### **Phase 4 — Composite Tool: `create_button` MVP**

Builds on Phase 3 – adds additional atomic tools (`create_text`, `set_fill_color`, etc.) and a composite high-level tool to fulfil the original button request. Detailed steps mirror previous description and are left for future work once Phase 3 is rock-solid.

---