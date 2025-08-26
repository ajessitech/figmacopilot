# Figma Copilot - OpenAI Agents SDK Integration

A sophisticated AI-powered Figma plugin that provides real-time streaming chat with persistent conversation history using the OpenAI Agents SDK.

## 🚀 Features

- **Real-time Streaming Responses** - See AI responses appear word-by-word
- **Persistent Conversation History** - Context maintained throughout your session
- **OpenAI Agents SDK Integration** - Enterprise-grade AI agent management
- **Modern Architecture** - Single-container deployment with high performance
- **Figma Design Expertise** - Specialized knowledge for design workflows

## 🎯 Current Status: Phase 1 Complete ✅

**What Works Now:**
- ✅ Real-time streaming AI chat in Figma plugin
- ✅ Persistent conversation context using SQLiteSession
- ✅ OpenAI Agents SDK with `gpt-4.1-nano` model
- ✅ Professional chat UI with typing indicators
- ✅ Robust WebSocket bridge with message routing
- ✅ Single-command development environment

**Coming Next (Phase 2):**
- 🔄 Direct Figma API control (create frames, buttons, etc.)
- 🔄 Tool execution with visual feedback
- 🔄 Composite operations (e.g., "create a login form")

## 🏗️ Architecture

```
┌─────────────────┐    WebSocket     ┌─────────────────┐    Process Call    ┌─────────────────┐
│   Figma Plugin  │ ◄────────────► │   Bun Bridge    │ ◄─────────────► │  Python Agent  │
│   (UI + Code)   │                │  (index.ts)     │                 │   (main.py)     │
└─────────────────┘                └─────────────────┘                 └─────────────────┘
        │                                   │                                   │
        ├─ Real-time UI                     ├─ Message Router                   ├─ OpenAI Agents SDK
        ├─ Streaming Support               ├─ Channel Management               ├─ SQLiteSession
        └─ Connection Handling             └─ Protocol Validation              └─ gpt-4.1-nano
```

## 🚀 Quick Start

### Prerequisites
- Docker Desktop
- Figma Desktop App
- OpenAI API Key

### 1. Clone and Setup
```bash
git clone <repository-url>
cd figmacopilot
```

### 2. Configure Environment
Create `backend/.env`:
```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4.1-nano
```

### 3. Start Development Environment
```bash
./scripts/dev.sh
```

This single command:
- Builds optimized Docker container
- Starts bridge on `localhost:3055`
- Launches Python agent with Agents SDK
- Shows real-time logs from both services

### 4. Install Figma Plugin
1. Open Figma Desktop
2. Go to **Plugins** → **Development** → **Import plugin from manifest**
3. Select `plugin/manifest.json` from this project
4. Run the "Figma Copilot" plugin

### 5. Start Chatting!
- Plugin automatically connects to bridge
- Type messages to get streaming AI responses
- Ask follow-up questions to test conversation memory

## 💬 Example Conversations

```
You: "How do I create a button in Figma?"
Agent: [Streams in real-time] "To create a button in Figma, you can use the Rectangle tool and then style it. Here's the process:

1. Select the Rectangle tool (R)
2. Draw your button shape
3. Add a fill color in the properties panel
4. Set corner radius for rounded corners
5. Add text on top using the Text tool (T)

Would you like me to walk through styling options or explain how to make it interactive?"

You: "What about making it blue?"
Agent: [Remembers context] "For the button we just discussed, here's how to make it blue:

1. Select your rectangle shape
2. In the Fill section of the properties panel
3. Click the color swatch
4. Choose your blue color or enter a hex code like #007AFF
5. You can also adjust opacity if needed

The blue will give your button a modern, clickable appearance. Would you like suggestions for complementary colors for the text?"
```

## 🛠️ Technology Stack

### Backend Agent
- **Python 3.11** - Modern language features
- **OpenAI Agents SDK** - Enterprise AI agent framework
- **SQLiteSession** - Persistent conversation memory
- **websocket-client** - Reliable WebSocket connectivity

### Bridge
- **Bun** - High-performance JavaScript runtime
- **TypeScript** - Type-safe message routing
- **WebSocket Server** - Real-time bidirectional communication

### Frontend
- **Figma Plugin API** - Direct integration with Figma
- **Modern JavaScript** - Streaming UI and real-time updates
- **CSS3** - Professional chat interface

### Infrastructure
- **Docker** - Single-container deployment
- **Python 3.11 Slim** - Optimized base image
- **Multi-stage Build** - Efficient dependency management

## 📁 Project Structure

```
figmacopilot/
├── backend/                    # Python Agent (OpenAI Agents SDK)
│   ├── main.py                # Main agent with streaming & SQLiteSession
│   └── requirements.txt       # Python dependencies
├── bridge/                    # Bun WebSocket Bridge
│   ├── index.ts              # Message router with protocol validation
│   ├── package.json          # Bun dependencies
│   └── tsconfig.json         # TypeScript configuration
├── plugin/                   # Figma Plugin
│   ├── ui.html              # Modern chat UI with streaming support
│   ├── code.js              # Plugin runtime code
│   └── manifest.json        # Plugin configuration
├── scripts/                 # Development tools
│   └── dev.sh              # One-command development setup
├── docs/                   # Documentation
│   ├── plan.md            # Implementation roadmap
│   └── phase1-implementation.md  # Technical details
├── Dockerfile             # Single-container deployment
└── README.md             # This file
```

## 🔧 Development

### Building and Running
```bash
# Development mode (with logs)
./scripts/dev.sh

# Production build
docker build -t figma-agent .
docker run -p 3055:3055 figma-agent
```

### Environment Variables
```bash
# Required
OPENAI_API_KEY=your_key_here

# Optional
OPENAI_MODEL=gpt-4.1-nano        # AI model (default: gpt-4o-mini)
BRIDGE_URL=ws://localhost:3055   # Bridge connection
FIGMA_CHANNEL=your-channel-name  # Channel isolation
```

### Debugging
- Bridge logs: Real-time WebSocket message routing
- Agent logs: OpenAI API calls and streaming events  
- Plugin logs: Available in browser dev tools

## 📖 Documentation

- **[Implementation Plan](docs/plan.md)** - Phased development roadmap
- **[Phase 1 Technical Guide](docs/phase1-implementation.md)** - Detailed implementation
- **[Message Protocol](docs/message-protocol.md)** - WebSocket message specifications

## 🔮 Roadmap

### ✅ Phase 1: Advanced Chat (COMPLETED)
- Real-time streaming responses
- Persistent conversation history with SQLiteSession
- OpenAI Agents SDK integration
- Professional chat UI

### 🔄 Phase 2: Direct Figma Control (IN PROGRESS)
- `@function_tool` decorated Figma API functions
- Tool execution with visual feedback
- Basic operations: create frames, shapes, text
- RPC protocol for plugin ↔ agent communication

### 🔄 Phase 3: Composite Operations (PLANNED)
- High-level tools: "create button", "design login form"
- Multi-step operations with progress tracking
- Smart defaults and style consistency
- Context-aware design suggestions

### 🔄 Future Enhancements
- Vector search for design patterns
- Integration with design systems
- Collaborative features for teams
- Advanced visual AI capabilities

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `./scripts/dev.sh`
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

---

**Ready to revolutionize your Figma workflow with AI?** 🎨✨

Start with `./scripts/dev.sh` and begin chatting with your AI design assistant!
