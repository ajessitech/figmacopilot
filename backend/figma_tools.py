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

# ============================================
# ============ INTERNAL HELPERS ==============
# ============================================

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

def _sanitize_color_value(value: float, default: float = 0.0) -> float:
    """Sanitizes a color component to be a float between 0.0 and 1.0."""
    try:
        v = float(value)
        return max(0.0, min(1.0, v))
    except (ValueError, TypeError):
        return default


# ============================================
# == PYDANTIC MODELS FOR COMPLEX PARAMETERS ==
# ============================================

class TextReplacement(BaseModel):
    node_id: str
    text: str

class AnnotationProperty(BaseModel):
    name: str
    value: str

class Annotation(BaseModel):
    node_id: str
    label_markdown: str
    category_id: Optional[str] = None
    properties: Optional[List[AnnotationProperty]] = None

class Connection(BaseModel):
    start_node_id: str
    end_node_id: str
    text: Optional[str] = None

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

class FontName(BaseModel):
    model_config = ConfigDict(extra='forbid')
    family: str
    style: str


# ============================================
# ===============  TOOLS  ====================
# ============================================

# ============================================
# === Category 1: Scoping & Orientation ======
# ============================================

@function_tool
async def get_canvas_snapshot() -> str:
    """Return a compact snapshot of the current page and selection.

    Purpose & Use Case
    --------------------
    Provide the agent with the immediate context by returning the active page
    summary and the current selection. This tool is the canonical entry-point
    for scoping a new user task and should be called before any discovery or
    mutation operations.

    Parameters (Args)
    ------------------
    None.

    Returns
    -------
    (str): JSON string with keys:
        - `page`: {"id": str, "name": str}
        - `selection`: [RichNodeSummary]  # Always present (may be empty)
        - `root_nodes_on_page`: [BasicNodeSummary]  # Present when selection empty
        - `selection_signature` (optional): str
        - `selection_summary` (optional): {
              "selection_count": int,
              "types_count": {"<type>": int, ...},
              "hints": {"has_instances": bool, "has_variants": bool, "has_auto_layout": bool, "sticky_note_count": int, "total_text_chars": int},
              "nodes": [{"id": str, "name": str, "type": str}]
          }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: The communicator will re-raise structured plugin errors
    unchanged to enable agent self-correction. Known error codes include:
        - `page_unavailable`: Current page could not be accessed. Recovery: open a file/page.
        - `unknown_plugin_error`: Plugin-side failure. Recovery: inspect plugin logs.
        - `communication_error`: Bridge or websocket failure. Recovery: restart bridge.

    Agent Guidance
    --------------
    When to Use:
        - Always call as the very first tool to establish scope and selection.
    When NOT to Use:
        - Do not use for deep node inspection; call `get_node_details` instead.

    Chain of Thought Example
    -------------------------
    1. Call `get_canvas_snapshot` to get `selection`.
    2. If `selection` contains targets, scope subsequent `find_nodes` calls to it.

    Efficiency & Cost
    ------------------
    - Token Cost: Low. Returns a compact summary.
    - Latency: Low. Fast local plugin read; avoid calling repeatedly.
    """
    try:
        logger.info("🧭 Getting canvas snapshot")
        result = await send_command("get_canvas_snapshot")
        return _to_json_string(result)
    except ToolExecutionError as te:
        logger.error(f"❌ Tool get_canvas_snapshot failed: {getattr(te, 'message', str(te))}")
        # Re-raise structured tool error for agent self-correction
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_canvas_snapshot: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to communicate with plugin: {str(e)}",
            "details": {"command": "get_canvas_snapshot"}
        })


# ============================================
# === Category 2: Observation & Inspection ===
# ============================================

@function_tool(strict_mode=False)
async def find_nodes(filters: Optional[Dict[str, Any]] = None, scope_node_id: Optional[str] = None, highlight_results: Optional[bool] = None) -> str:
    """Find nodes matching flexible filters.

    Purpose & Use Case
    --------------------
    Locate nodes within a scope using flexible filters. Prefer scoping to the
    user's selection to reduce latency and avoid page-wide searches.

    Parameters (Args)
    ------------------
    filters (dict | None): Allowed keys: `name_regex`, `text_regex`, `node_types`,
        `main_component_id`, `style_id`.
    scope_node_id (str | None): Optional node id to restrict the search to its subtree.
    highlight_results (bool | None): If true the plugin may briefly highlight matches.

    Returns
    -------
    (str): JSON string: { "matching_nodes": [ RichNodeSummary, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged when the plugin reports structured
    errors. Known error codes include:
      - `invalid_regex`: The provided regex is invalid.
      - `scope_not_found`: The supplied `scopeNodeId` does not exist.
      - `figma_api_error`: Underlying Figma API failure.
      - `communication_error`: Bridge connectivity issues.

    Agent Guidance
    --------------
    When to Use: Use to find descendant nodes within a given scope. When NOT to Use:
    avoid page-wide searches unless necessary; prefer scoping to selection.
    """
    try:
        logger.info("🔎 Calling find_nodes", {"filters": filters, "scope_node_id": scope_node_id})
        params: Dict[str, Any] = {"filters": filters or {}}
        if scope_node_id is not None:
            params["scope_node_id"] = scope_node_id
        if highlight_results is not None:
            params["highlight_results"] = bool(highlight_results)
        result = await send_command("find_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        # Preserve structured tool errors for the agent to handle
        logger.error("❌ Tool find_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in find_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call find_nodes: {str(e)}", "details": {"command": "find_nodes"}})


@function_tool
async def get_node_details(node_ids: List[str]) -> str:
    """Fetch deep, authoritative details for one or more nodes.

    Purpose & Use Case
    --------------------
    Use as the ground-truth inspector immediately before a mutation and for
    post-mutation verification. Returns the full UnifiedNodeDataModel for each
    requested node.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids to inspect (1-3 recommended).

    Returns
    -------
    (str): JSON string: { "details": { "<nodeId>": { "target_node": {...}, "parent_summary": {...}|null, "children_summaries": [...] } } }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged for plugin-side structured failures.
    Known codes:
      - `missing_parameter`: `nodeIds` not provided or empty.
      - `node_not_found`: One or more node ids not present in the document.
      - `communication_error`: Bridge failure.

    Agent Guidance
    --------------
    When to Use: Call immediately before mutating a target node and after
    performing a mutation to verify the result.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids' must be a non-empty list", "details": {"node_ids": node_ids}})
        logger.info("🔍 Calling get_node_details", {"node_ids": node_ids})
        params = {"node_ids": node_ids}
        result = await send_command("get_node_details", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool get_node_details raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_node_details: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call get_node_details: {str(e)}", "details": {"command": "get_node_details"}})


@function_tool(strict_mode=False)
async def get_image_of_node(node_ids: List[str], export_settings: Optional[Dict[str, Any]] = None) -> str:
    """Export visual raster/vector images for nodes and return base64 blobs.

    Purpose & Use Case
    --------------------
    Generate PNG/JPEG/SVG exports for 1-3 nodes for visual verification or
    downstream image processing. Exports may be costly; prefer small batches.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids to export.
    export_settings (dict | None): Plugin export options (format, constraint).

    Returns
    -------
    (str): JSON string: { "images": { "<nodeId>": "<base64>" | null, ... } }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged for plugin-side errors. Known codes:
      - `missing_parameter`: `nodeIds` not supplied.
      - `export_failed`: Export failed for reasons captured in `details`.
      - `communication_error`: Bridge failure.

    Agent Guidance
    --------------
    When to Use: For final visual verification of a change or to show the user
    a before/after snapshot.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids' must be a non-empty list", "details": {"node_ids": node_ids}})
        logger.info("🖼️ Calling get_image_of_node", {"node_ids": node_ids})
        params: Dict[str, Any] = {"node_ids": node_ids}
        if export_settings is not None:
            params["export_settings"] = export_settings
        result = await send_command("get_image_of_node", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool get_image_of_node raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_image_of_node: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call get_image_of_node: {str(e)}", "details": {"command": "get_image_of_node"}})


@function_tool
async def get_node_ancestry(node_id: str) -> str:
    """Return the ancestry (parent chain) of a node up to the page root.

    Purpose & Use Case
    --------------------
    Provide a lightweight ordered list of ancestor `BasicNodeSummary` objects
    (parent, grandparent, ...). Useful to determine the node's contextual
    placement before making structural mutations.

    Parameters (Args)
    ------------------
    node_id (str): Target node id.

    Returns
    -------
    (str): JSON string: { "ancestors": [ BasicNodeSummary, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes:
      - `missing_parameter`: node_id missing or invalid.
      - `node_not_found`: Provided id not present in document.
      - `communication_error`: Bridge issues.

    Agent Guidance
    --------------
    When to Use: Inspect container hierarchy prior to structural changes.
    """
    try:
        logger.info(f"🧭 Getting ancestry for node {node_id}")
        # Pass snake_case params to the plugin boundary (plugin expects snake_case keys)
        result = await send_command("get_node_ancestry", {"node_id": node_id})
        return _to_json_string(result)
    except ToolExecutionError as te:
        # Propagate structured tool errors unchanged so the agent core can react
        raise te
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_node_ancestry: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get node ancestry: {str(e)}",
            "details": {"command": "get_node_ancestry", "node_id": node_id}
        })


