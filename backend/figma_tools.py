"""
Figma Tools - OpenAI Agent Tools

This module defines the tools that the OpenAI Agent can use to interact
with Figma through the plugin via the figma_communicator.

All tools are dynamically generated based on the available commands in the plugin.
"""

import logging
import json
from typing import Optional, List, Any, Dict, Literal
from pydantic import BaseModel, ConfigDict
from agents import function_tool
from figma_communicator import send_command, ToolExecutionError

logger = logging.getLogger(__name__)

# === INTERNAL HELPERS ===

def _to_json_string(result: Any) -> str:
    """Convert plugin result to a JSON string for model reasoning."""
    try:
        if isinstance(result, str):
            # Assume plugin already returned a JSON/string payload
            return result
        return json.dumps(result, ensure_ascii=False)
    except Exception:
        # Fallback: wrap as string field
        return json.dumps({"result": str(result)}, ensure_ascii=False)

def _error_json(message: str) -> str:
    return json.dumps({"success": False, "message": message}, ensure_ascii=False)

def _sanitize_color_value(value: float, default: float = 0.0) -> float:
    """Sanitizes a color component to be a float between 0.0 and 1.0."""
    try:
        v = float(value)
        return max(0.0, min(1.0, v))
    except (ValueError, TypeError):
        return default

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

# Strict RGBA color model for tool schemas
class RGBAColor(BaseModel):
    model_config = ConfigDict(extra='forbid')
    r: float
    g: float
    b: float
    a: Optional[float] = 1.0

class ConstraintsKV(BaseModel):
    model_config = ConfigDict(extra='forbid')
    horizontal: Literal["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]
    vertical: Literal["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]

# === CORE NODE OPERATIONS ===

@function_tool
async def get_document_info() -> str:
    """{
      "category": "inspect",
      "mutates_canvas": false,
      "description": "Return current page metadata and top-level child summaries.",
      "when_to_use": "You need broad context (page, names, IDs) before targeted actions.",
      "when_not_to_use": "You already know precise node IDs (prefer get_selection/get_node_info).",
      "parameters": {},
      "returns": "{ name, id, type, children: [{ id, name, type }], currentPage: { id, name, childCount }, pages: [{ id, name, childCount }] }",
      "hints": [
        "Prefer this before heavy scans; it’s cheaper than gather_full_context.",
        "Use children IDs to pivot to get_node_info/get_nodes_info for details.",
        "Use the page ID to constrain follow-up queries."
      ],
      "pitfalls": [
        "Do not assume selection belongs to the first page returned; check IDs.",
        "Large docs may truncate noncritical fields in summaries."
      ],
      "errors": [
        "page_load_failed — Retry later or switch to a smaller context.",
        "unknown_plugin_error — Re-read selection or retry the call."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Only the current page is reported in pages[].",
        "Children are immediate children of current page only."
      ],
      "preconditions": [
        "A Figma document with an active currentPage exists.",
        "The plugin has permission to read the document structure."
      ],
      "postchecks": [
        "The root 'id' equals currentPage.id.",
        "children.length equals currentPage.childCount."
      ],
      "agent_chaining": [
        "Use page.children[*].id with get_node_info/get_nodes_info.",
        "Call get_selection next if you need to act on selected nodes."
      ],
      "related_tools": ["get_selection", "gather_full_context", "get_styles"],
      "example_params": {}
    }"""
    try:
        logger.info("📄 Getting document info")
        result = await send_command("get_document_info")
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool get_document_info failed: {getattr(te, 'message', str(te))}")
        # Re-raise structured tool error to enable agent self-correction
        raise
    except Exception as e:
        # Normalize non-tool failures to ToolExecutionError
        logger.error(f"❌ Communication/system error in get_document_info: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get document info: {str(e)}",
            "details": {"command": "get_document_info"}
        })

@function_tool
async def get_selection() -> str:
    """{
      "category": "inspect",
      "mutates_canvas": false,
      "description": "Read the current selection snapshot (ids, types, visibility).",
      "when_to_use": "Before acting on selected nodes or confirming targets.",
      "when_not_to_use": "You need deep details for a specific node (use get_node_info).",
      "parameters": {},
      "returns": "{ selectionCount: number, selection: [{ id: string, name: string, type: string, visible: boolean }] }",
      "hints": [
        "Use ids from selection to call get_node_info/get_nodes_info.",
        "If empty, use get_document_info or gather_full_context to locate nodes.",
        "Chain with scroll_and_zoom_into_view for UX focus."
      ],
      "pitfalls": [
        "Selection can be empty; handle gracefully.",
        "Mixed node types require branching in follow-ups.",
        "Indirectly selected children do not appear in selection[]."
      ],
      "errors": [
        "selection_read_failed — Retry the call or fall back to get_document_info.",
        "unknown_plugin_error — Re-read selection or retry; inspect details."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Returns only the current page selection.",
        "Does not include deep properties (use get_node_info)."
      ],
      "preconditions": [
        "A Figma document with an active currentPage exists.",
        "Plugin has permission to read the selection."
      ],
      "postchecks": [
        "selectionCount equals selection.length."
      ],
      "agent_chaining": [
        "Call get_nodes_info on returned ids to fetch details.",
        "Use scroll_and_zoom_into_view to focus the selection."
      ],
      "related_tools": ["get_node_info", "get_nodes_info", "scroll_and_zoom_into_view"],
      "example_params": {}
    }"""
    try:
        logger.info("🎯 Getting current selection")
        result = await send_command("get_selection")
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool get_selection failed: {getattr(te, 'message', str(te))}")
        # Re-raise structured tool error to enable agent self-correction
        raise
    except Exception as e:
        # Normalize non-tool failures to ToolExecutionError
        logger.error(f"❌ Communication/system error in get_selection: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get selection: {str(e)}",
            "details": {"command": "get_selection"}
        })

@function_tool
async def get_node_info(node_id: str) -> str:
    """{
      "category": "inspect",
      "mutates_canvas": false,
      "description": "Return filtered JSON for a node via exportAsync(JSON_REST_V1).",
      "when_to_use": "You need deep details for a single node.",
      "when_not_to_use": "Broad context is needed (prefer get_document_info/get_selection).",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Target node ID." }
      },
      "returns": "Filtered node JSON or null for vectors: { id, name, type, fills?, strokes?, cornerRadius?, absoluteBoundingBox?, characters?, style?, children? }",
      "hints": [
        "Check auto-layout vs absolute positioning before moving/resizing.",
        "Use style fields (fontSize, fontWeight) to plan text updates.",
        "If null is returned, the node is a vector; use export_node_as_image instead."
      ],
      "pitfalls": [
        "Requesting on a deleted/missing node returns node_not_found.",
        "Vectors are omitted (returns null).",
        "IDs from other files are invalid in the current document."
      ],
      "errors": [
        "missing_parameter — Provide node_id.",
        "node_not_found — Re-select or search for the correct node.",
        "export_failed — Retry once; if persistent, fall back to get_nodes_info.",
        "unknown_plugin_error — Re-run with fresh selection; inspect details.",
        "communication_error — Bridge not reachable; restart the plugin session."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Only properties included in JSON_REST_V1 are returned.",
        "Child arrays may be filtered and exclude vectors."
      ],
      "preconditions": [
        "The node exists in the open document.",
        "Plugin has permission to read nodes."
      ],
      "postchecks": [
        "Returned id equals the requested node_id.",
        "If returned.type is FRAME, absoluteBoundingBox is present."
      ],
      "agent_chaining": ["scroll_and_zoom_into_view", "set_text_content", "set_fill_color"],
      "related_tools": ["get_nodes_info", "get_selection", "export_node_as_image"],
      "example_params": { "node_id": "12:34" }
    }"""
    try:
        logger.info(f"🔍 Getting info for node: {node_id}")
        result = await send_command("get_node_info", {"nodeId": node_id})
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool get_node_info failed: {getattr(te, 'message', str(te))}")
        # Re-raise structured tool error for agent self-correction
        raise
    except Exception as e:
        # Normalize non-tool failures to ToolExecutionError
        logger.error(f"❌ Communication/system error in get_node_info: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get node info: {str(e)}",
            "details": {"command": "get_node_info", "nodeId": node_id}
        })

@function_tool
async def get_nodes_info(node_ids: List[str]) -> str:
    """
    {
      "category": "inspect",
      "mutates_canvas": false,
      "description": "Batch-inspect multiple nodes and return filtered JSON for each.",
      "when_to_use": "You need details for several nodes at once.",
      "when_not_to_use": "Only one node is needed (prefer get_node_info).",
      "parameters": {
        "node_ids": { "type": "string[]", "required": true, "notes": "Array of Figma node IDs." }
      },
      "returns": "Array of { nodeId, document|null, error? } in input order.",
      "hints": [
        "Batch reads are cheaper than many single reads.",
        "Use outputs to plan coordinated mutations (set_multiple_text_contents, set_layout_mode).",
        "Compare across results to spot inconsistencies in variants/properties."
      ],
      "pitfalls": [
        "Partial results: invalid IDs are included with error and document=null.",
        "Large batches can be slower—only request what you need."
      ],
      "errors": [
        "missing_parameter — Provide node_ids as a non-empty array.",
        "invalid_parameter — Ensure all node_ids are strings.",
        "no_valid_nodes — Re-select or discover valid targets, then retry.",
        "unknown_plugin_error — Retry; if persistent, inspect details.",
        "communication_error — Bridge not reachable; restart the plugin session."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Filtered JSON excludes vector geometry and large binary blobs.",
        "Per-entry export failures are returned inline (document=null)."
      ],
      "preconditions": [
        "Node IDs reference nodes in the current Figma document.",
        "Plugin session is active and connected via the bridge."
      ],
      "postchecks": [
        "results.length equals node_ids.length",
        "At least one entry has document != null on success"
      ],
      "agent_chaining": [
        "Use selection ids → get_nodes_info → mutate with set_* tools"
      ],
      "related_tools": ["get_node_info", "scan_text_nodes", "set_multiple_text_contents"],
      "example_params": { "node_ids": ["12:1", "34:2"] }
    }
    """
    try:
        logger.info(f"🔍 Getting info for {len(node_ids)} nodes")
        result = await send_command("get_nodes_info", {"nodeIds": node_ids})
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool get_nodes_info failed: {getattr(te, 'message', str(te))}")
        # Re-raise structured tool error to enable agent self-correction
        raise
    except Exception as e:
        # Normalize non-tool failures to ToolExecutionError
        logger.error(f"❌ Communication/system error in get_nodes_info: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get nodes info: {str(e)}",
            "details": {"command": "get_nodes_info", "nodeIds": node_ids}
        })

# === CREATION TOOLS ===

