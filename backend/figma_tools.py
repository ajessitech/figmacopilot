"""
Figma Tools - OpenAI Agent Tools for Phase 2+

This module defines the tools that the OpenAI Agent can use to interact
with Figma through the plugin via the figma_communicator.

All tools are dynamically generated based on the available commands in the plugin.
"""

import logging
from typing import Dict, Any, Optional, List, Union
from pydantic import BaseModel
from agents import function_tool
from figma_communicator import send_command, ToolExecutionError

logger = logging.getLogger(__name__)

# === PYDANTIC MODELS FOR COMPLEX PARAMETERS ===

class TextReplacement(BaseModel):
    nodeId: str
    text: str

class AnnotationProperty(BaseModel):
    name: str
    value: str

class Annotation(BaseModel):
    nodeId: str
    labelMarkdown: str
    categoryId: Optional[str] = None
    properties: Optional[List[AnnotationProperty]] = None

class Connection(BaseModel):
    startNodeId: str
    endNodeId: str
    text: Optional[str] = None

# === CORE NODE OPERATIONS ===

@function_tool
async def get_document_info() -> str:
    """
    Gets information about the current Figma document and page.
    
    Returns:
        Document information including page details and children
    """
    try:
        logger.info("📄 Getting document info")
        result = await send_command("get_document_info")
        return f"Document info retrieved: {result}"
    except Exception as e:
        error_msg = f"Failed to get document info: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_selection() -> str:
    """
    Gets the current selection in Figma.
    
    Returns:
        Information about currently selected nodes
    """
    try:
        logger.info("🎯 Getting current selection")
        result = await send_command("get_selection")
        return f"Selection info: {result}"
    except Exception as e:
        error_msg = f"Failed to get selection: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_node_info(node_id: str) -> str:
    """
    Gets detailed information about a specific node.
    
    Args:
        node_id: The ID of the node to inspect
        
    Returns:
        Detailed node information
    """
    try:
        logger.info(f"🔍 Getting info for node: {node_id}")
        result = await send_command("get_node_info", {"nodeId": node_id})
        return f"Node info for {node_id}: {result}"
    except Exception as e:
        error_msg = f"Failed to get node info: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_nodes_info(node_ids: List[str]) -> str:
    """
    Gets detailed information about multiple nodes.
    
    Args:
        node_ids: List of node IDs to inspect
        
    Returns:
        Information about all requested nodes
    """
    try:
        logger.info(f"🔍 Getting info for {len(node_ids)} nodes")
        result = await send_command("get_nodes_info", {"nodeIds": node_ids})
        return f"Nodes info: {result}"
    except Exception as e:
        error_msg = f"Failed to get nodes info: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === CREATION TOOLS ===