@function_tool
async def get_node_hierarchy(node_id: str) -> str:
    """Return the immediate parent summary and direct children for a node.

    Purpose & Use Case
    --------------------
    Useful to inspect the immediate structure (parent + direct children) of a
    container node prior to iterating or mutating its direct children.

    Parameters (Args)
    ------------------
    node_id (str): Target node id.

    Returns
    -------
    (str): JSON string: { "parent_summary": BasicNodeSummary | null, "children": [ BasicNodeSummary, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known error codes include `missing_parameter`, `node_not_found`, and `communication_error`.

    Agent Guidance
    --------------
    When to Use: Inspect the immediate one-level structure of a container.
    """
    try:
        logger.info(f"🌳 Getting hierarchy for node {node_id}")
        result = await send_command("get_node_hierarchy", {"node_id": node_id})
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_node_hierarchy: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get node hierarchy: {str(e)}",
            "details": {"command": "get_node_hierarchy", "node_id": node_id}
        })


@function_tool
async def get_document_styles(style_types: Optional[List[str]] = None) -> str:
    """Return document-level styles (PAINT, TEXT, EFFECT, GRID).

    Purpose & Use Case
    --------------------
    Discover reusable design tokens in the file. Use to resolve human-friendly
    style names to style IDs before applying styles.

    Parameters (Args)
    ------------------
    style_types (List[str] | None): Optional list to filter by style kinds.

    Returns
    -------
    (str): JSON string: { "styles": [ { "id": str, "name": str, "type": str }, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: Call before applying a named style to obtain its ID.
    """
    try:
        logger.info("🎨 Getting document styles")
        # map to plugin-facing snake_case key (plugin accepts snake_case parameters)
        params = {"style_types": style_types} if style_types is not None else {}
        result = await send_command("get_document_styles", params)
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_document_styles: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get document styles: {str(e)}",
            "details": {"command": "get_document_styles"}
        })


@function_tool
async def get_style_consumers(style_id: str) -> str:
    """Find nodes on the current page that use the given style.

    Purpose & Use Case
    --------------------
    Useful to understand impact before changing a style or to show the user
    which nodes consume a style.

    Parameters (Args)
    ------------------
    style_id (str): Style ID to search for.

    Returns
    -------
    (str): JSON string: { "consuming_nodes": [ { "node": RichNodeSummary, "fields": List[str] }, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: Before mutating or deleting a style to evaluate its consumers.
    """
    try:
        logger.info(f"🔎 Getting style consumers for {style_id}")
        result = await send_command("get_style_consumers", {"style_id": style_id})
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_style_consumers: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get style consumers: {str(e)}",
            "details": {"command": "get_style_consumers", "style_id": style_id}
        })


@function_tool
async def get_document_components() -> str:
    """List local components and component sets in the document.

    Purpose & Use Case
    --------------------
    Discover local components (id/key/name) for instantiation or inspection.

    Returns
    -------
    (str): JSON string: { "components": [ { "id": str, "component_key": Optional[str], "name": str, "type": str }, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `figma_api_error`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: When needing to instantiate or inspect components programmatically.
    """
    try:
        logger.info("🧩 Getting document components")
        result = await send_command("get_document_components", {})
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_document_components: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get document components: {str(e)}",
            "details": {"command": "get_document_components"}
        })


@function_tool
async def get_prototype_interactions(node_id: str) -> str:
    """Retrieve prototype reactions attached to a node.

    Purpose & Use Case
    --------------------
    Returns the node's `reactions` array (triggers/actions) for prototype inspection
    and verification.

    Parameters (Args)
    ------------------
    node_id (str): Target node id.

    Returns
    -------
    (str): JSON string: { "reactions": [ Reaction, ... ] }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `node_not_found`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: Inspect prototype wiring before changing interactions.
    """
    try:
        logger.info(f"🔗 Getting prototype interactions for node {node_id}")
        result = await send_command("get_prototype_interactions", {"node_id": node_id})
        return _to_json_string(result)
    except ToolExecutionError as te:
        raise te
    except Exception as e:
        logger.error(f"❌ Communication/system error in get_prototype_interactions: {str(e)}")
        raise ToolExecutionError({
            "code": "communication_error",
            "message": f"Failed to get prototype interactions: {str(e)}",
            "details": {"command": "get_prototype_interactions", "node_id": node_id}
        })


# ============================================
# ==== Category 3: Mutation & Creation =======
# ============================================

### Sub-Category 3.1: Create Tools

@function_tool(strict_mode=False)
async def create_frame(
    width: int = 100,
    height: int = 100,
    x: int = 0,
    y: int = 0,
    name: str = "Frame",
    parent_id: str = "",
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
    """Create a new Frame node.

    Purpose & Use Case
    --------------------
    Create a `FRAME` container with optional auto-layout and styling. Use when
    adding new layout containers or cards to the canvas.

    Parameters (Args)
    ------------------
    width (int): Initial width in px.
    height (int): Initial height in px.
    x (int): X position on the canvas.
    y (int): Y position on the canvas.
        name (str): Node name.
    parent_id (str): Parent node ID (required).
    layout_mode (str | None): "NONE" | "HORIZONTAL" | "VERTICAL".
    ... (auto-layout and styling options as function signature)

    Returns
    -------
    (str): JSON string: { "success": true, "summary": str, "created_node_id": str, "node": { ... } }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin error codes include:
      - `parent_not_found`, `invalid_parent_type`, `locked_parent`,
        `append_failed`, `create_frame_failed`, `plugin_reported_failure`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: Create layout containers, especially when auto-layout is needed.
    Verification: Call `get_node_details` on the returned node id.
    """
    try:
        logger.info(f"🖼️ Creating frame: {width}x{height} at ({x}, {y}) named '{name}'")

        params: Dict[str, Any] = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name,
            "layout_mode": layout_mode,
        }
        # `parent_id` is optional: if provided and non-empty, include it; otherwise
        # omit to let the plugin append the created frame to the current page.
        if isinstance(parent_id, str) and parent_id:
            params["parent_id"] = parent_id

        # Optional layout fields
        if layout_wrap is not None:
            params["layout_wrap"] = layout_wrap
        if padding_top is not None:
            params["padding_top"] = padding_top
        if padding_right is not None:
            params["padding_right"] = padding_right
        if padding_bottom is not None:
            params["padding_bottom"] = padding_bottom
        if padding_left is not None:
            params["padding_left"] = padding_left
        if primary_axis_align_items is not None:
            params["primary_axis_align_items"] = primary_axis_align_items
        if counter_axis_align_items is not None:
            params["counter_axis_align_items"] = counter_axis_align_items
        if layout_sizing_horizontal is not None:
            params["layout_sizing_horizontal"] = layout_sizing_horizontal
        if layout_sizing_vertical is not None:
            params["layout_sizing_vertical"] = layout_sizing_vertical
        if item_spacing is not None:
            params["item_spacing"] = item_spacing

        # Optional styling fields
        if fill_color is not None:
            params["fill_color"] = {
                "r": _sanitize_color_value(getattr(fill_color, "r", 0.0), 0.0),
                "g": _sanitize_color_value(getattr(fill_color, "g", 0.0), 0.0),
                "b": _sanitize_color_value(getattr(fill_color, "b", 0.0), 0.0),
                "a": _sanitize_color_value(getattr(fill_color, "a", 1.0) or 1.0, 1.0),
            }
        if stroke_color is not None:
            params["stroke_color"] = {
                "r": _sanitize_color_value(getattr(stroke_color, "r", 0.0), 0.0),
                "g": _sanitize_color_value(getattr(stroke_color, "g", 0.0), 0.0),
                "b": _sanitize_color_value(getattr(stroke_color, "b", 0.0), 0.0),
                "a": _sanitize_color_value(getattr(stroke_color, "a", 1.0) or 1.0, 1.0),
            }
        if stroke_weight is not None:
            params["stroke_weight"] = stroke_weight

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

@function_tool(strict_mode=False)
async def create_rectangle(
    width: int = 100,
    height: int = 100,
    x: int = 0,
    y: int = 0,
    name: str = "Rectangle",
    parent_id: str = "",
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
    """Create a Rectangle node.

    Purpose & Use Case
    --------------------
    Add rectangle shapes (cards, buttons) with optional styling and layout
    constraints.

    Parameters (Args)
    ------------------
    See function signature for supported options (dimensions, styling, radii,
    visibility, layout flags).

    Returns
    -------
    (str): JSON string: { "success": true, "summary": str, "created_node_id": str, "node": { ... } }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `invalid_size`,
    `invalid_fills`, `invalid_stroke_weight`, `invalid_corner_radius`,
    `parent_not_found`, `invalid_parent`, `append_failed`, `plugin_reported_failure`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For rectangular UI elements; verify with `get_node_details` after creation.
    """
    try:
        logger.info(f"🟦 Creating rectangle: {width}x{height} at ({x}, {y}) named '{name}'")

        params: Dict[str, Any] = {
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "name": name,
        }

        # parent_id is optional (defaults to figma.currentPage on the plugin side)
        if isinstance(parent_id, str) and parent_id:
            params["parent_id"] = parent_id

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
            params["stroke_weight"] = float(stroke_weight)
        if stroke_align is not None:
            params["stroke_align"] = str(stroke_align).upper()

        # Corners
        if corner_radius is not None:
            params["corner_radius"] = float(corner_radius)
        if top_left_radius is not None:
            params["top_left_radius"] = float(top_left_radius)
        if top_right_radius is not None:
            params["top_right_radius"] = float(top_right_radius)
        if bottom_left_radius is not None:
            params["bottom_left_radius"] = float(bottom_left_radius)
        if bottom_right_radius is not None:
            params["bottom_right_radius"] = float(bottom_right_radius)

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
            params["layout_align"] = str(layout_align).upper()
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
async def create_ellipse(
    width: int = 100,
    height: int = 100,
    x: int = 0,
    y: int = 0,
    name: str = "Ellipse",
    parent_id: str = "",
) -> str:
    """Create an Ellipse node (oval).

    Purpose & Use Case
    --------------------
    Create circular or oval shapes for icons and decoration.

    Parameters (Args)
    ------------------
    See function signature for width/height/position/parent options.

    Returns
    -------
    (str): JSON string success payload including "created_node_id" and created node summary.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes include `parent_not_found`, `invalid_parent`, `append_failed`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For circular shapes; verify and style after creation.
    """
    try:
        logger.info(f"◯ Creating ellipse: {width}x{height} at ({x}, {y}) named '{name}'")
        params: Dict[str, Any] = {"width": width, "height": height, "x": x, "y": y, "name": name}
        # parent_id is optional (defaults to figma.currentPage on the plugin side)
        if isinstance(parent_id, str) and parent_id:
            params["parent_id"] = parent_id
        result = await send_command("create_ellipse", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool execution failed for create_ellipse")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_ellipse: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to create ellipse: {str(e)}", "details": {"command": "create_ellipse"}})


