### Alignment + Variances (scope: tools.json L1–L296)

- set_layout_mode
  - Status: aligned
  - Variance: Figma docs include layoutMode 'GRID' but original notes listed only NONE/HORIZONTAL/VERTICAL. Contract updated to include 'GRID'. Plugin assigns layoutWrap even when layoutMode='GRID' (likely ignored by Figma). Consider guarding layoutWrap on GRID.
  - Link: https://www.figma.com/plugin-docs/api/properties/nodes-layoutmode/

- set_corner_radius
  - Status: aligned
  - Variance: Plugin supports per-corner via corners[4], wrapper does not accept this argument. Extend wrapper to support optional corners list and forward it.

- set_stroke_color
  - Status: aligned
  - Notes: Overwrites strokes array with single SOLID paint; keeps strokeWeight when supported.

- set_fill_color
  - Status: aligned
  - Notes: Overwrites fills array; verification tolerance ≈ 0.001.

- create_text
  - Status: aligned
  - Variance: Wrapper does not forward fontColor; extend wrapper to accept fontColor {r,g,b,a} and forward to plugin.

- create_rectangle
  - Status: aligned
  - Notes: Add downstream styling calls for fills/strokes/corner radius as needed.

- create_frame
  - Status: aligned
  - Variance: Wrapper forwards only {x,y,width,height,name,parentId,layoutMode}. Consider extending wrapper to forward fillColor, strokeColor, strokeWeight, layoutWrap, padding, axis alignment, sizing, and itemSpacing supported by plugin.

- get_nodes_info
  - Status: aligned
  - Notes: Invalid nodeIds are skipped; results may be partial. Consider surfacing a list of missing IDs in response.

- get_node_info
  - Status: aligned
  - Notes: Colors are hex; vectors omitted per filter.

- get_selection
  - Status: aligned

- get_document_info
  - Status: aligned
  - Variance: pages[] includes only current page per plugin; consider an optional mode to enumerate all pages when needed.


### Alignment + Variances (scope: tools.json L420–L621)

- clone_node
  - Status: aligned
  - Notes: Returns {id,name,x?,y?,width?,height?}. Uses node.clone()+append to parent. Positioning applied only if both x and y provided.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)

- delete_node
  - Status: aligned
  - Notes: Returns {id,name,type} captured before removal.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)

- resize_node
  - Status: aligned
  - Notes: Calls node.resize(w,h). Text nodes may require textAutoResize='NONE' and fonts loaded.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)

- move_node
  - Status: aligned
  - Variance: Plugin does not set layoutPositioning to 'ABSOLUTE'. In auto-layout parents, x/y may be ignored by Figma.
  - TODO: Add a helper to toggle layoutPositioning to 'ABSOLUTE' before move when needed.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)

- set_item_spacing
  - Status: aligned
  - Notes: Requires at least one of itemSpacing or counterAxisSpacing. counterAxisSpacing only when layoutWrap == 'WRAP'.
  - Links: [InferredAutoLayoutResult](https://www.figma.com/plugin-docs/api/InferredAutoLayoutResult)

- set_layout_sizing
  - Status: aligned
  - Notes: Enforces FIXED|HUG|FILL with guards. FILL requires auto-layout parent; HUG valid on FRAME/TEXT.
  - TODO: Consider exposing layoutGrow in a dedicated tool to complement FILL behavior.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)

- set_axis_align
  - Status: aligned
  - Notes: Validates primaryAxisAlignItems and counterAxisAlignItems; BASELINE only for horizontal.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)