@function_tool
async def create_frame(
    width: int = 100, 
    height: int = 100, 
    x: int = 0, 
    y: int = 0, 
    name: str = "Frame",
    parent_id: Optional[str] = None,
    layout_mode: str = "NONE"
) -> str:
    """
    Creates a new frame in Figma with the specified dimensions and position.
    
    Args:
        width: Width of the frame in pixels (default: 100)
        height: Height of the frame in pixels (default: 100)
        x: X position of the frame (default: 0)
        y: Y position of the frame (default: 0)
        name: Name for the frame (default: "Frame")
        parent_id: ID of the parent node (optional)
        layout_mode: Layout mode - "NONE", "HORIZONTAL", or "VERTICAL" (default: "NONE")
    
    Returns:
        A confirmation message with the created frame's ID
    """
    try:
        logger.info(f"🖼️ Creating frame: {width}x{height} at ({x}, {y}) named '{name}'")
        
        params = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name,
            "layoutMode": layout_mode
        }
        
        if parent_id:
            params["parentId"] = parent_id
        
        result = await send_command("create_frame", params)
        
        if isinstance(result, dict) and "id" in result:
            node_id = result["id"]
            logger.info(f"✅ Successfully created frame with ID: {node_id}")
            return f"Successfully created frame '{name}' ({width}x{height}) with ID: {node_id}"
        else:
            return f"Frame '{name}' was created successfully"
            
    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for create_frame with params: {params}")
        raise
    except Exception as e:
        # Handle communication/system errors
        error_msg = f"Failed to create frame due to system error: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def create_rectangle(
    width: int = 100,
    height: int = 100,
    x: int = 0,
    y: int = 0,
    name: str = "Rectangle",
    parent_id: Optional[str] = None
) -> str:
    """
    Creates a new rectangle in Figma.
    
    Args:
        width: Width of the rectangle in pixels (default: 100)
        height: Height of the rectangle in pixels (default: 100)
        x: X position of the rectangle (default: 0)
        y: Y position of the rectangle (default: 0)
        name: Name for the rectangle (default: "Rectangle")
        parent_id: ID of the parent node (optional)
    
    Returns:
        A confirmation message with the created rectangle's ID
    """
    try:
        logger.info(f"🟦 Creating rectangle: {width}x{height} at ({x}, {y}) named '{name}'")
        
        params = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name
        }
        
        if parent_id:
            params["parentId"] = parent_id
        
        result = await send_command("create_rectangle", params)
        
        if isinstance(result, dict) and "id" in result:
            node_id = result["id"]
            return f"Successfully created rectangle '{name}' with ID: {node_id}"
        else:
            return f"Rectangle '{name}' was created successfully"
            
    except Exception as e:
        error_msg = f"Failed to create rectangle: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def create_text(
    text: str,
    parent_id: Optional[str] = None,
    x: int = 0,
    y: int = 0,
    font_size: int = 16,
    font_weight: int = 400,
    name: str = ""
) -> str:
    """
    Creates a text node in Figma.
    
    Args:
        text: The text content
        parent_id: ID of the parent node (optional)
        x: X position (default: 0)
        y: Y position (default: 0)
        font_size: Font size in pixels (default: 16)
        font_weight: Font weight (default: 400)
        name: Name for the text node (default: uses text content)
    
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
            "fontWeight": font_weight,
            "name": name or text
        }
        
        if parent_id:
            params["parentId"] = parent_id
        
        result = await send_command("create_text", params)
        
        if isinstance(result, dict) and "id" in result:
            node_id = result["id"]
            logger.info(f"✅ Successfully created text node with ID: {node_id}")
            return f"Successfully created text '{text}' with ID: {node_id}"
        else:
            return f"Text '{text}' was created successfully"
            
    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for create_text with params: {params}")
        raise
    except Exception as e:
        # Handle communication/system errors
        error_msg = f"Failed to create text due to system error: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === STYLING TOOLS ===

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
        logger.info(f"✅ Successfully set fill color for node {node_id}")
        return f"Successfully set fill color to {hex_color} for node {node_id}"
        
    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for set_fill_color with params: {params}")
        raise
    except Exception as e:
        # Handle communication/system errors
        error_msg = f"Failed to set fill color due to system error: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_stroke_color(
    node_id: str,
    r: float,
    g: float,
    b: float,
    a: float = 1.0,
    weight: int = 1
) -> str:
    """
    Sets the stroke color and weight of a Figma node.
    
    Args:
        node_id: The ID of the node to modify
        r: Red component (0.0 to 1.0)
        g: Green component (0.0 to 1.0)
        b: Blue component (0.0 to 1.0)
        a: Alpha component (0.0 to 1.0, default: 1.0)
        weight: Stroke weight in pixels (default: 1)
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"🖊️ Setting stroke color for node {node_id}")
        
        params = {
            "nodeId": node_id,
            "color": {"r": r, "g": g, "b": b, "a": a},
            "weight": weight
        }
        
        result = await send_command("set_stroke_color", params)
        hex_color = f"#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}"
        return f"Successfully set stroke color to {hex_color} with weight {weight}px for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set stroke color: {str(e)}"
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
        
        logger.info(f"✅ Successfully set corner radius for node {node_id}")
        return f"Successfully set corner radius to {radius}px for node {node_id}"
        
    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for set_corner_radius with params: {params}")
        raise
    except Exception as e:
        # Handle communication/system errors
        error_msg = f"Failed to set corner radius due to system error: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === LAYOUT TOOLS ===