@function_tool
async def create_polygon(
    side_count: int = 3,
    radius: int = 50,
    x: int = 0,
    y: int = 0,
    name: str = "Polygon",
    parent_id: str = "",
) -> str:
    """Create a regular polygon node.

    Purpose & Use Case
    --------------------
    Create regular polygons (triangles, pentagons, etc.) useful for badges and icons.

    Parameters (Args)
    ------------------
        side_count (int): Number of sides (>=3).
    radius (int): Outer radius in px.
    ... see signature for placement and parent.

    Returns
    -------
    (str): JSON string including "created_node_id" and created node summary.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `parent_not_found`, `invalid_parent`, `append_failed`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For geometric decorations; verify created node with `get_node_details`.
    """
    try:
        logger.info(f"🔷 Creating polygon: sides={side_count} radius={radius} at ({x},{y}) named '{name}'")
        params: Dict[str, Any] = {"side_count": int(side_count), "radius": radius, "x": x, "y": y, "name": name}
        # parent_id is optional (defaults to figma.currentPage on the plugin side)
        if isinstance(parent_id, str) and parent_id:
            params["parent_id"] = parent_id
        result = await send_command("create_polygon", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool execution failed for create_polygon")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_polygon: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to create polygon: {str(e)}", "details": {"command": "create_polygon"}})


@function_tool
async def create_star(
    point_count: int = 5,
    outer_radius: int = 50,
    inner_radius_ratio: float = 0.5,
    x: int = 0,
    y: int = 0,
    name: str = "Star",
    parent_id: str = "",
) -> str:
    """Create a Star node.

    Purpose & Use Case
    --------------------
    Create star shapes for badges and icons.

    Parameters (Args)
    ------------------
    point_count (int), outer_radius (int), inner_radius_ratio (float), placement, parent.

    Returns
    -------
    (str): JSON string including "created_node_id" and created node summary.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `parent_not_found`, `invalid_parent`, `append_failed`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For decorative star shapes; verify result after creation.
    """
    try:
        logger.info(f"⭐ Creating star: points={point_count} outer_radius={outer_radius} at ({x},{y}) named '{name}'")
        params: Dict[str, Any] = {"point_count": int(point_count), "outer_radius": outer_radius, "inner_radius_ratio": float(inner_radius_ratio), "x": x, "y": y, "name": name}
        # parent_id is optional (defaults to figma.currentPage on the plugin side)
        if isinstance(parent_id, str) and parent_id:
            params["parent_id"] = parent_id
        result = await send_command("create_star", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool execution failed for create_star")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_star: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to create star: {str(e)}", "details": {"command": "create_star"}})


@function_tool
async def create_line(
    length: int = 100,
    rotation_degrees: int = 0,
    x: int = 0,
    y: int = 0,
    name: str = "Line",
    parent_id: str = "",
) -> str:
    """Create a Line node.

    Purpose & Use Case
    --------------------
    Add simple line primitives for dividers and underlines.

    Parameters (Args)
    ------------------
        length (int): Line length in px.
        rotation_degrees (int): Rotation in degrees.
    x,y,name,parent as per signature.

    Returns
    -------
    (str): JSON string success payload including "created_node_id" and created node info.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `parent_not_found`, `invalid_parent`, `append_failed`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For straight-line primitives; verify created node with `get_node_details`.
    """
    try:
        logger.info(f"— Creating line: length={length} rotation={rotation_degrees} at ({x},{y}) named '{name}'")
        params: Dict[str, Any] = {"length": length, "rotation_degrees": rotation_degrees, "x": x, "y": y, "name": name}
        # parent_id is optional (defaults to figma.currentPage on the plugin side)
        if isinstance(parent_id, str) and parent_id:
            params["parent_id"] = parent_id
        result = await send_command("create_line", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool execution failed for create_line")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_line: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to create line: {str(e)}", "details": {"command": "create_line"}})