@function_tool
async def create_frame(
    width: int = 100,
    height: int = 100,
    x: int = 0,
    y: int = 0,
    name: str = "Frame",
    parent_id: Optional[str] = None,
    layout_mode: str = "NONE",
    layout_wrap: Optional[str] = None,
    padding_top: Optional[float] = None,
    padding_right: Optional[float] = None,
    padding_bottom: Optional[float] = None,
    padding_left: Optional[float] = None,
    primary_axis_align_items: Optional[str] = None,
    counter_axis_align_items: Optional[str] = None,
    layout_sizing_horizontal: Optional[str] = None,
    layout_sizing_vertical: Optional[str] = None,
    item_spacing: Optional[float] = None,
    fill_color: Optional[RGBAColor] = None,
    stroke_color: Optional[RGBAColor] = None,
    stroke_weight: Optional[int] = None,
) -> str:
    """
    {
      "category": "create",
      "mutates_canvas": true,
      "description": "Create a new Frame node with optional auto layout and styling.",
      "when_to_use": "You need a container to organize or host UI elements.",
      "when_not_to_use": "You only need grouping semantics (prefer group) or to update an existing frame.",
      "parameters": {
        "width": { "type": "number", "required": false, "notes": "Initial width in px." },
        "height": { "type": "number", "required": false, "notes": "Initial height in px." },
        "x": { "type": "number", "required": false, "notes": "X position." },
        "y": { "type": "number", "required": false, "notes": "Y position." },
        "name": { "type": "string", "required": false },
        "parent_id": { "type": "string", "required": false, "notes": "Defaults to current page if omitted." },
        "layout_mode": { "type": "string", "required": false, "notes": "NONE | HORIZONTAL | VERTICAL" },
        "layout_wrap": { "type": "string", "required": false, "notes": "NO_WRAP | WRAP" },
        "padding_top": { "type": "number", "required": false },
        "padding_right": { "type": "number", "required": false },
        "padding_bottom": { "type": "number", "required": false },
        "padding_left": { "type": "number", "required": false },
        "primary_axis_align_items": { "type": "string", "required": false, "notes": "MIN | MAX | CENTER | SPACE_BETWEEN" },
        "counter_axis_align_items": { "type": "string", "required": false, "notes": "MIN | MAX | CENTER | BASELINE" },
        "layout_sizing_horizontal": { "type": "string", "required": false, "notes": "FIXED | HUG | FILL" },
        "layout_sizing_vertical": { "type": "string", "required": false, "notes": "FIXED | HUG | FILL" },
        "item_spacing": { "type": "number", "required": false },
        "fill_color": { "type": "object", "required": false, "notes": "{ r,g,b,a } 0..1" },
        "stroke_color": { "type": "object", "required": false, "notes": "{ r,g,b,a } 0..1" },
        "stroke_weight": { "type": "number", "required": false }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], node: { id, name, x, y, width, height, fills?, strokes?, strokeWeight?, layoutMode?, layoutWrap?, parentId? } }",
      "hints": [
        "Enable Auto Layout via layout_mode to configure padding and spacing immediately.",
        "Set layout sizing to HUG/FILL to avoid fixed-size traps.",
        "If styling is deferred, chain with set_fill_color/set_stroke_color later."
      ],
      "pitfalls": [
        "Using an invalid parent_id will fail the call.",
        "Passing auto layout fields while layout_mode is NONE has no effect.",
        "Using invalid enums will be rejected by the plugin."
      ],
      "errors": [
        "parent_not_found — Re-select a valid parent and retry.",
        "invalid_parent_type — Choose a parent that supports children.",
        "locked_parent — Unlock the parent or choose a different one.",
        "append_failed — Retry; if persistent, reparent after creation.",
        "create_frame_failed — Retry; if persistent, reduce parameters.",
        "plugin_reported_failure — Inspect details.result and retry after correction.",
        "communication_error — Bridge unreachable; restart session and retry."
      ],
      "side_effects": [
        "Creates a new Frame node and appends to parent or current page.",
        "May set fills/strokes when provided."
      ],
      "limits": [
        "Does not import external styles; applies inline paints only.",
        "No vector geometry creation; frame only."
      ],
      "preconditions": [
        "Figma document is open and plugin is connected.",
        "Parent (if provided) exists and accepts children."
      ],
      "postchecks": [
        "Returned node.id exists and is selectable on canvas.",
        "node.parentId equals parent_id when provided."
      ],
      "agent_chaining": [
        "set_layout_mode", "set_padding", "set_item_spacing", "set_layout_sizing", "set_fill_color", "set_stroke_color"
      ],
      "related_tools": ["set_layout_mode", "set_padding", "set_layout_sizing", "set_item_spacing"],
      "example_params": { "x": 24, "y": 24, "name": "Card", "width": 320, "height": 200, "layout_mode": "VERTICAL", "item_spacing": 8 }
    }
    """
    try:
        logger.info(f"🖼️ Creating frame: {width}x{height} at ({x}, {y}) named '{name}'")

        params: Dict[str, Any] = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name,
            "layoutMode": layout_mode,
        }
        if parent_id:
            params["parentId"] = parent_id

        # Optional layout fields
        if layout_wrap is not None:
            params["layoutWrap"] = layout_wrap
        if padding_top is not None:
            params["paddingTop"] = padding_top
        if padding_right is not None:
            params["paddingRight"] = padding_right
        if padding_bottom is not None:
            params["paddingBottom"] = padding_bottom
        if padding_left is not None:
            params["paddingLeft"] = padding_left
        if primary_axis_align_items is not None:
            params["primaryAxisAlignItems"] = primary_axis_align_items
        if counter_axis_align_items is not None:
            params["counterAxisAlignItems"] = counter_axis_align_items
        if layout_sizing_horizontal is not None:
            params["layoutSizingHorizontal"] = layout_sizing_horizontal
        if layout_sizing_vertical is not None:
            params["layoutSizingVertical"] = layout_sizing_vertical
        if item_spacing is not None:
            params["itemSpacing"] = item_spacing

        # Optional styling fields
        if fill_color is not None:
            params["fillColor"] = {
                "r": _sanitize_color_value(getattr(fill_color, "r", 0.0), 0.0),
                "g": _sanitize_color_value(getattr(fill_color, "g", 0.0), 0.0),
                "b": _sanitize_color_value(getattr(fill_color, "b", 0.0), 0.0),
                "a": _sanitize_color_value(getattr(fill_color, "a", 1.0) or 1.0, 1.0),
            }
        if stroke_color is not None:
            params["strokeColor"] = {
                "r": _sanitize_color_value(getattr(stroke_color, "r", 0.0), 0.0),
                "g": _sanitize_color_value(getattr(stroke_color, "g", 0.0), 0.0),
                "b": _sanitize_color_value(getattr(stroke_color, "b", 0.0), 0.0),
                "a": _sanitize_color_value(getattr(stroke_color, "a", 1.0) or 1.0, 1.0),
            }
        if stroke_weight is not None:
            params["strokeWeight"] = stroke_weight

        result = await send_command("create_frame", params)
        return _to_json_string(result)

    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for create_frame: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_frame: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to create frame: {str(e)}",
            "details": {"command": "create_frame"}
        })

@function_tool
async def create_rectangle(
    width: int = 100,
    height: int = 100,
    x: int = 0,
    y: int = 0,
    name: str = "Rectangle",
    parent_id: Optional[str] = None,
    # Styling (RGBA floats 0..1)
    fill: Optional[RGBAColor] = None,
    stroke: Optional[RGBAColor] = None,
    stroke_weight: Optional[float] = None,
    stroke_align: Optional[Literal["CENTER", "INSIDE", "OUTSIDE"]] = None,  # CENTER | INSIDE | OUTSIDE
    # Corners
    corner_radius: Optional[float] = None,
    top_left_radius: Optional[float] = None,
    top_right_radius: Optional[float] = None,
    bottom_left_radius: Optional[float] = None,
    bottom_right_radius: Optional[float] = None,
    # Misc geometry
    rotation: Optional[float] = None,
    opacity: Optional[float] = None,
    # Visibility/locking
    visible: Optional[bool] = None,
    locked: Optional[bool] = None,
    # Layout
    layout_align: Optional[Literal["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"]] = None,
    constraints: Optional[ConstraintsKV] = None,  # { horizontal, vertical }
    # UX helper
    select: bool = False,
) -> str:
    """{
      "category": "create",
      "mutates_canvas": true,
      "description": "Create a rectangle with optional style, corners, and layout.",
      "when_to_use": "You need a new rectangular layer on the canvas.",
      "when_not_to_use": "You need non-rectangular vectors (use ellipse or vector tools).",
      "parameters": {
        "width": { "type": "number", "required": false, "notes": "> 0; default 100" },
        "height": { "type": "number", "required": false, "notes": "> 0; default 100" },
        "x": { "type": "number", "required": false, "notes": "Position X; default 0" },
        "y": { "type": "number", "required": false, "notes": "Position Y; default 0" },
        "name": { "type": "string", "required": false, "notes": "Layer name; default 'Rectangle'" },
        "parent_id": { "type": "string", "required": false, "notes": "Append to parent if provided" },
        "fill": { "type": "object", "required": false, "notes": "Solid RGBA in [0,1]" },
        "stroke": { "type": "object", "required": false, "notes": "Solid RGBA in [0,1]" },
        "stroke_weight": { "type": "number", "required": false, "notes": ">= 0" },
        "stroke_align": { "type": "string", "required": false, "notes": "CENTER|INSIDE|OUTSIDE" },
        "corner_radius": { "type": "number", "required": false, "notes": ">= 0 uniform" },
        "top_left_radius": { "type": "number", "required": false, "notes": ">= 0" },
        "top_right_radius": { "type": "number", "required": false, "notes": ">= 0" },
        "bottom_left_radius": { "type": "number", "required": false, "notes": ">= 0" },
        "bottom_right_radius": { "type": "number", "required": false, "notes": ">= 0" },
        "rotation": { "type": "number", "required": false, "notes": "Degrees" },
        "opacity": { "type": "number", "required": false, "notes": "0..1" },
        "visible": { "type": "boolean", "required": false, "notes": "Default true" },
        "locked": { "type": "boolean", "required": false, "notes": "Default false" },
        "layout_align": { "type": "string", "required": false, "notes": "MIN|CENTER|MAX|STRETCH|INHERIT" },
        "constraints": { "type": "object", "required": false, "notes": "{horizontal,vertical}: MIN|CENTER|MAX|STRETCH|SCALE" },
        "select": { "type": "boolean", "required": false, "notes": "Select and focus after creation" }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], node: { id, name, x, y, width, height, parentId? } }",
      "hints": [
        "Provide either uniform or per-corner radii; per-corner overrides uniform.",
        "Use constraints/layout_align only when parenting into frames.",
        "Set select=true to focus the new node for follow-up actions."
      ],
      "pitfalls": [
        "Color components must be floats in [0,1].",
        "Negative sizes or radii are rejected.",
        "Invalid enums (stroke_align/layout_align/constraints) will fail validation."
      ],
      "errors": [
        "invalid_size — Provide width/height > 0 and retry.",
        "invalid_fills — Fix fill RGBA to numbers in [0,1].",
        "invalid_strokes — Fix stroke RGBA to numbers in [0,1].",
        "invalid_stroke_weight — Provide non-negative stroke_weight.",
        "invalid_stroke_align — Use CENTER|INSIDE|OUTSIDE.",
        "invalid_corner_radius — Provide non-negative corner radii.",
        "invalid_rotation — Provide a numeric rotation value.",
        "invalid_opacity — Provide opacity 0..1.",
        "invalid_layout_align — Use MIN|CENTER|MAX|STRETCH|INHERIT.",
        "invalid_constraints — Provide horizontal/vertical within allowed set.",
        "parent_not_found — Re-select or pass a valid parent_id.",
        "invalid_parent — Choose a parent that accepts children (e.g., FRAME).",
        "plugin_reported_failure — Inspect result.details and retry if feasible.",
        "unknown_plugin_error — Retry once; if persistent, inspect details.",
        "communication_error — Bridge not reachable; restart the session."
      ],
      "side_effects": [
        "Adds a new rectangle to the canvas.",
        "May change selection when select=true."
      ],
      "limits": [
        "Only SOLID fill/stroke are supported by this tool.",
        "Does not apply styles via styleId (use dedicated style tools)."
      ],
      "preconditions": [
        "A Figma document is open and editable.",
        "Parent (if provided) exists in the current file."
      ],
      "postchecks": [
        "The returned node.id exists in the document.",
        "Node size matches requested width/height (within Figma constraints)."
      ],
      "agent_chaining": [
        "unlock_layers on locked parents before retrying.",
        "set_fill_color or set_stroke after creation for complex styling."
      ],
      "related_tools": ["create_frame", "create_text", "set_fill_color", "get_selection"],
      "example_params": { "x": 64, "y": 64, "width": 200, "height": 120, "name": "Card", "fill": { "r": 0.97, "g": 0.97, "b": 0.97 }, "corner_radius": 8, "select": true }
    }"""
    try:
        logger.info(f"🟦 Creating rectangle: {width}x{height} at ({x}, {y}) named '{name}'")

        params: Dict[str, Any] = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name,
        }

        if parent_id:
            params["parentId"] = parent_id

        # Optional styling
        if fill is not None:
            params["fill"] = {
                "r": _sanitize_color_value(getattr(fill, "r", 0.0)),
                "g": _sanitize_color_value(getattr(fill, "g", 0.0)),
                "b": _sanitize_color_value(getattr(fill, "b", 0.0)),
                "a": _sanitize_color_value(getattr(fill, "a", 1.0) or 1.0),
            }
        if stroke is not None:
            params["stroke"] = {
                "r": _sanitize_color_value(getattr(stroke, "r", 0.0)),
                "g": _sanitize_color_value(getattr(stroke, "g", 0.0)),
                "b": _sanitize_color_value(getattr(stroke, "b", 0.0)),
                "a": _sanitize_color_value(getattr(stroke, "a", 1.0) or 1.0),
            }
        if stroke_weight is not None:
            params["strokeWeight"] = float(stroke_weight)
        if stroke_align is not None:
            params["strokeAlign"] = str(stroke_align).upper()

        # Corners
        if corner_radius is not None:
            params["cornerRadius"] = float(corner_radius)
        if top_left_radius is not None:
            params["topLeftRadius"] = float(top_left_radius)
        if top_right_radius is not None:
            params["topRightRadius"] = float(top_right_radius)
        if bottom_left_radius is not None:
            params["bottomLeftRadius"] = float(bottom_left_radius)
        if bottom_right_radius is not None:
            params["bottomRightRadius"] = float(bottom_right_radius)

        # Misc geometry
        if rotation is not None:
            params["rotation"] = float(rotation)
        if opacity is not None:
            params["opacity"] = _sanitize_color_value(opacity, 1.0)

        # Visibility/locking
        if visible is not None:
            params["visible"] = bool(visible)
        if locked is not None:
            params["locked"] = bool(locked)

        # Layout
        if layout_align is not None:
            params["layoutAlign"] = str(layout_align).upper()
        if constraints is not None:
            params["constraints"] = {
                "horizontal": getattr(constraints, "horizontal", "MIN"),
                "vertical": getattr(constraints, "vertical", "MIN"),
            }

        # UX helper
        if select:
            params["select"] = True

        result = await send_command("create_rectangle", params)
        return _to_json_string(result)

    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for create_rectangle with params: {{'width': {width}, 'height': {height}}}")
        raise
    except Exception as e:
        # Normalize non-tool failures to ToolExecutionError
        logger.error(f"❌ Communication/system error in create_rectangle: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to create rectangle due to system error: {str(e)}",
            "details": {"command": "create_rectangle"}
        })