@function_tool
async def set_layout_mode(
    node_id: str,
    layout_mode: str = "NONE",
    layout_wrap: str = "NO_WRAP"
) -> str:
    """
    Sets the layout mode of a frame (enables auto-layout).
    
    Args:
        node_id: The ID of the frame to modify
        layout_mode: Layout mode - "NONE", "HORIZONTAL", or "VERTICAL"
        layout_wrap: Layout wrap - "NO_WRAP" or "WRAP"
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📐 Setting layout mode for node {node_id} to {layout_mode}")
        
        params = {
            "nodeId": node_id,
            "layoutMode": layout_mode,
            "layoutWrap": layout_wrap
        }
        
        result = await send_command("set_layout_mode", params)
        return f"Successfully set layout mode to {layout_mode} for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set layout mode: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_padding(
    node_id: str,
    padding_top: Optional[int] = None,
    padding_right: Optional[int] = None,
    padding_bottom: Optional[int] = None,
    padding_left: Optional[int] = None
) -> str:
    """
    Sets the padding of an auto-layout frame.
    
    Args:
        node_id: The ID of the frame to modify
        padding_top: Top padding in pixels
        padding_right: Right padding in pixels
        padding_bottom: Bottom padding in pixels
        padding_left: Left padding in pixels
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📐 Setting padding for node {node_id}")
        
        params = {"nodeId": node_id}
        if padding_top is not None:
            params["paddingTop"] = padding_top
        if padding_right is not None:
            params["paddingRight"] = padding_right
        if padding_bottom is not None:
            params["paddingBottom"] = padding_bottom
        if padding_left is not None:
            params["paddingLeft"] = padding_left
        
        result = await send_command("set_padding", params)
        return f"Successfully set padding for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set padding: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === NODE MANIPULATION ===

@function_tool
async def move_node(node_id: str, x: int, y: int) -> str:
    """
    Moves a node to a new position.
    
    Args:
        node_id: The ID of the node to move
        x: New X position
        y: New Y position
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"🔄 Moving node {node_id} to ({x}, {y})")
        
        params = {
            "nodeId": node_id,
            "x": x,
            "y": y
        }
        
        result = await send_command("move_node", params)
        return f"Successfully moved node {node_id} to position ({x}, {y})"
        
    except Exception as e:
        error_msg = f"Failed to move node: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def resize_node(node_id: str, width: int, height: int) -> str:
    """
    Resizes a node to new dimensions.
    
    Args:
        node_id: The ID of the node to resize
        width: New width in pixels
        height: New height in pixels
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📏 Resizing node {node_id} to {width}x{height}")
        
        params = {
            "nodeId": node_id,
            "width": width,
            "height": height
        }
        
        result = await send_command("resize_node", params)
        return f"Successfully resized node {node_id} to {width}x{height}"
        
    except Exception as e:
        error_msg = f"Failed to resize node: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def delete_node(node_id: str) -> str:
    """
    Deletes a single node.
    
    Args:
        node_id: The ID of the node to delete
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"🗑️ Deleting node {node_id}")
        
        params = {"nodeId": node_id}
        result = await send_command("delete_node", params)
        return f"Successfully deleted node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to delete node: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def clone_node(node_id: str, x: Optional[int] = None, y: Optional[int] = None) -> str:
    """
    Clones a node and optionally positions it.
    
    Args:
        node_id: The ID of the node to clone
        x: X position for the clone (optional)
        y: Y position for the clone (optional)
    
    Returns:
        A confirmation message with the cloned node's ID
    """
    try:
        logger.info(f"📋 Cloning node {node_id}")
        
        params = {"nodeId": node_id}
        if x is not None:
            params["x"] = x
        if y is not None:
            params["y"] = y
        
        result = await send_command("clone_node", params)
        
        if isinstance(result, dict) and "id" in result:
            clone_id = result["id"]
            return f"Successfully cloned node {node_id} to new node {clone_id}"
        else:
            return f"Successfully cloned node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to clone node: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === TEXT TOOLS ===

@function_tool
async def set_text_content(node_id: str, text: str, smart_strategy: Optional[str] = None) -> str:
    """
    Sets the text content of a text node.
    
    Args:
        node_id: The ID of the text node to modify
        text: New text content
    
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📝 Setting text content for node {node_id} to '{text}'")
        
        params = {
            "nodeId": node_id,
            "text": text
        }
        if smart_strategy:
            params["smartStrategy"] = smart_strategy
        
        result = await send_command("set_text_content", params)
        return f"Successfully set text content of node {node_id} to '{text}'"
        
    except Exception as e:
        error_msg = f"Failed to set text content: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def scan_text_nodes(node_id: str) -> str:
    """
    Scans for all text nodes within a given node.
    
    Args:
        node_id: The ID of the node to scan within
    
    Returns:
        Information about found text nodes
    """
    try:
        logger.info(f"🔍 Scanning text nodes in {node_id}")
        
        params = {"nodeId": node_id}
        result = await send_command("scan_text_nodes", params)
        return f"Text scan results: {result}"
        
    except Exception as e:
        error_msg = f"Failed to scan text nodes: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === COMPONENT TOOLS ===

