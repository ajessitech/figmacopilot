

## **Implementation Plan: Direct-Control Figma Agent**

This document outlines the phased implementation of a direct-control Figma agent. The goal is to replace the current MCP-based architecture with a simplified, high-performance system where a Python AI agent directly controls the Figma plugin via a WebSocket bridge.

The plan is structured as a series of iterative, testable milestones. Each phase builds upon the last, ensuring a stable foundation and clear progress.

### **Definition of Done (MVP)**

A user can open the Figma plugin, type "Create a blue button with the text 'Submit'", see the corresponding button created on the Figma canvas, and receive a confirmation message in the plugin UI.

---

### **Phase 0: Foundation & Environment Setup**

**Objective:** Establish a reproducible, one-command development environment using Docker to encapsulate all server-side components (Bridge & Agent). This ensures a consistent setup for all developers.

**1. Standardize Project Structure:**
Organize the repository into clear, distinct components:
```
/
├── backend/              # Python Agent (the "brain")
│   ├── main.py
│   ├── figma_tools.py
│   └── figma_communicator.py
├── bridge/               # Bun WebSocket Bridge (replaces top-level socket.ts)
│   └── index.ts
├── plugin/               # Figma Plugin files (ui.html, code.js)
│   ├── ui.html
│   └── code.js
├── scripts/              # Helper scripts for development
│   └── dev.sh
├── Dockerfile            # Single Dockerfile for all server components
└── README.md
```

**2. Dockerize the Server Environment:**
Create a single `Dockerfile` that builds an image containing both the Bun runtime for the WebSocket bridge and the Python runtime for the agent.

*   **Rationale:** A single container simplifies the developer experience, eliminates the need for `docker-compose`, and guarantees the bridge and agent can communicate seamlessly over `localhost` within the container network.

*   **`Dockerfile`:**
    ```Dockerfile
    # Stage 1: Base image with Bun and Python
    FROM oven/bun:1.1 AS base
    WORKDIR /app

    # Install Python, venv, and pip
    RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip && \
        rm -rf /var/lib/apt/lists/*

    # Create a non-root user for security
    RUN useradd --create-home --shell /bin/bash app
    USER app

    # Stage 2: Install Bridge Dependencies
    COPY --chown=app:app bridge/package.json bridge/bun.lockb ./bridge/
    RUN cd bridge && bun install --frozen-lockfile

    # Stage 3: Install Agent Dependencies
    COPY --chown=app:app backend/requirements.txt ./backend/
    RUN python3.11 -m venv /app/venv && \
        /app/venv/bin/pip install --no-cache-dir -r backend/requirements.txt

    # Stage 4: Copy Source Code and Finalize
    COPY --chown=app:app bridge/ ./bridge/
    COPY --chown=app:app backend/ ./backend/

    # Expose the WebSocket bridge port
    EXPOSE 3055

    # Use tini to manage subprocesses gracefully
    ENV TINI_VERSION v0.19.0
    ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
    RUN chmod +x /tini
    ENTRYPOINT ["/tini", "--"]

    # Start both the bridge and the agent in parallel
    CMD ["bash", "-c", "bun run bridge/index.ts & /app/venv/bin/python backend/main.py & wait -n"]
    ```

**3. Create Development Script:**
Implement a `scripts/dev.sh` to automate the build-and-run process.
```bash
#!/bin/bash
echo "Building Docker image: figma-agent..."
docker build -t figma-agent .

echo "Starting container... Bridge will be available on localhost:3055"
docker run --rm -it -p 3055:3055 --name figma-agent-container figma-agent
```

**✅ Success Criteria for Phase 0:**
*   A developer can clone the repo, run `./scripts/dev.sh`, and see interleaved logs from both the Bun bridge and the Python agent starting up successfully. The container exposes port `3055`.

---

### **Phase 1: Advanced Chat with OpenAI Agents SDK** ✅ **COMPLETED**

**Objective:** Implement a sophisticated AI-powered chat system using the OpenAI Agents SDK with real-time streaming responses and persistent conversation history.

#### **What We Actually Built:**

**1. Bridge (`bridge/index.ts`):** ✅ **IMPLEMENTED**
*   Complete WebSocket message router supporting multiple message types
*   **Channel Management:**
    *   `Map<channelId, { plugin: WebSocket, agent: WebSocket }>` for connection tracking
    *   Join protocol: `{"type": "join", "role": "plugin" | "agent", "channel": "channelId"}`
    *   Message forwarding between roles in the same channel
    *   Graceful disconnection handling and cleanup
*   **Message Types Supported:**
    *   `join` - Connection establishment
    *   `user_prompt` - User messages to agent
    *   `agent_response` - Complete agent responses  
    *   `agent_response_chunk` - **NEW**: Real-time streaming chunks
    *   `tool_call` / `tool_response` - Ready for Phase 2
    *   `ping` / `pong` - Connection health monitoring
    *   `system` / `error` - Status and error handling