@function_tool
async def create_text(
    text: str,
    parent_id: Optional[str] = None,
    x: int = 0,
    y: int = 0,
    font_size: int = 16,
    font_weight: int = 400,
    name: str = "",
    font_color: Optional[RGBAColor] = None,
) -> str:
    """{
      "category": "text",
      "mutates_canvas": true,
      "description": "Create a text node with optional font size, weight, and color.",
      "when_to_use": "Add labels, headings, or button text.",
      "when_not_to_use": "You need a container or shape (use create_frame/create_rectangle).",
      "parameters": {
        "text": { "type": "string", "required": true },
        "parent_id": { "type": "string", "required": false, "notes": "Append under this parent if provided" },
        "x": { "type": "number", "required": false, "notes": "Position X; default 0" },
        "y": { "type": "number", "required": false, "notes": "Position Y; default 0" },
        "font_size": { "type": "number", "required": false, "notes": "> 0; default 16" },
        "font_weight": { "type": "number", "required": false, "notes": "100..900 mapped to Inter styles" },
        "name": { "type": "string", "required": false, "notes": "Layer name; defaults to text" },
        "font_color": { "type": "object", "required": false, "notes": "Solid RGBA in [0,1]" }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], node: { id, name, x, y, width, height, characters, fontSize, fontWeight, fontName, fills, parentId? } }",
      "hints": [
        "Set font_color upfront or use set_range_text_style for rich styling.",
        "Use set_layout_sizing or a Frame to avoid clipping long text.",
        "Use the returned id for immediate set_text_content updates."
      ],
      "pitfalls": [
        "Parents that don't accept children (e.g., SHAPE) will fail.",
        "Unavailable font styles will cause a font_load_failed error."
      ],
      "errors": [
        "invalid_font_size — Provide a positive numeric font_size.",
        "invalid_font_weight — Use one of 100,200,...,900.",
        "invalid_font_color — Provide RGBA with values in [0,1].",
        "font_load_failed — Try a supported Inter weight or fallback.",
        "set_characters_failed — Retry once; then adjust text or font.",
        "parent_not_found — Re-select or pass a valid parent_id.",
        "invalid_parent — Choose a parent that accepts children (e.g., FRAME).",
        "locked_parent — Unlock parent or choose a different parent.",
        "append_failed — Reparent to a different node or retry after unlock.",
        "plugin_reported_failure — Inspect result.details and retry if feasible.",
        "unknown_plugin_error — Retry once; if persistent, inspect details.",
        "communication_error — Bridge not reachable; restart the session."
      ],
      "side_effects": [
        "Adds a new text node to the canvas."
      ],
      "limits": [
        "Only Inter family and weight mapping exposed here.",
        "Single-style text creation; mixed styles require follow-up tools."
      ],
      "preconditions": [
        "A Figma document is open and editable.",
        "Parent (if provided) exists in the current file."
      ],
      "postchecks": [
        "The returned node.id exists in the document.",
        "fontSize/characters match the requested values."
      ],
      "agent_chaining": [
        "unlock_layers on locked parents, then retry create_text.",
        "set_text_content or set_range_text_style for further edits."
      ],
      "related_tools": ["create_frame", "create_rectangle", "set_text_content", "set_range_text_style"],
      "example_params": { "text": "Get Started", "x": 64, "y": 64, "font_size": 16, "font_weight": 600, "font_color": { "r": 0.11, "g": 0.11, "b": 0.11, "a": 1 }, "name": "Label" }
    }"""
    try:
        logger.info(f"📝 Creating text node: '{text}' at ({x}, {y})")

        params: Dict[str, Any] = {
            "text": text,
            "x": x,
            "y": y,
            "fontSize": font_size,
            "fontWeight": font_weight,
            "name": name or text,
        }

        if parent_id:
            params["parentId"] = parent_id
        if font_color is not None:
            params["fontColor"] = {
                "r": _sanitize_color_value(getattr(font_color, "r", 0.0)),
                "g": _sanitize_color_value(getattr(font_color, "g", 0.0)),
                "b": _sanitize_color_value(getattr(font_color, "b", 0.0)),
                "a": _sanitize_color_value(getattr(font_color, "a", 1.0) or 1.0),
            }

        result = await send_command("create_text", params)
        return _to_json_string(result)

    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for create_text with params: {params}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_text: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to create text due to system error: {str(e)}",
            "details": {"command": "create_text"}
        })

# === STYLING TOOLS ===

@function_tool
async def set_fill_color(
    node_id: Optional[str] = None,
    node_ids: Optional[List[str]] = None,
    color: Optional[RGBAColor] = None,
    style_id: Optional[str] = None,
    replace: Optional[bool] = True,
) -> str:
    """{
      "category": "style",
      "mutates_canvas": true,
      "description": "Apply a SOLID fill color or link a PaintStyle to one or more nodes.",
      "when_to_use": "Change a layer's fill color or link a color style.",
      "when_not_to_use": "You need gradients or image paints (use set_gradient_fill/create_image).",
      "parameters": {
        "node_id": { "type": "string", "required": false, "notes": "Target node ID. Provide this or node_ids." },
        "node_ids": { "type": "string[]", "required": false, "notes": "Array of target node IDs." },
        "color": { "type": "object", "required": false, "notes": "{ r,g,b,a? } floats in [0,1]" },
        "style_id": { "type": "string", "required": false, "notes": "PaintStyle id to link." },
        "replace": { "type": "boolean", "required": false, "notes": "Replace existing fills; default true." }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], mode: 'color'|'style', replaced: boolean }",
      "hints": [
        "Use style_id to keep colors in sync across components.",
        "Set replace=false to append a new fill instead of replacing.",
        "Call get_node_info first to confirm nodes are paintable."
      ],
      "pitfalls": [
        "Passing neither color nor style_id causes a missing_parameter error.",
        "Locked or non-paintable nodes are skipped and reported.",
        "Color components outside 0..1 are clamped; non-numeric are rejected."
      ],
      "errors": [
        "missing_parameter — Provide target(s) and color or style_id, then retry.",
        "invalid_parameter — Fix color to RGBA 0..1 or pass a valid style_id.",
        "no_valid_nodes — Re-select paintable, unlocked nodes.",
        "set_fill_failed — Inspect details; correct inputs and retry.",
        "unknown_plugin_error — Retry once; if persistent, inspect details.",
        "communication_error — Bridge unreachable; restart session."
      ],
      "side_effects": [
        "Changes fills on target nodes."
      ],
      "limits": [
        "Supports SOLID fills and PaintStyle linking; no gradient/image construction.",
        "Does not implement selection fallback automatically."
      ],
      "preconditions": [
        "Target nodes exist in the current file.",
        "Plugin session is connected."
      ],
      "postchecks": [
        "modifiedNodeIds.length > 0",
        "When replace=true, first fill equals requested paint on modified nodes."
      ],
      "agent_chaining": [
        "unlock_layers",
        "get_node_info",
        "set_stroke_color"
      ],
      "related_tools": ["set_stroke_color", "set_gradient_fill", "get_node_info"],
      "example_params": { "node_id": "12:34", "color": { "r": 1, "g": 0, "b": 0, "a": 1 }, "replace": true }
    }"""
    try:
        logger.info(
            f"🎨 set_fill_color: node_id={node_id}, node_ids={len(node_ids) if node_ids else 0}, "
            f"mode={'style' if style_id else 'color'}, replace={replace}"
        )

        params: Dict[str, Any] = {}
        if node_id:
            params["nodeId"] = node_id
        if node_ids:
            params["nodeIds"] = node_ids
        if color is not None:
            params["color"] = {
                "r": _sanitize_color_value(getattr(color, "r", 0.0), 0.0),
                "g": _sanitize_color_value(getattr(color, "g", 0.0), 0.0),
                "b": _sanitize_color_value(getattr(color, "b", 0.0), 0.0),
                "a": _sanitize_color_value(getattr(color, "a", 1.0) or 1.0, 1.0),
            }
        if style_id:
            params["styleId"] = style_id
        if replace is not None:
            params["replace"] = bool(replace)

        result = await send_command("set_fill_color", params)
        return _to_json_string(result)

    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for set_fill_color: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_fill_color: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to set fill color: {str(e)}",
            "details": {"command": "set_fill_color"}
        })