@function_tool(strict_mode=False)
async def create_text(
    characters: str,
    parent_id: str,
    x: int = 0,
    y: int = 0,
    font_size: int = 16,
    font_weight: int = 400,
    name: str = "",
    font_color: Optional[RGBAColor] = None,
) -> str:
    """Create a Text node.

    ## Purpose & Use Case
    Create a single-style text node with optional font size, weight and color.
    Use this tool to add labels, headings, or button text that will be
    follow-up edited via text-specific tools if required.

    ## Parameters (Args)
        characters (str): The textual characters to insert (required).
        parent_id (str): Parent node id to append to (required).
        x (int): X position on canvas (optional).
        y (int): Y position on canvas (optional).
        font_size (int): Font size in px (>0 recommended).
        font_weight (int): Numeric weight mapped to available font styles.
        name (str): Layer name; defaults to the provided text.
        font_color (RGBAColor): Inline font color {r,g,b,a} (optional).

    ## Returns
        (str): JSON string: {
            "success": true,
            "summary": str,
            "created_node_id": str,
            "node": { id, name, x, y, characters, font_size, font_weight, parent_id? }
        }

    ## Raises (Errors & Pitfalls)
        ToolExecutionError: Plugin may raise structured errors. Common codes:
            - "invalid_font_size": Provide a positive numeric font_size.
            - "invalid_font_weight": Use supported weight mappings.
            - "font_load_failed": Requested font not available; try fallback.
            - "set_characters_failed": Setting characters failed; retry.
            - "parent_not_found": Parent id invalid; re-select and retry.
            - "locked_parent": Unlock the parent or pick a different one.
            - "append_failed": Failed to append to parent; may be transient.
            - "plugin_reported_failure": Inspect details and rectify inputs.
            - "communication_error": Bridge issue; restart session and retry.

    ## Agent Guidance
    When to Use:
        - When creating labels or other short, single-style text nodes.
    When NOT to Use:
        - Avoid for rich/multi-style text; use range-style tools after creation.
    Chain of Thought Example:
        1. Locate target parent/frame.
        2. Call `create_text` with characters and desired font_size.
        3. Verify node via `get_node_details` and apply further styling with `set_text_style`.
    """
    try:
        logger.info(f"📝 Creating text node: '{characters}' at ({x}, {y})")

        params: Dict[str, Any] = {
            "characters": characters,
            "x": x,
            "y": y,
            "font_size": font_size,
            "font_weight": font_weight,
            "name": name or characters,
        }
        if not isinstance(parent_id, str) or not parent_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide parent_id", "details": {"parent_id": parent_id}})
        params["parent_id"] = parent_id
        if font_color is not None:
            params["font_color"] = {
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


### Sub-Category 3.2: Modify (General Properties)

@function_tool(strict_mode=False)
async def set_fills(node_ids: List[str], paints: List[Dict[str, Any]]) -> str:
    """Set the fills array for multiple nodes (replace or remove).

    Purpose & Use Case
    --------------------
    Replace the full `fills` array on a set of nodes. Use an empty `paints`
    array to remove fills.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    paints (List[dict]): Array of Paint objects per Figma API.

    Returns
    -------
    (str): JSON string success payload: { "modified_node_ids": [...], "summary": "..." }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `missing_parameter`, `invalid_parameter`, `invalid_fills`, `node_not_found`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For exact control over a node's fills. Verify with `get_node_details` after mutation.
    """
    try:
        logger.info(f"🎨 set_fills: node_ids={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "paints": paints}
        result = await send_command("set_fills", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_fills: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set fills: {str(e)}", "details": {"command": "set_fills"}})


@function_tool(strict_mode=False)
async def set_strokes(node_ids: List[str], paints: List[Dict[str, Any]], stroke_weight: Optional[float] = None, stroke_align: Optional[str] = None, dash_pattern: Optional[List[float]] = None) -> str:
    """Set stroke paints and stroke properties on multiple nodes.

    Purpose & Use Case
    --------------------
    Update strokes (paints, weight, alignment, dash pattern) for a batch of nodes.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    paints (List[dict]): Stroke paints array.
    stroke_weight (float | None): Stroke thickness.
    stroke_align (str | None): "CENTER"|"INSIDE"|"OUTSIDE".
    dash_pattern (List[float] | None): Dash pattern values.

    Returns
    -------
    (str): JSON string success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `invalid_parameter`, `invalid_stroke_weight`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For stroke updates across multiple nodes; batch changes and verify visually.
    """
    try:
        logger.info(f"🖊️ set_strokes: node_ids={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "paints": paints}
        if stroke_weight is not None: params["stroke_weight"] = float(stroke_weight)
        if stroke_align is not None: params["stroke_align"] = stroke_align
        if dash_pattern is not None: params["dash_pattern"] = dash_pattern
        result = await send_command("set_strokes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_strokes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set strokes: {str(e)}", "details": {"command": "set_strokes"}})


@function_tool
async def set_corner_radius(
    node_ids: List[str],
    uniform_radius: Optional[float] = None,
    top_left: Optional[float] = None,
    top_right: Optional[float] = None,
    bottom_left: Optional[float] = None,
    bottom_right: Optional[float] = None,
) -> str:
    """Set uniform or per-corner radii on supported nodes (v2 spec).

    Purpose & Use Case
    --------------------
    Apply rounded corners to frames, rectangles, and components. Supports a
    uniform radius and/or per-corner radii when the node type allows it.

    Parameters (Args)
    ------------------
    node_ids (List[str]): One or more target node ids.
    uniform_radius (float | None): Radius in px to apply uniformly to all corners.
    top_left (float | None): Per-corner override for top-left.
    top_right (float | None): Per-corner override for top-right.
    bottom_left (float | None): Per-corner override for bottom-left.
    bottom_right (float | None): Per-corner override for bottom-right.

    Returns
    -------
    (str): JSON string success payload: { "modified_node_ids": [...], "summary": "..." }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `set_corner_radius_failed`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For consistent corner radii on UI components. Verify with `get_node_details`.
    """
    try:
        logger.info(
            f"📐 set_corner_radius: nodes={len(node_ids)} uniform={uniform_radius} TL={top_left} TR={top_right} BL={bottom_left} BR={bottom_right}"
        )

        params: Dict[str, Any] = {"node_ids": node_ids}
        if uniform_radius is not None:
            params["uniform_radius"] = float(uniform_radius)
        if top_left is not None:
            params["top_left"] = float(top_left)
        if top_right is not None:
            params["top_right"] = float(top_right)
        if bottom_left is not None:
            params["bottom_left"] = float(bottom_left)
        if bottom_right is not None:
            params["bottom_right"] = float(bottom_right)

        result = await send_command("set_corner_radius", params)
        return _to_json_string(result)

    except ToolExecutionError:
        logger.error("❌ Tool execution failed for set_corner_radius")
        raise
    except Exception as e:
        error_msg = f"Failed to set corner radius due to system error: {str(e)}"
        logger.error(error_msg)
        raise ToolExecutionError({
            "code": "communication_error",
            "message": error_msg,
            "details": {"command": "set_corner_radius"}
        })


@function_tool
async def set_size(node_ids: List[str], width: Optional[float] = None, height: Optional[float] = None) -> str:
    """Resize multiple nodes by width and/or height.

    Purpose & Use Case
    --------------------
    Adjust geometry of target nodes. Provide one or both dimensions.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    width (float | None): New width in px.
    height (float | None): New height in px.

    Returns
    -------
    (str): JSON success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes: `missing_parameter`, `invalid_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For layout adjustments; prefer `set_auto_layout` for auto-layout containers.
    """
    try:
        logger.info(f"📏 set_size: node_ids={len(node_ids)}, width={width}, height={height}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        if width is not None: params["width"] = float(width)
        if height is not None: params["height"] = float(height)
        result = await send_command("set_size", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_size: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set size: {str(e)}", "details": {"command": "set_size"}})


@function_tool
async def set_position(node_ids: List[str], x: float, y: float) -> str:
    """Set absolute X/Y position for multiple nodes.

    Purpose & Use Case
    --------------------
    Reposition nodes on the canvas using absolute coordinates.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    x (float): X coordinate in px.
    y (float): Y coordinate in px.

    Returns
    -------
    (str): JSON success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For explicit positioning; consider layout constraints when moving children.
    """
    try:
        logger.info(f"📍 set_position: node_ids={len(node_ids)}, x={x}, y={y}")
        params: Dict[str, Any] = {"node_ids": node_ids, "x": float(x), "y": float(y)}
        result = await send_command("set_position", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_position: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set position: {str(e)}", "details": {"command": "set_position"}})


@function_tool
async def set_rotation(node_ids: List[str], rotation_degrees: float) -> str:
    """Set rotation (degrees) for multiple nodes.

    Purpose & Use Case
    --------------------
    Rotate nodes by a specified degree value.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    rotation_degrees (float): Rotation angle in degrees.

    Returns
    -------
    (str): JSON success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes include `missing_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For rotating decorations or icons; verify bounding boxes if needed.
    """
    try:
        logger.info(f"🧭 set_rotation: node_ids={len(node_ids)}, rotation_degrees={rotation_degrees}")
        params: Dict[str, Any] = {"node_ids": node_ids, "rotation_degrees": float(rotation_degrees)}
        result = await send_command("set_rotation", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_rotation: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set rotation: {str(e)}", "details": {"command": "set_rotation"}})


@function_tool
async def set_layer_properties(node_ids: List[str], name: Optional[str] = None, opacity: Optional[float] = None, visible: Optional[bool] = None, locked: Optional[bool] = None, blend_mode: Optional[str] = None) -> str:
    """Set common layer properties (name, opacity, visibility, lock, blend) on nodes.

    Purpose & Use Case
    --------------------
    Apply naming and visibility properties across a batch of nodes.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    name (str | None), opacity (float | None), visible (bool | None), locked (bool | None), blend_mode (str | None).

    Returns
    -------
    (str): JSON success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `invalid_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For bulk edits to layer metadata; useful for cleanup and visibility toggles.
    """
    try:
        logger.info(f"🧱 set_layer_properties: node_ids={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        if name is not None: params["name"] = name
        if opacity is not None: params["opacity"] = float(opacity)
        if visible is not None: params["visible"] = bool(visible)
        if locked is not None: params["locked"] = bool(locked)
        if blend_mode is not None: params["blend_mode"] = blend_mode
        result = await send_command("set_layer_properties", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_layer_properties: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set layer properties: {str(e)}", "details": {"command": "set_layer_properties"}})


@function_tool(strict_mode=False)
async def set_effects(node_ids: List[str], effects: List[Dict[str, Any]]) -> str:
    """Set the effects array (shadows, blurs) on multiple nodes.

    Purpose & Use Case
    --------------------
    Replace the `effects` array on target nodes. Use `[]` to remove all effects.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    effects (List[dict]): Array of Effect objects per Figma API.

    Returns
    -------
    (str): JSON success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `invalid_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For applying visual effects; verify rendering via `get_image_of_node` if necessary.
    """
    try:
        logger.info(f"✨ set_effects: node_ids={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "effects": effects}
        result = await send_command("set_effects", params)
        return _to_json_string(result)
    except ToolExecutionError:
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_effects: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to set effects: {str(e)}", "details": {"command": "set_effects"}})


### Sub-Category 3.3: Modify (Layout)

@function_tool
async def set_auto_layout(
    node_ids: List[str],
    layout_mode: Optional[str] = None,
    padding_left: Optional[float] = None,
    padding_right: Optional[float] = None,
    padding_top: Optional[float] = None,
    padding_bottom: Optional[float] = None,
    item_spacing: Optional[float] = None,
    primary_axis_align_items: Optional[str] = None,
    counter_axis_align_items: Optional[str] = None,
    primary_axis_sizing_mode: Optional[str] = None,
    counter_axis_sizing_mode: Optional[str] = None,
) -> str:
    """Configure auto-layout on container nodes.

    Purpose & Use Case
    --------------------
    Apply auto-layout properties (mode, padding, spacing, alignment, sizing)
    to container nodes that support `layoutMode`.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of container node ids.
    layout_mode (str | None): "HORIZONTAL" | "VERTICAL" | "NONE" | "GRID".
    padding_* (float | None): Padding values in px.
    item_spacing (float | None), primary/counter axis alignment and sizing.

    Returns
    -------
    (str): JSON success payload from the plugin.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes include `missing_parameter`, `set_auto_layout_failed`, `invalid_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For configuring auto-layout on frames; call `get_node_details` first to confirm node supports auto-layout.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide node_ids array", "details": {"received": node_ids}})

        logger.info(f"📐 set_auto_layout: node_ids={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        if layout_mode is not None: params["layout_mode"] = layout_mode
        if padding_left is not None: params["padding_left"] = float(padding_left)
        if padding_right is not None: params["padding_right"] = float(padding_right)
        if padding_top is not None: params["padding_top"] = float(padding_top)
        if padding_bottom is not None: params["padding_bottom"] = float(padding_bottom)
        if item_spacing is not None: params["item_spacing"] = float(item_spacing)
        if primary_axis_align_items is not None: params["primary_axis_align_items"] = primary_axis_align_items
        if counter_axis_align_items is not None: params["counter_axis_align_items"] = counter_axis_align_items
        if primary_axis_sizing_mode is not None: params["primary_axis_sizing_mode"] = primary_axis_sizing_mode
        if counter_axis_sizing_mode is not None: params["counter_axis_sizing_mode"] = counter_axis_sizing_mode

        result = await send_command("set_auto_layout", params)
        return _to_json_string(result)
    except ToolExecutionError:
        # Preserve structured tool errors
        logger.error("❌ Tool set_auto_layout raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_auto_layout: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_auto_layout: {str(e)}", "details": {"command": "set_auto_layout"}})


@function_tool
async def set_auto_layout_child(
    node_ids: List[str],
    layout_align: Optional[str] = None,
    layout_grow: Optional[int] = None,
    layout_positioning: Optional[str] = None,
) -> str:
    """Set auto-layout child properties on child nodes.

    Purpose & Use Case
    --------------------
    Configure per-child auto-layout properties (layoutAlign, layoutGrow, positioning).

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of child node ids.
    layout_align (str | None): Alignment setting.
    layout_grow (int | None): 0 or 1.
    layout_positioning (str | None): "AUTO" or "ABSOLUTE".

    Returns
    -------
    (str): JSON success payload from plugin.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `invalid_parameter`, `set_auto_layout_child_failed`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For tuning child behavior inside auto-layout containers.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide node_ids array", "details": {"received": node_ids}})
        if layout_grow is not None and layout_grow not in (0, 1):
            raise ToolExecutionError({"code": "invalid_parameter", "message": "layout_grow must be 0 or 1", "details": {"layout_grow": layout_grow}})

        logger.info(f"📐 set_auto_layout_child: node_ids={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        if layout_align is not None: params["layout_align"] = layout_align
        if layout_grow is not None: params["layout_grow"] = int(layout_grow)
        if layout_positioning is not None: params["layout_positioning"] = layout_positioning

        result = await send_command("set_auto_layout_child", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool set_auto_layout_child raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_auto_layout_child: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_auto_layout_child: {str(e)}", "details": {"command": "set_auto_layout_child"}})


@function_tool
async def set_constraints(node_ids: List[str], horizontal: str, vertical: str) -> str:
    """Set layout constraints (horizontal & vertical) on multiple nodes.

    Purpose & Use Case
    --------------------
    Apply constraint rules for responsive behavior of nodes within parents.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids.
    horizontal (str): Constraint for horizontal axis.
    vertical (str): Constraint for vertical axis.

    Returns
    -------
    (str): JSON success payload.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `invalid_parameter`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For responsive design adjustments; validate in multiple breakpoints if applicable.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide node_ids array", "details": {"received": node_ids}})
        if not isinstance(horizontal, str) or not isinstance(vertical, str):
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide horizontal and vertical", "details": {"horizontal": horizontal, "vertical": vertical}})

        logger.info(f"📐 set_constraints: node_ids={len(node_ids)} horizontal={horizontal} vertical={vertical}")
        params: Dict[str, Any] = {"node_ids": node_ids, "horizontal": horizontal, "vertical": vertical}
        result = await send_command("set_constraints", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool set_constraints raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_constraints: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_constraints: {str(e)}", "details": {"command": "set_constraints"}})


### Sub-Category 3.4: Modify (Text)

@function_tool
async def set_text_characters(node_id: str, new_characters: str) -> str:
    """Set the full `characters` value for a single TEXT node.

    Purpose & Use Case
    --------------------
    Replace the entire contents of a TEXT node. Intended for whole-text
    replacements (labels, button text). Operates on a single node.

    Parameters (Args)
    ------------------
    node_id (str): Target TEXT node id.
    new_characters (str): Replacement characters string.

    Returns
    -------
    (str): JSON plugin response: { "modified_node_ids": ["<id>"], "summary": "..." }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes:
      - `missing_parameter`, `node_not_found`, `invalid_node_type`, `node_locked`,
        `font_load_failed`, `set_text_characters_failed`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: For whole-text replacements. For incremental/range edits use range-specific tools.
    """
    try:
        if not isinstance(node_id, str) or not node_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_id' must be a non-empty string", "details": {"node_id": node_id}})
        if not isinstance(new_characters, str):
            raise ToolExecutionError({"code": "missing_parameter", "message": "'new_characters' must be a string", "details": {"new_characters": new_characters}})

        logger.info(f"✏️ set_text_characters: node_id={node_id}")
        params = {"node_id": node_id, "new_characters": new_characters}
        result = await send_command("set_text_characters", params)
        return _to_json_string(result)
    except ToolExecutionError:
        # Preserve structured tool errors for the agent core to handle
        logger.error(f"❌ Tool set_text_characters raised ToolExecutionError for node {node_id}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_text_characters: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_text_characters: {str(e)}", "details": {"command": "set_text_characters", "node_id": node_id}})


@function_tool(strict_mode=False)
async def set_text_style(
    node_ids: List[str],
    font_size: Optional[float] = None,
    font_name: Optional[FontName] = None,
    text_align_horizontal: Optional[str] = None,
    text_auto_resize: Optional[str] = None,
    line_height_percent: Optional[float] = None,
    letter_spacing_percent: Optional[float] = None,
    text_case: Optional[str] = None,
    text_decoration: Optional[str] = None,
) -> str:
    """Apply common text-style properties to multiple TEXT nodes.

    Purpose & Use Case
    --------------------
    Apply font-related and layout-oriented text properties (font size, font
    family/style, alignment, auto-resize mode, line-height/letter-spacing,
    casing and decoration) across a batch of TEXT nodes.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of target TEXT node IDs.
    font_size (float, optional): Font size in pixels.
    font_name (FontName, optional): Object with `family` and `style` keys.
    text_align_horizontal (str, optional): One of 'LEFT','CENTER','RIGHT','JUSTIFIED'.
    text_auto_resize (str, optional): One of 'NONE','WIDTH_AND_HEIGHT','HEIGHT'.
    line_height_percent (float, optional): Line height as percent (0-100+).
    letter_spacing_percent (float, optional): Letter spacing as percent.
    text_case (str, optional): One of 'ORIGINAL','UPPER','LOWER','TITLE'.
    text_decoration (str, optional): One of 'NONE','STRIKETHROUGH','UNDERLINE'.

    Returns
    -------
    (str): JSON-serialized plugin response. On success: `{ "modified_node_ids": [...], "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports a structured failure.
        Known error codes include:
            - "missing_parameter": node_ids missing or empty.
            - "font_load_failed": Plugin could not load the requested font.
            - "set_text_style_failed": Generic plugin failure applying styles.
            - "communication_error": Bridge/connection issue while calling plugin.

    Agent Guidance
    --------------
    When to Use: Use this when you want to normalize typography across a small
    set of text nodes (1-10). For very large batches consider chunking.

    When NOT to Use: Do not call repeatedly in tight loops; batch updates
    together and verify with `get_node_details` after the mutation.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids' must be a non-empty list", "details": {"node_ids": node_ids}})

        logger.info("🅰️ set_text_style", extra={"node_count": len(node_ids)})

        params: Dict[str, Any] = {"node_ids": node_ids}
        if font_size is not None:
            params["font_size"] = float(font_size)
        if font_name is not None:
            # FontName is a pydantic model; convert to dict expected by plugin
            params["font_name"] = {"family": font_name.family, "style": font_name.style}
        if text_align_horizontal is not None:
            params["text_align_horizontal"] = text_align_horizontal
        if text_auto_resize is not None:
            params["text_auto_resize"] = text_auto_resize
        if line_height_percent is not None:
            params["line_height_percent"] = float(line_height_percent)
        if letter_spacing_percent is not None:
            params["letter_spacing_percent"] = float(letter_spacing_percent)
        if text_case is not None:
            params["text_case"] = text_case
        if text_decoration is not None:
            params["text_decoration"] = text_decoration

        result = await send_command("set_text_style", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool set_text_style raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_text_style: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_text_style: {str(e)}", "details": {"command": "set_text_style"}})


### Sub-Category 3.5: Hierarchy & Structure

@function_tool
async def clone_nodes(node_ids: List[str]) -> str:
    """Clone one or more nodes on the canvas.

    Purpose & Use Case
    --------------------
    Create immediate duplicates of the provided nodes. Useful for creating
    temporary copies or making small variations without modifying the
    original elements.

    Parameters (Args)
    ------------------
    node_ids (List[str]): A non-empty list of node IDs to clone.

    Returns
    -------
    (str): JSON-serialized plugin response. On success the plugin returns
        `{ "created_node_ids": [...], "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports a structured failure.
        Known error codes include: "missing_parameter", "node_not_found",
        "clone_failed", and "communication_error".
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids' must be a non-empty list", "details": {"node_ids": node_ids}})

        logger.info("🧬 clone_nodes", extra={"node_count": len(node_ids)})
        params = {"node_ids": node_ids}
        result = await send_command("clone_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool clone_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in clone_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call clone_nodes: {str(e)}", "details": {"command": "clone_nodes"}})


@function_tool
async def group_nodes(node_ids: List[str], new_group_name: str, parent_id: str) -> str:
    """Group nodes into a new container with the given name under a parent.

    Purpose & Use Case
    --------------------
    Create a new group/container that holds the provided nodes. Use this to
    create logical containers for layout or organization.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to group.
    new_group_name (str): Name to assign to the created group.
    parent_id (str): ID of the parent container where the group will be placed.

    Returns
    -------
    (str): JSON-serialized plugin response. On success the plugin returns
        `{ "created_group_id": "<id>", "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: May raise "missing_parameter", "parent_not_found",
        "invalid_parent_container", "group_failed", or
        "communication_error".
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids' must be a non-empty list", "details": {"node_ids": node_ids}})
        if not isinstance(new_group_name, str) or not new_group_name:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'new_group_name' must be a non-empty string", "details": {"new_group_name": new_group_name}})
        if not isinstance(parent_id, str) or not parent_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'parent_id' must be a non-empty string", "details": {"parent_id": parent_id}})

        logger.info("📦 group_nodes", extra={"node_count": len(node_ids), "parent_id": parent_id})
        params = {"node_ids": node_ids, "new_group_name": new_group_name, "parent_id": parent_id}
        result = await send_command("group_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool group_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in group_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call group_nodes: {str(e)}", "details": {"command": "group_nodes"}})


@function_tool
async def ungroup_node(node_id: str) -> str:
    """Ungroup a group node, moving its children to the group's parent.

    Purpose & Use Case
    --------------------
    Remove a grouping node and move its children back to the parent. Useful
    for flattening structure after temporary grouping.

    Parameters (Args)
    ------------------
    node_id (str): The ID of the group node to ungroup.

    Returns
    -------
    (str): JSON-serialized plugin response. On success the plugin returns
        `{ "moved_child_ids": [...], "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: May raise "missing_parameter", "node_not_found",
        "invalid_parent_container", "ungroup_failed", or
        "communication_error".
    """
    try:
        if not isinstance(node_id, str) or not node_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_id' must be a non-empty string", "details": {"node_id": node_id}})

        logger.info("🧩 ungroup_node", extra={"node_id": node_id})
        params = {"node_id": node_id}
        result = await send_command("ungroup_node", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool ungroup_node raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in ungroup_node: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call ungroup_node: {str(e)}", "details": {"command": "ungroup_node", "node_id": node_id}})


@function_tool
async def reparent_nodes(node_ids_to_move: List[str], new_parent_id: str) -> str:
    """Move nodes into a new parent container.

    Purpose & Use Case
    --------------------
    Reparent the provided nodes under the specified parent. Use this to
    reorganize the scene graph or move items into newly created containers.

    Parameters (Args)
    ------------------
    node_ids_to_move (List[str]): Non-empty list of node IDs to move.
    new_parent_id (str): The destination parent node ID.

    Returns
    -------
    (str): JSON-serialized plugin response. On success the plugin returns
        `{ "moved_node_ids": [...], "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: May raise "missing_parameter", "parent_not_found",
        "invalid_parent_container", "reparent_failed", or
        "communication_error".
    """
    try:
        if not isinstance(node_ids_to_move, list) or len(node_ids_to_move) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids_to_move' must be a non-empty list", "details": {"node_ids_to_move": node_ids_to_move}})
        if not isinstance(new_parent_id, str) or not new_parent_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'new_parent_id' must be a non-empty string", "details": {"new_parent_id": new_parent_id}})

        logger.info("🔀 reparent_nodes", extra={"count": len(node_ids_to_move), "new_parent_id": new_parent_id})
        params = {"node_ids_to_move": node_ids_to_move, "new_parent_id": new_parent_id}
        result = await send_command("reparent_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool reparent_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in reparent_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call reparent_nodes: {str(e)}", "details": {"command": "reparent_nodes"}})


@function_tool
async def reorder_nodes(node_ids: List[str], mode: str) -> str:
    """Reorder nodes in their parent's stacking order.

    Purpose & Use Case
    --------------------
    Change the stacking order (z-order) of nodes. Mode must be one of
    BRING_FORWARD, SEND_BACKWARD, BRING_TO_FRONT, SEND_TO_BACK.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to reorder.
    mode (str): One of the supported reorder modes.

    Returns
    -------
    (str): JSON-serialized plugin response. On success the plugin returns
        `{ "modified_node_ids": [...], "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: May raise "missing_parameter", "invalid_parameter",
        "reorder_failed", or "communication_error".
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_ids' must be a non-empty list", "details": {"node_ids": node_ids}})
        if not isinstance(mode, str) or mode not in {"BRING_FORWARD", "SEND_BACKWARD", "BRING_TO_FRONT", "SEND_TO_BACK"}:
            raise ToolExecutionError({"code": "invalid_parameter", "message": "'mode' must be one of BRING_FORWARD|SEND_BACKWARD|BRING_TO_FRONT|SEND_TO_BACK", "details": {"mode": mode}})

        logger.info("↕️ reorder_nodes", extra={"mode": mode, "count": len(node_ids)})
        params = {"node_ids": node_ids, "mode": mode}
        result = await send_command("reorder_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool reorder_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in reorder_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call reorder_nodes: {str(e)}", "details": {"command": "reorder_nodes"}})


### Sub-Category 3.6: Vector & Boolean

@function_tool
async def perform_boolean_operation(node_ids: List[str], operation: str, parent_id: str) -> str:
    """
    Perform a boolean operation (UNION, SUBTRACT, INTERSECT, EXCLUDE) on vector-like nodes.

    ## Purpose & Use Case
    Create a single boolean compound from multiple vector-like shapes. Use this
    when the agent needs to merge or cut shapes programmatically.

    ## Parameters (Args)
        node_ids (List[str]): Non-empty list of node ids (>=2) to combine.
        operation (str): One of 'UNION','SUBTRACT','INTERSECT','EXCLUDE'.
        parent_id (str): ID of the parent/container to place the resulting node into.

    ## Returns
        (str): JSON-serialized plugin response with keys: { created_node_id, summary, unresolved_node_ids }

    ## Raises (Errors & Pitfalls)
        ToolExecutionError: Structured errors from the plugin such as:
            - 'missing_parameter' if required args are missing
            - 'invalid_parameter' for bad operation value
            - 'parent_not_found' if parent_id does not exist
            - 'invalid_node_types' if supplied nodes are not vector-like
            - 'boolean_operation_failed' or 'operation_failed' for plugin-side failures
            - 'communication_error' for bridge/timeout/system errors
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) < 2:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide at least 2 node_ids", "details": {"node_ids": node_ids}})
        if not isinstance(operation, str) or operation not in {"UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"}:
            raise ToolExecutionError({"code": "invalid_parameter", "message": "Invalid operation; must be UNION|SUBTRACT|INTERSECT|EXCLUDE", "details": {"operation": operation}})
        if not isinstance(parent_id, str) or not parent_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide parent_id", "details": {"parent_id": parent_id}})

        logger.info(f"🔀 perform_boolean_operation: op={operation} count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "operation": operation, "parent_id": parent_id}
        result = await send_command("perform_boolean_operation", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool perform_boolean_operation raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in perform_boolean_operation: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call perform_boolean_operation: {str(e)}", "details": {"command": "perform_boolean_operation"}})


@function_tool
async def flatten_nodes(node_ids: List[str], parent_id: str) -> str:
    """
    Flatten multiple nodes into a single vector/path node.

    ## Purpose & Use Case
    Convert a set of nodes into a single flattened vector (e.g., for exporting
    or simplifying complex groups). Use sparingly and prefer 1-3 nodes at a time.

    ## Parameters (Args)
        node_ids (List[str]): Non-empty list of node ids to flatten.
        parent_id (str): ID of the parent/container to place the flattened node into.

    ## Returns
        (str): JSON-serialized plugin response with keys: { created_node_id, summary, unresolved_node_ids }

    ## Raises (Errors & Pitfalls)
        ToolExecutionError: Structured errors such as 'missing_parameter', 'parent_not_found',
        'flatten_failed', 'operation_failed', or 'communication_error'.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide a non-empty node_ids list", "details": {"node_ids": node_ids}})
        if not isinstance(parent_id, str) or not parent_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide parent_id", "details": {"parent_id": parent_id}})

        logger.info(f"🧱 flatten_nodes: count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "parent_id": parent_id}
        result = await send_command("flatten_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool flatten_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in flatten_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call flatten_nodes: {str(e)}", "details": {"command": "flatten_nodes"}})


### Sub-Category 3.7: Components & Styles

@function_tool
async def create_component_from_node(node_id: str, name: str) -> str:
    """
    { "category": "components", "mutates_canvas": true, "description": "Create a new Component from an existing node by cloning it into a newly created component." }

    Purpose & Use Case
    --------------------
    Creates a new Figma `COMPONENT` by cloning the provided node into a fresh component object
    and placing that component alongside the original node when possible.

    Parameters
    ----------
    node_id (str): ID of the source node to convert into a component (required)
    name (str): Name for the created component.

    Returns
    -------
    str: JSON-serialized plugin response: {"success": true, "summary": string, "created_component_id": "<id>", "modified_node_ids": ["<id>"]}

    Raises
    ------
    ToolExecutionError: The communicator will raise structured errors produced by the plugin
        (e.g., `missing_parameter`, `node_not_found`, `creation_failed`, `configuration_failed`, `communication_error`).
    """
    try:
        logger.info(f"🧩 create_component_from_node: node_id={node_id}, name={name}")
        params: Dict[str, Any] = {"node_id": node_id, "name": name}
        result = await send_command("create_component_from_node", params)
        return _to_json_string(result)
    except ToolExecutionError:
        # Preserve structured tool errors
        logger.error("❌ Tool create_component_from_node raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_component_from_node: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call create_component_from_node: {str(e)}", "details": {"command": "create_component_from_node"}})


@function_tool
async def create_component_instance(
    component_key: Optional[str] = None,
    component_id: Optional[str] = None,
    x: Optional[float] = 0.0,
    y: Optional[float] = 0.0,
    parent_id: Optional[str] = None,
) -> str:
    """
    { "category": "components", "mutates_canvas": true, "description": "Create an instance of a published component by key and place it on the canvas." }

    Parameters
    ----------
    component_key (str | None): The component key (published) to import and instantiate.
    component_id (str | None): The component node id to instantiate (alternative to key).
    x (float, optional): X coordinate for placement (default: 0)
    y (float, optional): Y coordinate for placement (default: 0)
    parent_id (str, optional): Optional parent node id to append the instance into.

    Returns
    -------
    str: JSON-serialized plugin response containing {"success": true, "summary": string, "created_node_id": string, ...node details }.

    Raises
    ------
    ToolExecutionError: Propagates plugin-structured errors such as `missing_parameter`, `component_not_found`, `permission_denied`, `instance_creation_failed`, or `communication_error`.
    """
    try:
        if not component_key and not component_id:
            raise ToolExecutionError({
                "code": "missing_parameter",
                "message": "Provide at least one of 'component_key' or 'component_id'",
                "details": {}
            })

        logger.info(
            f"🧩 create_component_instance: key={component_key} id={component_id} x={x} y={y} parent_id={parent_id}"
        )
        params: Dict[str, Any] = {}
        if component_key:
            params["component_key"] = component_key
        if component_id:
            params["component_id"] = component_id
        if x is not None: params["x"] = float(x)
        if y is not None: params["y"] = float(y)
        if parent_id is not None: params["parent_id"] = parent_id
        result = await send_command("create_component_instance", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool create_component_instance raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_component_instance: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call create_component_instance: {str(e)}", "details": {"command": "create_component_instance"}})


@function_tool(strict_mode=False)
async def set_instance_properties(node_ids: List[str], properties: Dict[str, Any]) -> str:
    """
    { "category": "components", "mutates_canvas": true, "description": "Set published instance properties (overrides) on one or more instance nodes." }

    Parameters
    ----------
    node_ids (List[str]): List of instance node IDs to modify (required)
    properties (dict): Mapping of propertyName[#id] -> value (required)

    Returns
    -------
    str: JSON-serialized object: {"success": true, "modified_node_ids": [...], "summary": "..."}

    Raises
    ------
    ToolExecutionError: Structured errors from the plugin (e.g., `missing_parameter`, `no_instances_modified`, `unknown_plugin_error`, `communication_error`).
    """
    try:
        logger.info(f"🔧 set_instance_properties: node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "properties": properties}
        result = await send_command("set_instance_properties", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool set_instance_properties raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_instance_properties: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_instance_properties: {str(e)}", "details": {"command": "set_instance_properties"}})


@function_tool
async def detach_instance(node_ids: List[str]) -> str:
    """
    { "category": "components", "mutates_canvas": true, "description": "Detach one or more instances into regular frames/groups (materialize overrides)." }

    Parameters
    ----------
    node_ids (List[str]): List of instance node IDs to detach (required)

    Returns
    -------
    str: JSON-serialized object: {"success": true, "created_frame_ids": ["<id>", ...], "summary": string}

    Raises
    ------
    ToolExecutionError: Propagates plugin structured failures such as `missing_parameter`, `no_instances_detached`, or `communication_error`.
    """
    try:
        logger.info(f"🔧 detach_instance: node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        result = await send_command("detach_instance", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool detach_instance raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in detach_instance: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call detach_instance: {str(e)}", "details": {"command": "detach_instance"}})


@function_tool(strict_mode=False)
async def create_style(name: str, type: str, style_properties: Dict[str, Any]) -> str:
    """
    { "category": "styles", "mutates_canvas": true, "description": "Create a document style (paint/text/effect/grid) from provided properties." }

    Parameters
    ----------
    name (str): Style name (required)
    type (str): Style type: 'PAINT'|'TEXT'|'EFFECT'|'GRID' (required)
    style_properties (dict): Properties required to construct the style (paints, text style, effect params, grid params)

    Returns
    -------
    str: JSON-serialized object: {"created_style_id": "<id>"}

    Raises
    ------
    ToolExecutionError: Propagates plugin-structured errors such as `missing_parameter`, `invalid_style_type`, `style_creation_failed`, or `communication_error`.
    """
    try:
        logger.info(f"🎨 create_style: name={name}, type={type}")
        params: Dict[str, Any] = {"name": name, "type": type, "style_properties": style_properties}
        result = await send_command("create_style", params)
        return _to_json_string(result)
    except ToolExecutionError as e:
        logger.error(f"❌ Tool create_style raised ToolExecutionError | code={getattr(e, 'code', None)} | details={getattr(e, 'details', {})}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_style: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call create_style: {str(e)}", "details": {"command": "create_style"}})


@function_tool
async def apply_style(node_ids: List[str], style_id: str, style_type: str) -> str:
    """
    { "category": "styles", "mutates_canvas": true, "description": "Apply a named style to a set of nodes (fills, strokes, text, effects, grid)." }

    Parameters
    ----------
    node_ids (List[str]): Node IDs to apply the style to (required)
    style_id (str): ID of the style to apply (required)
    style_type (str): Which kind of style to apply: 'FILL'|'STROKE'|'TEXT'|'EFFECT'|'GRID'

    Returns
    -------
    str: JSON-serialized object: {"modified_node_ids": [...], "summary": "..."}

    Raises
    ------
    ToolExecutionError: Propagates plugin structured failures such as `missing_parameter`, `invalid_style_type`, `apply_failed`, or `communication_error`.
    """
    try:
        logger.info(f"🎨 apply_style: style_id={style_id}, style_type={style_type}, node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "style_id": style_id, "style_type": style_type}
        result = await send_command("apply_style", params)
        return _to_json_string(result)
    except ToolExecutionError as e:
        logger.error(f"❌ Tool apply_style raised ToolExecutionError | code={getattr(e, 'code', None)} | details={getattr(e, 'details', {})}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in apply_style: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call apply_style: {str(e)}", "details": {"command": "apply_style"}})


### Sub-Category 3.8: Variables

@function_tool
async def create_variable_collection(name: str, initial_mode_name: Optional[str] = None) -> str:
    """Create a variable collection in the current document.

    Purpose & Use Case
    --------------------
    Create a named variable collection which can host multiple variables
    and modes. Useful for organizing design tokens or theme-scoped values.

    Parameters (Args)
    ------------------
    name (str): Name for the new collection. Must be non-empty.
    initial_mode_name (str, optional): Optional name for the initial mode in the collection.

    Returns
    -------
    str: JSON-serialized plugin response. On success returns an object with
         key `collection_id` containing the new collection's id.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: The communicator will raise structured errors produced
    by the plugin. Known error codes include:
        - "missing_parameter": name was not provided or empty.
        - "variables_api_unavailable": Variables API not supported in this environment.
        - "unknown_plugin_error": Any other plugin-side failure.

    Agent Guidance
    --------------
    When to Use: Call this to create a new logical grouping for variables
    before creating variables inside it.
    """
    try:
        logger.info(f"🧾 create_variable_collection: name={name} initial_mode_name={initial_mode_name}")
        if not isinstance(name, str) or not name.strip():
            raise ToolExecutionError({"code": "missing_parameter", "message": "'name' must be a non-empty string", "details": {"name": name}})

        params: Dict[str, Any] = {"name": name}
        if initial_mode_name is not None:
            params["initial_mode_name"] = initial_mode_name

        result = await send_command("create_variable_collection", params)
        return _to_json_string(result)
    except ToolExecutionError as e:
        logger.error(f"❌ Tool create_variable_collection raised ToolExecutionError | code={getattr(e, 'code', None)} | details={getattr(e, 'details', {})}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_variable_collection: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call create_variable_collection: {str(e)}", "details": {"command": "create_variable_collection"}})


@function_tool
async def create_variable(name: str, collection_id: str, resolved_type: str) -> str:
    """Create a variable inside a collection.

    Purpose & Use Case
    --------------------
    Create a new variable in the specified collection. The `resolved_type`
    must match one of the plugin-supported types (COLOR, FLOAT, STRING, BOOLEAN).

    Parameters (Args)
    ------------------
    name (str): Variable name (non-empty).
    collection_id (str): ID of an existing variable collection.
    resolved_type (str): One of "COLOR","FLOAT","STRING","BOOLEAN".

    Returns
    -------
    str: JSON string with key `variable_id` on success.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagates structured plugin errors such as:
        - "missing_parameter": required args missing.
        - "invalid_parameter": invalid `resolved_type` supplied.
        - "collection_not_found": specified collection does not exist.
        - "create_variable_failed": plugin failed to create the variable.
        - "variables_api_unavailable": Variables API not available.
    """
    try:
        logger.info(f"🧪 create_variable: name={name} collection_id={collection_id} resolved_type={resolved_type}")
        if not isinstance(name, str) or not name.strip() or not isinstance(collection_id, str) or not collection_id.strip() or not isinstance(resolved_type, str):
            raise ToolExecutionError({"code": "missing_parameter", "message": "'name', 'collection_id', and 'resolved_type' are required", "details": {"name": name, "collection_id": collection_id, "resolved_type": resolved_type}})

        valid_types = {"COLOR", "FLOAT", "STRING", "BOOLEAN"}
        if resolved_type not in valid_types:
            raise ToolExecutionError({"code": "invalid_parameter", "message": "'resolved_type' must be one of COLOR|FLOAT|STRING|BOOLEAN", "details": {"resolved_type": resolved_type}})

        params = {"name": name, "collection_id": collection_id, "resolved_type": resolved_type}
        result = await send_command("create_variable", params)
        return _to_json_string(result)
    except ToolExecutionError as e:
        logger.error(f"❌ Tool create_variable raised ToolExecutionError | code={getattr(e, 'code', None)} | details={getattr(e, 'details', {})}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in create_variable: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call create_variable: {str(e)}", "details": {"command": "create_variable"}})


@function_tool
async def set_variable_value(variable_id: str, mode_id: str, value: Any) -> str:
    """Set the value of a variable for a specific mode.

    Purpose & Use Case
    --------------------
    Update the runtime value for a variable in a given mode (for example,
    setting the color value for a color variable). The `value` type must be
    compatible with the variable's resolved type.

    Parameters (Args)
    ------------------
    variable_id (str): ID of the target variable.
    mode_id (str): ID of the mode to set the value for.
    value (Any): The value to assign (string/number/bool/object depending on type).

    Returns
    -------
    str: JSON-serialized plugin response with keys like `modified_variable_id` and `summary`.

    Raises
    ------
    ToolExecutionError: Propagates plugin structured errors such as:
        - "missing_parameter": required args missing.
        - "variable_not_found": variable id not found.
        - "set_value_failed": plugin failed to set the value.
        - "variables_api_unavailable": Variables API not available.
    """
    try:
        logger.info(f"🔁 set_variable_value: variable_id={variable_id} mode_id={mode_id}")
        if not isinstance(variable_id, str) or not variable_id.strip() or not isinstance(mode_id, str) or not mode_id.strip():
            raise ToolExecutionError({"code": "missing_parameter", "message": "'variable_id' and 'mode_id' are required", "details": {"variable_id": variable_id, "mode_id": mode_id}})

        params = {"variable_id": variable_id, "mode_id": mode_id, "value": value}
        result = await send_command("set_variable_value", params)
        return _to_json_string(result)
    except ToolExecutionError as e:
        logger.error(f"❌ Tool set_variable_value raised ToolExecutionError | code={getattr(e, 'code', None)} | details={getattr(e, 'details', {})}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_variable_value: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_variable_value: {str(e)}", "details": {"command": "set_variable_value"}})


@function_tool
async def bind_variable_to_property(node_id: str, property: str, variable_id: str) -> str:
    """Bind an existing variable to a node property (e.g., fills[0].color).

    Purpose & Use Case
    --------------------
    Connect a variable to a node's property so the node will reference the variable
    (e.g., to keep colors in sync across components). Supports common property
    paths such as `fills[0].color` and `strokes[0].color`.

    Parameters (Args)
    ------------------
    node_id (str): The node to bind the variable to.
    property (str): The property path string (e.g., `fills[0].color`).
    variable_id (str): ID of the variable to bind.

    Returns
    -------
    str: JSON response on success containing `modified_node_ids` and `summary`.

    Raises
    ------
    ToolExecutionError: Propagates structured plugin errors such as:
        - "missing_parameter": required args missing.
        - "node_not_found": node id not found.
        - "variable_not_found": variable id not found.
        - "unsupported_property": property path not supported for binding.
        - "bind_failed": plugin failed to perform binding.
    """
    try:
        logger.info(f"🔗 bind_variable_to_property: node_id={node_id} property={property} variable_id={variable_id}")
        if not isinstance(node_id, str) or not node_id.strip() or not isinstance(property, str) or not property.strip() or not isinstance(variable_id, str) or not variable_id.strip():
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_id', 'property', and 'variable_id' are required", "details": {"node_id": node_id, "property": property, "variable_id": variable_id}})

        params = {"node_id": node_id, "property": property, "variable_id": variable_id}
        result = await send_command("bind_variable_to_property", params)
        return _to_json_string(result)
    except ToolExecutionError as e:
        logger.error(f"❌ Tool bind_variable_to_property raised ToolExecutionError | code={getattr(e, 'code', None)} | details={getattr(e, 'details', {})}")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in bind_variable_to_property: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call bind_variable_to_property: {str(e)}", "details": {"command": "bind_variable_to_property"}})


### Sub-Category 3.9: Prototyping

@function_tool(strict_mode=False)
async def set_reaction(node_ids: List[str], reactions: List[Dict[str, Any]]) -> str:
    """
    Set prototyping reactions on one or more nodes (batch replace/remove).

    Purpose & Use Case
    --------------------
    Configure the prototype `reactions` array for a set of nodes. This tool
    is intended for precise, small-batch updates to prototype interactions
    (1-10 nodes). To remove reactions, pass an empty list for `reactions`.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to modify.
    reactions (List[Dict[str, Any]]): Array of Reaction objects as defined
        by the Figma plugin API. Provide `[]` to remove all reactions.

    Returns
    -------
    (str): JSON-serialized plugin response on success. Expected structure:
        `{ "success": true, "modified_node_ids": ["<id>"], "summary": "..." }`.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports a structured failure.
        Known error codes emitted by the plugin include:
            - "missing_parameter": `node_ids` missing or empty.
              Recovery: Supply a non-empty `node_ids` array.
            - "invalid_parameter": `reactions` is not an array.
              Recovery: Pass an array (use `[]` to remove reactions).
            - "set_reaction_failed": No nodes were updated (see details).
              Recovery: Inspect `details` for notFoundIds/lockedNodes and retry.
            - "communication_error": Bridge/connection issue. Restart session.

    Agent Guidance
    --------------
    When to Use: Call immediately before mutating prototype interactions and
    use `get_prototype_interactions` to verify pre/post state when needed.

    When NOT to Use: Do not use for broad discovery; use `find_nodes`/selection
    to target specific nodes first. Avoid calling in tight loops for large sets.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide node_ids array", "details": {"received": node_ids}})
        if not isinstance(reactions, list):
            raise ToolExecutionError({"code": "invalid_parameter", "message": "reactions must be an array (use [] to remove)", "details": {"received": reactions}})

        logger.info(f"🔗 set_reaction: node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "reactions": reactions}
        result = await send_command("set_reaction", params)
        return _to_json_string(result)

    except ToolExecutionError:
        logger.error("❌ Tool set_reaction raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_reaction: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_reaction: {str(e)}", "details": {"command": "set_reaction"}})


# ============================================
# ======= Category 4: Meta & Utility =========
# ============================================

@function_tool
async def scroll_and_zoom_into_view(node_ids: List[str]) -> str:
    """
    Scroll the viewport to focus on specified nodes and adjust zoom.

    Purpose & Use Case
    --------------------
    Programmatically moves the user's viewport to focus on the provided
    node ids. Use this to draw the user's attention to found or newly
    created nodes before or after mutations.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids to bring into view.

    Returns
    -------
    str: JSON-serialized plugin response matching the plugin contract:
        {"success": true, "summary": "...", "resolved_node_ids": [...], "unresolved_node_ids": [...], "zoom": number, "center": {x,y}}

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports a structured failure
        (e.g., `missing_parameter`, `nodes_not_found`, `figma_api_error`) or
        when communication fails.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide node_ids array", "details": {"node_ids": node_ids}})

        logger.info(f"🔭 scroll_and_zoom_into_view: node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        result = await send_command("scroll_and_zoom_into_view", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool scroll_and_zoom_into_view raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in scroll_and_zoom_into_view: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call scroll_and_zoom_into_view: {str(e)}", "details": {"command": "scroll_and_zoom_into_view"}})


@function_tool
async def delete_nodes(node_ids: List[str]) -> str:
    """
    Permanently delete nodes from the canvas.

    Purpose & Use Case
    --------------------
    Remove nodes specified by id. Use only when the user intends deletion
    or when cleaning up temporary helper objects. The plugin will report
    which nodes were actually deleted and which were unresolved/locked.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids to delete.

    Returns
    -------
    str: JSON-serialized plugin response matching the plugin contract:
        {"success": true, "deleted_node_ids": [...], "summary": "...", "unresolved_node_ids": [...], "locked_node_ids": [...], "non_deletable_node_ids": [...]}.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports structured failures
        (e.g., `missing_required_parameter`, `no_nodes_deleted`, `delete_failed`) or
        when communication fails.
    """
    try:
        if not isinstance(node_ids, list) or len(node_ids) == 0:
            raise ToolExecutionError({"code": "missing_parameter", "message": "Provide node_ids array", "details": {"node_ids": node_ids}})

        logger.info(f"🗑️ delete_nodes: node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids}
        result = await send_command("delete_nodes", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool delete_nodes raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in delete_nodes: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call delete_nodes: {str(e)}", "details": {"command": "delete_nodes"}})


@function_tool
async def show_notification(message: str, is_error: Optional[bool] = None) -> str:
    """
    Show a short toast notification to the user.

    Purpose & Use Case
    --------------------
    Display a transient message to inform the user about progress, success,
    or non-blocking errors. This is not meant for critical failures that
    prevent further execution.

    Parameters (Args)
    ------------------
    message (str): Non-empty message to show to the user.
    is_error (bool, optional): If true, show as an error-style notification.

    Returns
    -------
    str: JSON-serialized plugin response: {"success": true}

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports structured failures
        (e.g., `missing_parameter`, `figma_api_error`) or when communication fails.
    """
    try:
        if not isinstance(message, str) or not message:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'message' must be a non-empty string", "details": {"message": message}})

        logger.info(f"🔔 show_notification: message='{message[:80]}' is_error={bool(is_error)}")
        params: Dict[str, Any] = {"message": message}
        if is_error is not None:
            params["is_error"] = bool(is_error)
        result = await send_command("show_notification", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool show_notification raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in show_notification: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call show_notification: {str(e)}", "details": {"command": "show_notification"}})


@function_tool
async def commit_undo_step() -> str:
    """
    Commit the last set of operations into a single undo step.

    Purpose & Use Case
    --------------------
    After performing a logical multi-step mutation sequence, call this
    tool so the user's undo stack treats the sequence as one atomic step.

    Parameters (Args)
    ------------------
    None.

    Returns
    -------
    str: JSON-serialized plugin response: {"success": true}

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Raised when the plugin reports structured failures
        or when communication fails.
    """
    try:
        logger.info("🔁 commit_undo_step")
        result = await send_command("commit_undo_step", {})
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool commit_undo_step raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in commit_undo_step: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call commit_undo_step: {str(e)}", "details": {"command": "commit_undo_step"}})