**2. Agent (`backend/main.py`):** ✅ **IMPLEMENTED WITH MAJOR ENHANCEMENTS**
*   **OpenAI Agents SDK Integration:**
    *   Using `gpt-4.1-nano` model for optimal performance
    *   `Agent` class with comprehensive Figma-specific instructions
    *   `Runner.run_streamed()` for real-time response streaming
    *   Proper async event loop management for streaming
*   **SQLiteSession for Persistent Context:**
    *   Channel-specific conversation history using `SQLiteSession`
    *   In-memory database for container environments  
    *   Conversation continuity across messages
    *   Context-aware responses that reference previous interactions
*   **Real-time Streaming Implementation:**
    *   `stream_events()` iteration for live response generation
    *   Individual word/phrase streaming via `agent_response_chunk` messages
    *   Complete response finalization with `agent_response`
    *   Proper error handling and event loop management
*   **Synchronous Architecture:**
    *   Eliminated async/await complexity in main logic
    *   Event loop only for Agents SDK streaming requirements
    *   Clean WebSocket client using `websocket-client` library
    *   Robust reconnection logic with exponential backoff

**3. Plugin (`plugin/ui.html` & `plugin/code.js`):** ✅ **IMPLEMENTED**
*   **Modern Chat UI:**
    *   Clean chat interface with message history
    *   Real-time streaming with visual typing cursor (`▋`)
    *   Timestamped messages with role-based styling
    *   Connection status indicators
*   **Streaming Support:**
    *   `handleStreamingChunk()` for real-time text accumulation
    *   `finalizeStreamingMessage()` for completion handling
    *   Visual feedback during response generation
*   **WebSocket Management:**
    *   Automatic connection to `ws://localhost:3055`
    *   Proper message protocol implementation
    *   Error handling and reconnection support

#### **Technical Architecture Achievements:**

**🐳 Containerized Development Environment:**
*   Python 3.11 slim base image for modern language features
*   Bun runtime for high-performance bridge
*   Single-container deployment with proper signal handling
*   Optimized dependency caching and build process

**🚀 Performance Optimizations:**
*   Real-time streaming for immediate user feedback
*   Efficient message forwarding with minimal latency
*   Persistent conversation context without performance overhead
*   Optimized Docker layers for fast rebuilds

**🧠 AI Integration:**
*   OpenAI Agents SDK for enterprise-grade agent management
*   Environment-driven model configuration (`OPENAI_MODEL=gpt-4.1-nano`)
*   Comprehensive system prompts for Figma-specific assistance
*   Context-aware responses using SQLiteSession

**✅ Current Success Criteria (Enhanced):**
*   ✅ Developer runs `./scripts/dev.sh` - single command setup
*   ✅ Plugin connects automatically to bridge on startup
*   ✅ User types messages and sees **real-time streaming responses**
*   ✅ Agent provides **context-aware follow-up responses**
*   ✅ Conversation history maintained throughout session
*   ✅ Agent responds as Figma design expert with helpful guidance

#### **Message Flow Example:**
```
User: "How do I create a button in Figma?"
Agent: [Streams in real-time] "To create a button in Figma, you can..."

User: "What about styling it?"  
Agent: [Remembers context] "For styling the button we just discussed..."
```

---

### **Channel Coordination**

For Phase 1, both the plugin and agent use a fixed channel name `figma-copilot-default` to ensure they can communicate:

**Agent Channel Selection:**
- Default: `figma-copilot-default` (hardcoded in `backend/main.py`)
- Override: Set `FIGMA_CHANNEL` environment variable or use `--channel=<name>` CLI argument
- Fallback: Auto-generates `agent-{uuid}` if no channel specified

**Plugin Channel Selection:**
- Uses the same fixed channel: `figma-copilot-default` (hardcoded in `plugin/ui.html`)
- This ensures both components join the same channel for communication

**Future Improvements:**
- Phase 2+ will implement dynamic channel coordination
- Plugin could discover agent channels or vice versa
- Support for multiple concurrent agent sessions

---

### **Phase 2: The First Atomic Tool (`create_frame`)**

**Objective:** Implement the full RPC (Remote Procedure Call) flow for a single, atomic Figma action. This proves the agent can command the plugin to perform a task and receive a result.

**1. Protocol Expansion:**
Define the message types for tool communication:
*   **Tool Call (Agent -> Plugin):**
    ```json
    { "type": "tool_call", "id": "uuid", "command": "create_frame", "params": { ... } }
    ```
*   **Tool Response (Plugin -> Agent):**
    ```json
    // Success
    { "type": "tool_response", "id": "uuid", "result": { "nodeId": "123:456" } }
    // Error
    { "type": "tool_response", "id": "uuid", "error": "Node not found" }
    ```