@function_tool
async def set_stroke_color(
    node_id: str,
    color: RGBAColor,
    weight: float | None = None,
) -> str:
    """{
      "category": "style",
      "mutates_canvas": true,
      "description": "Apply a SOLID stroke color and optional weight to a node.",
      "when_to_use": "Adjust a layer's outline/border.",
      "when_not_to_use": "You need gradients or style linking.",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Target node ID." },
        "color": { "type": "object", "required": true, "notes": "{ r,g,b,a? } floats in [0,1]" },
        "weight": { "type": "number", "required": false, "notes": ">= 0; when omitted, preserves existing weight" }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], node: { id, name, strokes, strokeWeight? } }",
      "hints": [
        "Use get_node_info first to confirm the node supports strokes.",
        "Omit weight to keep the current strokeWeight.",
        "Clamp color components to [0,1] to avoid plugin validation errors."
      ],
      "pitfalls": [
        "Passing non-numeric color values yields invalid_parameter.",
        "Nodes without strokes support will fail with unsupported_strokes.",
        "Alpha outside [0,1] is rejected."
      ],
      "errors": [
        "missing_parameter — Provide node_id and color.",
        "invalid_parameter — Ensure RGBA in [0,1] and non-negative weight.",
        "node_not_found — Re-select or search for a valid node.",
        "unsupported_strokes — Pick a node that supports strokes.",
        "locked_nodes — Unlock target layers first, then retry.",
        "plugin_reported_failure — Inspect details.result and retry after correction.",
        "unknown_plugin_error — Retry once; if persistent, inspect details.",
        "communication_error — Bridge unreachable; restart session."
      ],
      "side_effects": [
        "Overwrites node.strokes with a single SOLID paint.",
        "Sets strokeWeight when provided and supported."
      ],
      "limits": [
        "Only SOLID paints supported here (no gradients/styles).",
        "Single-node operation; batching not supported by this tool."
      ],
      "preconditions": [
        "Target node exists and is accessible in the current file.",
        "Plugin session is active and connected."
      ],
      "postchecks": [
        "modifiedNodeIds.length > 0",
        "node.strokes[0].type === 'SOLID'"
      ],
      "agent_chaining": [
        "set_fill_color",
        "set_corner_radius"
      ],
      "related_tools": ["set_fill_color"],
      "example_params": { "node_id": "12:34", "color": { "r": 0.13, "g": 0.13, "b": 0.13, "a": 1 }, "weight": 1 }
    }"""
    try:
        logger.info(f"🖊️ set_stroke_color: node_id={node_id}, weight={weight}")

        params: Dict[str, Any] = {
            "nodeId": node_id,
            "color": {
                "r": _sanitize_color_value(getattr(color, "r", 0.0), 0.0),
                "g": _sanitize_color_value(getattr(color, "g", 0.0), 0.0),
                "b": _sanitize_color_value(getattr(color, "b", 0.0), 0.0),
                "a": _sanitize_color_value(getattr(color, "a", 1.0) or 1.0, 1.0),
            },
        }
        if weight is not None:
            params["weight"] = float(weight)

        result = await send_command("set_stroke_color", params)
        return _to_json_string(result)

    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for set_stroke_color: {getattr(te, 'message', str(te))}")
        # Preserve structured payload for agent self-correction
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_stroke_color: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to set stroke color: {str(e)}",
            "details": {"command": "set_stroke_color", "nodeId": node_id}
        })