@function_tool
async def get_local_components() -> str:
    """
    Gets all local components in the document.
    
    Returns:
        List of available local components
    """
    try:
        logger.info("🧩 Getting local components")
        result = await send_command("get_local_components")
        return f"Local components: {result}"
        
    except Exception as e:
        error_msg = f"Failed to get local components: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def create_component_instance(
    component_key: str,
    x: int = 0,
    y: int = 0
) -> str:
    """
    Creates an instance of a component.
    
    Args:
        component_key: The key of the component to instantiate
        x: X position for the instance (default: 0)
        y: Y position for the instance (default: 0)
    
    Returns:
        A confirmation message with the instance ID
    """
    try:
        logger.info(f"🧩 Creating component instance for key {component_key}")
        
        params = {
            "componentKey": component_key,
            "x": x,
            "y": y
        }
        
        result = await send_command("create_component_instance", params)
        
        if isinstance(result, dict) and "id" in result:
            instance_id = result["id"]
            return f"Successfully created component instance with ID: {instance_id}"
        else:
            return f"Successfully created component instance"
        
    except Exception as e:
        error_msg = f"Failed to create component instance: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === UTILITY TOOLS ===

@function_tool
async def export_node_as_image(node_id: str, scale: float = 1.0) -> str:
    """
    Exports a node as an image.
    
    Args:
        node_id: The ID of the node to export
        scale: Export scale factor (default: 1.0)
    
    Returns:
        Base64-encoded image data
    """
    try:
        logger.info(f"📷 Exporting node {node_id} as image")
        
        params = {
            "nodeId": node_id,
            "scale": scale
        }
        
        result = await send_command("export_node_as_image", params)
        return f"Successfully exported node {node_id} as image"
        
    except Exception as e:
        error_msg = f"Failed to export node as image: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_styles() -> str:
    """
    Gets all styles (colors, text, effects, grids) in the document.
    
    Returns:
        Available styles in the document
    """
    try:
        logger.info("🎨 Getting document styles")
        result = await send_command("get_styles")
        return f"Document styles: {result}"
        
    except Exception as e:
        error_msg = f"Failed to get styles: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === CONTEXT GATHERERS ===

@function_tool
async def gather_full_context(include_comments: bool = True, force: bool = False) -> str:
    """
    Gathers exhaustive, untruncated context for the current selection.

    Args:
        include_comments: Also include comments attached to nodes in the selection
        force: Bypass plugin-side cache and recompute

    Returns:
        A JSON string containing document info and a fully expanded tree for each selected node
    """
    try:
        logger.info("🧾 Gathering FULL selection context (max depth, no truncation)")
        params = { "includeComments": bool(include_comments), "force": bool(force) }
        result = await send_command("gather_full_context", params)
        return f"Full context: {result}"
    except Exception as e:
        error_msg = f"Failed to gather full context: {str(e)}"
        logger.error(error_msg)
        return error_msg

# === ADDITIONAL TOOLS FROM CODE.JS ===

