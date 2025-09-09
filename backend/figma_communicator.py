"""
Figma Communicator - RPC Communication Layer

This module provides the communication layer between the Python agent
and the Figma plugin via WebSocket tool calls and responses.
"""

import asyncio
import json
import uuid
import logging
import time
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class ToolExecutionError(Exception):
    """
    Specialized exception for tool execution failures.
    
    Carries a structured payload allowing the agent to self-correct.
    Expected payload shape: { code: str, message: str, details?: dict }
    """

    def __init__(self, payload: Any, command: str | None = None, params: Dict[str, Any] | None = None):
        self.command = command
        self.params = params

        # Normalize payload and capture canonical fields
        if isinstance(payload, dict):
            self.code: str = str(payload.get("code", "unknown_plugin_error"))
            self.message: str = str(payload.get("message", ""))
            self.details: Dict[str, Any] = payload.get("details", {}) or {}
            normalized_payload = payload
        else:
            self.code = "unknown_plugin_error"
            self.message = str(payload)
            self.details = {}
            normalized_payload = {"code": self.code, "message": self.message, "details": self.details}

        # Store raw payload for agent consumption; avoid injecting business logic here
        self.payload = normalized_payload

        # Exception text is simply the structured message (or the code when empty)
        text = self.message if self.message else self.code
        super().__init__(text)

