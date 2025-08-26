"""
Figma Communicator - RPC Communication Layer for Phase 2+

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
        
        logger.info(f"📝 Added to pending requests: {request_id}")
        logger.info(f"📝 Total pending requests: {len(self.pending_requests)}")
        
        try:
            # Send the message
            start_time = time.time()
            logger.info(f"🚀 Sending tool_call: {command} with ID: {request_id} at {start_time:.3f}")
            logger.info(f"🚀 Tool call payload: {json.dumps(tool_call_message)}")
            await self.websocket.send(json.dumps(tool_call_message))
            
            # Wait for the response with timeout
            result = await asyncio.wait_for(future, timeout=self.timeout)
            return result
            
        except asyncio.TimeoutError:
            # Clean up the pending request
            self.pending_requests.pop(request_id, None)
            start_time = self.request_timestamps.pop(request_id, None)
            elapsed = time.time() - start_time if start_time else self.timeout
            logger.error(f"⏰ Tool call {command} (ID: {request_id}) timed out after {elapsed:.3f}s (limit: {self.timeout}s)")
            raise asyncio.TimeoutError(f"Tool call '{command}' timed out after {elapsed:.1f} seconds")
            
        except Exception as e:
            # Clean up the pending request
            self.pending_requests.pop(request_id, None)
            self.request_timestamps.pop(request_id, None)
            logger.error(f"Tool call {command} (ID: {request_id}) failed: {e}")
            raise
    
    def handle_tool_response(self, message: Dict[str, Any]) -> None:
        """
        Handle incoming tool_response messages from the plugin.
        
        Args:
            message: The tool_response message from the plugin
        """
        request_id = message.get("id")
        logger.info(f"🔄 Processing tool_response for ID: {request_id}")
        logger.info(f"🔄 Current pending requests: {list(self.pending_requests.keys())}")
        
        if not request_id:
            logger.warning("❌ Received tool_response without ID")
            return
        
        future = self.pending_requests.pop(request_id, None)
        start_time = self.request_timestamps.pop(request_id, None)
        
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
        
        # Check if the response contains an error
        if "error" in message:
            error_msg = message["error"]
            logger.error(f"❌ Tool call {request_id} failed after {elapsed:.3f}s: {error_msg}")
            # Schedule the exception setting on the event loop
            logger.info(f"🔥 Attempting to set exception on future for {request_id}")
            try:
                loop = asyncio.get_event_loop()
                logger.info(f"🔄 Using event loop call_soon_threadsafe for exception")
                loop.call_soon_threadsafe(future.set_exception, Exception(f"Plugin error: {error_msg}"))
            except RuntimeError as e:
                logger.warning(f"⚠️ No event loop running, using direct exception set: {e}")
                # Fallback if no event loop is running
                future.set_exception(Exception(f"Plugin error: {error_msg}"))
        else:
            # Success - return the result
            result = message.get("result", {})
            logger.info(f"✅ Tool call {request_id} completed successfully after {elapsed:.3f}s")
            logger.info(f"🎯 Result payload: {result}")
            # Schedule the result setting on the event loop
            logger.info(f"🔄 Attempting to set result on future for {request_id}")
            try:
                loop = asyncio.get_event_loop()
                logger.info(f"🔄 Using event loop call_soon_threadsafe for result")
                loop.call_soon_threadsafe(future.set_result, result)
                logger.info(f"🔄 Scheduled result setting for {request_id}")
            except RuntimeError as e:
                logger.warning(f"⚠️ No event loop running, using direct result set: {e}")
                # Fallback if no event loop is running
                future.set_result(result)
    
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