@function_tool
async def read_my_design() -> str:
    """
    Reads the design of all currently selected nodes.
    
    Returns:
        Design information for selected nodes
    """
    try:
        logger.info("📖 Reading design of selected nodes")
        result = await send_command("read_my_design")
        return f"Design information: {result}"
        
    except Exception as e:
        error_msg = f"Failed to read design: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def delete_multiple_nodes(node_ids: List[str]) -> str:
    """
    Deletes multiple nodes at once.
    
    Args:
        node_ids: List of node IDs to delete
        
    Returns:
        A confirmation message with deletion results
    """
    try:
        logger.info(f"🗑️ Deleting {len(node_ids)} nodes")
        
        params = {"nodeIds": node_ids}
        result = await send_command("delete_multiple_nodes", params)
        return f"Successfully deleted {len(node_ids)} nodes: {result}"
        
    except Exception as e:
        error_msg = f"Failed to delete multiple nodes: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_multiple_text_contents(node_id: str, text_replacements: List[TextReplacement]) -> str:
    """
    Sets text content for multiple text nodes at once.
    
    Args:
        node_id: The root node ID to scan
        text_replacements: List of text replacement objects with nodeId and text
        
    Returns:
        A confirmation message with replacement results
    """
    try:
        logger.info(f"📝 Setting multiple text contents for {len(text_replacements)} nodes")
        
        # Convert Pydantic models to dicts for the plugin
        text_list = [tr.dict() for tr in text_replacements]
        params = {
            "nodeId": node_id,
            "text": text_list
        }
        result = await send_command("set_multiple_text_contents", params)
        return f"Text replacement results: {result}"
        
    except Exception as e:
        error_msg = f"Failed to set multiple text contents: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_annotations(node_id: Optional[str] = None, include_categories: bool = True) -> str:
    """
    Gets annotations from a node or all annotations in the document.
    
    Args:
        node_id: The ID of the node to get annotations from (optional)
        include_categories: Whether to include annotation categories
        
    Returns:
        Annotation information
    """
    try:
        logger.info(f"📋 Getting annotations for node: {node_id or 'all'}")
        
        params = {"includeCategories": include_categories}
        if node_id:
            params["nodeId"] = node_id
            
        result = await send_command("get_annotations", params)
        return f"Annotations: {result}"
        
    except Exception as e:
        error_msg = f"Failed to get annotations: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_annotation(
    node_id: str,
    label_markdown: str,
    category_id: Optional[str] = None,
    properties: Optional[List[AnnotationProperty]] = None
) -> str:
    """
    Sets an annotation on a node.
    
    Args:
        node_id: The ID of the node to annotate
        label_markdown: The annotation text in markdown format
        category_id: Optional category ID for the annotation
        properties: Optional annotation properties
        
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📋 Setting annotation on node {node_id}")
        
        params = {
            "nodeId": node_id,
            "labelMarkdown": label_markdown
        }
        
        if category_id:
            params["categoryId"] = category_id
        if properties:
            params["properties"] = [prop.dict() for prop in properties]
            
        result = await send_command("set_annotation", params)
        return f"Successfully set annotation on node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set annotation: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def scan_nodes_by_types(node_id: str, types: List[str]) -> str:
    """
    Scans for nodes of specific types within a given node.
    
    Args:
        node_id: The ID of the node to scan within
        types: List of node types to find (e.g., ['COMPONENT', 'FRAME'])
        
    Returns:
        Information about found nodes
    """
    try:
        logger.info(f"🔍 Scanning for node types {types} in {node_id}")
        
        params = {
            "nodeId": node_id,
            "types": types
        }
        result = await send_command("scan_nodes_by_types", params)
        return f"Node scan results: {result}"
        
    except Exception as e:
        error_msg = f"Failed to scan nodes by types: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_multiple_annotations(node_id: str, annotations: List[Annotation]) -> str:
    """
    Sets multiple annotations at once.
    
    Args:
        node_id: The node ID context for annotations
        annotations: List of annotation objects
        
    Returns:
        A confirmation message with annotation results
    """
    try:
        logger.info(f"📋 Setting {len(annotations)} annotations")
        
        # Convert Pydantic models to dicts for the plugin
        annotation_list = [ann.dict() for ann in annotations]
        params = {
            "nodeId": node_id,
            "annotations": annotation_list
        }
        result = await send_command("set_multiple_annotations", params)
        return f"Annotation results: {result}"
        
    except Exception as e:
        error_msg = f"Failed to set multiple annotations: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_reactions(node_ids: List[str]) -> str:
    """
    Gets reactions (interactions) from specified nodes.
    
    Args:
        node_ids: List of node IDs to check for reactions
        
    Returns:
        Information about found reactions
    """
    try:
        logger.info(f"⚡ Getting reactions for {len(node_ids)} nodes")
        
        params = {"nodeIds": node_ids}
        result = await send_command("get_reactions", params)
        return f"Reactions found: {result}"
        
    except Exception as e:
        error_msg = f"Failed to get reactions: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def get_instance_overrides(instance_node_id: Optional[str] = None) -> str:
    """
    Gets component instance overrides.
    
    Args:
        instance_node_id: The ID of the instance node (optional, uses selection if not provided)
        
    Returns:
        Instance override information
    """
    try:
        logger.info(f"🧩 Getting instance overrides for: {instance_node_id or 'selection'}")
        
        params = {}
        if instance_node_id:
            params["instanceNodeId"] = instance_node_id
            
        result = await send_command("get_instance_overrides", params)
        return f"Instance overrides: {result}"
        
    except Exception as e:
        error_msg = f"Failed to get instance overrides: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_instance_overrides(
    target_node_ids: List[str],
    source_instance_id: str
) -> str:
    """
    Sets instance overrides from a source instance to target instances.
    
    Args:
        target_node_ids: List of target instance node IDs
        source_instance_id: Source instance ID to copy overrides from
        
    Returns:
        A confirmation message with override results
    """
    try:
        logger.info(f"🧩 Setting instance overrides for {len(target_node_ids)} instances")
        
        params = {
            "targetNodeIds": target_node_ids,
            "sourceInstanceId": source_instance_id
        }
        result = await send_command("set_instance_overrides", params)
        return f"Instance override results: {result}"
        
    except Exception as e:
        error_msg = f"Failed to set instance overrides: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_axis_align(
    node_id: str,
    primary_axis_align_items: Optional[str] = None,
    counter_axis_align_items: Optional[str] = None
) -> str:
    """
    Sets axis alignment for auto-layout frames.
    
    Args:
        node_id: The ID of the frame to modify
        primary_axis_align_items: Primary axis alignment - "MIN", "MAX", "CENTER", "SPACE_BETWEEN"
        counter_axis_align_items: Counter axis alignment - "MIN", "MAX", "CENTER", "BASELINE"
        
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📐 Setting axis alignment for node {node_id}")
        
        params = {"nodeId": node_id}
        if primary_axis_align_items:
            params["primaryAxisAlignItems"] = primary_axis_align_items
        if counter_axis_align_items:
            params["counterAxisAlignItems"] = counter_axis_align_items
            
        result = await send_command("set_axis_align", params)
        return f"Successfully set axis alignment for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set axis alignment: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_layout_sizing(
    node_id: str,
    layout_sizing_horizontal: Optional[str] = None,
    layout_sizing_vertical: Optional[str] = None
) -> str:
    """
    Sets layout sizing for auto-layout frames.
    
    Args:
        node_id: The ID of the frame to modify
        layout_sizing_horizontal: Horizontal sizing - "FIXED", "HUG", "FILL"
        layout_sizing_vertical: Vertical sizing - "FIXED", "HUG", "FILL"
        
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📐 Setting layout sizing for node {node_id}")
        
        params = {"nodeId": node_id}
        if layout_sizing_horizontal:
            params["layoutSizingHorizontal"] = layout_sizing_horizontal
        if layout_sizing_vertical:
            params["layoutSizingVertical"] = layout_sizing_vertical
            
        result = await send_command("set_layout_sizing", params)
        return f"Successfully set layout sizing for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set layout sizing: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_item_spacing(
    node_id: str,
    item_spacing: Optional[int] = None,
    counter_axis_spacing: Optional[int] = None
) -> str:
    """
    Sets item spacing for auto-layout frames.
    
    Args:
        node_id: The ID of the frame to modify
        item_spacing: Spacing between items in pixels
        counter_axis_spacing: Counter axis spacing in pixels (for wrap layouts)
        
    Returns:
        A confirmation message
    """
    try:
        logger.info(f"📐 Setting item spacing for node {node_id}")
        
        params = {"nodeId": node_id}
        if item_spacing is not None:
            params["itemSpacing"] = item_spacing
        if counter_axis_spacing is not None:
            params["counterAxisSpacing"] = counter_axis_spacing
            
        result = await send_command("set_item_spacing", params)
        return f"Successfully set item spacing for node {node_id}"
        
    except Exception as e:
        error_msg = f"Failed to set item spacing: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def set_default_connector(connector_id: Optional[str] = None) -> str:
    """
    Sets or finds a default connector for creating connections.
    
    Args:
        connector_id: The ID of the connector to set as default (optional)
        
    Returns:
        A confirmation message with connector information
    """
    try:
        logger.info(f"🔗 Setting default connector: {connector_id or 'auto-find'}")
        
        params = {}
        if connector_id:
            params["connectorId"] = connector_id
            
        result = await send_command("set_default_connector", params)
        return f"Default connector result: {result}"
        
    except Exception as e:
        error_msg = f"Failed to set default connector: {str(e)}"
        logger.error(error_msg)
        return error_msg

@function_tool
async def create_connections(connections: List[Connection]) -> str:
    """
    Creates connections between nodes using the default connector.
    
    Args:
        connections: List of connection objects with startNodeId, endNodeId, and optional text
        
    Returns:
        A confirmation message with connection results
    """
    try:
        logger.info(f"🔗 Creating {len(connections)} connections")
        
        # Convert Pydantic models to dicts for the plugin
        connection_list = [conn.dict() for conn in connections]
        params = {"connections": connection_list}
        result = await send_command("create_connections", params)
        return f"Connection results: {result}"
        
    except Exception as e:
        error_msg = f"Failed to create connections: {str(e)}"
        logger.error(error_msg)
        return error_msg
