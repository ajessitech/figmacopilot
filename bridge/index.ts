import { serve, ServerWebSocket } from "bun";

const PORT = 3055;

// Channel management
interface ChannelMembers {
  plugin?: ServerWebSocket<unknown>;
  agent?: ServerWebSocket<unknown>;
}

const channels = new Map<string, ChannelMembers>();

// Channel cleanup configuration
const CHANNEL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const channelTimestamps = new Map<string, number>();

// Message types
interface JoinMessage {
  type: "join";
  role: "plugin" | "agent";
  channel: string;
}

interface UserPromptMessage {
  type: "user_prompt";
  prompt: string;
}

interface AgentResponseMessage {
  type: "agent_response";
  prompt: string;
  is_final?: boolean;
}

interface AgentResponseChunkMessage {
  type: "agent_response_chunk";
  chunk: string;
  is_partial: boolean;
}

interface SystemMessage {
  type: "system";
  message: { result: boolean };
  channel: string;
}

interface ErrorMessage {
  type: "error";
  message: string;
  channel?: string;
}

interface PingMessage {
  type: "ping";
}

interface PongMessage {
  type: "pong";
}

// Phase 2+ Tool execution messages
interface ToolCallMessage {
  type: "tool_call";
  id: string;
  command: string;
  params: any;
}

interface ToolResponseMessage {
  type: "tool_response";
  id: string;
  result?: any;
  error?: string;
}

type Message = JoinMessage | UserPromptMessage | AgentResponseMessage | AgentResponseChunkMessage | SystemMessage | ErrorMessage | PingMessage | PongMessage | ToolCallMessage | ToolResponseMessage;

