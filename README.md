# Figma Copilot - OpenAI Agents SDK Integration

A sophisticated AI-powered Figma plugin that provides real-time streaming chat with persistent conversation history and direct Figma API control using the OpenAI Agents SDK.

## 🚀 Features

- **Real-time Streaming Responses** - See AI responses appear word-by-word.
- **Persistent Conversation History** - Context maintained throughout your session using an in-memory SQLite database.
- **Direct Figma API Control** - Instruct the agent to perform actions like creating shapes, changing styles, and manipulating layers.
- **OpenAI Agents SDK Integration** - Enterprise-grade AI agent management with `gpt-4.1-nano` (or a user-defined model).
- **Modern Architecture** - Single-container deployment with a high-performance Bun-based WebSocket bridge.
- **Robust Tooling** - An extensive set of tools for interacting with the Figma canvas.

## 🏗️ Architecture

The system consists of three main components communicating over WebSockets:

```
┌─────────────────┐    WebSocket     ┌─────────────────┐    WebSocket     ┌─────────────────┐
│   Figma Plugin  │ ◄────────────► │   Bun Bridge    │ ◄───────────► │  Python Agent   │
│   (UI + Code)   │                │  (index.ts)     │               │    (main.py)    │
└─────────────────┘                └─────────────────┘               └─────────────────┘
        │                                   │                                 │
        ├─ Real-time UI & Chat              ├─ Message Router                 ├─ OpenAI Agents SDK
        ├─ Executes Figma API Tools         ├─ Channel Management             ├─ SQLiteSession (Memory)
        └─ Connection Handling              └─ Protocol Validation            └─ Tool Definitions
```

-   **Figma Plugin (`plugin/`)**: The frontend running in the Figma sandbox. It provides the chat UI and executes tool calls received from the agent.
-   **Bun Bridge (`bridge/`)**: A high-performance WebSocket server that routes messages between the plugin and the agent based on a channel system.
-   **Python Agent (`backend/`)**: The "brain" of the operation. It uses the OpenAI Agents SDK to understand user prompts, orchestrate tool calls, and generate responses.

## 🚀 Quick Start

### Prerequisites
- Docker Desktop
- Figma Desktop App
- An OpenAI API Key

### 1. Clone and Setup
```bash
git clone <repository-url>
cd figmacopilot
```

### 2. Configure Environment
Create a `.env` file inside the `backend/` directory:
```bash
# backend/.env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-nano # Or any other model like gpt-4o-mini
```

### 3. Start Development Environment
A single script builds the Docker container and starts all services.
```bash
./scripts/dev.sh
```
This command will:
- Build the `figma-agent` Docker image.
- Start the container, exposing the bridge on `localhost:3055`.
- Launch both the Bun bridge and the Python agent, showing logs from both.

### 4. Install Figma Plugin
1.  Open the Figma Desktop App.
2.  Go to **Plugins** → **Development** → **Import plugin from manifest...**
3.  Select the `plugin/manifest.json` file from this project.
4.  Run the "Figma Copilot" plugin. It should automatically connect to the bridge.

### 5. Start Chatting!
You can now interact with the agent through the Figma plugin UI. Ask it to perform tasks or ask questions about your design.

## 🛠️ Available Tools

The agent has access to a wide range of tools to interact with your Figma file. You can ask it to:

-   **Create Objects**: `create_frame`, `create_rectangle`, `create_text`, `create_component_instance`.
-   **Read Information**: `get_document_info`, `get_selection`, `get_node_info`, `get_local_components`.
-   **Modify Properties**: `set_fill_color`, `set_stroke_color`, `set_corner_radius`, `set_text_content`.
-   **Layout**: `set_layout_mode`, `set_padding`, `set_item_spacing`, `set_axis_align`.
-   **And many more...** A full list of tools can be found in `backend/figma_tools.py` and are handled in `plugin/code.js`.

## WebSocket Message Protocol

Communication between the Plugin, Bridge, and Agent happens via a JSON-based WebSocket protocol.

### Connection
- A client (plugin or agent) connects to the bridge at `ws://localhost:3055`.
- It sends a `join` message to enter a specific channel.
- Each channel can have one `plugin` and one `agent`.

**Join Message:**
```json
{
  "type": "join",
  "role": "plugin" | "agent",
  "channel": "figma-copilot-default"
}
```

### Communication Flow
- **User Input**: The plugin sends a `user_prompt` message.
- **Agent Response**: The agent streams back the response using `agent_response_chunk` messages for real-time feedback, followed by a final `agent_response` with `is_final: true`.
- **Tool Usage**:
    1. The agent sends a `tool_call` message to the plugin.
    2. The plugin executes the corresponding Figma API function.
    3. The plugin sends the result back with a `tool_response` message, including the original `id`.

**Tool Call Example (Agent → Plugin):**
```json
{
  "type": "tool_call",
  "id": "uuid-123",
  "command": "create_rectangle",
  "params": { "width": 200, "height": 100 }
}
```

**Tool Response Example (Plugin → Agent):**
```json
{
  "type": "tool_response",
  "id": "uuid-123",
  "result": { "id": "123:456", "name": "Rectangle", ... }
}
```

##  troubleshooting

### Plugin Cannot Connect to Bridge
- **Symptom**: Plugin UI shows "Not connected to Figma Bridge".
- **Solution**:
    1.  Ensure the Docker container is running: `docker ps | grep figma-agent-container`.
    2.  If not running, start it with `./scripts/dev.sh`.
    3.  Check that port `3055` is not being used by another application: `lsof -i :3055`.
    4.  Check the container logs for errors: `docker logs figma-agent-container`.

### Messages Not Being Delivered
- **Symptom**: You send a message from the plugin but get no response.
- **Solution**:
    1.  Check the bridge logs (`docker logs figma-agent-container`) for "Message forwarded".
    2.  Ensure both the plugin and agent have successfully joined the same channel. The default is `figma-copilot-default`.

### Docker Build Failures
- **Symptom**: The `./scripts/dev.sh` command fails during the `docker build` step.
- **Solution**:
    1.  Try a clean build: `docker build --no-cache -t figma-agent .`
    2.  On ARM-based Macs (M1/M2/M3), you might need to specify the platform if you encounter issues: `docker build --platform linux/amd64 -t figma-agent .`. However, the current setup should work on ARM64.

## 📁 Project Structure
```
figmacopilot/
├── backend/              # Python Agent (OpenAI Agents SDK)
│   ├── main.py           # Main agent logic
│   ├── figma_tools.py    # Tool definitions
│   └── requirements.txt  # Python dependencies
├── bridge/               # Bun WebSocket Bridge
│   └── index.ts          # Message router
├── plugin/               # Figma Plugin
│   ├── ui.html           # Plugin UI
│   ├── code.js           # Plugin logic (executes tools)
│   └── manifest.json     # Plugin manifest
├── scripts/
│   └── dev.sh            # Development startup script
├── Dockerfile            # Single-container deployment
└── README.md             # This file
```
