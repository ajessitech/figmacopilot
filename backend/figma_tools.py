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
async def get_canvas_snapshot(include_images: bool = False) -> str:
    """Return a compact snapshot of the current page and selection.

    Purpose & Use Case
    --------------------
    This tool provides a foundational overview of the user's current context in Figma.
    It's the primary method for gathering initial information at the start of any task,
    capturing details about the active page and the user's current selection. The snapshot
    is lightweight and designed for quick orientation before diving into more specific
    discovery or mutation operations. It can optionally include Base64-encoded images
    of the selected nodes for visual inspection by the agent, though this increases
    the payload size and should be used judiciously.

    Parameters (Args)
    ------------------
    include_images (bool, optional): If True, the plugin will attempt to export
        a low-resolution PNG image of each selected node (up to a small limit)
        and include it as a Base64-encoded string in the response. Defaults to False.

    Returns
    -------
    (str): JSON string with a detailed snapshot, including:
        - `page`: { "id": str, "name": str } - Basic info of the current page.
        - `selection`: [RichNodeSummary] - A (possibly empty) list of detailed summaries
          for each currently selected node.
        - `root_nodes_on_page`: [BasicNodeSummary] - A list of top-level nodes on the
          page, provided ONLY if the selection is empty.
        - `selection_signature` (str): A unique hash representing the current selection state.
          Useful for caching or detecting changes.
        - `selection_summary` (dict): A condensed summary of the selection, including
          node counts by type, structural hints (e.g., presence of auto-layout, instances),
          and a simple list of selected node IDs, names, and types.
        - `exported_images` (dict, optional): A dictionary mapping node IDs to their
          Base64-encoded PNG image strings. This key is only present if `include_images`
          was set to True and the export was successful for at least one node.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: The communicator will re-raise structured plugin errors
    unchanged to enable agent self-correction. Known error codes include:
        - `page_unavailable`: Current page could not be accessed. Recovery: ask the user to open a file/page.
        - `snapshot_export_failed`: The optional image export failed for one or more nodes. This is a partial failure; the main snapshot data is still returned.
        - `unknown_plugin_error`: A general plugin-side failure occurred. Recovery: inspect plugin logs for details.
        - `communication_error`: Bridge or websocket failure. Recovery: advise restarting the bridge.

    Agent Guidance
    --------------
    When to Use:
        - As the very first tool call in nearly every new user task to establish the initial context.
        - When you need to quickly check if the user's selection has changed.
        - When a visual understanding of the selected items is necessary for the task (use `include_images=True`).

    When NOT to Use:
        - Do not use this tool for deep, authoritative node inspection; call `get_node_details` for that purpose.
        - Avoid calling with `include_images=True` unless visual confirmation is essential, as it increases latency and token usage.

    Chain of Thought Example
    -------------------------
    1. User asks: "Change the color of these buttons to blue."
    2. Agent calls `get_canvas_snapshot()` to see what "these buttons" refers to.
    3. The `selection` array in the response confirms the user has selected three FRAME nodes.
    4. Agent proceeds to call `set_fills` on the node IDs from the snapshot.
    """
    try:
        logger.info(f"🧭 Getting canvas snapshot (include_images={include_images})")
        result = await send_command("get_canvas_snapshot", {"include_images": include_images})
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
    """Find nodes matching flexible filters within a specified scope.

    Purpose & Use Case
    --------------------
    This tool is essential for locating specific nodes on the canvas based on a
    flexible set of criteria. It allows searching by node type, name, text
    content, component linkage, or applied styles. The search can be performed
    across the entire page or scoped to a specific container node, making it a
    versatile tool for discovery and inspection before performing mutations.

    Parameters (Args)
    ------------------
    filters (dict, optional): A dictionary of filters to apply. All filters are
        AND-composed. Supported keys are:
        - `node_types` (List[str]): An array of node types to search for (e.g.,
          ["FRAME", "TEXT", "INSTANCE"]). This is the most efficient filter.
        - `name_regex` (str): A regular expression to match against the node's
          layer name (`node.name`).
        - `text_regex` (str): A regular expression to match against the content
          of a TEXT node (`node.characters`). The plugin will only test this
          regex against nodes of type "TEXT".
        - `main_component_id` (str): The ID of a main component to find all its
          instances. The plugin will only test this against INSTANCE nodes.
        - `style_id` (str): The ID of a style (e.g., fill, stroke, text, effect)
          to find all nodes that consume it.
    scope_node_id (str, optional): The ID of a node to search within. If omitted,
        the search is performed on the entire current page. Scoping searches is
        highly recommended for performance.
    highlight_results (bool, optional): If True, the plugin will briefly
        highlight the found nodes on the canvas to provide visual feedback to
        the user. Defaults to False.

    Returns
    -------
    (str): A JSON string containing a single key, "matching_nodes", which holds
        an array of `RichNodeSummary` objects for each node that matched the
        filters.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged when the plugin reports structured
    errors. Known error codes include:
      - `invalid_regex`: The `name_regex` or `text_regex` provided is invalid.
      - `scope_not_found`: The `scope_node_id` does not exist in the document.
      - `invalid_scope`: The node specified by `scope_node_id` does not support
        searching (e.g., it's a primitive shape).
      - `unknown_plugin_error`: A general failure occurred inside the plugin.
      - `communication_error`: A failure in the bridge/websocket connection.

    Agent Guidance
    --------------
    When to Use:
        - To find a set of nodes before performing a bulk mutation (e.g., find
          all buttons to change their color).
        - To locate a specific element by its text content or layer name.
        - To analyze the usage of a specific component or style.
    When NOT to Use:
        - Avoid page-wide searches (`scope_node_id` is null) on large documents
          unless absolutely necessary, as it can be slow. Prefer to scope to the
          user's selection or a relevant container.
        - For fetching deep, authoritative details of a known node, use
          `get_node_details` instead.

    Examples
    --------
    - Find all TEXT nodes containing "Submit" within a specific frame:
      `{"filters": {"node_types": ["TEXT"], "text_regex": "^Submit$"}, "scope_node_id": "123:456"}`
    - Find all instances of a specific main component on the page:
      `{"filters": {"main_component_id": "789:101"}}`
    - Find all nodes with a specific fill style applied:
      `{"filters": {"style_id": "S:12345..."}, "highlight_results": true}`
    - Find all frames whose names start with "Card-":
      `{"filters": {"node_types": ["FRAME"], "name_regex": "^Card-"}}`
    """
    try:
        # Normalize filters to match bridge/plugin schema and avoid unrecognized_keys errors
        allowed_filter_keys = {"name_regex", "text_regex", "node_types", "main_component_id", "style_id"}
        normalized_filters: Dict[str, Any] = {}
        removed_keys: List[str] = []

        if isinstance(filters, dict):
            temp = dict(filters)

            # Map common alias 'characters' -> 'text_regex'
            if "characters" in temp and "text_regex" not in temp:
                try:
                    temp["text_regex"] = str(temp.get("characters", ""))
                except Exception:
                    # Best-effort; if conversion fails, drop alias
                    pass
                finally:
                    temp.pop("characters", None)

            # Coerce node_types to array if a single string was provided
            if isinstance(temp.get("node_types"), str):
                temp["node_types"] = [temp["node_types"]]

            # Keep only allowed keys; record removed ones for observability
            for k, v in temp.items():
                if k in allowed_filter_keys:
                    normalized_filters[k] = v
                else:
                    removed_keys.append(k)

        if removed_keys:
            logger.info(
                "🧹 Normalized find_nodes filters",
                {"code": "normalized_find_nodes_filters", "removed_keys": removed_keys}
            )

        logger.info("🔎 Calling find_nodes", {"filters": normalized_filters or filters, "scope_node_id": scope_node_id})
        params: Dict[str, Any] = {"filters": normalized_filters if normalized_filters else (filters or {})}
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
    This is the primary tool for inspecting the properties of one or more nodes.
    It returns a comprehensive data model for each requested node, including its
    own properties, a summary of its parent, and summaries of its direct children.
    This tool is essential for gathering the ground-truth state of a node right
    before a mutation and for verifying the results after a mutation.
    Parameters (Args)
    ------------------
    node_ids (List[str]): A non-empty list of node IDs to inspect. It is
        recommended to keep the list short (1-5 nodes) to manage payload size.
    Returns
    -------
    (str): A JSON string with a single top-level key, "details". This key
        contains a dictionary mapping each requested node ID to an object with:
        - `target_node` (dict): A rich data model of the node itself. This
          model combines properties from the Figma Plugin API with an exported
          REST API-like JSON structure, providing a unified view. Key fields
          include:
            - `id`, `name`, `type`
            - `visible`, `locked`, `opacity`
            - `width`, `height`, `rotation`
            - `fills`, `strokes`, `effects` (and related style properties)
            - `auto_layout` (if applicable, detailed auto-layout settings)
            - `component_meta` (for instances/components, info about linkage)
            - `text_meta` (for TEXT nodes, content and typography)
            - `bound_variables` (if any variables are bound)
            - ... and many other properties depending on the node type.
        - `exported_image` (str | None): A Base64-encoded PNG image of the
          node, providing a visual preview.
        - `parent_summary` (RichNodeSummary | None): A summary of the node's
          immediate parent, or null if it's a top-level node.
        - `children_summaries` (List[RichNodeSummary]): A list of summaries for
          the node's direct children.
    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged for plugin-side structured failures.
    Known codes:
      - `missing_parameter`: `node_ids` was not provided or was an empty list.
      - `node_not_found`: One or more of the requested node IDs do not exist
        in the current document. The tool will skip these but return details
        for the nodes that were found.
      - `export_failed`: The plugin failed to export the JSON or image for a
        node. The operation may still succeed with partial data.
      - `communication_error`: A failure in the bridge/websocket connection.
    Agent Guidance
    --------------
    When to Use:
        - Call this immediately before mutating a node to get its current state
          (e.g., to read its current `fills` before modifying them).
        - Call this immediately after a mutation to verify that the changes
          were applied as expected.
        - Use it to gather detailed information needed for complex reasoning
          (e.g., analyzing layout properties to decide on a change).
    When NOT to Use:
        - For broad, canvas-wide discovery, use `find_nodes` or
          `get_canvas_snapshot` first to get the target node IDs. This tool
          is for deep inspection, not discovery.
        - Avoid requesting a large number of nodes at once, as the returned
          payload can be very large and may exceed token limits.
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
    """Export visual raster images for nodes and return base64-encoded image data.

    Purpose & Use Case
    --------------------
    Generate PNG/JPEG exports for 1-3 nodes for visual verification, documentation,
    or downstream image processing. This tool uses Figma's native exportAsync() API
    to capture high-fidelity raster images of design elements. Exports are resource-
    intensive; prefer small batches and use sparingly for critical visual verification.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to export. Each node must
        support the exportAsync() method (most visual nodes do). Invalid or
        non-exportable nodes will return null in the result.
    
    export_settings (dict | None): Optional export configuration object with:
        - format (str): Image format - "PNG" (default) or "JPG"/"JPEG" (case-insensitive)
        - constraint (dict): Size constraints with:
            - type (str): "SCALE" (default), "WIDTH", or "HEIGHT"
            - value (number): Scale factor (1.0 = 100%) or pixel dimensions
        - use_absolute_bounds (bool): Use full node dimensions vs. cropped bounds
            (default: true for visual fidelity, false for tight cropping)

    Returns
    -------
    (str): JSON string containing:
        {
            "images": {
                "<nodeId>": "<base64_encoded_image_data>" | null,
                ...
            }
        }
    
    Each node ID maps to either:
    - Base64-encoded image data (successful export)
    - null (export failed, node not found, or node doesn't support export)

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged for plugin-side errors. Known codes:
      - `missing_parameter`: node_ids not provided or empty array
      - `export_failed`: Individual node export failed (logged, returns null)
      - `unknown_plugin_error`: Unexpected plugin-side error
      - `communication_error`: Bridge/backend communication failure

    Technical Implementation Notes
    ------------------------------
    - Uses Figma's exportAsync() API with ExportSettingsImage configuration
    - Supports PNG (lossless) and JPG (lossy) formats per Figma API spec
    - Constraint types: SCALE (proportional), WIDTH/HEIGHT (fixed dimensions)
    - useAbsoluteBounds=true preserves full node dimensions (recommended)
    - Individual node failures don't abort the entire operation
    - Base64 encoding handled by custom implementation for compatibility

    Agent Guidance
    --------------
    When to Use:
    - Visual verification after mutations (before/after comparisons)
    - Documentation or screenshot generation
    - Quality assurance for complex layouts or effects
    - Debugging visual rendering issues
    
    Best Practices:
    - Limit to 1-3 nodes per call (performance consideration)
    - Use PNG for UI elements, JPG for photos/illustrations
    - Default 2x scale (constraint: {type: "SCALE", value: 2}) for crisp exports
    - Verify exports with get_image_of_node after significant changes
    - Prefer get_canvas_snapshot(include_images=True) for broader context
    - For better layout understanding: Use get_node_ancestry first to identify the root frame,
      then export the root frame instead of just the target node to capture full context
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
    """Return the complete ancestry chain of a node from its immediate parent up to the page root.

    Purpose & Use Case
    --------------------
    This tool provides a lightweight ordered list of ancestor nodes, traversing from the target
    node's immediate parent up to and including the PAGE node. This is essential for understanding
    the hierarchical context of a node within the Figma document structure, particularly useful
    for:
    
    - Understanding Auto Layout constraints and inheritance patterns
    - Determining proper parent-child relationships before structural mutations
    - Analyzing the container hierarchy for layout decisions
    - Validating node placement within complex nested structures
    - Planning operations that depend on parent container properties

    The ancestry chain reveals the complete path from the target node to the document root,
    showing how the node is nested within frames, groups, components, and other containers.

    Parameters (Args)
    ------------------
    node_id (str): The unique identifier of the target node (e.g., "1:23"). Must be a
                   non-empty string corresponding to an existing node in the document.

    Returns
    -------
    (str): JSON string containing the ancestry chain:
        {
            "ancestors": [
                {
                    "id": "string",           # Node ID (e.g., "1:24")
                    "name": "string",         # Node name as displayed in Figma
                    "type": "string",         # Node type (FRAME, GROUP, COMPONENT, etc.)
                    "has_children": boolean   # Whether this ancestor has child nodes
                },
                ...                           # Additional ancestors in order
            ]
        }
    
    The ancestors array is ordered from immediate parent to page root (inclusive):
    - Index 0: Immediate parent of the target node
    - Index 1: Grandparent (parent of immediate parent)
    - ...
    - Last index: PAGE node (document root for the target node)

    Technical Implementation
    -------------------------
    - Uses figma.getNodeByIdAsync() for dynamic page loading compatibility
    - Traverses the parent property chain until reaching a PAGE node
    - Includes the PAGE node in the ancestry chain (unlike some other hierarchy tools)
    - Each ancestor is converted to a BasicNodeSummary for lightweight representation
    - Handles edge cases where nodes may not have parents or may be orphaned

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes:
      - `missing_parameter`: node_id missing or invalid (not a non-empty string)
      - `node_not_found`: No node exists with the given node_id in the current document
      - `communication_error`: Bridge/plugin communication failure or timeout

    Agent Guidance
    --------------
    When to Use:
    - Before making structural changes to understand container constraints
    - When analyzing Auto Layout inheritance patterns
    - To determine the proper parent for new nodes
    - When debugging layout issues by understanding the full container chain
    - Before operations that depend on parent container properties (styling, positioning)
    
    Example Usage Scenarios:
    - Check if a node is inside an Auto Layout frame before setting layout properties
    - Understand the nesting depth before creating new child elements
    - Verify component hierarchy before making structural modifications
    - Analyze container constraints that might affect node positioning
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
    """Retrieves the hierarchy of a specified node, including its parent and immediate children.

    This tool is essential for understanding the structural context of a node within the Figma document.
    It allows for inspection of the immediate surroundings of a node, which is a prerequisite for many
    manipulation and traversal tasks. For instance, before modifying the children of a frame, one might
    use this tool to get a summary of the children to be modified.

    Args:
        node_id: The unique identifier of the node for which to retrieve the hierarchy.

    Returns:
        A JSON string representing an object with two keys:
        - "parent_summary": A summary of the parent node, or null if the node is a root element.
                          The summary is a `BasicNodeSummary` object containing the node's `id`,
                          `name`, `type`, and a boolean `has_children`.
        - "children": A list of `BasicNodeSummary` objects for each direct child of the specified node.
                      If the node has no children, this will be an empty list.

    Raises:
        ToolExecutionError: If the `node_id` is not found, or if there is a communication
                            error with the Figma plugin.
    """
    if not node_id:
        raise ToolExecutionError({
            "code": "missing_parameter",
            "message": "'node_id' must be a non-empty string",
            "details": {"node_id": node_id}
        })

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
    """Retrieve all local document-level styles from the current Figma file.

    Purpose & Use Case
    --------------------
    This tool provides access to all locally-defined styles in the current Figma document,
    enabling discovery of reusable design tokens and style libraries. Essential for:
    - Discovering available color, text, effect, and grid styles before applying them
    - Resolving human-friendly style names to their unique style IDs
    - Auditing design system consistency across the document
    - Understanding what styles are available for reuse in new designs
    - Building style inventories for design system documentation

    Parameters (Args)
    ------------------
    style_types (List[str] | None): Optional filter to retrieve only specific style types.
        Valid values: ["PAINT", "TEXT", "EFFECT", "GRID"]
        - PAINT: Color/fill styles (solid colors, gradients, images)
        - TEXT: Typography styles (font family, size, weight, line height, etc.)
        - EFFECT: Visual effects (drop shadows, blurs, inner shadows, etc.)
        - GRID: Layout grid styles (columns, rows, margins, gutters)
        If None or empty, returns all available style types.

    Returns
    -------
    (str): JSON string containing style information:
        {
            "styles": [
                {
                    "id": str,        # Unique style identifier (e.g., "S:1234567890abcdef")
                    "name": str,      # Human-readable style name (e.g., "Primary Blue")
                    "type": str       # Style type: "PAINT", "TEXT", "EFFECT", or "GRID"
                },
                ...
            ]
        }

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes:
        - `unknown_plugin_error`: Plugin-side error during style retrieval
        - `communication_error`: Bridge communication failure

    Technical Notes
    ---------------
    - Only returns LOCAL styles defined in the current document, not team library styles
    - Styles are returned in the same order as displayed in Figma's UI
    - Requires Figma Design editor (not available in FigJam or Dev Mode)
    - Uses async Figma API methods: getLocalPaintStylesAsync(), getLocalTextStylesAsync(),
      getLocalEffectStylesAsync(), getLocalGridStylesAsync()
    - Gracefully handles missing style types by filtering invalid values
    - Returns empty styles array if called in non-design editors

    Agent Guidance
    --------------
    Use this tool to:
    1. Discover available styles before applying them to nodes with set_fill_style_id,
       set_stroke_style_id, set_text_style_id, or set_effect_style_id
    2. Filter by specific style types when you only need certain kinds of styles
    3. Build comprehensive style inventories for design system audits
    4. Resolve style names to IDs when users reference styles by name
    5. Check style availability before attempting to apply them to nodes

    Example Usage Patterns:
    - Get all styles: get_document_styles()
    - Get only color styles: get_document_styles(["PAINT"])
    - Get text and effect styles: get_document_styles(["TEXT", "EFFECT"])
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
    """Find all nodes on the current page that consume the specified style.

    Purpose & Use Case
    --------------------
    This tool identifies which nodes are currently using a specific style, providing
    crucial information for style management workflows. It's essential for:
    - Impact analysis before modifying or deleting styles
    - Understanding style usage patterns across the document
    - Identifying nodes that will be affected by style changes
    - Auditing style consumption for design system maintenance

    The tool uses the Figma Plugins API's Style API for accurate detection, with
    a fallback method that scans all nodes on the current page.

    Parameters (Args)
    ------------------
    style_id (str): The unique identifier of the style to analyze. Must be a
        non-empty string. This should be a valid style ID from the document.

    Returns
    -------
    (str): JSON string containing consuming nodes information:
        {
            "consuming_nodes": [
                {
                    "node": RichNodeSummary,  # Detailed node information
                    "fields": List[str]       # Style fields where the style is applied
                },
                ...
            ]
        }
    
    The `fields` array contains the specific style properties where the style is
    applied. Supported fields include:
    - "fillStyleId": Style applied to node fills (PaintStyle)
    - "strokeStyleId": Style applied to node strokes (PaintStyle)
    - "effectStyleId": Style applied to node effects (EffectStyle)
    - "textStyleId": Style applied to text formatting (TextStyle, TEXT nodes only)

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known error codes:
    - `missing_parameter`: style_id is empty or invalid
    - `unknown_plugin_error`: Unexpected plugin execution error
    - `communication_error`: Failed to communicate with plugin

    Agent Guidance
    --------------
    When to Use:
    - Before modifying or deleting styles to assess impact
    - When auditing style usage across the document
    - To identify nodes that will be affected by style changes
    - For design system maintenance and cleanup
    
    Best Practices:
    - Always check consumers before deleting styles to avoid breaking designs
    - Use this tool in combination with style modification tools for safe updates
    - Consider the field information to understand how the style is being used
    

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
async def get_document_components(published_filter: Optional[str] = None) -> str:
    """List all local components and component sets in the current Figma document.

    Purpose & Use Case
    --------------------
    This tool provides comprehensive discovery of all component definitions within the current document,
    enabling agents to understand the available design system components for instantiation, analysis,
    or modification. It's essential for component-based design workflows and design system audits.

    Key Use Cases:
    - Discover available components before creating instances with create_component_instance
    - Audit design system completeness and component coverage
    - Analyze component usage patterns and dependencies
    - Identify published vs unpublished components for library management
    - Support component-based design system documentation

    Parameters (Args)
    ------------------
    published_filter (str | None): Optional filter to control which components are returned.
        - 'all' (default): Returns all components regardless of publication status
        - 'published_only': Returns only components that have been published to the team library
        - 'unpublished_only': Returns only local components not yet published
        - Any other value defaults to 'all'

    Returns
    -------
    (str): JSON string containing a components array with detailed component information:
        {
            "components": [
                {
                    "id": str,                    # Unique node ID for direct manipulation
                    "component_key": str | null,  # Team library key (null if unpublished)
                    "name": str,                  # Component name as shown in layers panel
                    "type": str,                  # Either "COMPONENT" or "COMPONENT_SET"
                    "is_published": bool          # True if component has a key (published)
                },
                ...
            ]
        }

    Technical Implementation Details
    --------------------------------
    - Uses figma.root.findAll() to traverse the entire document tree
    - Filters nodes by type: 'COMPONENT' and 'COMPONENT_SET'
    - Determines publication status by checking for the presence of a 'key' property
    - Component sets contain multiple component variants and are treated as single entities
    - Performance note: May be slow in documents with thousands of nodes

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes:
        - `figma_api_error`: Figma API returned an error
        - `unknown_plugin_error`: Unexpected plugin execution error
        - `communication_error`: Failed to communicate with plugin

    Agent Guidance
    --------------
    - Use 'published_only' to find components available for team-wide use
    - Use 'unpublished_only' to identify local components that need publishing
    - Component IDs can be used directly with create_component_instance
    - Component sets represent variant groups - use get_node_details for variant information
    - Consider performance impact in large documents (1000+ nodes)
    - Always check is_published status before assuming component availability
    """
    try:
        logger.info("🧩 Getting document components")
        params: Dict[str, Any] = {}
        if isinstance(published_filter, str) and published_filter in {"all", "published_only", "unpublished_only"}:
            params["published_filter"] = published_filter
        result = await send_command("get_document_components", params)
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
    layout_mode: str = "None",
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
    """Create a Frame node with comprehensive auto-layout and styling configuration.

    ## Purpose & Use Case
    Creates a new Frame node that serves as a container for organizing UI elements. Frames are 
    fundamental building blocks in Figma, similar to `<div>` elements in HTML. This tool supports 
    both basic frames and advanced auto-layout configurations for responsive, structured designs.

    ## Core Parameters
    - `width` (int, default=100): Frame width in pixels. Must be positive.
    - `height` (int, default=100): Frame height in pixels. Must be positive.
    - `x` (int, default=0): X coordinate position on canvas
    - `y` (int, default=0): Y coordinate position on canvas
    - `name` (str, default="Frame"): Frame name/label for organization
    - `parent_id` (str, default=""): ID of parent container. If empty, appends to current page root.

    ## Auto-Layout Configuration
    - `layout_mode` (str, default="None"): Layout behavior
      - "None": Manual positioning, children placed freely
      - "Horizontal": Children arranged left-to-right in a row
      - "Vertical": Children arranged top-to-bottom in a column  
      - "Grid": Children arranged in a grid layout (advanced)
    
    - `layout_wrap` (Optional[str]): Wrapping behavior (only for Horizontal/Vertical modes)
      - "No_Wrap": Children stay in single line/column (default)
      - "Wrap": Children wrap to new lines when space is insufficient
    
    - `padding_top/right/bottom/left` (Optional[float]): Internal spacing between frame border and children.
      Only applies to auto-layout frames. Values in pixels, must be non-negative.
    
    - `primary_axis_align_items` (Optional[str]): Alignment along primary axis (Horizontal/Vertical only)
      - "Min": Align to start (left for horizontal, top for vertical)
      - "Max": Align to end (right for horizontal, bottom for vertical)
      - "Center": Center alignment
      - "Space_Between": Distribute with equal space between items
    
    - `counter_axis_align_items` (Optional[str]): Alignment perpendicular to primary axis
      - "Min": Align to start of counter axis
      - "Max": Align to end of counter axis  
      - "Center": Center alignment
      - "Space_Between": Distribute with equal space between items
    
    - `layout_sizing_horizontal/vertical` (Optional[str]): How frame sizes itself
      - "Fixed": Use specified width/height values
      - "Auto": Size based on content (hug contents)
      - "Fill": Fill available space in parent container
    
    - `item_spacing` (Optional[float]): Space between children in auto-layout frames.
      Only applies to Horizontal/Vertical modes. Value in pixels, must be non-negative.

    ## Visual Styling
    - `fill_color` (Optional[RGBAColor]): Background fill color with RGBA values (0.0-1.0 range)
    - `stroke_color` (Optional[RGBAColor]): Border stroke color with RGBA values (0.0-1.0 range)
    - `stroke_weight` (Optional[int]): Border thickness in pixels. Must be non-negative.

    ## Returns
    JSON string containing:
    - `success` (bool): Operation success status
    - `summary` (str): Human-readable operation summary
    - `created_node_id` (str): Unique identifier of the created frame
    - `node` (object): Frame details including id, name, position, size, and parent_id

    ## Auto-Layout Behavior Details
    **None Mode**: Basic frame with manual child positioning. Children can be placed anywhere 
    within the frame bounds. Useful for complex layouts or when precise control is needed.

    **Horizontal Mode**: Children arranged in a single row from left to right. Frame width 
    can be fixed or auto-sized based on content. Use `item_spacing` to control gaps between children.

    **Vertical Mode**: Children arranged in a single column from top to bottom. Frame height 
    can be fixed or auto-sized based on content. Use `item_spacing` to control gaps between children.

    **Grid Mode**: Advanced layout system for complex arrangements. Children are positioned 
    in a grid structure with configurable rows and columns.

    **Wrapping**: When `layout_wrap="Wrap"` is set for Horizontal/Vertical modes, children 
    that exceed the frame width (horizontal) or height (vertical) will wrap to new lines/columns.

    ## Error Handling & Edge Cases
    Common error scenarios and their codes:
    - `parent_not_found`: Specified parent_id doesn't exist in the document
    - `invalid_parent_type`: Parent node type doesn't support children (e.g., text nodes)
    - `locked_parent`: Parent is locked and cannot be modified
    - `append_failed`: Failed to add frame to parent due to constraints or permissions
    - `create_frame_failed`: General creation failure (invalid parameters, system error)

    ## Best Practices & Guidelines
    **Layout Strategy**:
    - Use auto-layout for responsive designs and consistent spacing
    - Start with "Auto" sizing to let frames adapt to content
    - Set appropriate padding (typically 16-24px) for content breathing room
    - Use consistent `item_spacing` values (8px, 16px, 24px) for visual rhythm

    **Naming & Organization**:
    - Use descriptive names: "Header Container", "Button Group", "Card Layout"
    - Follow consistent naming conventions across your design system
    - Group related elements within appropriately named frames

    **Performance Considerations**:
    - Avoid deeply nested auto-layout hierarchies (more than 4-5 levels)
    - Use "Fixed" sizing when frame dimensions are known and stable
    - Consider using basic frames for complex layouts that don't benefit from auto-layout

    **Accessibility & Usability**:
    - Ensure minimum touch targets (44px) for interactive elements
    - Maintain sufficient contrast ratios for text and UI elements
    - Use consistent spacing patterns for predictable user experience

    ## Integration with Other Tools
    After creating a frame, commonly used follow-up operations:
    - `get_node_details`: Verify frame properties and visual appearance
    - `create_text`: Add text content within the frame
    - `set_auto_layout_child`: Configure individual child layout properties
    - `set_fills`/`set_strokes`: Apply additional visual styling
    - `set_constraints`: Configure responsive behavior within parent containers

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin error codes include:
      - `parent_not_found`, `invalid_parent_type`, `locked_parent`,
        `append_failed`, `create_frame_failed`, `plugin_reported_failure`, `communication_error`.

    Agent Guidance
    --------------
    **When to Use**: Create layout containers, especially when auto-layout is needed for 
    responsive designs. Essential for organizing UI elements and establishing visual hierarchy.
    
    **Verification**: Always call `get_node_details` on the returned node id to confirm 
    creation and verify properties match expectations.
    
    **Common Workflows**: 
    1. Create container frame with auto-layout
    2. Add children (text, shapes, components)  
    3. Configure child layout properties
    4. Apply visual styling and constraints
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
    """Create a Text node with comprehensive typography and positioning control.

    ## Purpose & Use Case
    Creates a new TextNode using figma.createText() with full control over content, 
    typography, positioning, and styling. This tool handles font loading, character 
    setting, and proper parent attachment following Figma's API requirements.
    
    Perfect for creating labels, headings, button text, form labels, or any single-style 
    text content that needs precise control over appearance and placement.

    ## Parameters (Args)
        characters (str): The textual content to display. Required parameter that 
                         becomes the text node's content. Cannot be empty.
        parent_id (str): Target parent node ID where the text will be appended. 
                         Required - must be a valid node that supports children 
                         (Frame, Group, Component, etc.). Cannot be a leaf node.
        x (int): Horizontal position on canvas in pixels. Defaults to 0. 
                 Positioned relative to parent's coordinate system.
        y (int): Vertical position on canvas in pixels. Defaults to 0.
                 Positioned relative to parent's coordinate system.
        font_size (int): Font size in pixels. Must be positive integer. 
                         Defaults to 16px. Minimum value is 1px per Figma API.
        font_weight (int): Font weight as numeric value (400=Regular, 700=Bold, etc.).
                           Defaults to 400. Maps to available font styles for the 
                           loaded font family.
        name (str): Layer name in Figma's layers panel. Defaults to the characters 
                    content if empty. Used for organization and identification.
        font_color (RGBAColor): Optional text color specification. RGB values 
                                should be 0.0-1.0 range, alpha defaults to 1.0.
                                Creates a SOLID fill paint with specified color.

    ## Returns
        (str): JSON string containing success status and created node details:
        {
            "success": true,
            "summary": "Created text {node_id}",
            "created_node_id": "string",
            "node": {
                "id": "string",
                "name": "string", 
                "x": number,
                "y": number,
                "characters": "string",
                "font_size": number,
                "font_weight": "string|number",
                "parent_id": "string"
            }
        }

    ## Implementation Details
    The tool follows Figma's text creation workflow:
    1. Loads Inter Regular font using figma.loadFontAsync() - required before 
       setting any text properties that affect rendering
    2. Creates text node via figma.createText() - returns empty TextNode
    3. Sets basic properties: x, y, name positioning and identification
    4. Sets characters content using setCharacters() helper with error handling
    5. Applies typography overrides: fontSize, fontName (family+style)
    6. Applies color styling via fills array with SOLID paint type
    7. Attaches to parent using appendChild() with comprehensive error handling
    8. Returns structured success payload with node details

    ## Font Loading Requirements
    Per Figma API documentation, font loading is MANDATORY before setting:
    - characters property (text content)
    - fontSize property 
    - fontName property
    - Any other properties that affect text rendering
    
    The tool automatically loads Inter Regular as the default font. Font weight 
    changes attempt to preserve the family while updating the style component.

    ## Error Handling & Edge Cases
    The tool provides comprehensive error handling for common failure scenarios:
    
    **Parent-Related Errors:**
    - "parent_not_found": Parent ID doesn't exist or is invalid
    - "invalid_parent": Parent node type doesn't support children (e.g., TextNode)
    - "locked_parent": Parent is locked and cannot accept new children
    - "append_failed": Generic appendChild failure (may be transient)
    
    **Font-Related Errors:**
    - Font loading failures are caught and logged but don't prevent text creation
    - Font weight/style changes are attempted with fallback to current font
    - Character setting failures are caught and logged but don't fail the operation
    
    **Color-Related Errors:**
    - Invalid color values are sanitized to valid 0.0-1.0 range
    - Missing color components default to 0.0
    - Alpha channel defaults to 1.0 if not specified
    
    **API Compliance:**
    - All operations follow Figma's async/await patterns
    - Error messages are structured JSON with code, message, and details
    - Logging includes contextual information for debugging
    - Return values match the standardized success payload format

    ## Raises (Errors & Pitfalls)
        ToolExecutionError: Plugin raises structured errors with specific codes:
            - "parent_not_found": Parent node ID is invalid or doesn't exist
            - "invalid_parent": Parent node type cannot accept children  
            - "locked_parent": Parent is locked and cannot be modified
            - "append_failed": Failed to append text to parent (may be transient)
            - "unknown_plugin_error": Unexpected error during text creation
            - "communication_error": Bridge communication failure

    ## Agent Guidance
    **When to Use:**
        - Creating labels, headings, or button text
        - Adding form field labels or descriptions
        - Creating single-style text content (not rich text)
        - When you need precise control over typography and positioning
        - As part of component creation workflows
        
    **When NOT to Use:**
        - For rich text with multiple styles (use text editing tools instead)
        - When you need text with complex formatting or multiple font weights
        - For placeholder text that will be heavily modified later
        - When creating text that needs to be part of a larger text editing workflow
        
    **Best Practices:**
        - Always specify a meaningful name for organization
        - Use appropriate font sizes (12px+ for readability)
        - Consider parent container's auto-layout when positioning
        - Test font weight changes to ensure the font family supports the style
        - Use RGBAColor for precise color control when needed
        
    **Common Workflows:**
        1. Create container frame first, then add text as child
        2. Use with create_frame() for complete UI element creation
        3. Follow with set_text_* tools for advanced typography if needed
        4. Combine with set_auto_layout_child() for proper layout integration
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
    """Set or remove the `fills` array on multiple nodes, fully replacing existing paints.

    What this does
    --------------
    - Replaces the entire `fills` array on each target node that supports `fills` (e.g., FRAME, RECTANGLE, COMPONENT, TEXT when paintable, etc.).
    - Pass an empty list `[]` to remove all fills.
    - Performs robust input normalization to match the Figma Plugin API's Paint schema.

    Input parameters
    ----------------
    - node_ids: List[str]
      - Required, non-empty. Each must resolve to a node that has a `fills` property.
      - Locked nodes are skipped and reported.
    - paints: List[dict | string]
      - Required array describing paints to apply. Fully replaces the node's `fills`.
      - Convenience: Hex strings like "#RRGGBB" or "#RRGGBBAA" are accepted and converted to a SolidPaint via `figma.util.solidPaint` (or a safe fallback) where alpha maps to `opacity`.

    Accepted paint shapes (normalized to Figma Plugin API)
    -----------------------------------------------------
    - SOLID:
      - `{ type: 'SOLID', color: { r, g, b } [, opacity] [, visible] }`
      - RGBA input is supported: any `color.a` is moved to top-level `opacity` (0..1) and removed from `color` per API.
    - GRADIENT_* (LINEAR | RADIAL | ANGULAR | DIAMOND):
      - `{ type: 'GRADIENT_LINEAR'|'GRADIENT_RADIAL'|'GRADIENT_ANGULAR'|'GRADIENT_DIAMOND', gradientStops, [gradientTransform], [opacity], [visible] }`
      - `gradientStops`: Array of ColorStop objects. Each stop has `{ color: RGBA, position: number }` with 0 ≤ position ≤ 1. At least 2 stops required. Stops are sorted by position.
      - `gradientTransform`: 2×3 matrix. Defaults to identity `[[1,0,0],[0,1,0]]` if omitted. Alias `gradient_handle_positions` is accepted and converted when provided.
    - IMAGE:
      - `{ type: 'IMAGE', imageHash, [scaleMode], [imageTransform], [opacity], [visible], ... }`
      - If `imageHash` is not provided but `imageBytes` is, the plugin creates an Image and populates `imageHash`.
      - Other ImagePaint fields are passed through if present and valid (e.g., `scaleMode: 'FILL'|'FIT'|'TILE'|'CROP'`).
    - Other paint subtypes (e.g., VIDEO) are deep-cloned and passed through without modification.

    Behavior and safeguards
    -----------------------
    - Dynamic page safety: When the document uses dynamic page loading, the plugin preloads pages (`figma.loadAllPagesAsync()` and `figma.currentPage.loadAsync()`) before mutating nodes, per Figma API guidance.
    - Normalization:
      - Numbers outside 0..1 for colors are converted from 0..255 when any channel > 1 is detected.
      - `opacity` values are clamped to [0, 1].
      - Gradient stops are validated and sorted.
    - Node handling:
      - Nodes not found, locked, lacking a `fills` property, read-only targets, or non-overridable properties on instances are classified and reported.
      - On per-node mutation failure, the original `fills` are restored.

    Returns
    -------
    str: JSON-encoded success payload from the plugin, for example:
      {
        "success": true,
        "modified_node_ids": ["12:34", "56:78"],
        "unresolved_node_ids": ["99:99"],
        "summary": "Applied fills to 2 node(s)",
        "details": {
          "not_found_node_ids": [],
          "locked_node_ids": [],
          "unsupported_node_ids": []
        }
      }

    Error model
    -----------
    - Raises ToolExecutionError with a structured payload when the bridge/communication fails.
    - Plugin-sourced structured errors are propagated, including (non-exhaustive):
      - `missing_parameter`: e.g., empty or missing `node_ids`.
      - `invalid_parameter`: e.g., `paints` is not an array.
      - `invalid_fills`: e.g., invalid paint entries or insufficient gradient stops.
      - `set_fills_failed`: no nodes were updated (all were missing/locked/unsupported/read-only).
      - `unknown_plugin_error`: unexpected plugin-side exception.

    Usage notes and examples
    ------------------------
    - To remove fills: call with `paints=[]`.
    - Hex → SolidPaint conversion accepted: `paints=["#FF7847"]`.
    - Example args (conceptual):
      {"node_ids":["12:34"], "paints":[{"type":"SOLID","color":{"r":1,"g":0.47,"b":0.28}, "opacity":1}]}

    Agent guidance
    --------------
    - Prefer replacing rather than mutating individual entries; this tool replaces the full array.
    - After mutation, verify results with `get_node_details()` or a targeted image export when necessary.
    - If instance overrides fail (non-overridable), consider editing the main component or detaching when appropriate.
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
    """Set stroke paints and stroke properties across multiple nodes.

    What this does
    --------------
    - Replaces the entire `strokes` array and optionally updates `strokeWeight`, `strokeAlign`, and `dashPattern` on each node that supports strokes.
    - Pass an empty `paints` list to remove all strokes.

    Input parameters
    ----------------
    - node_ids: List[str]
      - Required, non-empty. Each must resolve to a node with a `strokes` property.
    - paints: List[dict | string]
      - Required. Paints are normalized exactly as in `set_fills` (SOLID, GRADIENT_*, IMAGE, hex-string convenience).
    - stroke_weight: float | None
      - Optional. Non-negative, fractional values allowed (per Figma API). Applies uniformly; per-side stroke weights are not set by this tool.
    - stroke_align: str | None
      - Optional. One of "CENTER", "INSIDE", "OUTSIDE".
    - dash_pattern: List[float] | None
      - Optional. Array of non-negative numbers representing alternating dash and gap lengths in pixels.

    Behavior and safeguards
    -----------------------
    - Paint normalization and dynamic page safety identical to `set_fills`.
    - For each node, original stroke-related properties are restored on failure.

    Returns
    -------
    str: JSON-encoded success payload from the plugin, including `modified_node_ids`, `unresolved_node_ids`, `summary`, and categorized details.

    Error model
    -----------
    - Raises ToolExecutionError when bridge/communication fails.
    - Plugin-sourced errors include (non-exhaustive): `missing_parameter`, `invalid_parameter`, `set_strokes_failed`, `unknown_plugin_error`.
      - Additional validation: rejects negative `stroke_weight`, invalid `stroke_align` values, or non-numeric entries in `dash_pattern`.

    Usage notes
    -----------
    - Use `paints=[]` to clear strokes while preserving `strokeWeight` (which may still render nothing if no strokes are present).
    - Consider follow-up verification via `get_node_details()`.
    - If instance override restrictions apply, adjust strategy (edit main component or detach instance).
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
    Apply consistent corner rounding to UI components like buttons, cards, and containers.
    Supports both uniform radius (all corners same) and individual corner control for advanced
    design patterns. Essential for modern UI design where rounded corners provide visual
    hierarchy and soften interface elements.

    Supported Node Types
    --------------------
    - RectangleNode: Full support for both uniform and individual corner radius
    - FrameNode: Full support for both uniform and individual corner radius  
    - ComponentNode: Full support for both uniform and individual corner radius
    - InstanceNode: Full support for both uniform and individual corner radius
    - Other node types: Not supported (will be skipped and reported)

    Parameters (Args)
    ------------------
    node_ids (List[str]): Target node IDs to modify. Must be non-empty array.
    uniform_radius (float | None): Set all corners to this value (pixels). Must be non-negative 
                                  and can be fractional. When set, overrides individual corner values.
    top_left (float | None): Per-corner override for top-left corner (pixels). Must be non-negative 
                            and can be fractional.
    top_right (float | None): Per-corner override for top-right corner (pixels). Must be non-negative 
                             and can be fractional.
    bottom_left (float | None): Per-corner override for bottom-left corner (pixels). Must be non-negative 
                               and can be fractional.
    bottom_right (float | None): Per-corner override for bottom-right corner (pixels). Must be non-negative 
                                and can be fractional.

    Corner Radius Behavior
    ----------------------
    - Values must be non-negative and can be fractional (e.g., 2.5px)
    - If edge length is less than twice the corner radius, the radius is automatically 
      clamped to half the edge length to prevent invalid shapes
    - Setting uniform_radius applies the same value to all four corners
    - Setting individual corner values makes the uniform cornerRadius property return 'mixed'
    - Individual corner values override uniform_radius when both are provided
    - Zero values create sharp corners (no rounding)

    Returns
    -------
    (str): JSON string success payload containing:
        - success: true
        - modified_node_ids: List of successfully updated node IDs
        - unresolved_node_ids: List of node IDs that couldn't be updated
        - summary: Human-readable description of changes made
        - details: Object with breakdown of failures:
            - not_found_node_ids: Node IDs that don't exist
            - locked_node_ids: Node IDs that are locked and cannot be modified
            - unsupported_node_ids: Node IDs of unsupported node types

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin error codes:
        - set_corner_radius_failed: No nodes were successfully updated
        - missing_parameter: Required parameters not provided
        - unknown_plugin_error: Unexpected plugin error
        - communication_error: System/communication failure

    Agent Guidance
    --------------
    When to Use: 
        - Apply consistent corner radii across UI components (buttons, cards, modals)
        - Create modern, soft interface designs with rounded corners
        - Implement design system corner radius tokens
        - Fix inconsistent corner rounding in existing designs
    
    Best Practices:
        - Use uniform_radius for consistent design system values (e.g., 8px for cards, 4px for buttons)
        - Use individual corner values for special cases (e.g., top-only rounding for dropdowns)
        - Verify node types with get_node_details before applying corner radius
        - Check for locked nodes in selection before attempting modifications
        - Use fractional values for precise design specifications
    
    Common Use Cases:
        - Button components: uniform_radius=4 or 8px
        - Card containers: uniform_radius=8 or 12px  
        - Modal dialogs: uniform_radius=12 or 16px
        - Dropdown menus: top_left=8, top_right=8, bottom_left=0, bottom_right=0
        - Input fields: uniform_radius=4 or 6px
    
    Error Handling:
        - Tool gracefully handles mixed node types in selection
        - Skips locked, unsupported, or non-existent nodes
        - Provides detailed breakdown of which nodes failed and why
        - Continues processing remaining nodes even if some fail
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
    """Resize multiple nodes by width and/or height using Figma's resize() API.

    Purpose & Use Case
    --------------------
    Adjust the dimensions of target nodes by providing new width and/or height values.
    This tool uses Figma's native `node.resize(width, height)` method which:
    - Applies child constraints during resizing (if the node contains children with constraints)
    - Causes parent auto-layout containers to resize automatically
    - Preserves aspect ratios when only one dimension is provided (uses current dimension for the other)
    - Works on all resizable node types: frames, rectangles, ellipses, text, components, etc.

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to resize. Each ID must be valid and reference an existing node.
    width (float | None): New width in pixels. If None, preserves current width.
    height (float | None): New height in pixels. If None, preserves current height.
    
    Note: At least one of width or height must be provided. If only one is provided, the other dimension remains unchanged.

    Returns
    -------
    (str): JSON success payload containing:
    - success: true/false
    - modified_node_ids: List of successfully resized node IDs
    - unresolved_node_ids: List of node IDs that couldn't be resized (not found, locked, or unsupported)
    - summary: Human-readable summary of the operation
    - details: Object containing categorized lists of problematic nodes:
      - not_found_node_ids: Nodes that don't exist or couldn't be found
      - locked_node_ids: Nodes that are locked (preventing user interactions but not plugin operations)
      - unsupported_node_ids: Nodes that don't support the resize() method

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known plugin codes:
    - `missing_parameter`: When node_ids is empty or both width and height are None
    - `set_size_failed`: When no nodes could be resized (all failed validation)
    - `unknown_plugin_error`: For unexpected plugin-side errors
    - `communication_error`: For bridge communication failures

    Implementation Details
    ----------------------
    The tool performs comprehensive validation and error handling:
    1. Validates input parameters (non-empty node_ids, at least one dimension)
    2. For each node ID:
       - Uses figma.getNodeByIdAsync() to safely retrieve the node
       - Checks if node exists (handles null returns)
       - Verifies node is not locked (node.locked property)
       - Confirms node supports resize() method (typeof node.resize === "function")
       - Attempts resize with current dimensions preserved for unspecified axes
    3. Categorizes results into successful modifications and various failure types
    4. Returns structured success payload even when some nodes fail (partial success)
    5. Only throws error if NO nodes could be resized (complete failure)

    Node Type Compatibility
    -----------------------
    Supports all Figma node types that implement the resize() method:
    - FrameNode, RectangleNode, EllipseNode, PolygonNode, StarNode, LineNode
    - TextNode, ComponentNode, InstanceNode, BooleanOperationNode
    - MediaNode (images, videos)
    - SliceNode
    
    Does NOT support:
    - PageNode, DocumentNode (no resize method)
    - GroupNode (auto-fits children, use resizeWithoutConstraints for manual sizing)
    - VectorNode (use rescale() for proportional scaling instead)

    Constraint Behavior
    -------------------
    When resizing nodes with children that have constraints:
    - Figma automatically applies child constraints during the resize operation
    - Children with "STRETCH" constraints will resize proportionally
    - Children with "MIN/MAX/CENTER" constraints maintain their relative positions
    - Parent auto-layout containers automatically adjust their size to accommodate changes
    
    For constraint-free resizing, consider using resizeWithoutConstraints() method instead.

    Best Practices
    --------------
    - Always provide both width and height for predictable results
    - Use get_node_details() before resizing to understand current dimensions and constraints
    - Check for locked nodes in your workflow - they may indicate important design elements
    - For text nodes, consider using set_text_* tools for content-aware sizing
    - When resizing auto-layout containers, be aware that children may reflow
    - Use get_image_of_node() after resizing to verify visual results

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
    """Set absolute X/Y position for multiple nodes on the Figma canvas.

    Purpose & Use Case
    --------------------
    Reposition nodes on the canvas using absolute coordinates. This tool moves nodes to
    specific pixel positions relative to the page origin (top-left corner). Useful for:
    - Precise alignment of elements
    - Creating grid layouts
    - Positioning elements at exact coordinates
    - Moving nodes to specific locations on the canvas

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to reposition. Each ID must be a 
        valid node identifier (e.g., "1:23", "2:45"). The tool will process all valid 
        nodes and skip invalid ones, reporting which nodes were successfully moved.
    x (float): Absolute X coordinate in pixels from the left edge of the page. Can be
        negative for positioning outside the visible canvas area. Must be a number.
    y (float): Absolute Y coordinate in pixels from the top edge of the page. Can be
        negative for positioning outside the visible canvas area. Must be a number.

    Returns
    -------
    (str): JSON string containing:
        - success: boolean indicating if any nodes were moved
        - modified_node_ids: array of node IDs that were successfully repositioned
        - summary: human-readable description of the operation
        - notFoundIds: array of node IDs that couldn't be found (if any)
        - lockedNodes: array of node IDs that are locked and couldn't be moved (if any)
        - unsupportedNodes: array of node IDs that don't support position changes (if any)

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes:
        - `missing_parameter`: When node_ids is empty or x/y are not numbers
        - `set_position_failed`: When no nodes could be moved (all locked/invalid/unsupported)
        - `unknown_plugin_error`: For unexpected plugin API errors
        - `communication_error`: For bridge communication failures

    Technical Details
    -----------------
    - Uses figma.getNodeByIdAsync() for dynamic page loading compatibility
    - Checks node.locked property to prevent moving locked nodes
    - Verifies nodes have 'x' and 'y' properties before attempting to set them
    - Sets both node.x and node.y properties atomically
    - Follows structured error reporting with JSON.stringify() format
    - Logs all operations with emoji indicators for better observability

    Agent Guidance
    --------------
    When to Use:
    - For explicit positioning when you need precise control over node locations
    - When creating layouts that require exact pixel positioning
    - For moving nodes to specific coordinates on the canvas
    - When you need to position multiple nodes at the same location

    When NOT to Use:
    - For relative positioning (use move_node instead)
    - For nodes within auto-layout containers (position is managed by layout)
    - For nodes that are children of groups (consider group positioning)
    - When you need to maintain relative relationships between nodes

    Best Practices:
    - Always check the response for lockedNodes and unsupportedNodes
    - Consider using move_node for relative positioning
    - Be aware that moving nodes may affect their children's relative positions
    - Use get_node_info first to verify nodes support position changes
    - Consider layout constraints when moving nodes with children
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
async def set_layer_properties(node_ids: List[str], name: Optional[str] = None, opacity: Optional[float] = None, visible: Optional[bool] = None, locked: Optional[bool] = None, blend_mode: Optional[str] = None) -> str:
    """Set common layer properties (name, opacity, visibility, lock, blend) on multiple nodes.

    Purpose & Use Case
    --------------------
    Bulk update fundamental layer properties across multiple nodes. This tool is essential for:
    - Layer organization and naming conventions
    - Visibility management and layer toggling
    - Opacity adjustments for transparency effects
    - Lock/unlock operations for design protection
    - Blend mode changes for visual effects
    - Design system maintenance and cleanup

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node IDs to modify. All nodes must exist and be accessible.
    
    name (str | None): New layer name. If provided, updates the node.name property. Useful for:
        - Standardizing naming conventions ("Button/Primary", "Icon/Check")
        - Adding descriptive prefixes ("Component/", "Layout/")
        - Organizing layers by function or state
    
    opacity (float | None): Opacity value between 0.0 (transparent) and 1.0 (opaque). 
        - Automatically clamped to valid range [0.0, 1.0]
        - Used for fade effects, overlays, and visual hierarchy
        - Common values: 0.5 (50% transparent), 0.8 (subtle fade)
    
    visible (bool | None): Layer visibility state. Controls whether node appears in canvas.
        - true: Layer is visible and interactive
        - false: Layer is hidden but still accessible to plugins
        - Useful for conditional visibility, prototyping states, and layer management
    
    locked (bool | None): Lock state to prevent user interactions.
        - true: Prevents selection, dragging, and editing by users
        - false: Allows normal user interaction
        - Plugin can still modify locked nodes
        - Essential for protecting critical design elements
    
    blend_mode (str | None): Visual blending mode for layer compositing. Valid values:
        - "NORMAL": Standard blending (default)
        - "MULTIPLY": Darkens underlying layers
        - "SCREEN": Lightens underlying layers  
        - "OVERLAY": Combines multiply and screen
        - "SOFT_LIGHT": Subtle lighting effect
        - "HARD_LIGHT": Strong lighting effect
        - "COLOR_DODGE": Brightens with color
        - "COLOR_BURN": Darkens with color
        - "DARKEN": Shows darker pixels only
        - "LIGHTEN": Shows lighter pixels only
        - "DIFFERENCE": Inverts colors
        - "EXCLUSION": Softer difference effect
        - "HUE": Preserves hue, changes saturation/luminosity
        - "SATURATION": Preserves saturation, changes hue/luminosity
        - "COLOR": Preserves hue/saturation, changes luminosity
        - "LUMINOSITY": Preserves luminosity, changes hue/saturation
        - "PASS_THROUGH": Bypasses blend mode (for groups)

    Returns
    -------
    (str): JSON success payload containing:
        - success: true if any nodes were modified
        - modified_node_ids: List of successfully updated node IDs
        - unresolved_node_ids: List of nodes that couldn't be updated
        - summary: Human-readable description of changes
        - details: Breakdown of failures by category:
            - not_found_node_ids: Nodes that don't exist
            - locked_node_ids: Nodes that were already locked
            - unsupported_node_ids: Nodes that don't support the property

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known error codes:
        - "missing_parameter": No node_ids provided or no properties to change
        - "set_layer_properties_failed": No nodes could be updated
        - "unknown_plugin_error": Unexpected plugin-side error
        - "communication_error": Bridge communication failure

    Agent Guidance
    --------------
    When to Use:
        - Bulk layer organization and naming standardization
        - Visibility toggles for prototyping and design states
        - Opacity adjustments for visual effects and overlays
        - Lock/unlock operations for design protection
        - Blend mode changes for visual compositing effects
        - Design system maintenance and cleanup workflows
    
    Best Practices:
        - Always provide at least one property to change (name, opacity, visible, locked, or blend_mode)
        - Use descriptive names that follow your design system conventions
        - Consider using opacity for subtle visual hierarchy rather than hiding layers
        - Lock critical elements (logos, brand elements) to prevent accidental changes
        - Test blend modes on a copy first as they can dramatically change appearance
        - Handle partial failures gracefully - some nodes may update while others fail
    
    Common Use Cases:
        - Rename all selected layers with consistent prefixes
        - Hide/show layers for different design states or prototypes
        - Apply consistent opacity to overlay elements
        - Lock all brand elements to prevent accidental modification
        - Apply blend modes for visual effects and compositing
        - Bulk cleanup of layer organization and naming
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
    """Set the effects array (shadows, blurs, noise, textures) on multiple nodes.

    Purpose & Use Case
    --------------------
    Replace the `effects` array on target nodes. Effects include drop shadows, inner shadows, 
    blur effects, noise effects, and texture effects. Use `[]` to remove all effects.
    
    This tool handles both direct effects assignment and fallback to EffectStyle creation
    for environments where direct assignment is read-only (e.g., dynamic-page plugins).

    Parameters (Args)
    ------------------
    node_ids (List[str]): Non-empty list of node ids. Must be non-empty.
    effects (List[dict]): Array of Effect objects per Figma API. Each effect must have a 'type' field.
        Supported effect types:
        - DropShadowEffect: { "type": "DROP_SHADOW", "color": {...}, "offset": {...}, "radius": number, "spread": number, "showShadowBehindNode": boolean }
        - InnerShadowEffect: { "type": "INNER_SHADOW", "color": {...}, "offset": {...}, "radius": number, "spread": number }
        - BlurEffect: { "type": "LAYER_BLUR" | "BACKGROUND_BLUR", "radius": number }
        - NoiseEffect: { "type": "NOISE", "noiseType": "MONOTONE" | "DUOTONE" | "MULTITONE", ... }
        - TextureEffect: { "type": "TEXTURE", ... }
        Use `[]` to remove all effects.

    Returns
    -------
    (str): JSON success payload with:
        - success: boolean
        - modified_node_ids: List[str] - successfully updated nodes
        - unresolved_node_ids: List[str] - nodes that couldn't be updated
        - summary: string - human-readable summary
        - details: object with breakdown of failures (not_found_node_ids, locked_node_ids, 
          unsupported_node_ids, failed_node_ids, node_types, failure_reasons, capability_summary)

    Node Support & Capabilities
    ----------------------------
    Supported node types: All nodes with 'effects' property (most visual nodes except text, 
    groups, and some containers). The tool automatically detects node capabilities:
    - hasSetEffectStyleIdAsync: Can use async style setting (dynamic-page compatible)
    - hasEffectStyleIdProp: Can use direct style ID assignment
    - hadStyle: Whether node previously had an effect style linked

    Fallback Strategy
    -----------------
    1. Direct assignment: node.effects = effects
    2. If read-only, detach existing style and retry direct assignment
    3. If still failing, create/find matching EffectStyle and apply via setEffectStyleIdAsync
    4. Comprehensive error reporting with actionable details

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`, `invalid_parameter`, 
    `set_effects_failed`, `unknown_plugin_error`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: 
    - Apply visual effects like shadows, blurs, or noise
    - Remove effects by passing empty array []
    - Verify rendering via `get_image_of_node` if necessary
    - Check returned details for any failed nodes and retry with different approach if needed
    
    Common Patterns:
    - Drop shadow: [{"type": "DROP_SHADOW", "color": {"r": 0, "g": 0, "b": 0, "a": 0.25}, "offset": {"x": 0, "y": 4}, "radius": 8, "spread": 0, "showShadowBehindNode": true}]
    - Inner shadow: [{"type": "INNER_SHADOW", "color": {"r": 0, "g": 0, "b": 0, "a": 0.1}, "offset": {"x": 0, "y": 2}, "radius": 4, "spread": 0}]
    - Blur: [{"type": "LAYER_BLUR", "radius": 10}]
    - Remove all: []
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


@function_tool
async def set_child_index(node_id: str, new_index: int) -> str:
    """Move a child to a specific sibling index within its parent (auto-layout order).

    Purpose & Use Case
    --------------------
    Adjust the order of a child within its parent container by index. In auto-layout
    parents this directly controls the visual position of the child.

    Parameters (Args)
    ------------------
    node_id (str): The child node id to move.
    new_index (int): The target index inside the current parent.

    Returns
    -------
    (str): JSON success payload from the plugin.

    Raises (Errors & Pitfalls)
    --------------------------
    ToolExecutionError: Propagated unchanged. Known codes: `missing_parameter`,
        `invalid_parameter`, `node_not_found`, `invalid_parent_container`,
        `set_child_index_failed`, `communication_error`.

    Agent Guidance
    --------------
    When to Use: Use for precise sibling ordering inside auto-layout containers.
    """
    try:
        if not isinstance(node_id, str) or not node_id:
            raise ToolExecutionError({"code": "missing_parameter", "message": "'node_id' must be a non-empty string", "details": {"node_id": node_id}})
        if not isinstance(new_index, int):
            raise ToolExecutionError({"code": "invalid_parameter", "message": "'new_index' must be an integer", "details": {"new_index": new_index}})

        logger.info(f"↕️ set_child_index: node_id={node_id} new_index={new_index}")
        params: Dict[str, Any] = {"node_id": node_id, "new_index": int(new_index)}
        result = await send_command("set_child_index", params)
        return _to_json_string(result)
    except ToolExecutionError:
        logger.error("❌ Tool set_child_index raised ToolExecutionError")
        raise
    except Exception as e:
        logger.error(f"❌ Communication/system error in set_child_index: {str(e)}")
        raise ToolExecutionError({"code": "communication_error", "message": f"Failed to call set_child_index: {str(e)}", "details": {"command": "set_child_index"}})


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


### Sub-Category 3.7: Components & Styles

@function_tool
async def create_component_from_node(node_id: str, name: str) -> str:
    """
    { "category": "components", "mutates_canvas": true, "description": "Create a new Component from an existing node by cloning it into a newly created component." }

    Purpose & Use Case
    --------------------
    Creates a new Figma `COMPONENT` by converting an existing node into a reusable component.
    This is the primary method for creating components in Figma's Plugin API, using the official
    `figma.createComponentFromNode()` function. The original node is cloned into a new component
    object that can be instantiated multiple times across the design.

    This tool is essential for:
    - Converting design elements into reusable components
    - Building design systems and component libraries
    - Creating master components from existing UI elements
    - Establishing component hierarchies for consistent design patterns

    Technical Implementation
    -------------------------
    Uses Figma's native `figma.createComponentFromNode(node)` API which:
    - Clones the source node into a new ComponentNode
    - Preserves all visual properties, children, and styling
    - Maintains the original node's position and parent relationship
    - Creates a component that can be instantiated via create_component_instance

    Parameters
    ----------
    node_id (str): 
        ID of the source node to convert into a component (required)
        - Must be a valid node ID that exists in the current document
        - Can be any node type that supports component creation (frames, groups, etc.)
        - The node must not be locked or read-only
    name (str): 
        Name for the created component
        - Will be set as the component.name property
        - Should follow design system naming conventions
        - If empty or whitespace, component keeps default name

    Returns
    -------
    str: JSON-serialized plugin response containing:
        {
            "success": true,
            "summary": "Created component 'ComponentName' from node <node_id>",
            "created_component_id": "<component_id>",
            "modified_node_ids": ["<component_id>"]
        }

    Error Handling
    --------------
    The tool provides comprehensive error handling with structured error codes:
    
    - `missing_parameter`: node_id is missing or not a string
    - `node_not_found`: The specified node_id doesn't exist in the document
    - `creation_failed`: Figma API failed to create the component (e.g., node type not supported)
    - `unknown_plugin_error`: Unexpected errors during component creation
    - `communication_error`: Bridge communication failures

    Raises
    ------
    ToolExecutionError: The communicator will raise structured errors produced by the plugin
        with detailed error codes and context information for debugging.

    Usage Examples
    --------------
    # Convert a button frame into a reusable component
    result = await create_component_from_node("123:456", "Button/Primary")
    
    # Create a component from a complex UI element
    result = await create_component_from_node("789:012", "Card/Product")

    Best Practices
    --------------
    - Use descriptive, hierarchical names (e.g., "Button/Primary", "Card/Product")
    - Ensure the source node is complete and properly styled before conversion
    - Consider the component's intended use cases when naming
    - Test component creation with different node types to understand limitations
    - Use this tool as part of a larger design system workflow

    Related Tools
    -------------
    - create_component_instance: Create instances of the newly created component
    - get_document_components: Discover existing components in the document
    - set_instance_properties: Configure properties on component instances
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

    Creates a new document-level style in Figma Design editor. Styles are reusable design tokens that can be applied to multiple nodes, ensuring consistency across designs. This tool supports all four Figma style types with comprehensive validation and error handling.

    **Style Types & Requirements:**
    
    **PAINT Styles** (Color/Fill styles):
    - Used for fills, strokes, and backgrounds
    - Can contain solid colors, gradients, or images
    - Requires `style_properties.paints` array with Paint objects
    - Example: `{"paints": [{"type": "SOLID", "color": {"r": 1, "g": 0, "b": 0}}]}`
    
    **TEXT Styles** (Typography styles):
    - Define font family, size, weight, color, and other text properties
    - Requires `style_properties` object with text formatting properties
    - Example: `{"fontSize": 16, "fontWeight": 700, "fontColor": {"r": 0, "g": 0, "b": 0}}`
    
    **EFFECT Styles** (Shadow/Blur styles):
    - Define visual effects like drop shadows, inner shadows, blurs
    - Requires `style_properties.effects` array with Effect objects
    - Example: `{"effects": [{"type": "DROP_SHADOW", "color": {"r": 0, "g": 0, "b": 0, "a": 0.1}, "offset": {"x": 0, "y": 4}, "radius": 12}]}`
    
    **GRID Styles** (Layout grid styles):
    - Define layout grids for consistent spacing and alignment
    - Requires `style_properties.layoutGrids` array with LayoutGrid objects
    - Example: `{"layoutGrids": [{"pattern": "GRID", "sectionSize": 8, "color": {"r": 0, "g": 0, "b": 0, "a": 0.1}}]}`

    **API Compatibility:**
    - Only available in Figma Design editor (not FigJam or Dev Mode)
    - Uses Figma's native `createPaintStyle()`, `createTextStyle()`, `createEffectStyle()`, `createGridStyle()` APIs
    - Handles style naming conflicts with automatic suffixing
    - Supports nested folder organization via slash-separated names (e.g., "Colors/Primary/Red")

    **Design System Integration:**
    - Essential for maintaining consistent design tokens across projects
    - Styles appear in Figma's Assets panel and can be published to team libraries
    - Enables bulk updates by modifying the style definition
    - Supports design system audits and style inventory management

    Parameters
    ----------
    name : str
        Style name (required). Use slash-separated names for folder organization (e.g., "Colors/Primary/Red").
        Names must be non-empty strings. Duplicate names will be automatically suffixed with numbers.
    type : str
        Style type (required). Must be one of: 'PAINT', 'TEXT', 'EFFECT', 'GRID' (case-insensitive).
        Determines which Figma style creation API is used and what properties are expected.
    style_properties : Dict[str, Any]
        Properties required to construct the style (required). Structure depends on style type:
        - PAINT: Must contain 'paints' key with array of Paint objects
        - TEXT: Object with text formatting properties (fontSize, fontWeight, etc.)
        - EFFECT: Must contain 'effects' key with array of Effect objects  
        - GRID: Must contain 'layoutGrids' key with array of LayoutGrid objects

    Returns
    -------
    str
        JSON-serialized success object: `{"success": true, "summary": "Created [type] style '[name]'", "created_style_id": "<style_id>"}`
        The created_style_id can be used with apply_style tool to apply this style to nodes.

    Raises
    ------
    ToolExecutionError
        Propagates structured plugin errors with specific error codes:
        - `missing_parameter`: Required name parameter is missing or empty
        - `invalid_parameter`: Invalid type value or missing required style_properties
        - `unsupported_editor_type`: Called in FigJam or Dev Mode (styles only available in Design)
        - `style_creation_failed`: Figma API error during style creation
        - `communication_error`: Bridge communication failure

    Examples
    --------
    Create a primary color style:
    ```python
    await create_style(
        name="Colors/Primary/Blue",
        type="PAINT", 
        style_properties={"paints": [{"type": "SOLID", "color": {"r": 0.2, "g": 0.4, "b": 0.8}}]}
    )
    ```
    
    Create a heading text style:
    ```python
    await create_style(
        name="Typography/Headings/H1",
        type="TEXT",
        style_properties={"fontSize": 32, "fontWeight": 700, "fontColor": {"r": 0, "g": 0, "b": 0}}
    )
    ```
    
    Create a card shadow effect style:
    ```python
    await create_style(
        name="Effects/Shadows/Card",
        type="EFFECT",
        style_properties={"effects": [{"type": "DROP_SHADOW", "color": {"r": 0, "g": 0, "b": 0, "a": 0.1}, "offset": {"x": 0, "y": 4}, "radius": 12, "spread": 0}]}
    )
    ```
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

    Applies an existing document-level style to multiple nodes in the Figma canvas. This tool enables consistent styling across design elements by linking nodes to shared style definitions. Supports all Figma style types with comprehensive node compatibility checking and dynamic-page API compatibility.

    **Style Application Types:**
    
    **FILL** (Paint styles for fills):
    - Applies paint styles to node fill properties
    - Compatible with: FrameNode, RectangleNode, EllipseNode, ComponentNode, InstanceNode, VectorNode
    - Uses `setFillStyleIdAsync()` for dynamic-page compatibility, falls back to `fillStyleId` property
    - Replaces existing fills with the style's paint definition
    
    **STROKE** (Paint styles for strokes):
    - Applies paint styles to node stroke properties  
    - Compatible with: FrameNode, RectangleNode, EllipseNode, ComponentNode, InstanceNode, VectorNode, LineNode
    - Uses `setStrokeStyleIdAsync()` for dynamic-page compatibility, falls back to `strokeStyleId` property
    - Replaces existing strokes with the style's paint definition
    
    **TEXT** (Text styles for typography):
    - Applies text styles to text node typography properties
    - Compatible with: TextNode only
    - Uses `setTextStyleIdAsync()` for dynamic-page compatibility, falls back to `textStyleId` property
    - Applies font family, size, weight, color, and other text formatting properties
    
    **EFFECT** (Effect styles for shadows/blurs):
    - Applies effect styles to node visual effects
    - Compatible with: FrameNode, RectangleNode, EllipseNode, ComponentNode, InstanceNode, VectorNode
    - Uses `setEffectStyleIdAsync()` for dynamic-page compatibility, falls back to `effectStyleId` property
    - Replaces existing effects with the style's effect definition
    
    **GRID** (Grid styles for layout grids):
    - Applies grid styles to node layout grid properties
    - Compatible with: FrameNode, ComponentNode, InstanceNode
    - Uses `setGridStyleIdAsync()` for dynamic-page compatibility, falls back to `gridStyleId` property
    - Applies layout grid patterns for consistent spacing and alignment

    **API Compatibility & Error Handling:**
    - Supports both dynamic-page and standard Figma environments
    - Prefers async setter methods (`set*StyleIdAsync`) when available for dynamic-page compatibility
    - Falls back to direct property assignment for standard environments
    - Gracefully handles locked nodes, unsupported node types, and missing nodes
    - Provides detailed feedback on which nodes were successfully modified

    **Design System Workflow:**
    - Essential for maintaining design consistency across large projects
    - Enables bulk style updates by modifying the source style definition
    - Supports design system migration and style standardization
    - Integrates with `get_style_consumers` for impact analysis before style changes

    Parameters
    ----------
    node_ids : List[str]
        List of node IDs to apply the style to (required, non-empty).
        Each ID must be a valid Figma node ID string. Invalid or missing nodes are silently skipped.
        Locked nodes are automatically skipped to prevent accidental modifications.
    style_id : str
        ID of the style to apply (required). Must be a valid style ID from the current document.
        Style IDs can be obtained from `create_style` tool or `get_document_styles` tool.
        Invalid style IDs will cause the operation to fail for all target nodes.
    style_type : str
        Type of style application (required). Must be one of: 'FILL', 'STROKE', 'TEXT', 'EFFECT', 'GRID' (case-insensitive).
        Determines which node property is modified and which setter method is used.
        Must match the type of the target style (e.g., use 'FILL' for paint styles, 'TEXT' for text styles).

    Returns
    -------
    str
        JSON-serialized success object: `{"success": true, "modified_node_ids": ["id1", "id2"], "summary": "Applied [style_type] style to N node(s)"}`
        The modified_node_ids array contains only the IDs of nodes that were successfully updated.
        Nodes that were skipped (locked, unsupported, or missing) are not included in the result.

    Raises
    ------
    ToolExecutionError
        Propagates structured plugin errors with specific error codes:
        - `missing_parameter`: Required parameters are missing or invalid
        - `invalid_parameter`: Invalid style_type value (must be FILL|STROKE|TEXT|EFFECT|GRID)
        - `no_nodes_modified`: No nodes could be updated (all were locked, unsupported, or missing)
        - `unknown_plugin_error`: Unexpected Figma API or plugin errors
        - `communication_error`: Bridge communication failure

    Examples
    --------
    Apply a color style to multiple buttons:
    ```python
    await apply_style(
        node_ids=["123:45", "123:46", "123:47"],
        style_id="S:abc123def456",
        style_type="FILL"
    )
    ```
    
    Apply a text style to heading elements:
    ```python
    await apply_style(
        node_ids=["456:78"],
        style_id="S:xyz789uvw012", 
        style_type="TEXT"
    )
    ```
    
    Apply a shadow effect to card components:
    ```python
    await apply_style(
        node_ids=["789:01", "789:02"],
        style_id="S:def456ghi789",
        style_type="EFFECT"
    )
    ```

    Notes
    -----
    - Style application is atomic per node - either the entire style is applied or the node is skipped
    - Locked nodes are automatically skipped to prevent accidental modifications
    - Use `get_style_consumers` to identify which nodes are currently using a style before making changes
    - For bulk style updates, modify the source style definition rather than re-applying to individual nodes
    """
    try:
        # Sanitize inputs for robustness against minor agent errors
        safe_style_id = (style_id or "").strip().rstrip(",")
        # Accept common synonyms from Figma docs vs our tool enum
        t = (style_type or "").strip().upper()
        if t == "PAINT":
            # Our tool expects where to apply the PAINT style: default to FILL
            t = "FILL"
        # Only allow supported enums
        if t not in {"FILL", "STROKE", "TEXT", "EFFECT", "GRID"}:
            logger.error("❌ apply_style invalid style_type", extra={"code": "invalid_parameter", "details": {"style_type": style_type}})
            raise ToolExecutionError({
                "code": "invalid_parameter",
                "message": "'style_type' must be one of FILL|STROKE|TEXT|EFFECT|GRID",
                "details": {"style_type": style_type}
            })

        logger.info(f"🎨 apply_style: style_id={safe_style_id}, style_type={t}, node_count={len(node_ids)}")
        params: Dict[str, Any] = {"node_ids": node_ids, "style_id": safe_style_id, "style_type": t}
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


