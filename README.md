# Figma Copilot - OpenAI Agents SDK Integration

A sophisticated AI-powered Figma plugin that provides real-time streaming chat with persistent conversation history and direct Figma API control using the OpenAI Agents SDK.

## 🚀 Features

- **Real-time Streaming Responses** - See AI responses appear word-by-word.
- **Persistent Conversation History** - Context maintained throughout your session using an in-memory SQLite database.
- **Direct Figma API Control** - Instruct the agent to perform actions like creating shapes, changing styles, and manipulating layers.
- **OpenAI Agents SDK Integration** - Enterprise-grade AI agent management with `gemini-2.5-flash-lite` (using LiteLLM).
- **Modern Architecture** - Single-container deployment with a high-performance Bun-based WebSocket bridge.
- **Robust Tooling** - An extensive set of tools for interacting with the Figma canvas.

## 🏗️ Architecture

-   **Figma Plugin (`plugin/`)**: The frontend running in the Figma sandbox. It provides the chat UI and executes tool calls received from the agent.
-   **Bun Bridge (`bridge/`)**: A high-performance WebSocket server that routes messages between the plugin and the agent based on a channel system.
-   **Python Agent (`backend/`)**: The "brain" of the operation. It uses the OpenAI Agents SDK to understand user prompts, orchestrate tool calls, and generate responses.