class FigmaCommunicator:
    """
    Handles RPC communication with the Figma plugin.
    
    This class manages:
    - Sending tool_call messages to the plugin
    - Tracking pending requests with unique IDs
    - Resolving futures when tool_response messages arrive
    - Error handling and timeouts
    """
    
    def __init__(self, websocket, timeout: float = 30.0):
        """
        Initialize the communicator.
        
        Args:
            websocket: The WebSocket connection to send messages through
            timeout: Timeout in seconds for tool calls (default: 30.0)
        """
        self.websocket = websocket
        self.timeout = timeout
        self.pending_requests: Dict[str, asyncio.Future] = {}
        self.request_timestamps: Dict[str, float] = {}  # Track request start times
        self.request_meta: Dict[str, Dict[str, Any]] = {}  # Track command/params per request
        # Token logging context and hook
        self.current_turn_id: Optional[str] = None
        self._token_counter_hook = None  # Optional[Callable[[Dict[str, Any]], None]]

    def set_token_counter_hook(self, hook) -> None:
        """Register a callback to record token usage per tool IO locally in the agent.

        The hook will be called with a dict containing: { scope: str, turn_id: str | None,
        command: str | None, tokens: int, direction: "input" | "output" }.
        """
        self._token_counter_hook = hook
        
    def generate_id(self) -> str:
        """Generate a unique ID for tool calls."""
        return str(uuid.uuid4())
    
    async def send_command(self, command: str, params: Dict[str, Any] = None) -> Any:
        """
        Send a command to the Figma plugin and wait for the response.
        
        Args:
            command: The command name (e.g., "create_frame")
            params: Optional parameters for the command
            
        Returns:
            The result from the plugin
            
        Raises:
            asyncio.TimeoutError: If the request times out
            Exception: If the plugin returns an error
        """
        if not self.websocket:
            raise RuntimeError("WebSocket connection not available")
        
        # Single-version mode: no Phase guardrails; allow all commands and rely on tool errors
        
        # Generate unique ID for this request
        request_id = self.generate_id()
        
        # Create the tool_call message
        tool_call_message = {
            "type": "tool_call",
            "id": request_id,
            "command": command,
            "params": params or {}
        }
        
        # Create a future to track this request
        future = asyncio.Future()
        self.pending_requests[request_id] = future
        self.request_timestamps[request_id] = time.time()  # Record start time
        self.request_meta[request_id] = {"command": command, "params": params or {}}
        
        logger.debug(f"📝 Added to pending requests: {request_id}")
        logger.debug(f"📝 Total pending requests: {len(self.pending_requests)}")
        
        try:
            # Emit progress update: tool_called
            try:
                await self.websocket.send(json.dumps({
                    "type": "progress_update",
                    "message": {"phase": 3, "status": "tool_called", "message": f"🛠️ {command}", "data": {"command": command, "id": request_id}}
                }))
            except Exception:
                pass
            # Send the message
            start_time = time.time()
            logger.info(f"🚀 Sending tool_call: {command} with ID: {request_id} at {start_time:.3f}")
            logger.debug(f"🚀 Tool call payload: {json.dumps(tool_call_message)}")
            await self.websocket.send(json.dumps(tool_call_message))

            # Emit token_usage progress update for tool input size (heuristic: chars/4)
            try:
                serialized = json.dumps({"command": command, "params": params or {}}, ensure_ascii=False)
                est_tokens = max(1, int(len(serialized) / 4))
                usage_msg = {
                    "type": "progress_update",
                    "message": {
                        "kind": "token_usage",
                        "scope": "tool_input",
                        "turn_id": self.current_turn_id,
                        "usage": {"requests": 0, "input_tokens": est_tokens, "output_tokens": 0, "total_tokens": est_tokens},
                        "tool": {"command": command, "id": request_id}
                    }
                }
                await self.websocket.send(json.dumps(usage_msg))
                if callable(self._token_counter_hook):
                    try:
                        self._token_counter_hook({"scope": "tool_input", "turn_id": self.current_turn_id, "command": command, "tokens": est_tokens, "direction": "input"})
                    except Exception:
                        pass
            except Exception:
                pass
            
            # Wait for the response with timeout
            result = await asyncio.wait_for(future, timeout=self.timeout)
            # Emit progress update: step_succeeded
            try:
                await self.websocket.send(json.dumps({
                    "type": "progress_update",
                    "message": {"phase": 3, "status": "step_succeeded", "message": f"✅ {command}", "data": {"command": command, "id": request_id}}
                }))
            except Exception:
                pass
            return result
            
        except asyncio.TimeoutError:
            # Clean up the pending request
            self.pending_requests.pop(request_id, None)
            start_time = self.request_timestamps.pop(request_id, None)
            self.request_meta.pop(request_id, None)
            elapsed = time.time() - start_time if start_time else self.timeout
            logger.error(f"⏰ Tool call {command} (ID: {request_id}) timed out after {elapsed:.3f}s (limit: {self.timeout}s)")
            try:
                await self.websocket.send(json.dumps({
                    "type": "progress_update",
                    "message": {"phase": 3, "status": "step_failed", "message": f"❗ {command} timed out", "data": {"command": command, "id": request_id, "elapsed_ms": int(elapsed*1000)}}
                }))
            except Exception:
                pass
            raise asyncio.TimeoutError(f"Tool call '{command}' timed out after {elapsed:.1f} seconds")
            
        except Exception as e:
            # Clean up the pending request
            self.pending_requests.pop(request_id, None)
            self.request_timestamps.pop(request_id, None)
            self.request_meta.pop(request_id, None)
            logger.error(f"Tool call {command} (ID: {request_id}) failed: {e}")
            try:
                await self.websocket.send(json.dumps({
                    "type": "progress_update",
                    "message": {"phase": 3, "status": "step_failed", "message": f"❗ {command} failed", "data": {"command": command, "id": request_id, "error": str(e)}}
                }))
            except Exception:
                pass
            raise
    
    def handle_tool_response(self, message: Dict[str, Any]) -> None:
        """
        Handle incoming tool_response messages from the plugin.
        
        Args:
            message: The tool_response message from the plugin
        """
        request_id = message.get("id")
        logger.debug(f"🔄 Processing tool_response for ID: {request_id}")
        logger.debug(f"🔄 Current pending requests: {list(self.pending_requests.keys())}")
        
        if not request_id:
            logger.warning("❌ Received tool_response without ID")
            return
        
        future = self.pending_requests.pop(request_id, None)
        start_time = self.request_timestamps.pop(request_id, None)
        meta = self.request_meta.pop(request_id, None)
        cmd = meta.get("command") if isinstance(meta, dict) else None
        params = meta.get("params") if isinstance(meta, dict) else None
        
        if not future:
            logger.warning(f"❌ Received tool_response for unknown ID: {request_id}")
            logger.warning(f"❌ Available pending IDs were: {list(self.pending_requests.keys())}")
            return
        
        if future.cancelled():
            logger.debug(f"⚠️ Received tool_response for cancelled request: {request_id}")
            return
        
        logger.info(f"🎯 Found matching future for ID: {request_id}, cancelled: {future.cancelled()}, done: {future.done()}")
        
        # Calculate elapsed time
        elapsed = time.time() - start_time if start_time else 0
        
        # Check if the response contains an error or an explicit failure result
        if "error_structured" in message and isinstance(message.get("error_structured"), dict):
            error_payload = message.get("error_structured")
            logger.error(f"❌ Tool call {request_id} failed after {elapsed:.3f}s: code={error_payload.get('code')}, message={error_payload.get('message')}")
            tool_error = ToolExecutionError(error_payload, command=cmd, params=params)
            logger.debug(f"🔥 Setting exception on future for {request_id}")
            if not future.done():
                future.set_exception(tool_error)
            else:
                logger.debug(f"⚠️ Future already completed for {request_id}")
            return

        if "error" in message:
            error_val = message.get("error")
            logger.error(f"❌ Tool call {request_id} failed after {elapsed:.3f}s: {error_val}")
            # If `error` is already an object, use it directly; otherwise attempt to parse JSON string
            try:
                if isinstance(error_val, dict):
                    error_payload = error_val
                else:
                    error_payload = json.loads(error_val)
                if not isinstance(error_payload, dict):
                    raise TypeError("Parsed error is not an object")
                tool_error = ToolExecutionError(error_payload, command=cmd, params=params)
            except Exception:
                tool_error = ToolExecutionError({"code": "unknown_plugin_error", "message": str(error_val)}, command=cmd, params=params)
            logger.debug(f"🔥 Setting exception on future for {request_id}")
            if not future.done():
                future.set_exception(tool_error)
            else:
                logger.debug(f"⚠️ Future already completed for {request_id}")
            return

        result = message.get("result", {})
        # Treat structured result with success=false as an error
        if isinstance(result, dict) and result.get("success") is False:
            err_text = result.get("message") or "Tool reported failure"
            logger.error(f"❌ Tool call {request_id} reported failure after {elapsed:.3f}s: {err_text}")
            tool_error = ToolExecutionError({"code": "plugin_reported_failure", "message": str(err_text), "details": {"result": result}}, command=cmd, params=params)
            logger.debug(f"🔥 Setting exception on future for {request_id}")
            if not future.done():
                future.set_exception(tool_error)
            else:
                logger.debug(f"⚠️ Future already completed for {request_id}")
            return

        # Success - return the result
        logger.info(f"✅ Tool call {request_id} completed successfully after {elapsed:.3f}s")
        logger.debug(f"🎯 Result payload: {result}")
        logger.debug(f"🔄 Setting result on future for {request_id}")
        # Emit token_usage progress update for tool output size (heuristic: chars/4)
        try:
            serialized_result = json.dumps(result, ensure_ascii=False)
            est_tokens = max(1, int(len(serialized_result) / 4))
            token_msg = {
                "type": "progress_update",
                "message": {
                    "kind": "token_usage",
                    "scope": "tool_output",
                    "turn_id": self.current_turn_id,
                    # Tool output is read by the next LLM call → count on input side
                    "usage": {"requests": 0, "input_tokens": est_tokens, "output_tokens": 0, "total_tokens": est_tokens},
                    "tool": {"command": cmd, "id": request_id}
                }
            }
            # handle_tool_response is sync; schedule the send in the current loop
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.websocket.send(json.dumps(token_msg)))
            except Exception:
                pass
            if callable(self._token_counter_hook):
                try:
                    self._token_counter_hook({"scope": "tool_output", "turn_id": self.current_turn_id, "command": cmd, "tokens": est_tokens, "direction": "output"})
                except Exception:
                    pass
        except Exception:
            pass
        if not future.done():
            future.set_result(result)
        else:
            logger.debug(f"⚠️ Future already completed for {request_id}")
    
    def cleanup_pending_requests(self) -> None:
        """Cancel all pending requests (called on shutdown)."""
        for request_id, future in self.pending_requests.items():
            if not future.cancelled():
                future.cancel()
                logger.info(f"Cancelled pending request: {request_id}")
        self.pending_requests.clear()
        self.request_timestamps.clear()


# Global communicator instance (will be set by main.py)
_communicator: Optional[FigmaCommunicator] = None

def set_communicator(communicator: FigmaCommunicator) -> None:
    """Set the global communicator instance."""
    global _communicator
    _communicator = communicator

def get_communicator() -> FigmaCommunicator:
    """Get the global communicator instance."""
    if _communicator is None:
        raise RuntimeError("Communicator not initialized. Call set_communicator() first.")
    return _communicator

async def send_command(command: str, params: Dict[str, Any] = None) -> Any:
    """
    Convenience function to send a command using the global communicator.
    
    Args:
        command: The command name
        params: Optional parameters
        
    Returns:
        The result from the plugin
    """
    communicator = get_communicator()
    return await communicator.send_command(command, params)
