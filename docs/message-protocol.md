# Figma Copilot Message Protocol

This document describes the WebSocket message protocol used for communication between the Figma plugin, bridge, and agent.

## Overview

The protocol uses JSON messages over WebSocket connections. All participants must join a channel before they can communicate. The bridge routes messages between participants in the same channel.

## Connection Flow

1. **Connect**: Client connects to `ws://localhost:3055`
2. **Join Channel**: Send join message with role and channel
3. **Receive Ack**: Bridge confirms successful join
4. **Communicate**: Send/receive messages within the channel

## Message Types

### Join Message
Sent by both plugin and agent to join a channel.

```json
{
  "type": "join",
  "role": "plugin" | "agent",
  "channel": "figma-copilot-default"
}
```

**Response (Success):**
```json
{
  "type": "system",
  "message": { "result": true },
  "channel": "figma-copilot-default"
}
```

**Response (Error):**
```json
{
  "type": "error",
  "message": "A plugin is already connected to channel figma-copilot-default",
  "channel": "figma-copilot-default"
}
```

### User Prompt Message
Sent by plugin to agent with user input.

```json
{
  "type": "user_prompt",
  "prompt": "Create a blue button"
}
```

### Agent Response Message
Sent by agent back to plugin with response.

```json
{
  "type": "agent_response",
  "prompt": "You said: 'Create a blue button'"
}
```

### Ping/Pong Messages
Used for connection health checks.

**Ping:**
```json
{
  "type": "ping"
}
```

**Pong:**
```json
{
  "type": "pong"
}
```

### System Messages
Used for notifications and status updates.

```json
{
  "type": "system",
  "message": "The plugin has disconnected",
  "channel": "figma-copilot-default"
}
```

### Error Messages
Used for error reporting.

```json
{
  "type": "error",
  "message": "Invalid message format"
}
```

## Phase 1 Example Flow

1. **Agent joins:**
   ```json
   {"type": "join", "role": "agent", "channel": "figma-copilot-default"}
   ```

2. **Plugin joins:**
   ```json
   {"type": "join", "role": "plugin", "channel": "figma-copilot-default"}
   ```

3. **User types "Hello":**
   ```json
   {"type": "user_prompt", "prompt": "Hello"}
   ```

4. **Agent echoes:**
   ```json
   {"type": "agent_response", "prompt": "You said: 'Hello'"}
   ```

## Channel Management

- Each channel can have exactly one plugin and one agent
- Channels are automatically cleaned up when both participants disconnect
- Idle channels are garbage collected after 5 minutes
- Channel names are case-sensitive

## Error Handling

- Invalid JSON: Returns error message
- Unknown message type: Returns error message
- Duplicate role in channel: Returns error message
- Message without joining: Returns error message

## Heartbeat

Clients can send ping messages to check connection health. The bridge responds with pong messages.

## Future Extensions

Phase 2+ will add:
- Tool call/response messages
- Progress update messages
- Batch operations
- Authentication