- set_padding
  - Status: aligned
  - Notes: Only on Auto Layout nodes; returns per-side padding values.
  - Links: [FrameNode docs](https://www.figma.com/plugin-docs/api/FrameNode/)


### Alignment + Variances (scope: tools.json L761–L1072)

- scan_nodes_by_types
  - Status: aligned
  - Notes: Returns { success, message, count, matchingNodes[{ id,name,type,bbox }], searchedTypes }. Added explicit errors and limits in tools.json.
  - Links: [findAll docs](https://www.figma.com/plugin-docs/api/figma-root/#findall) (conceptual), [SceneNode bbox fields](https://www.figma.com/plugin-docs/api/SceneNode/)

- read_my_design
  - Status: aligned
  - Notes: Returns array of { nodeId, document } via exportAsync(JSON_REST_V1). Marked as read-only in tools.json.
  - Links: [exportAsync(JSON)](https://www.figma.com/plugin-docs/api/SceneNode/#exportasync)

- get_annotations / set_annotation / set_multiple_annotations
  - Status: not implemented in plugin
  - Behavior: Backend wrapper returns { success: false, message } on call. tools.json updated to reflect errors/side_effects.
  - TODO: Implement plugin handlers to return structured failures instead of undefined result; ensure UI forwards a valid tool_response when a command is unknown.
  - Links: [Plugin data](https://www.figma.com/plugin-docs/api/properties/nodes-setplugindata/), [FigJam stickies](https://www.figma.com/plugin-docs/api/StickyNode/) (context only)

- get_instance_overrides
  - Status: minor diff fixed
  - Change: tools.json now exposes optional parameter instanceNodeId. code.js registry mapping corrected to support both selection fallback and explicit ID. Wrapper already supported optional ID.
  - Variance against docs: Uses InstanceNode.overrides (internal). Verify stability vs public API.
  - TODO: Verify override fields coverage vs componentPropertyDefinitions; add docs if needed.
  - Links: [InstanceNode](https://www.figma.com/plugin-docs/api/InstanceNode/)

- set_instance_overrides
  - Status: major fix applied in plugin
  - Change: Fixed commandRegistry mapping to accept { targetNodeIds, sourceInstanceId } (previously expected { targetInstances, sourceResult }). Switch-case and helpers retained.
  - tools.json: Added explicit side_effects and errors.
  - Links: [Instance swapping](https://www.figma.com/plugin-docs/api/InstanceNode/#swapcomponent)

- get_local_components
  - Status: aligned
  - Notes: Returns only ComponentNode entries; key may be null. Added limits and side_effects to tools.json.
  - Links: [findAllWithCriteria](https://www.figma.com/plugin-docs/api/figma-root/#findallwithcriteria)

- create_component_instance
  - Status: aligned
  - Notes: Uses importComponentByKeyAsync + createInstance; added errors/side_effects in tools.json.
  - Links: [importComponentByKeyAsync](https://www.figma.com/plugin-docs/api/figma/#importcomponentbykeyasync)

- set_multiple_text_contents
  - Status: aligned
  - Notes: Chunks of 5; emits progress; documented limits/errors. Wrapper already forwards results.
  - Links: [TextNode](https://www.figma.com/plugin-docs/api/TextNode/)

- scan_text_nodes
  - Status: minor enhancement applied
  - Change: Wrapper now supports optional use_chunking (default true) and chunk_size (default 10). tools.json updated with defaults, side_effects, errors.
  - Links: [TextNode](https://www.figma.com/plugin-docs/api/TextNode/)

- set_text_content
  - Status: aligned
  - Notes: Supports smartStrategy: prevail | strict | experimental; documented fontName return semantics. Wrapper forwards smartStrategy as smartStrategy.
  - Links: [Font loading](https://www.figma.com/plugin-docs/api/figma/#loadfontasync)

- delete_multiple_nodes
  - Status: aligned
  - Notes: Chunks of 5 deletions; emits progress; errors documented.

### Follow-ups

- Verify stability of InstanceNode.overrides vs public API and document any limitations or alternatives. (Docs variance)
- Implement annotation tools in plugin and ensure UI sends valid tool_response when command is unknown.

### Alignment + Variances (scope: tools.json L1153–L1399)

- get_reactions
  - Status: aligned (tool present but not registered in plugin)
  - Notes: Returns progress via internal updates; filters navigation === 'CHANGE_TO'; temporary orange stroke highlight unless silent.
  - Variance: Not registered in `commandRegistry` or switch; backend wrapper forwards call and returns failure today. Consider adding a thin adapter `getReactionsCommand(params)` and registering `commandRegistry.set('get_reactions', getReactionsCommand)`.
  - Links: [Reaction](https://www.figma.com/plugin-docs/api/Reaction)

- set_default_connector
  - Status: not implemented in plugin (wrapper returns { success: false, message })
  - Variance: FigJam-only concept. Keep as stub until FigJam scope is prioritized.
  - Links: [ConnectorNode](https://www.figma.com/plugin-docs/api/ConnectorNode/)

- create_connections
  - Status: not implemented in plugin (wrapper returns { success: false, message })
  - Variance: FigJam-only concept. Keep as stub until FigJam scope is prioritized.
  - Links: [ConnectorNode](https://www.figma.com/plugin-docs/api/ConnectorNode/)

- export_node_as_image
  - Status: aligned
  - Variance: Plugin always exports PNG; tools.json clarified format, mimeType, and errors.
  - Links: [ExportSettings](https://www.figma.com/plugin-docs/api/ExportSettings)

- get_styles
  - Status: aligned
  - Variance: For paints, plugin returns only the first paint (`style.paints[0]`). Documented as a limit.
  - Links: [PaintStyle](https://www.figma.com/plugin-docs/api/PaintStyle), [TextStyle](https://www.figma.com/plugin-docs/api/TextStyle), [EffectStyle](https://www.figma.com/plugin-docs/api/EffectStyle), [GridStyle](https://www.figma.com/plugin-docs/api/GridStyle)

- gather_full_context
  - Status: aligned
  - Notes: Cache TTL 45s (FULL_CONTEXT_TTL_MS). Added side_effects and agent_chaining in tools.json.
  - Links: [Nodes API](https://www.figma.com/plugin-docs/api/nodes/)

- selections_context
  - Status: minor diff fixed (wrapper added)
  - Notes: Snapshot mode returns fast summary; complete delegates to gather_full_context; cache TTL applies.
  - Links: [Nodes API](https://www.figma.com/plugin-docs/api/nodes/)

- get_comments
  - Status: minor diff fixed (wrapper added)
  - TODO: Verify official docs link for `figma.root.getCommentsAsync()` and add to index file if missing.
  - Links: [figma](https://www.figma.com/plugin-docs/api/figma/)

- create_image
  - Status: minor diff fixed (wrapper added)
  - Notes: Appends to provided parent when valid, otherwise to current page. Errors on missing base64 only.
  - Links: [figma.createImageAsync](https://www.figma.com/plugin-docs/api/properties/figma-createimageasync/), [Image](https://www.figma.com/plugin-docs/api/Image)

- get_image_by_hash
  - Status: minor diff fixed (wrapper added)
  - Notes: Returns base64 and size on success, structured failure when image not found.
  - Links: [Image](https://www.figma.com/plugin-docs/api/Image)

- set_gradient_fill
  - Status: minor diff fixed (wrapper added; tools.json expanded with errors/limits)
  - Notes: Overwrites node.fills with provided gradient. Gradient must conform to Paint type for gradients.
  - Links: [Paint](https://www.figma.com/plugin-docs/api/Paint)

### Alignment + Variances (scope: tools.json L1525–L1686)

- set_range_text_style
  - Status: aligned (wrapper added)
  - Variance: Plugin loads font via node.fontName; if fontName is 'MIXED' per Figma, loadFontAsync will throw. Docs recommend loading per-range font via getRangeFontName. Keep plugin behavior, document pitfall.
  - TODO: Consider enhancing plugin to load fonts per-range when node.fontName === 'MIXED'.
  - Links: [TextNode.setRangeTextStyleId](https://www.figma.com/plugin-docs/api/TextNode/), [figma.loadFontAsync](https://www.figma.com/plugin-docs/api/figma/#loadfontasync)

- list_available_fonts
  - Status: aligned (wrapper added)
  - Notes: Returns { family, style } pairs only; agent must form FontName.
  - Links: [figma.listAvailableFontsAsync](https://www.figma.com/plugin-docs/api/figma/#listavailablefontsasync)

- group
  - Status: aligned (wrapper added)
  - Notes: Uses figma.group(nodes, parent). Validates parentId supports appendChild.
  - Links: [figma.group](https://www.figma.com/plugin-docs/api/properties/figma-group/)

- ungroup
  - Status: aligned (wrapper added)
  - Variance: Implementation reinserts each child at the same index; order may reverse relative to the original group. Keep behavior and document pitfall.
  - TODO: Optionally change insertion to parent.insertChild(index + i, child) to preserve order.
  - Links: [figma.ungroup](https://www.figma.com/plugin-docs/api/properties/figma-ungroup/)

- reparent
  - Status: aligned (wrapper added)
  - Notes: Appends each node to new parent; order == input order. Guards invalid self-parent.
  - Links: [SceneNode.appendChild](https://www.figma.com/plugin-docs/api/SceneNode/#appendchild)

- insert_child
  - Status: aligned (wrapper added)
  - Notes: Validates parent/child existence; index must be within bounds.
  - Links: [SceneNode.insertChild](https://www.figma.com/plugin-docs/api/SceneNode/#insertchild)

- zoom
  - Status: aligned (wrapper added)
  - Notes: Optional center; returns current zoom+center.
  - Links: [figma.viewport.zoom](https://www.figma.com/plugin-docs/api/figma-viewport/)

- center
  - Status: aligned (wrapper added)
  - Notes: Centers viewport only; no zoom change.
  - Links: [figma.viewport.center](https://www.figma.com/plugin-docs/api/figma-viewport/)

- scroll_and_zoom_into_view
  - Status: aligned (wrapper added)
  - Notes: Resolves nodes via getNodeByIdAsync; errors when none are valid.
  - Links: [figma.viewport.scrollAndZoomIntoView](https://www.figma.com/plugin-docs/api/figma-viewport/)

- create_component
  - Status: aligned (wrapper added)
  - Notes: Creates a ComponentNode, clones children, and places an Instance next to the original. Original is not removed.
  - Variance vs docs: Docs have createComponentFromNode; implementation manually clones. Keep behavior and document.
  - TODO: Evaluate using figma.createComponentFromNode for fidelity if available in this editor type.
  - Links: [figma.createComponent](https://www.figma.com/plugin-docs/api/properties/figma-createcomponent/), [figma.createComponentFromNode](https://www.figma.com/plugin-docs/api/properties/figma-createcomponentfromnode/)