@function_tool
async def set_corner_radius(
    node_id: str, 
    radius: int, 
    corners: Optional[List[bool]] = None
) -> str:
    """
    {
      "category": "style",
      "mutates_canvas": true,
      "description": "Sets uniform or individual corner radii for a supported node type.",
      "when_to_use": "Apply rounded corners to frames, rectangles, or components.",
      "when_not_to_use": "Node types that don't support corner radius (e.g., text, lines).",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "ID of the node to modify" },
        "radius": { "type": "number", "required": true, "notes": "Corner radius in pixels (min: 0)" },
        "corners": { "type": "boolean[]", "required": false, "notes": "[topLeft, topRight, bottomRight, bottomLeft] - set individual corners if provided" }
      },
      "returns": "JSON with {success, summary, modifiedNodeIds, id, name, cornerRadius?, topLeftRadius?, topRightRadius?, bottomRightRadius?, bottomLeftRadius?}",
      "hints": [
        "Use token values (e.g., 4/8/12) for consistency.",
        "Check auto-layout clipping if content overflows rounded corners.",
        "Radius larger than min(width,height)/2 may flatten shape."
      ],
      "pitfalls": [
        "Setting different per-corner radii makes cornerRadius return 'mixed'.",
        "Not all node types support individual corner radii.",
        "Corners array must have exactly 4 boolean values if provided."
      ],
      "errors": [
        "missing_node_id — Provide the nodeId parameter",
        "missing_radius — Provide the radius parameter",
        "node_not_found — Verify nodeId exists or use get_selection",
        "unsupported_node_type — Use only on frames, rectangles, or components"
      ],
      "side_effects": ["Mutates corner radii on the node (uniform or per-corner)."],
      "limits": [
        "Per-corner radii only applied when node supports per-corner properties.",
        "Cannot set negative radius values.",
        "Extremely large radii may produce unexpected results."
      ],
      "preconditions": [
        "Node must exist and support corner radius property.",
        "Radius must be a non-negative number."
      ],
      "postchecks": [
        "Modified node has updated corner radius values.",
        "Return payload includes all applicable radius properties."
      ],
      "agent_chaining": ["Combine with create_rectangle and set_fill_color for cards/buttons."],
      "related_tools": ["create_rectangle", "set_fill_color", "set_stroke_color"],
      "example_params": { "node_id": "12:34", "radius": 8, "corners": [true, true, false, false] }
    }
    """
    try:
        logger.info(f"📐 Setting corner radius for node {node_id} to {radius}px")
        
        params = {
            "nodeId": node_id,
            "radius": radius
        }
        
        # Add corners parameter if provided
        if corners is not None:
            if not isinstance(corners, list) or len(corners) != 4:
                raise ToolExecutionError({
                    "code": "invalid_corners_array",
                    "message": "Corners array must contain exactly 4 boolean values",
                    "details": {"corners": corners}
                })
            params["corners"] = corners
        
        result = await send_command("set_corner_radius", params)
        return _to_json_string(result)
        
    except ToolExecutionError:
        # Re-raise tool execution errors so the Agent SDK can handle them properly
        logger.error(f"❌ Tool execution failed for set_corner_radius with params: {params}")
        raise
    except Exception as e:
        # Handle communication/system errors
        error_msg = f"Failed to set corner radius due to system error: {str(e)}"
        logger.error(error_msg)
        raise ToolExecutionError({
            "code": "communication_error",
            "message": error_msg,
            "details": {"command": "set_corner_radius", "nodeId": node_id}
        })

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
        layout_mode: Layout mode - "NONE", "HORIZONTAL", "VERTICAL", or "GRID"
        layout_wrap: Layout wrap - "NO_WRAP" or "WRAP"
    
    Returns:
        JSON string with { id, name, layoutMode, layoutWrap }
    """
    try:
        logger.info(f"📐 Setting layout mode for node {node_id} to {layout_mode}")
        
        params = {
            "nodeId": node_id,
            "layoutMode": layout_mode,
            "layoutWrap": layout_wrap
        }
        
        result = await send_command("set_layout_mode", params)
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set layout mode: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def set_padding(
    node_id: str,
    padding_top: Optional[float] = None,
    padding_right: Optional[float] = None,
    padding_bottom: Optional[float] = None,
    padding_left: Optional[float] = None
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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set padding: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

# === NODE MANIPULATION ===

@function_tool
async def move_node(node_id: str, x: float, y: float) -> str:
    """{
      "category": "layout",
      "mutates_canvas": true,
      "description": "Move a node to an absolute (x,y) position.",
      "when_to_use": "Reposition a layer on the canvas.",
      "when_not_to_use": "You need reparenting or auto-layout positioning.",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Target node ID." },
        "x": { "type": "number", "required": true, "notes": "Finite number; absolute X in px." },
        "y": { "type": "number", "required": true, "notes": "Finite number; absolute Y in px." }
      },
      "returns": "{ success: true, summary, modifiedNodeIds, node: { id, name, x, y } }",
      "hints": [
        "Call get_node_info first to verify the node supports x/y.",
        "Locked nodes must be unlocked before moving.",
        "Negative coordinates are allowed; Figma canvas is unbounded."
      ],
      "pitfalls": [
        "Moving nodes that don't expose x/y (e.g., PAGE) will fail.",
        "Passing NaN/Infinity for x/y triggers invalid_parameter."
      ],
      "errors": [
        "missing_parameter — Provide node_id, x, and y.",
        "invalid_parameter — Ensure x and y are finite numbers.",
        "node_not_found — Re-select or search for a valid node.",
        "unsupported_position — Choose a node that supports x/y.",
        "locked_nodes — Unlock target layers first, then retry.",
        "plugin_reported_failure — Inspect details.result and retry after correction.",
        "unknown_plugin_error — Retry once; if persistent, inspect details.",
        "communication_error — Bridge unreachable; restart session."
      ],
      "side_effects": [
        "Updates the node's absolute x and y values."
      ],
      "limits": [
        "Does not reparent or adjust auto-layout; absolute move only.",
        "Single-node operation."
      ],
      "preconditions": [
        "Node exists in the current file and is not locked.",
        "Plugin session is active and connected."
      ],
      "postchecks": [
        "modifiedNodeIds contains node_id",
        "node.x and node.y equal requested values"
      ],
      "agent_chaining": [
        "unlock_layers",
        "get_node_info"
      ],
      "related_tools": ["resize_node", "get_node_info"],
      "example_params": { "node_id": "12:34", "x": 100, "y": 200 }
    }"""
    try:
        logger.info(f"🔄 move_node: node_id={node_id}, x={x}, y={y}")

        params = { "nodeId": node_id, "x": float(x), "y": float(y) }
        result = await send_command("move_node", params)
        return _to_json_string(result)

    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for move_node: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in move_node: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to move node: {str(e)}",
            "details": {"command": "move_node", "nodeId": node_id}
        })

@function_tool
async def resize_node(node_id: str, width: float, height: float) -> str:
    """{
      "category": "layout",
      "mutates_canvas": true,
      "description": "Resize a node to the given width and height.",
      "when_to_use": "Adjust a layer's dimensions.",
      "when_not_to_use": "You need auto-layout sizing (HUG/FILL).",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Target node ID." },
        "width": { "type": "number", "required": true, "notes": ">= 0; finite px." },
        "height": { "type": "number", "required": true, "notes": ">= 0; finite px." }
      },
      "returns": "{ success: true, summary, modifiedNodeIds, node: { id, name, width, height } }",
      "hints": [
        "Use get_node_info to confirm the node exposes resize().",
        "Zero width/height collapses the layer; verify visibility."
      ],
      "pitfalls": [
        "Passing negative or non-finite sizes triggers invalid_parameter.",
        "Resizing locked nodes is not permitted."
      ],
      "errors": [
        "missing_parameter — Provide node_id, width, and height.",
        "invalid_parameter — Use finite, non-negative width and height.",
        "node_not_found — Re-select or search for a valid node.",
        "unsupported_resize — Choose a node that supports resize().",
        "locked_nodes — Unlock target layers first, then retry.",
        "plugin_reported_failure — Inspect details.result and retry after correction.",
        "unknown_plugin_error — Retry once; if persistent, inspect details.",
        "communication_error — Bridge unreachable; restart session."
      ],
      "side_effects": [
        "Updates the node's width and height."
      ],
      "limits": [
        "Does not alter layout sizing modes (HUG/FILL).",
        "Single-node operation."
      ],
      "preconditions": [
        "Node exists in the current file and is not locked.",
        "Plugin session is active and connected."
      ],
      "postchecks": [
        "modifiedNodeIds contains node_id",
        "node.width and node.height equal requested values"
      ],
      "agent_chaining": [
        "unlock_layers",
        "get_node_info"
      ],
      "related_tools": ["move_node", "get_node_info"],
      "example_params": { "node_id": "12:34", "width": 320, "height": 200 }
    }"""
    try:
        logger.info(f"📏 resize_node: node_id={node_id}, width={width}, height={height}")

        params = { "nodeId": node_id, "width": float(width), "height": float(height) }
        result = await send_command("resize_node", params)
        return _to_json_string(result)

    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for resize_node: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in resize_node: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to resize node: {str(e)}",
            "details": {"command": "resize_node", "nodeId": node_id}
        })

@function_tool
async def delete_node(
    node_id: str,
    force: Optional[bool] = None,
    select_parent: Optional[bool] = None,
) -> str:
    """{
      "category": "utility",
      "mutates_canvas": true,
      "description": "Delete a node by ID with optional force-unlock and selection behavior",
      "when_to_use": "Remove a layer/frame/component instance from the canvas",
      "when_not_to_use": "When targeting the document or page nodes",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Figma node ID to delete" },
        "force": { "type": "boolean", "required": false, "notes": "Unlocks the node before deletion if locked" },
        "select_parent": { "type": "boolean", "required": false, "notes": "Select parent after deletion" }
      },
      "returns": "{ success, summary, modifiedNodeIds:[nodeId], node:{id,name,type}, parentId? }",
      "hints": [
        "Enable force when you anticipate locked nodes",
        "Set select_parent to keep context after deletion"
      ],
      "pitfalls": [
        "Deleting PAGE or DOCUMENT will fail",
        "Locked nodes require force or an unlock step"
      ],
      "errors": [
        "missing_parameter — Provide node_id",
        "invalid_parameter — Fix bad flag types",
        "node_not_found — Verify the node still exists",
        "cannot_delete_root_or_page — Use another target",
        "locked_node — Call unlock tool or set force=true",
        "delete_failed — Retry or reduce concurrent edits",
        "plugin_reported_failure — Inspect details.result",
        "unknown_plugin_error — Inspect plugin logs",
        "python_wrapper_error — Retry; check server logs"
      ],
      "side_effects": [
        "Selection may change if select_parent is true"
      ],
      "limits": [
        "Cannot delete document nor page",
        "No soft-delete; removal is permanent"
      ],
      "preconditions": [
        "node_id resolves to a non-root node"
      ],
      "postchecks": [
        "Node is absent from the canvas",
        "Parent selection is active when requested"
      ],
      "agent_chaining": [
        "unlock_layers for locked_node"
      ],
      "related_tools": [
        "clone_node", "delete_multiple_nodes"
      ],
      "example_params": { "node_id": "1:2", "force": true, "select_parent": true }
    }"""
    try:
        logger.info(f"🗑️ delete_node: node_id={node_id}, force={force}, select_parent={select_parent}")
        params: Dict[str, Any] = {"nodeId": node_id}
        if force is not None:
            params["force"] = bool(force)
        if select_parent is not None:
            params["selectParent"] = bool(select_parent)
        result = await send_command("delete_node", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        raise ToolExecutionError({
            "code": "python_wrapper_error",
            "message": f"delete_node wrapper failed: {str(e)}",
            "details": {"node_id": node_id}
        }, command="delete_node", params={"nodeId": node_id})

@function_tool
async def clone_node(
    node_id: str,
    x: Optional[float] = None,
    y: Optional[float] = None,
    offset_x: Optional[float] = None,
    offset_y: Optional[float] = None,
    parent_id: Optional[str] = None,
    insert_index: Optional[int] = None,
    select: Optional[bool] = None,
    name: Optional[str] = None,
    locked: Optional[bool] = None,
    visible: Optional[bool] = None,
) -> str:
    """{
      "category": "utility",
      "mutates_canvas": true,
      "description": "Clone a node with optional placement, parenting, and selection",
      "when_to_use": "Duplicate a layer while controlling placement",
      "when_not_to_use": "When a component instance swap is intended",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Figma node ID to clone" },
        "x": { "type": "number", "required": false, "notes": "Absolute X position for the clone" },
        "y": { "type": "number", "required": false, "notes": "Absolute Y position for the clone" },
        "offset_x": { "type": "number", "required": false, "notes": "Relative X offset to apply after cloning" },
        "offset_y": { "type": "number", "required": false, "notes": "Relative Y offset to apply after cloning" },
        "parent_id": { "type": "string", "required": false, "notes": "Place clone under this parent if provided" },
        "insert_index": { "type": "number", "required": false, "notes": "Index to insert under parent (0-based)" },
        "select": { "type": "boolean", "required": false, "notes": "Select the cloned node" },
        "name": { "type": "string", "required": false, "notes": "Rename the cloned node" },
        "locked": { "type": "boolean", "required": false, "notes": "Set locked state on the clone" },
        "visible": { "type": "boolean", "required": false, "notes": "Set visibility on the clone" }
      },
      "returns": "{ success, summary, modifiedNodeIds:[cloneId], node:{...}, originalNodeId, parentId? }",
      "hints": [
        "Use offset_x/offset_y to nudge relative to original",
        "Provide parent_id to place clone into a specific container"
      ],
      "pitfalls": [
        "Some node types may not support x/y positioning",
        "Parent must support child insertion"
      ],
      "errors": [
        "missing_parameter — Provide node_id",
        "invalid_parameter — Fix bad types (e.g., insert_index)",
        "node_not_found — Verify the node still exists",
        "clone_failed — Retry; check for unsupported node types",
        "position_not_supported — Omit positioning params",
        "parent_not_found — Provide a valid parent_id",
        "invalid_parent_container — Choose a container node",
        "insert_failed — Retry or adjust insert_index",
        "plugin_reported_failure — Inspect details.result",
        "unknown_plugin_error — Inspect plugin logs",
        "python_wrapper_error — Retry; check server logs"
      ],
      "side_effects": [
        "Selection may change if select is true"
      ],
      "limits": [
        "Cloning preserves plugin data by default",
        "No deep customization of linkages"
      ],
      "preconditions": [
        "node_id resolves to a cloneable node"
      ],
      "postchecks": [
        "Clone exists under expected parent",
        "Position reflects requested absolute/relative inputs"
      ],
      "agent_chaining": [
        "move_node for fine positioning"
      ],
      "related_tools": [
        "delete_node", "move_node"
      ],
      "example_params": { "node_id": "1:2", "offset_x": 16, "offset_y": 16, "select": true }
    }"""
    try:
        logger.info(f"🧬 clone_node: node_id={node_id}, x={x}, y={y}, offset_x={offset_x}, offset_y={offset_y}, parent_id={parent_id}, insert_index={insert_index}, select={select}")
        params: Dict[str, Any] = {"nodeId": node_id}
        if x is not None:
            params["x"] = float(x)
        if y is not None:
            params["y"] = float(y)
        if offset_x is not None:
            params["offsetX"] = float(offset_x)
        if offset_y is not None:
            params["offsetY"] = float(offset_y)
        if parent_id is not None:
            params["parentId"] = parent_id
        if insert_index is not None:
            params["insertIndex"] = int(insert_index)
        if select is not None:
            params["select"] = bool(select)
        if name is not None:
            params["name"] = name
        if locked is not None:
            params["locked"] = bool(locked)
        if visible is not None:
            params["visible"] = bool(visible)

        result = await send_command("clone_node", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        raise ToolExecutionError({
            "code": "python_wrapper_error",
            "message": f"clone_node wrapper failed: {str(e)}",
            "details": {"node_id": node_id}
        }, command="clone_node", params={"nodeId": node_id})

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set text content: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def scan_text_nodes(
    node_id: str,
    use_chunking: Optional[bool] = None,
    chunk_size: Optional[int] = None
) -> str:
    """
    Scans for text nodes within a given node. Supports chunked or non-chunked scanning.
    
    Args:
        node_id: The ID of the node to scan within
        use_chunking: When True (default), performs chunked scanning with progress updates
        chunk_size: Optional chunk size when use_chunking is True (default in plugin: 10)
    
    Returns:
        Information about found text nodes (chunked or non-chunked shape, includes commandId)
    """
    try:
        logger.info(f"🔍 Scanning text nodes in {node_id}")
        
        params = {"nodeId": node_id}
        if use_chunking is not None:
            params["useChunking"] = use_chunking
        if chunk_size is not None:
            params["chunkSize"] = chunk_size
        
        result = await send_command("scan_text_nodes", params)
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to scan text nodes: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

# === COMPONENT TOOLS ===

@function_tool
async def get_local_components(
    include_component_sets: Optional[bool] = None,
    name_contains: Optional[str] = None,
    only_publishable: Optional[bool] = None,
) -> str:
    """
    {
      "category": "inspect",
      "mutates_canvas": false,
      "description": "List local components and optionally component sets in the current file.",
      "when_to_use": "Discover reusable building blocks before creating elements.",
      "when_not_to_use": "You already know the target component key or ID.",
      "parameters": {
        "includeComponentSets": { "type": "boolean", "required": false, "notes": "Include COMPONENT_SET nodes in the results." },
        "nameContains": { "type": "string", "required": false, "notes": "Filter results by case-insensitive substring match on name." },
        "onlyPublishable": { "type": "boolean", "required": false, "notes": "Return only entries with a non-null key (published/exportable)." }
      },
      "returns": "{ count: number, components: [{ id: string, name: string, key: string|null, type: 'COMPONENT'|'COMPONENT_SET' }] }",
      "hints": [
        "Prefer reusing components over raw shapes.",
        "Use returned keys with create_component_instance.",
        "nameContains helps narrow large libraries quickly."
      ],
      "pitfalls": [
        "Very large files may take longer to scan.",
        "Filtering too aggressively may hide relevant variants."
      ],
      "errors": [
        "get_local_components_failed — Retry after ensuring all pages are loaded; check permissions.",
        "communication_error — Check bridge/WebSocket health; plugin may be unavailable."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Returns only local items in this file (not remote libraries).",
        "Keys may be null for unpublished local definitions."
      ],
      "preconditions": [
        "Document pages are accessible; plugin loads all pages before scanning."
      ],
      "postchecks": [
        "result.count equals result.components.length",
        "All returned items include a stable id and type"
      ],
      "agent_chaining": [
        "create_component_instance"
      ],
      "related_tools": ["create_component_instance", "get_instance_overrides"],
      "example_params": { "includeComponentSets": true, "nameContains": "Button", "onlyPublishable": false }
    }
    """
    try:
        logger.info("🧩 Getting local components")
        params = {}
        if include_component_sets is not None:
            params["includeComponentSets"] = bool(include_component_sets)
        if name_contains is not None and len(str(name_contains)) > 0:
            params["nameContains"] = str(name_contains)
        if only_publishable is not None:
            params["onlyPublishable"] = bool(only_publishable)

        result = await send_command("get_local_components", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool get_local_components failed: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_local_components: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get local components: {str(e)}",
            "details": {}
        })

@function_tool
async def create_component_instance(
    component_key: str,
    x: int = 0,
    y: int = 0,
    parent_id: Optional[str] = None,
) -> str:
    """{
      "category": "create",
      "mutates_canvas": true,
      "description": "Create an instance from a published component key and place it on the canvas (optionally under a parent).",
      "when_to_use": "You are assembling UI from a design system component.",
      "when_not_to_use": "No suitable component exists (create_frame + create_text instead).",
      "parameters": {
        "component_key": { "type": "string", "required": true, "notes": "Published component key used with importComponentByKeyAsync." },
        "x": { "type": "number", "required": false, "notes": "Initial x position (may be ignored in auto-layout)." },
        "y": { "type": "number", "required": false, "notes": "Initial y position (may be ignored in auto-layout)." },
        "parent_id": { "type": "string", "required": false, "notes": "Optional parent container ID to append the instance to." }
      },
      "returns": "{ success: true, summary, modifiedNodeIds: string[], node: { id, name, x, y, width?, height?, componentId, parentId? } }",
      "hints": [
        "Use set_instance_overrides immediately to set variant and property values.",
        "When placing inside Auto Layout, x/y are typically ignored by Figma.",
        "If parent is locked, unlock or place on current page first."
      ],
      "pitfalls": [
        "Passing an unpublished or invalid key will fail to import.",
        "Parent that is not a container (no appendChild) will reject insertion.",
        "Auto Layout parents override absolute positioning."
      ],
      "errors": [
        "missing_parameter — Provide component_key.",
        "invalid_parameter — Ensure x/y are numbers and parent_id is a string.",
        "component_not_found — Key does not resolve to a published component.",
        "permission_denied — The key is in a library you cannot access.",
        "component_import_failed — Generic import failure; retry or verify key.",
        "instance_creation_failed — Component.createInstance() threw.",
        "parent_not_found — Provided parent_id did not resolve to a node.",
        "invalid_parent — Parent does not support children (no appendChild).",
        "locked_parent — Parent appears locked; unlock before insertion.",
        "append_failed — Insertion failed for an unknown reason.",
        "create_component_instance_failed — Unknown plugin error; inspect details."
      ],
      "side_effects": [
        "Imports the component definition (if not local).",
        "Appends a new INSTANCE to the target parent or current page."
      ],
      "limits": [
        "Only published components can be imported by key.",
        "x/y may be ignored when placed in Auto Layout containers."
      ],
      "preconditions": [
        "The component key refers to a published component accessible to the user.",
        "The target parent (if provided) supports children."
      ],
      "postchecks": [
        "node.id equals modifiedNodeIds[0]",
        "node.componentId is defined"
      ],
      "agent_chaining": [
        "set_instance_overrides"
      ],
      "related_tools": ["get_local_components", "set_instance_overrides"],
      "example_params": { "component_key": "abcd123", "x": 0, "y": 0 }
    }"""
    try:
        logger.info(f"🧩 Creating component instance for key {component_key}")
        params: Dict[str, Any] = {
            "componentKey": component_key,
            "x": int(x),
            "y": int(y),
        }
        if parent_id is not None:
            params["parentId"] = str(parent_id)

        result = await send_command("create_component_instance", params)
        return _to_json_string(result)

    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for create_component_instance: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_component_instance: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to create component instance: {str(e)}",
            "details": {"component_key": component_key}
        })

# === UTILITY TOOLS ===

@function_tool
async def export_node_as_image(
    node_id: str,
    format: Optional[Literal["PNG", "JPG", "SVG", "SVG_STRING", "PDF", "JSON_REST_V1"]] = "PNG",
    scale: Optional[float] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    contents_only: Optional[bool] = None,
    use_absolute_bounds: Optional[bool] = None,
    suffix: Optional[str] = None,
    color_profile: Optional[Literal["DOCUMENT", "SRGB", "DISPLAY_P3_V4"]] = None,
    svg_outline_text: Optional[bool] = None,
    svg_id_attribute: Optional[bool] = None,
    svg_simplify_stroke: Optional[bool] = None
) -> str:
    """
    {
      "category": "export",
      "mutates_canvas": false,
      "description": "Export a node as an image, SVG, PDF, or JSON with comprehensive format and quality options",
      "when_to_use": "Convert any exportable node to various formats for external use or analysis",
      "when_not_to_use": "For non-exportable nodes like document root; use get_node_info first to verify exportability",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "ID of the node to export" },
        "format": { "type": "string", "required": false, "notes": "PNG|JPG|SVG|SVG_STRING|PDF|JSON_REST_V1, defaults to PNG" },
        "scale": { "type": "number", "required": false, "notes": "Export scale multiplier (e.g., 2.0 for 2x)" },
        "width": { "type": "number", "required": false, "notes": "Fixed width in pixels (overrides scale)" },
        "height": { "type": "number", "required": false, "notes": "Fixed height in pixels (overrides scale)" },
        "contents_only": { "type": "boolean", "required": false, "notes": "Export only node contents vs overlapping layers" },
        "use_absolute_bounds": { "type": "boolean", "required": false, "notes": "Use full dimensions regardless of cropping" },
        "suffix": { "type": "string", "required": false, "notes": "Filename suffix for export" },
        "color_profile": { "type": "string", "required": false, "notes": "DOCUMENT|SRGB|DISPLAY_P3_V4" },
        "svg_outline_text": { "type": "boolean", "required": false, "notes": "Render text as paths vs <text> elements (SVG only)" },
        "svg_id_attribute": { "type": "boolean", "required": false, "notes": "Include layer names as IDs (SVG only)" },
        "svg_simplify_stroke": { "type": "boolean", "required": false, "notes": "Simplify stroke rendering (SVG only)" }
      },
      "returns": "Export result: { nodeId, format, mimeType, imageData?, data?, settings }",
      "hints": [
        "Use JSON_REST_V1 format for API-compatible node structure",
        "SVG_STRING returns text directly; other formats return base64",
        "Only one constraint (scale/width/height) allowed per export"
      ],
      "pitfalls": [
        "Large nodes with high scale/resolution may timeout or consume memory",
        "SVG exports of complex nodes may be very large",
        "Text rendering varies between SVG outline vs text modes"
      ],
      "errors": [
        "missing_parameter — Provide node_id parameter",
        "node_not_found — Verify node exists and is accessible",
        "export_not_supported — Node type doesn't support exporting",
        "invalid_format — Use supported format: PNG|JPG|SVG|SVG_STRING|PDF|JSON_REST_V1",
        "export_failed — Retry with simpler settings or smaller scale"
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Export size limited by Figma's memory constraints",
        "Some node types (like DOCUMENT) cannot be exported",
        "Complex vector nodes may take significant time to process"
      ],
      "preconditions": [
        "Node must exist and be accessible in current document",
        "Node must support exportAsync method"
      ],
      "postchecks": [
        "Returned nodeId matches requested node_id",
        "For image formats, imageData is valid base64 string"
      ],
      "agent_chaining": ["get_node_info", "create_image", "get_image_by_hash"],
      "related_tools": ["get_node_info", "create_image", "get_image_by_hash"],
      "example_params": { "node_id": "12:34", "format": "PNG", "scale": 2.0 }
    }"""
    try:
        logger.info(f"📷 Exporting node {node_id} as {format}")
        
        # Build parameters with snake_case to camelCase mapping
        params = {"nodeId": node_id}
        
        if format is not None:
            params["format"] = format
        if scale is not None:
            params["scale"] = scale
        if width is not None:
            params["width"] = width
        if height is not None:
            params["height"] = height
        if contents_only is not None:
            params["contentsOnly"] = contents_only
        if use_absolute_bounds is not None:
            params["useAbsoluteBounds"] = use_absolute_bounds
        if suffix is not None:
            params["suffix"] = suffix
        if color_profile is not None:
            params["colorProfile"] = color_profile
        if svg_outline_text is not None:
            params["svgOutlineText"] = svg_outline_text
        if svg_id_attribute is not None:
            params["svgIdAttribute"] = svg_id_attribute
        if svg_simplify_stroke is not None:
            params["svgSimplifyStroke"] = svg_simplify_stroke
        
        result = await send_command("export_node_as_image", params)
        return _to_json_string(result)
        
    except ToolExecutionError as te:
        logger.error(f"❌ Tool export_node_as_image failed: {getattr(te, 'message', str(te))}")
        # Re-raise structured tool error for agent self-correction
        raise
    except Exception as e:
        # Normalize non-tool failures to ToolExecutionError
        logger.error(f"❌ Communication/system error in export_node_as_image: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to communicate with plugin: {str(e)}",
            "details": {"node_id": node_id, "format": format}
        })

@function_tool
async def create_image(base64: str, name: Optional[str] = None, parent_id: Optional[str] = None) -> str:
    """
    Creates an IMAGE-filled rectangle from base64 image bytes.
    
    Args:
        base64: Base64-encoded image bytes (no data URI prefix)
        name: Optional node name (default in plugin: "Image")
        parent_id: Optional parent node ID to append to
    
    Returns:
        JSON string with { success, nodeId, name, imageHash }
    """
    try:
        logger.info("🖼️ Creating image node from base64 bytes")
        params = {"base64": base64}
        if name is not None:
            params["name"] = name
        if parent_id is not None:
            params["parentId"] = parent_id
        result = await send_command("create_image", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to create image: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def get_image_by_hash(hash: str) -> str:
    """
    Reads an image by its hash and returns base64 bytes and size.
    
    Args:
        hash: The image hash
    
    Returns:
        JSON string with { success: boolean, base64?: string, size?: { width, height }, message?: string }
    """
    try:
        logger.info(f"🖼️ Reading image by hash: {hash}")
        result = await send_command("get_image_by_hash", {"hash": hash})
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to get image by hash: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def get_styles(
    kinds: Optional[List[str]] = None,
    name_substring: Optional[str] = None,
    case_sensitive: Optional[bool] = None,
    include_all_paints: Optional[bool] = None,
    sort_by: Optional[str] = None,
    sort_direction: Optional[str] = None,
) -> str:
    """{
      "category": "inspect",
      "mutates_canvas": false,
      "description": "List local styles by kind with optional name filtering.",
      "when_to_use": "Discover color/text/effect/grid style IDs and names.",
      "when_not_to_use": "When you need to create or edit styles.",
      "parameters": {
        "kinds": { "type": "string[]", "required": false, "notes": "One or more of ['paint','text','effect','grid']" },
        "name_substring": { "type": "string", "required": false, "notes": "Case-insensitive unless case_sensitive=true" },
        "case_sensitive": { "type": "boolean", "required": false, "notes": "Default false" },
        "include_all_paints": { "type": "boolean", "required": false, "notes": "Return all Paints per PaintStyle; default true" },
        "sort_by": { "type": "string", "required": false, "notes": "Only 'name' supported" },
        "sort_direction": { "type": "string", "required": false, "notes": "asc|desc; default asc" }
      },
      "returns": "{ colors: PaintStyleSummary[], texts: TextStyleSummary[], effects: EffectStyleSummary[], grids: GridStyleSummary[] }",
      "hints": [
        "Filter by name to narrow large libraries.",
        "Use keys/ids from this call in styling tools.",
        "Leave kinds undefined to return all types."
      ],
      "pitfalls": [
        "Empty kinds array is invalid.",
        "Name filter is substring match, not regex.",
        "Case sensitivity is controlled by case_sensitive."
      ],
      "errors": [
        "invalid_parameter — Fix param types (kinds must be array, name string).",
        "invalid_kinds — Restrict to ['paint','text','effect','grid'].",
        "invalid_sort — Only sortBy='name' and asc|desc are supported.",
        "no_styles_found — Remove filters or create styles.",
        "unknown_plugin_error — Retry or simplify filters."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Returns local file styles only (no team library).",
        "PaintStyle paints returned raw; not resolved to theme tokens."
      ],
      "preconditions": [
        "A Figma document is open.",
        "Plugin has document read access."
      ],
      "postchecks": [
        "Each item has id, name, and key.",
        "Counts reflect applied filters."
      ],
      "agent_chaining": [
        "set_fill_color or set_range_text_style using returned IDs."
      ],
      "related_tools": ["set_fill_color", "set_range_text_style", "get_node_info"],
      "example_params": { "kinds": ["text"], "name_substring": "Body", "case_sensitive": false, "sort_by": "name", "sort_direction": "asc" }
    }"""
    logger.info("🎨 Getting document styles")
    params: Dict[str, Any] = {}
    if kinds is not None:
        params["kinds"] = kinds
    if name_substring is not None:
        params["name"] = name_substring
    if case_sensitive is not None:
        params["caseSensitive"] = bool(case_sensitive)
    if include_all_paints is not None:
        params["includeAllPaints"] = bool(include_all_paints)
    if sort_by is not None:
        params["sortBy"] = sort_by
    if sort_direction is not None:
        params["sortDirection"] = sort_direction
    result = await send_command("get_styles", params)
    return _to_json_string(result)

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
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to gather full context: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def selections_context(
    mode: Optional[str] = None,
    include_comments: Optional[bool] = None,
    force: Optional[bool] = None,
) -> str:
    """
    Returns either a fast selection snapshot or a complete deep context depending on mode.
    
    Args:
        mode: 'snapshot' | 'complete'. When 'complete', returns the same shape as gather_full_context.
        include_comments: Include comments (used in 'complete' mode)
        force: Bypass plugin-side cache when true
    
    Returns:
        Snapshot: { success, document, selectionSignature, selectionSummary, gatheredAt }
        Complete: same as gather_full_context
    """
    try:
        logger.info("🧭 Getting selections context")
        params = {}
        if mode is not None:
            params["mode"] = mode
        if include_comments is not None:
            params["includeComments"] = include_comments
        if force is not None:
            params["force"] = force
        result = await send_command("selections_context", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to get selections context: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

# === ADDITIONAL TOOLS FROM CODE.JS ===

@function_tool
async def read_my_design() -> str:
    """{
      "category": "inspect",
      "mutates_canvas": false,
      "description": "Read filtered JSON for each currently selected node (fast selection materialization).",
      "when_to_use": "You need quick, per-node details for the current selection.",
      "when_not_to_use": "Broad context across the page (prefer get_document_info or selections_context).",
      "parameters": {},
      "returns": "Array of { nodeId, document|null, error? } mirroring get_nodes_info shape.",
      "hints": [
        "Use this as a cheap read of selection before deeper scans.",
        "Chain with get_reactions to audit interactive elements in selected frames.",
        "If empty array is returned, selection is empty—prompt the user to select nodes."
      ],
      "pitfalls": [
        "Vectors may produce null documents (same as get_node_info/export).",
        "Partial failures are returned per-entry with error objects—handle gracefully."
      ],
      "errors": [
        "read_my_design_failed — Retry; if persistent, inspect details and reduce scope.",
        "communication_error — Bridge unreachable; restart plugin session and try again."
      ],
      "side_effects": ["None. Read-only."],
      "limits": [
        "Exports are filtered (JSON_REST_V1).",
        "Selection only; does not discover unselected neighbors."
      ],
      "preconditions": [
        "A Figma document is open with accessible selection.",
        "Plugin is connected to the bridge."
      ],
      "postchecks": [
        "Returned array length equals current selection length.",
        "Each entry has either a document or an error."
      ],
      "agent_chaining": ["get_selection", "get_nodes_info", "get_reactions"],
      "related_tools": ["get_selection", "get_nodes_info", "get_reactions"],
      "example_params": {}
    }"""
    try:
        logger.info("📖 Reading design of selected nodes")
        result = await send_command("read_my_design")
        return _to_json_string(result)
    except ToolExecutionError:
        # Preserve structured payload for agent self-correction
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in read_my_design: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to read design: {str(e)}",
            "details": {"command": "read_my_design"}
        })

@function_tool
async def get_reactions(node_ids: List[str], silent: Optional[bool] = False) -> str:
    """{
      "category": "prototype",
      "mutates_canvas": false,
      "description": "Return prototype interactions (reactions) for nodes and descendants, excluding CHANGE_TO actions.",
      "when_to_use": "Audit interactive paths and verify user flows.",
      "when_not_to_use": "You need to modify reactions (not supported here).",
      "parameters": {
        "node_ids": { "type": "string[]", "required": true, "notes": "Root node IDs to traverse for reactions." },
        "silent": { "type": "boolean", "required": false, "notes": "When true, suppress canvas highlighting." }
      },
      "returns": "{ nodesCount, nodesWithReactions, nodes: [{ id, name, type, depth, hasReactions: true, reactions: object[], path }] }",
      "hints": [
        "Prefer high-level frames as inputs for performance.",
        "Use returned path/depth to narrate flows hierarchically.",
        "Pair with read_my_design for structural context of interactive nodes."
      ],
      "pitfalls": [
        "Large traversals can be slow—limit input IDs.",
        "Per-node not found issues are logged but do not fail the entire call.",
        "CHANGE_TO navigation is intentionally filtered out."
      ],
      "errors": [
        "missing_parameter — Provide node_ids as a non-empty array.",
        "invalid_parameter — Ensure all node_ids are strings.",
        "get_reactions_failed — Retry; if persistent, narrow the scope.",
        "unknown_plugin_error — Retry or inspect details from the payload.",
        "communication_error — Bridge unreachable; restart plugin session."
      ],
      "side_effects": [
        "Temporarily highlights nodes with reactions unless silent=true."
      ],
      "limits": [
        "Deep scans may be expensive on very large trees.",
        "Only reads reaction metadata; no writes."
      ],
      "preconditions": [
        "Input node IDs reference nodes in the current document.",
        "Plugin session is active and connected."
      ],
      "postchecks": [
        "nodesCount equals input length.",
        "nodesWithReactions equals nodes.length in the payload."
      ],
      "agent_chaining": ["read_my_design", "get_node_info"],
      "related_tools": ["read_my_design", "get_node_info", "scan_nodes_by_types"],
      "example_params": { "node_ids": ["12:1", "12:2"], "silent": false }
    }"""
    try:
        logger.info(f"🧭 Reading reactions for {len(node_ids) if node_ids else 0} node(s)")
        params: Dict[str, Any] = {"nodeIds": node_ids}
        if silent is not None:
            params["silent"] = bool(silent)
        result = await send_command("get_reactions", params)
        return _to_json_string(result)
    except ToolExecutionError:
        # Preserve structured payload for agent self-correction
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_reactions: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get reactions: {str(e)}",
            "details": {"command": "get_reactions", "nodeIds": node_ids}
        })

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to delete multiple nodes: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set multiple text contents: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)


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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to scan nodes by types: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)



@function_tool
async def get_comments() -> str:
    """
    Reads document comments (thread items).
    
    Returns:
        JSON string with { success: true, comments: [{ id, message, clientMeta, createdAt, resolvedAt, user }] }
    """
    try:
        logger.info("💬 Getting comments")
        result = await send_command("get_comments")
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to get comments: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def set_gradient_fill(node_id: str, gradient_json: str) -> str:
    """{
      "category": "style",
      "mutates_canvas": true,
      "description": "Set a gradient fill on a node.",
      "when_to_use": "Apply linear/radial/diamond/angle gradient fill.",
      "when_not_to_use": "Target doesn't support fills or needs solid/image.",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Target node ID." },
        "gradient_json": { "type": "string", "required": true, "notes": "JSON string of GradientPaint with type, gradientStops (≥2), gradientTransform (2x3)." }
      },
      "returns": "{ success: true, summary, modifiedNodeIds, nodeId, fills, gradientType }",
      "hints": [
        "Validate gradient_json locally to fail fast.",
        "Provide at least 2 gradient stops with positions in [0,1].",
        "gradientTransform is a 2x3 matrix: [[a,b,c],[d,e,f]]."
      ],
      "pitfalls": [
        "Locked nodes cannot be modified.",
        "Groups or unsupported nodes don't have fills."
      ],
      "errors": [
        "missing_parameter — Provide both node_id and gradient_json.",
        "invalid_gradient_json — Fix JSON parse errors before calling.",
        "invalid_parameter — Ensure 'gradient' object shape is valid.",
        "invalid_paint_type — Use a GRADIENT_* paint type.",
        "invalid_gradient_stops — Provide ≥2 stops; positions in [0,1].",
        "invalid_gradient_transform — Provide a 2x3 matrix.",
        "node_not_found — Resolve the node first or pass a different ID.",
        "node_not_supported — Choose a node that supports fills.",
        "locked_nodes — Unlock the node(s) with unlock_layers, then retry.",
        "plugin_write_failed — Retry or adjust selection/permissions.",
        "unknown_plugin_error — Re-run or gather more context."
      ],
      "side_effects": [
        "Overwrites node.fills with the provided gradient"
      ],
      "limits": [
        "Operates on a single node.",
        "Does not link to a PaintStyle (color styles)."
      ],
      "preconditions": [
        "Node exists and supports fills.",
        "gradient_json parses to a valid GradientPaint."
      ],
      "postchecks": [
        "Result.modifiedNodeIds contains node_id.",
        "Result.gradientType equals the input gradient.type."
      ],
      "agent_chaining": [
        "unlock_layers if locked_nodes",
        "get_node_info to verify fill applied"
      ],
      "related_tools": ["set_fill_color", "get_node_info", "unlock_layers"],
      "example_params": { "node_id": "12:34", "gradient_json": "{\"type\":\"GRADIENT_LINEAR\",\"gradientStops\":[{\"position\":0,\"color\":{\"r\":1,\"g\":0.5,\"b\":0,\"a\":1}},{\"position\":1,\"color\":{\"r\":1,\"g\":0,\"b\":0.5,\"a\":1}}],\"gradientTransform\":[[1,0,0],[0,1,0]]}" }
    }"""
    logger.info(f"🌈 Setting gradient fill on node {node_id}")
    # Parse gradient JSON early with structured error on failure
    try:
        gradient_obj = json.loads(gradient_json)
    except Exception as json_err:
        payload = {"code": "invalid_gradient_json", "message": "Invalid 'gradient_json' payload", "details": {"error": str(json_err)}}
        logger.error(f"set_gradient_fill param parse failed: {payload['message']}")
        raise ToolExecutionError(payload, command="set_gradient_fill", params={"nodeId": node_id})

    # Dispatch to plugin
    try:
        params = {"nodeId": node_id, "gradient": gradient_obj}
        result = await send_command("set_gradient_fill", params)
        return _to_json_string(result)
    except ToolExecutionError:
        # Pass through structured errors from plugin/bridge untouched
        raise
    except Exception as e:
        payload = {"code": "backend_error", "message": f"Failed to set gradient fill: {str(e)}", "details": {"node_id": node_id}}
        logger.error(f"set_gradient_fill failed: {payload['message']}")
        raise ToolExecutionError(payload, command="set_gradient_fill", params={"nodeId": node_id})

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to get instance overrides: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set instance overrides: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set axis alignment: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set layout sizing: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def set_item_spacing(
    node_id: str,
    item_spacing: Optional[float] = None,
    counter_axis_spacing: Optional[float] = None
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
        return _to_json_string(result)
        
    except Exception as e:
        error_msg = f"Failed to set item spacing: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)


# === VIEWPORT TOOLS ===

@function_tool
async def zoom(zoom_level: float, center_x: Optional[float] = None, center_y: Optional[float] = None) -> str:
    """
    Sets the editor viewport zoom (and optionally recenters the viewport).

    Args:
        zoom_level: The zoom level to set (e.g., 1.0 = 100%)
        center_x: Optional X coordinate to set viewport center before zoom
        center_y: Optional Y coordinate to set viewport center before zoom

    Returns:
        JSON string with { success, zoom, center }
    """
    try:
        logger.info(f"🔎 Setting viewport zoom to {zoom_level} with center=({center_x}, {center_y})")
        params: Dict[str, Any] = {"zoomLevel": zoom_level}
        if center_x is not None and center_y is not None:
            params["center"] = {"x": center_x, "y": center_y}
        result = await send_command("zoom", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to set zoom: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def center(x: float, y: float) -> str:
    """
    Centers the editor viewport at the specified coordinates.

    Args:
        x: X coordinate
        y: Y coordinate

    Returns:
        JSON string with { success, center }
    """
    try:
        logger.info(f"🎯 Centering viewport at ({x}, {y})")
        params = {"x": x, "y": y}
        result = await send_command("center", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to center viewport: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def scroll_and_zoom_into_view(node_ids: List[str]) -> str:
    """
    Scrolls and zooms the viewport to fit the specified nodes.

    Args:
        node_ids: List of node IDs to bring into view

    Returns:
        JSON string with { success, message }
    """
    try:
        logger.info(f"🧭 Scrolling and zooming into {len(node_ids)} node(s)")
        params = {"nodeIds": node_ids}
        result = await send_command("scroll_and_zoom_into_view", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to scroll and zoom into view: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

# === GROUPING / PARENTING TOOLS ===

@function_tool
async def group(node_ids: List[str], parent_id: Optional[str] = None, name: Optional[str] = None) -> str:
    """
    Groups the specified nodes under a parent (or current page) and returns the new group info.

    Args:
        node_ids: IDs of nodes to group
        parent_id: Optional parent node ID (defaults to current page)
        name: Optional name for the created group

    Returns:
        JSON string with { success, groupId, name, children }
    """
    try:
        logger.info(f"🧺 Grouping {len(node_ids)} node(s) under parent={parent_id or 'currentPage'} name={name or ''}")
        params: Dict[str, Any] = {"nodeIds": node_ids}
        if parent_id:
            params["parentId"] = parent_id
        if name:
            params["name"] = name
        result = await send_command("group", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to group nodes: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def ungroup(node_id: str) -> str:
    """
    Ungroups the specified group node, reinserting its children into the parent.

    Args:
        node_id: The group node ID to ungroup

    Returns:
        JSON string with { success, message, childrenIds }
    """
    try:
        logger.info(f"🧺➖ Ungrouping node {node_id}")
        params = {"nodeId": node_id}
        result = await send_command("ungroup", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to ungroup: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def reparent(node_ids: List[str], new_parent_id: str) -> str:
    """
    Moves the specified nodes under a new parent.

    Args:
        node_ids: IDs of nodes to move
        new_parent_id: Destination parent ID

    Returns:
        JSON string with { success, message }
    """
    try:
        logger.info(f"🔁 Reparenting {len(node_ids)} node(s) to {new_parent_id}")
        params = {"nodeIds": node_ids, "newParentId": new_parent_id}
        result = await send_command("reparent", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to reparent nodes: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

@function_tool
async def insert_child(parent_id: str, child_id: str, index: int) -> str:
    """
    Inserts a child node into a parent at the specified index.

    Args:
        parent_id: Parent node ID
        child_id: Child node ID
        index: Index within parent's children

    Returns:
        JSON string with { success, message }
    """
    try:
        logger.info(f"🧩 Inserting child {child_id} into parent {parent_id} at index {index}")
        params = {"parentId": parent_id, "childId": child_id, "index": index}
        result = await send_command("insert_child", params)
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to insert child: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

# === TEXT / FONT TOOLS ===

@function_tool
async def set_range_text_style(node_id: str, start: int, end: int, text_style_id: str, auto_clamp: bool | None = None) -> str:
    """{
      "category": "text",
      "mutates_canvas": true,
      "description": "Apply a shared TextStyle to a character range in a Text node.",
      "when_to_use": "Assign an existing TextStyle to selected characters.",
      "when_not_to_use": "When changing raw font attributes; use other text style tools.",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Target Text node ID" },
        "start": { "type": "number", "required": true, "notes": "Start index (inclusive) ≥ 0" },
        "end": { "type": "number", "required": true, "notes": "End index (exclusive) > start" },
        "text_style_id": { "type": "string", "required": true, "notes": "Existing TEXT style ID (S:...)" },
        "auto_clamp": { "type": "boolean", "required": false, "notes": "Default true. Clamp range to [0,len] and swap if needed." }
      },
      "returns": "{ success: true, summary, modifiedNodeIds: [nodeId], nodeId, start, end, textStyleId, clamped? }",
      "hints": [
        "Ensure start < end and within node.characters length.",
        "Fonts for the range must be loaded; the plugin loads required fonts per-range.",
        "Use get_styles to discover valid text style IDs."
      ],
      "pitfalls": [
        "Off-by-one ranges (end is exclusive).",
        "Ranges across mixed fonts require loading multiple fonts.",
        "Locked nodes cannot be edited."
      ],
      "errors": [
        "missing_parameter — Provide all required params: node_id, start, end, text_style_id.",
        "invalid_parameter — Ensure start/end are integers and valid numbers.",
        "node_not_found — Re-select or fetch a valid node id, then retry.",
        "invalid_node_type — Use a TEXT node id, not FRAME/RECTANGLE/etc.",
        "node_locked — Call unlock_layers on the node (or parent) and retry.",
        "invalid_range — Adjust indices within characters length and ensure start < end (when auto_clamp=false).",
        "empty_range — Provide a non-empty range; current text may be empty.",
        "style_not_found — Run get_styles and pass a valid TEXT style id (see details.suggestions).",
        "font_load_failed — Reduce range or update text fonts; then retry.",
        "document_access_denied — Use async APIs or update manifest/documentAccess.",
        "set_style_failed — Inspect details and retry with corrected inputs."
      ],
      "side_effects": [
        "Updates the text style for the specified range.",
        "Selection is not modified."
      ],
      "limits": [
        "Applies shared TextStyle only; does not create or edit styles.",
        "Does not modify characters or layout."
      ],
      "preconditions": [
        "Target node exists and is of type TEXT.",
        "Range is within the node's characters length."
      ],
      "postchecks": [
        "Result.modifiedNodeIds includes the provided node_id.",
        "Result.summary references the style id and range."
      ],
      "agent_chaining": [
        "unlock_layers if node_locked, then retry.",
        "get_styles to discover valid text styles."
      ],
      "related_tools": ["set_text_content", "get_styles", "get_node_info"],
      "example_params": { "node_id": "12:34", "start": 0, "end": 78, "text_style_id": "S:1234abcd", "auto_clamp": true }
    }"""
    try:
        logger.info(f"🔤 Applying text style {text_style_id} to range [{start},{end}) on node {node_id}")
        params = {"nodeId": node_id, "start": start, "end": end, "textStyleId": text_style_id}
        if auto_clamp is not None:
            params["autoClamp"] = bool(auto_clamp)
        result = await send_command("set_range_text_style", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        # Re-raise structured tool errors so the Agent SDK can self-correct
        logger.error(f"❌ Tool execution failed for set_range_text_style: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        # Normalize non-tool failures into ToolExecutionError
        logger.error(f"❌ Communication/system error in set_range_text_style: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to set range text style: {str(e)}",
            "details": {"node_id": node_id, "start": start, "end": end, "text_style_id": text_style_id}
        })

@function_tool
async def list_available_fonts() -> str:
    """
    Lists available fonts on the user's machine.

    Returns:
        JSON string with { success, fonts: [{ family, style }] }
    """
    try:
        logger.info("🔡 Listing available fonts")
        result = await send_command("list_available_fonts")
        return _to_json_string(result)
    except Exception as e:
        error_msg = f"Failed to list available fonts: {str(e)}"
        logger.error(error_msg)
        return _error_json(error_msg)

# === COMPONENT TOOL ===

@function_tool
async def create_component(node_id: str) -> str:
    """{
      "category": "create",
      "mutates_canvas": true,
      "description": "Create a component from a node (clones children) and place an instance next to it.",
      "when_to_use": "Promote a designed frame/group into a reusable component.",
      "when_not_to_use": "When using existing library components (use create_component_instance).",
      "parameters": {
        "node_id": { "type": "string", "required": true, "notes": "Figma node id to convert into a component." }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], componentId: string, instanceId: string, name: string }",
      "hints": [
        "Works best on frames or groups; leaf shapes produce empty components.",
        "Use get_node_info on returned ids to inspect details."
      ],
      "pitfalls": [
        "Original node is not removed automatically.",
        "Using a leaf node results in a component without children."
      ],
      "errors": [
        "missing_parameter — Provide node_id as a non-empty string.",
        "invalid_parameter — Ensure node_id is a string.",
        "node_not_found — Verify the node exists; call get_selection or get_node_info.",
        "instance_creation_failed — Retry or place a different node; check plugin logs.",
        "locked_parent — Unlock the parent or append to current page, then retry.",
        "append_failed — Fallback to appending on current page or reparent later.",
        "creation_failed — Retry; if persistent, inspect details and permissions.",
        "create_component_failed — Unknown plugin error; inspect details for recovery.",
        "plugin_reported_failure — Tool returned success=false; inspect result.details and retry.",
        "communication_error — Check bridge/WebSocket health and retry."
      ],
      "side_effects": [
        "Creates a new ComponentNode and an InstanceNode appended near the original.",
        "Select state may change due to new instance placement."
      ],
      "limits": [
        "Does not publish to a library or manage variants.",
        "Only clones immediate children; property parity is best-effort."
      ],
      "preconditions": [
        "node_id resolves to an accessible node in the current document.",
        "Running inside a Figma Design file (not FigJam)."
      ],
      "postchecks": [
        "componentId and instanceId resolve to valid nodes in the document.",
        "modifiedNodeIds contains both the new component and instance ids."
      ],
      "agent_chaining": [
        "get_instance_overrides",
        "create_component_instance",
        "get_node_info"
      ],
      "related_tools": ["create_component_instance", "get_instance_overrides", "get_node_info"],
      "example_params": { "node_id": "12:34" }
    }"""
    try:
        logger.info(f"🧩 Creating component from node {node_id}")
        params = {"nodeId": node_id}
        result = await send_command("create_component", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for create_component: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_component: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to create component: {str(e)}",
            "details": {"node_id": node_id}
        })


# === LIBRARY / PUBLISH TOOL ===

@function_tool
async def publish_components(
    description: Optional[str] = None,
    cancel_if_no_changes: Optional[bool] = None,
    timeout_ms: Optional[int] = None,
    include_components: Optional[bool] = None,
    include_component_sets: Optional[bool] = None,
    include_styles_paint: Optional[bool] = None,
    include_styles_text: Optional[bool] = None,
    include_styles_effect: Optional[bool] = None,
    include_styles_grid: Optional[bool] = None,
) -> str:
    """{
      "category": "export",
      "mutates_canvas": false,
      "description": "Publish changed local components and styles to the Team Library with an optional description.",
      "when_to_use": "You want to publish updated components/styles from this file to the library.",
      "when_not_to_use": "There are no local changes to publish.",
      "parameters": {
        "description": { "type": "string", "required": false, "notes": "Publish message shown in Figma's dialog." },
        "cancel_if_no_changes": { "type": "boolean", "required": false, "notes": "Throw if nothing to publish (default true in plugin)." },
        "timeout_ms": { "type": "number", "required": false, "notes": "Timeout in milliseconds for the publish call." },
        "include_components": { "type": "boolean", "required": false, "notes": "Preflight: consider COMPONENT nodes." },
        "include_component_sets": { "type": "boolean", "required": false, "notes": "Preflight: consider COMPONENT_SET nodes." },
        "include_styles_paint": { "type": "boolean", "required": false, "notes": "Preflight: consider Paint styles." },
        "include_styles_text": { "type": "boolean", "required": false, "notes": "Preflight: consider Text styles." },
        "include_styles_effect": { "type": "boolean", "required": false, "notes": "Preflight: consider Effect styles." },
        "include_styles_grid": { "type": "boolean", "required": false, "notes": "Preflight: consider Grid styles." }
      },
      "returns": "{ success: true, summary: string, modifiedNodeIds: string[], publishedComponentIds: string[], publishedComponentSetIds: string[], publishedStyleIds: string[], counts: { components, componentSets, styles } }",
      "hints": [
        "Use include_* flags to narrow preflight checks before publishing.",
        "Provide a description to leave a meaningful publish note.",
        "Counts reflect detected local changes at publish time."
      ],
      "pitfalls": [
        "No categories selected will throw no_targets_selected.",
        "User can cancel the publish dialog (publish_canceled).",
        "Timeout too short may cause a timeout error."
      ],
      "errors": [
        "invalid_parameter — Ensure types match the schema (booleans, number, string).",
        "no_targets_selected — Enable at least one include_* flag.",
        "no_changes_to_publish — Make changes or disable cancel_if_no_changes.",
        "publish_canceled — Ask user to confirm publish or retry later.",
        "permission_denied — Ensure user has rights to publish from this file.",
        "timeout — Increase timeout_ms and retry.",
        "publish_failed — Inspect originalError for details and retry.",
        "plugin_reported_failure — The plugin returned success=false.",
        "communication_error — Bridge/WebSocket problem; check connection and retry."
      ],
      "side_effects": [
        "Shows Figma's publish dialog and updates the Team Library on success."
      ],
      "limits": [
        "API publishes all eligible changes; include_* only affects preflight checks.",
        "Cannot scope publishing to a subset of changes via API."
      ],
      "preconditions": [
        "File contains publishable local components/styles and user has permission.",
        "Running inside a Figma Design file (not FigJam)."
      ],
      "postchecks": [
        "counts totals are >= 0 and summary mentions published categories.",
        "modifiedNodeIds correspond to published component and component set ids."
      ],
      "agent_chaining": [
        "get_local_components"
      ],
      "related_tools": ["get_local_components", "get_styles"],
      "example_params": { "description": "Publish DS updates", "cancel_if_no_changes": true, "include_components": true, "include_styles_text": true }
    }"""
    try:
        logger.info("🚀 Publishing components/styles to library")
        params: Dict[str, Any] = {}
        if description is not None:
            params["description"] = str(description)
        if cancel_if_no_changes is not None:
            params["cancelIfNoChanges"] = bool(cancel_if_no_changes)
        if timeout_ms is not None:
            params["timeoutMs"] = int(timeout_ms)
        if include_components is not None:
            params["includeComponents"] = bool(include_components)
        if include_component_sets is not None:
            params["includeComponentSets"] = bool(include_component_sets)
        if include_styles_paint is not None:
            params["includeStylesPaint"] = bool(include_styles_paint)
        if include_styles_text is not None:
            params["includeStylesText"] = bool(include_styles_text)
        if include_styles_effect is not None:
            params["includeStylesEffect"] = bool(include_styles_effect)
        if include_styles_grid is not None:
            params["includeStylesGrid"] = bool(include_styles_grid)

        result = await send_command("publish_components", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool execution failed for publish_components: {getattr(te, 'message', str(te))}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in publish_components: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to publish components/styles: {str(e)}",
            "details": {}
        })