function log(level: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [bridge] [${level}] ${message}`, data ? JSON.stringify(data) : "");
}

function sendMessage(ws: ServerWebSocket<unknown>, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function validateMessage(data: any): data is Message {
  if (!data || typeof data !== "object" || !data.type) {
    return false;
  }
  
  switch (data.type) {
    case "join":
      return typeof data.role === "string" && 
             (data.role === "plugin" || data.role === "agent") &&
             typeof data.channel === "string";
    case "user_prompt":
    case "agent_response":
      return typeof data.prompt === "string";
    case "agent_response_chunk":
      return typeof data.chunk === "string" && typeof data.is_partial === "boolean";
    case "tool_call":
      return typeof data.id === "string" &&
             typeof data.command === "string" &&
             data.params !== undefined;
    case "tool_response":
      return typeof data.id === "string" &&
             (data.result !== undefined || data.error !== undefined);
    case "ping":
    case "pong":
      return true;
    default:
      return false;
  }
}

function handleJoin(ws: ServerWebSocket<unknown>, message: JoinMessage) {
  const { role, channel } = message;
  
  log("info", `Join attempt`, { role, channel });
  
  // Get or create channel
  let channelMembers = channels.get(channel);
  if (!channelMembers) {
    channelMembers = {};
    channels.set(channel, channelMembers);
  }
  
  // Update channel timestamp
  channelTimestamps.set(channel, Date.now());
  
  // Check for duplicate role
  if (channelMembers[role]) {
    const errorMsg: ErrorMessage = {
      type: "error",
      message: `A ${role} is already connected to channel ${channel}`,
      channel
    };
    sendMessage(ws, errorMsg);
    log("warn", `Duplicate role join rejected`, { role, channel });
    return;
  }
  
  // Add to channel
  channelMembers[role] = ws;
  
  // Send success acknowledgment
  const ackMessage: SystemMessage = {
    type: "system",
    message: { result: true },
    channel
  };
  sendMessage(ws, ackMessage);
  
  log("info", `Join successful`, { role, channel, 
    pluginConnected: !!channelMembers.plugin,
    agentConnected: !!channelMembers.agent 
  });
}

function handleMessage(ws: ServerWebSocket<unknown>, message: UserPromptMessage | AgentResponseMessage | AgentResponseChunkMessage | ToolCallMessage | ToolResponseMessage) {
  // Find which channel this socket belongs to
  let senderRole: "plugin" | "agent" | null = null;
  let senderChannel: string | null = null;
  
  for (const [channelId, members] of channels.entries()) {
    if (members.plugin === ws) {
      senderRole = "plugin";
      senderChannel = channelId;
      break;
    }
    if (members.agent === ws) {
      senderRole = "agent";
      senderChannel = channelId;
      break;
    }
  }
  
  if (!senderRole || !senderChannel) {
    const errorMsg: ErrorMessage = {
      type: "error",
      message: "Socket not joined to any channel"
    };
    sendMessage(ws, errorMsg);
    log("warn", "Message from non-joined socket");
    return;
  }
  
  const channelMembers = channels.get(senderChannel);
  if (!channelMembers) {
    log("error", "Channel not found", { channel: senderChannel });
    return;
  }
  
  // Forward to the other role in the same channel
  const targetRole = senderRole === "plugin" ? "agent" : "plugin";
  const targetSocket = channelMembers[targetRole];
  
  if (targetSocket) {
    sendMessage(targetSocket, message);
    log("info", "Message forwarded", { 
      from: senderRole, 
      to: targetRole, 
      channel: senderChannel,
      type: message.type 
    });
  } else {
    log("warn", "No target socket for message", { 
      senderRole, 
      targetRole, 
      channel: senderChannel 
    });
  }
}

function cleanupIdleChannels() {
  const now = Date.now();
  for (const [channelId, timestamp] of channelTimestamps.entries()) {
    if (now - timestamp > CHANNEL_TIMEOUT_MS) {
      const members = channels.get(channelId);
      if (members && (!members.plugin && !members.agent)) {
        channels.delete(channelId);
        channelTimestamps.delete(channelId);
        log("info", "Idle channel cleaned up", { channel: channelId });
      }
    }
  }
}

function handleDisconnection(ws: ServerWebSocket<unknown>) {
  // Find and remove this socket from all channels
  for (const [channelId, members] of channels.entries()) {
    let disconnectedRole: "plugin" | "agent" | null = null;
    
    if (members.plugin === ws) {
      disconnectedRole = "plugin";
      delete members.plugin;
    } else if (members.agent === ws) {
      disconnectedRole = "agent";
      delete members.agent;
    }
    
    if (disconnectedRole) {
      log("info", "Socket disconnected", { role: disconnectedRole, channel: channelId });
      
      // Notify the remaining participant
      const remainingRole = disconnectedRole === "plugin" ? "agent" : "plugin";
      const remainingSocket = members[remainingRole];
      if (remainingSocket) {
        const leaveMessage = {
          type: "system",
          message: `The ${disconnectedRole} has disconnected`,
          channel: channelId
        };
        sendMessage(remainingSocket, leaveMessage);
      }
      
      // Clean up empty channels
      if (!members.plugin && !members.agent) {
        channels.delete(channelId);
        channelTimestamps.delete(channelId);
        log("info", "Channel cleaned up", { channel: channelId });
      }
      
      break;
    }
  }
}

serve({
  fetch(req, server) {
    // Upgrade to WebSocket if possible
    if (server.upgrade(req)) return;
    return new Response("Figma Bridge WebSocket", { status: 200 });
  },
  websocket: {
    open(ws) {
      log("info", "Client connected");
    },
    message(ws, rawMessage) {
      try {
        const data = JSON.parse(rawMessage as string);
        
        if (!validateMessage(data)) {
          const errorMsg: ErrorMessage = {
            type: "error",
            message: "Invalid message format"
          };
          sendMessage(ws, errorMsg);
          log("warn", "Invalid message received", { rawMessage });
          return;
        }
        
        if (data.type === "join") {
          handleJoin(ws, data);
        } else if (data.type === "user_prompt" || data.type === "agent_response" || data.type === "agent_response_chunk" || data.type === "tool_call" || data.type === "tool_response") {
          handleMessage(ws, data);
        } else if (data.type === "ping") {
          // Respond to ping with pong
          const pongMessage: PongMessage = { type: "pong" };
          sendMessage(ws, pongMessage);
        }
      } catch (error) {
        const errorMsg: ErrorMessage = {
          type: "error",
          message: "Failed to parse message"
        };
        sendMessage(ws, errorMsg);
        log("error", "Message parsing failed", { error: (error as Error).message, rawMessage });
      }
    },
    close(ws) {
      handleDisconnection(ws);
    }
  },
  port: PORT
});

// Start channel cleanup timer
setInterval(cleanupIdleChannels, 60000); // Run every minute

log("info", `Listening on ws://localhost:${PORT}`);