**2. Agent (`backend/`):**
*   **`figma_communicator.py`:** Create a module to manage the RPC flow.
    *   Implement `async def send_command(command, params)` which:
        1.  Generates a unique message `id`.
        2.  Sends the `tool_call` message over the WebSocket.
        3.  Stores the `id` and an `asyncio.Future` in a pending requests map.
        4.  `await`s the future, which will be resolved when a matching `tool_response` arrives.
*   **`figma_tools.py`:** Define the first tool.
    ```python
    from agents import function_tool
    from .figma_communicator import send_command

    @function_tool
    async def create_frame(width: int, height: int, x: int = 0, y: int = 0) -> str:
        """Creates a new frame in Figma."""
        params = locals() # Helper to get all args as a dict
        result = await send_command("create_frame", params)
        if "error" in result:
            return f"Error: {result['error']}"
        return f"Frame created with ID: {result['result']['nodeId']}"
    ```
*   **`main.py`:** Update the agent logic. When a user prompt includes "frame", call the `create_frame` tool.

**3. Bridge (`bridge/index.ts`):**
*   Update the routing logic to forward `tool_call` and `tool_response` messages between the agent and plugin.

**4. Plugin (`plugin/`):**
*   **`ui.html`:** The `socket.onmessage` handler must now check for `type: "tool_call"` and pass the message to `code.js` using `parent.postMessage`.
*   **`code.js`:**
    *   The `figma.ui.onmessage` handler receives the `tool_call`.
    *   A simple router or `switch` statement calls the appropriate Figma API function based on `message.command`.
    *   After the Figma API call completes, `postMessage` back to `ui.html` with the result or error, including the original `id`.
*   **`ui.html`:** The `window.onmessage` handler (receiving from `code.js`) must now wrap the result in a `tool_response` JSON object and send it back over the WebSocket.

**✅ Success Criteria for Phase 2:**
*   The user types "create a 100x100 frame" into the plugin UI.
*   A 100x100 frame appears on the Figma canvas.
*   The agent responds in the UI with a confirmation message like "Frame created with ID: 123:456".

---

### **Phase 3: The Composite Tool (`create_button`) & MVP Completion**

**Objective:** Fulfill the project's Definition of Done by creating a high-level, multi-step tool that demonstrates the agent's ability to orchestrate a sequence of atomic actions.

**1. Agent (`backend/figma_tools.py`):**
*   **Add New Atomic Tools:** Implement the following required `@function_tool`s, following the pattern from Phase 2:
    *   `create_text(text: str, parentId: str, ...)`
    *   `set_fill_color(nodeId: str, r: float, g: float, b: float)`
    *   `set_corner_radius(nodeId: str, radius: int)`
    *   `create_frame(...)` (already exists)
    *   (Add others as needed for layout, strokes, etc.)
*   **Implement the Composite Tool:** Create the main `create_button` tool. This tool does *not* send its own WebSocket messages; it calls the other atomic tools.
    ```python
    from agents import function_tool
    # ... import other atomic tools

    @function_tool
    async def create_button(text: str, color: str = "blue") -> str:
        """Creates a complete, styled button component in Figma."""
        # 1. Create the main frame
        frame_id_str = await create_frame(width=120, height=40)
        frame_id = frame_id_str.split(": ")[-1] # Extract ID from response

        # 2. Set the color
        # (Add logic to parse 'color' string into RGB values)
        await set_fill_color(nodeId=frame_id, r=0.1, g=0.4, b=0.9)
        await set_corner_radius(nodeId=frame_id, radius=8)

        # 3. Create and add the text
        await create_text(text=text, parentId=frame_id)
        # (Add more tool calls here for centering text, etc.)

        return f"Successfully created a '{text}' button."
    ```

**2. Plugin (`plugin/code.js`):**
*   Add handlers for the new atomic commands (`create_text`, `set_fill_color`, etc.) to the command router. The existing RPC mechanism will handle the rest.

**3. Agent (`backend/main.py`):**
*   Integrate a proper LLM (e.g., via the OpenAI SDK).
*   Provide the agent with a system prompt explaining its purpose as a Figma copilot and give it access to all the function tools.
*   The main loop now passes the user prompt to the LLM and executes any tool calls it requests.

**✅ Success Criteria for Phase 3 (MVP Complete):**
*   The user types "Create a blue button with the text 'Submit'" into the plugin UI.
*   The agent correctly calls the `create_button` tool.
*   A styled blue frame with a corner radius appears on the Figma canvas containing a centered text node that says "Submit".
*   The agent responds in the UI with "Successfully created a 'Submit' button."

---

### **Next Steps (Post-MVP)**

*   **Streaming & Real-time Feedback:** Stream the agent's thoughts and actions to the plugin UI for a more interactive experience.
*   **Advanced Tools:** Build more complex composite tools (e.g., `create_login_form`, `generate_color_palette`).
*   **Error Handling & Resilience:** Enhance error handling in the Python tools, including retries and more descriptive feedback to the agent.
*   **State Awareness:** Implement tools for reading Figma state (`get_selection`, `get_node_properties`) so the agent can perform contextual actions.