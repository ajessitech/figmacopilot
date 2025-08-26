# Troubleshooting Guide

This guide helps resolve common issues with the Figma Copilot system.

## Connection Issues

### Plugin Cannot Connect to Bridge

**Symptoms:**
- Plugin shows "Not connected to Figma Bridge"
- Connection error in plugin UI

**Solutions:**
1. **Check if container is running:**
   ```bash
   docker ps | grep figma-agent-container
   ```

2. **Start the container:**
   ```bash
   ./scripts/dev.sh
   ```

3. **Check port availability:**
   ```bash
   lsof -i :3055
   ```

4. **Verify bridge is listening:**
   ```bash
   docker logs figma-agent-container | grep "Listening"
   ```

### Agent Cannot Connect to Bridge

**Symptoms:**
- Agent logs show "Failed to connect"
- Agent keeps reconnecting

**Solutions:**
1. **Check bridge startup order:**
   - Bridge should start before agent
   - Check Docker logs for startup sequence

2. **Verify internal networking:**
   - Agent connects to `ws://localhost:3055` inside container
   - Bridge should be listening on port 3055

3. **Check container health:**
   ```bash
   docker exec figma-agent-container ps aux
   ```

## Channel Issues

### Messages Not Being Delivered

**Symptoms:**
- Plugin sends message but no response
- Bridge logs show "No target socket for message"

**Solutions:**
1. **Check channel coordination:**
   - Both plugin and agent must use same channel
   - Default channel: `figma-copilot-default`

2. **Verify both participants joined:**
   ```bash
   docker logs figma-agent-container | grep "Join successful"
   ```

3. **Check for duplicate roles:**
   - Only one plugin and one agent per channel
   - Restart container if needed

### Channel Mismatch

**Symptoms:**
- Plugin and agent in different channels
- No communication between them

**Solutions:**
1. **Verify channel names:**
   - Agent: `figma-copilot-default` (in `backend/main.py`)
   - Plugin: `figma-copilot-default` (in `plugin/ui.html`)

2. **Override channel if needed:**
   ```bash
   FIGMA_CHANNEL=my-channel ./scripts/dev.sh
   ```

## Development Issues

### Docker Build Failures

**Symptoms:**
- `docker build` fails
- Missing dependencies

**Solutions:**
1. **Clean and rebuild:**
   ```bash
   docker system prune -f
   docker build --no-cache -t figma-agent .
   ```

2. **Check platform compatibility:**
   ```bash
   PLATFORM=linux/arm64 ./scripts/dev.sh  # For M1/M2 Macs
   ```

### TypeScript Errors

**Symptoms:**
- Bridge compilation fails
- Type errors in `bridge/index.ts`

**Solutions:**
1. **Install dependencies:**
   ```bash
   cd bridge && bun install
   ```

2. **Check TypeScript config:**
   ```bash
   cd bridge && bun run tsc --noEmit
   ```

## Performance Issues

### High Memory Usage

**Symptoms:**
- Container using excessive memory
- Slow response times

**Solutions:**
1. **Check for memory leaks:**
   ```bash
   docker stats figma-agent-container
   ```

2. **Restart container:**
   ```bash
   docker restart figma-agent-container
   ```

### Slow Message Routing

**Symptoms:**
- Delayed responses
- Lag in UI

**Solutions:**
1. **Check bridge performance:**
   - Monitor message routing logs
   - Verify no blocking operations

2. **Optimize channel cleanup:**
   - Reduce cleanup interval if needed
   - Monitor channel count

## Platform-Specific Issues

### macOS ARM64 (M1/M2)

**Symptoms:**
- Container won't start
- Platform compatibility warnings

**Solutions:**
1. **Use ARM64 platform:**
   ```bash
   PLATFORM=linux/arm64 ./scripts/dev.sh
   ```

2. **Enable Rosetta if needed:**
   ```bash
   softwareupdate --install-rosetta
   ```

### Windows WSL

**Symptoms:**
- Connection refused errors
- Port binding issues

**Solutions:**
1. **Check WSL networking:**
   ```bash
   netstat -an | grep 3055
   ```

2. **Use host networking:**
   ```bash
   docker run --network host figma-agent
   ```

## Log Analysis

### Understanding Logs

**Bridge Logs:**
- `[bridge] [info]` - Normal operations
- `[bridge] [warn]` - Non-critical issues
- `[bridge] [error]` - Critical errors

**Agent Logs:**
- `[agent] [INFO]` - Normal operations
- `[agent] [WARNING]` - Reconnection attempts
- `[agent] [ERROR]` - Connection failures

### Common Log Patterns

**Successful Connection:**
```
[bridge] [info] Join successful {"role":"plugin","channel":"figma-copilot-default","pluginConnected":true,"agentConnected":true}
```

**Message Routing:**
```
[bridge] [info] Message forwarded {"from":"plugin","to":"agent","channel":"figma-copilot-default","type":"user_prompt"}
```

**Channel Cleanup:**
```
[bridge] [info] Idle channel cleaned up {"channel":"old-channel"}
```

## Getting Help

If you're still experiencing issues:

1. **Collect logs:**
   ```bash
   docker logs figma-agent-container > logs.txt
   ```

2. **Check system info:**
   ```bash
   uname -a
   docker version
   bun --version
   ```

3. **Create minimal reproduction:**
   - Document exact steps
   - Include relevant logs
   - Note platform and versions
