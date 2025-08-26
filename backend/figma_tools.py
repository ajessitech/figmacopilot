"""
Figma Tools - OpenAI Agent Tools for Phase 2+

This module defines the tools that the OpenAI Agent can use to interact
with Figma through the plugin via the figma_communicator.
"""

import logging
from typing import Dict, Any
from agents import function_tool
from figma_communicator import send_command

logger = logging.getLogger(__name__)

@function_tool
async def create_frame(
    width: int = 100, 
    height: int = 100, 
    x: int = 0, 
    y: int = 0, 
    name: str = "Frame"
) -> str:
    """
    Creates a new frame in Figma with the specified dimensions and position.
    
    Args:
        width: Width of the frame in pixels (default: 100)
        height: Height of the frame in pixels (default: 100)
        x: X position of the frame (default: 0)
        y: Y position of the frame (default: 0)
        name: Name for the frame (default: "Frame")
    
    Returns:
        A confirmation message with the created frame's ID
    """
    try:
        logger.info(f"🖼️ Creating frame: {width}x{height} at ({x}, {y}) named '{name}'")
        
        # Prepare parameters for the plugin
        params = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name
        }
        
        logger.info(f"🔧 Frame parameters: {params}")
        
        # Send the command to the plugin
        logger.info(f"📞 Calling send_command for create_frame")
        result = await send_command("create_frame", params)
        logger.info(f"📞 send_command returned: {result}")
        
        # Extract the node ID from the result
        if isinstance(result, dict) and "id" in result:
            node_id = result["id"]
            logger.info(f"Successfully created frame with ID: {node_id}")
            return f"Successfully created frame '{name}' ({width}x{height}) with ID: {node_id}"
        else:
            logger.warning(f"Unexpected result format from create_frame: {result}")
            return f"Frame '{name}' was created successfully"
            
    except Exception as e:
        error_msg = f"Failed to create frame: {str(e)}"
        logger.error(error_msg)
        return error_msg


@function_tool
async def create_text(
    text: str,
    parent_id: str = None,
    x: int = 0,
    y: int = 0,
    font_size: int = 16,
    font_family: str = "Inter"
) -> str:
    """
    Creates a text node in Figma.
    
    Args:
        text: The text content
        parent_id: ID of the parent node (optional)
        x: X position (default: 0)
        y: Y position (default: 0)
        font_size: Font size in pixels (default: 16)
        font_family: Font family name (default: "Inter")
    
    Returns:
        A confirmation message with the created text node's ID
    """
    try:
        logger.info(f"📝 Creating text node: '{text}' at ({x}, {y})")
        
        params = {
            "text": text,
            "x": x,
            "y": y,
            "fontSize": font_size,
            "fontFamily": font_family
        }
        
        if parent_id:
            params["parentId"] = parent_id
        
        result = await send_command("create_text", params)
        
        if isinstance(result, dict) and "id" in result:
            node_id = result["id"]
            logger.info(f"Successfully created text node with ID: {node_id}")
            return f"Successfully created text '{text}' with ID: {node_id}"
        else:
            return f"Text '{text}' was created, but the response format was unexpected: {result}"
            
    except Exception as e:
        error_msg = f"Failed to create text: {str(e)}"
        logger.error(error_msg)
        return error_msg


@function_tool
async def set_fill_color(
    node_id: str,
    r: float,
    g: float,
    b: float,
    a: float = 1.0
) -> str:
    """
    Sets the fill color of a Figma node.
    
    Args:
        node_id: The ID of the node to modify
        r: Red component (0.0 to 1.0)
        g: Green component (0.0 to 1.0)
        b: Blue component (0.0 to 1.0)
        a: Alpha component (0.0 to 1.0, default: 1.0)
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"🎨 Setting fill color for node {node_id} to RGB({r}, {g}, {b}, {a})")
        
        params = {
            "nodeId": node_id,
            "color": {
                "r": r,
                "g": g,
                "b": b,
                "a": a
            }
        }
        
        result = await send_command("set_fill_color", params)
        
        # Convert to hex for user-friendly display
        hex_color = f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"
        logger.info(f"Successfully set fill color for node {node_id}")
        return f"Successfully set fill color to {hex_color} for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set fill color: {str(e)}"
        logger.error(error_msg)
        return error_msg


@function_tool
async def set_corner_radius(node_id: str, radius: int) -> str:
    """
    Sets the corner radius of a Figma node.
    
    Args:
        node_id: The ID of the node to modify
        radius: Corner radius in pixels
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📐 Setting corner radius for node {node_id} to {radius}px")
        
        params = {
            "nodeId": node_id,
            "radius": radius
        }
        
        result = await send_command("set_corner_radius", params)
        
        logger.info(f"Successfully set corner radius for node {node_id}")
        return f"Successfully set corner radius to {radius}px for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set corner radius: {str(e)}"
        logger.error(error_msg)
        return error_msg
