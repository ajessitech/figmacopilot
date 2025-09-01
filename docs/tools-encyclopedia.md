

# Designer Agent: Tools Encyclopedia (v2.0)

**API Reference:** [Figma Plugin API](https://www.figma.com/plugin-docs/api/api-reference/)

**Guiding Principles:** This toolset is governed by the agent's core principles:
*   **Auto Layout First:** Prioritize Auto Layout for all container elements.
*   **Design System as Source of Truth:** Leverage styles, variables, and components.
*   **Component-Driven Architecture:** Build with instances, not detached groups.
*   **Build for Responsiveness:** Use constraints and resizing settings correctly.
*   **Non-Destructive Workflow:** Preserve original layers and properties where possible.

> **Note:** Every multi-step mutation **must** be wrapped in `withUndoGroup`, and significant off-screen mutations **must** be preceded by a call to `scrollAndZoomIntoView`.

---

## Table of Contents

1.  [Document & Page Management](#1-document--page-management)
2.  [Core & Observation Tools](#2-core--observation-tools)
3.  [Node & Layer Manipulation Tools](#3-node--layer-manipulation-tools)
4.  [Layout & Alignment Tools](#4-layout--alignment-tools)
5.  [Styling & Design System Tools](#5-styling--design-system-tools)
6.  [Text & Content Tools](#6-text--content-tools)
7.  [Component & Prototyping Tools](#7-component--prototyping-tools)
8.  [Viewport & User Experience Tools](#8-viewport--user-experience-tools)
9.  [Agent & Environment Utilities](#9-agent--environment-utilities)

---

## 1. Document & Page Management
High-level document/page tools. Unless stated otherwise, these are non-mutating (`mutatesCanvas: false`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`getRootNode`** | Retrieves the root `DocumentNode` of the file. | `None` | • [`figma.root`](https://www.figma.com/plugin-docs/api/figma/#root) |
| **`getCurrentPage`** | Gets the `PageNode` currently viewed by the user. | `None` | • [`figma.currentPage`](https://www.figma.com/plugin-docs/api/figma/#currentpage) |
| **`setCurrentPage`** | (`mutatesCanvas: true`) Switches the active page synchronously by assigning `figma.currentPage`. Switch pages before selection or viewport ops. | `pageId: string` | • [`figma.currentPage`](https://www.figma.com/plugin-docs/api/figma/#currentpage) |
| **`createPage`** | (`mutatesCanvas: true`) Creates a new `PageNode` and appends it to the document. | `None` | • [`figma.createPage`](https://www.figma.com/plugin-docs/api/properties/figma-createpage/) |
| **`loadPageContent`** | Ensures a page's children are loaded into memory before traversal/modification. | `pageId: string` | • [`PageNode.loadAsync`](https://www.figma.com/plugin-docs/api/PageNode/#loadasync) |
| **`loadAllPages`** | Loads all pages to enable document-wide searches. Use cautiously for performance. | `None` | • [`figma.loadAllPagesAsync`](https://www.figma.com/plugin-docs/api/figma/#loadallpagesasync) |
| **`renamePage`** | (`mutatesCanvas: true`) Renames a page. | `pageId: string`, `name: string` | • [`PageNode`](https://www.figma.com/plugin-docs/api/PageNode/) <br> • [`node.name`](https://www.figma.com/plugin-docs/api/properties/nodes-name/) |
| **`deletePage`** | (`mutatesCanvas: true`) Deletes a page from the document. | `pageId: string` | • [`node.remove`](https://www.figma.com/plugin-docs/api/properties/nodes-remove/) |

> Cross-page rule: before selecting or scrolling to nodes on another page, first `await setCurrentPage(...)`, then `await loadPageContent(...)` if you need children.

## 2. Core & Observation Tools
The agent's sensory system for understanding the canvas, design system, and user context. These tools are non-mutating (`mutatesCanvas: false`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`getSelection`** | Retrieves an array of the currently selected `SceneNode` objects on the active page. This is the primary entry point for context-aware commands. | `None` | • [`figma.currentPage.selection`](https://www.figma.com/plugin-docs/api/PageNode/#selection) |
| **`getNodeById`** | Retrieves a single node by its unique ID. Returns `null` if not found. Prefer `figma.getNodeByIdAsync` when using `"documentAccess": "dynamic-page"`. | `id: string` | • [`figma.getNodeById`](https://www.figma.com/plugin-docs/api/figma/#getnodebyid) <br> • [`figma.getNodeByIdAsync`](https://www.figma.com/plugin-docs/api/figma/#getnodebyidasync) |
| **`getNodeProperties`** | ***(Core Agent Function)*** Fetches a comprehensive, structured JSON object of properties for a given node ID. This is the agent's core "Observe" function, abstracting dozens of individual property lookups (`node.fills`, `node.width`, etc.) into a single data structure. It intelligently handles mixed values by returning `figma.mixed`. | `nodeId: string` | • [All Node Types](https://www.figma.com/plugin-docs/api/nodes/) <br> • [Shared Node Properties](https://www.figma.com/plugin-docs/api/node-properties/) <br> • [`figma.mixed`](https://www.figma.com/plugin-docs/api/properties/figma-mixed/) |
| **`findNodes`** | ***(Async)*** Searches the subtree of a given node for all descendants matching specific criteria. Requires page to be loaded via `loadPageContent`. The agent should prefer `findAllWithCriteria` for performance. | `startNodeId: string`, `criteria: FindAllCriteria` or `predicate: (node) => boolean` | • [`node.findAllWithCriteria`](https://www.figma.com/plugin-docs/api/properties/nodes-findallwithcriteria/) <br> • [`node.findAll`](https://www.figma.com/plugin-docs/api/properties/nodes-findall/) |
| **`findFirstNode`** | ***(Async)*** Searches the subtree of a given node and returns the *first* descendant matching the criteria. More efficient than `findNodes` when only one target is needed. | `startNodeId: string`, `criteria: FindAllCriteria` or `predicate: (node) => boolean` | • [`node.findOne`](https://www.figma.com/plugin-docs/api/properties/nodes-findone/) |
| **`findChildren`** | Searches the immediate children of a node (non-recursively). Useful for quick, shallow queries without walking the subtree. | `nodeId: string`, `predicate?: (node) => boolean` | • [`node.findChildren`](https://www.figma.com/plugin-docs/api/properties/nodes-findchildren/) |
| **`getParent`** | Retrieves the parent `BaseNode` of a given node. Returns `null` if the node is a page or the document root. | `nodeId: string` | • [`node.parent`](https://www.figma.com/plugin-docs/api/properties/nodes-parent/) |
| **`getStyles`** | ***(Async)*** Fetches all local styles of a specified type from the document's design system. | `styleType: 'PAINT' \| 'TEXT' \| 'EFFECT' \| 'GRID'` | • [`figma.getLocalPaintStylesAsync`](https://www.figma.com/plugin-docs/api/figma/#getlocalpaintstylesasync) <br> • And equivalents for `TEXT`, `EFFECT`, `GRID`. |
| **`getVariables`** | ***(Async)*** Fetches all local variables and their collections. Essential for applying and reasoning about design tokens. | `resolvedType?: VariableResolvedDataType` | • [`figma.variables.getLocalVariablesAsync`](https://www.figma.com/plugin-docs/api/properties/figma-variables-getlocalvariablesasync/) <br> • [`figma.variables.getLocalVariableCollectionsAsync`](https://www.figma.com/plugin-docs/api/figma-variables/#getlocalvariablecollectionsasync) |
| **`getComponentProperties`** | Reads the defined properties of a `ComponentNode` or `ComponentSetNode` (variants, text, boolean, etc.) or the applied property values of an `InstanceNode`. | `nodeId: string` | • [`component.componentPropertyDefinitions`](https://www.figma.com/plugin-docs/api/properties/ComponentPropertiesMixin-componentpropertydefinitions/) <br> • [`instance.componentProperties`](https://www.figma.com/plugin-docs/api/InstanceNode/#componentproperties) |
| **`getMainComponent`** | ***(Async)*** Retrieves the main `ComponentNode` for a given `InstanceNode`. A critical tool for any operation that involves modifying a component's base properties. | `instanceId: string` | • [`instance.getMainComponentAsync`](https://www.figma.com/plugin-docs/api/InstanceNode/#getmaincomponentasync) |
| **`getSiblings`** | Returns sibling nodes (excluding the node itself). Useful for relative ordering and comparisons. | `nodeId: string` | • [`node.parent`](https://www.figma.com/plugin-docs/api/properties/nodes-parent/) |
| **`getBoundingBox`** | Computes an axis‑aligned bounding box from `absoluteTransform`, `width`, `height`, and `rotation` to support alignment and collision checks. | `nodeId: string` | • [`node.absoluteTransform`](https://www.figma.com/plugin-docs/api/node-properties/#absolutetransform) <br> • [`node.width`/`node.height`](https://www.figma.com/plugin-docs/api/node-properties/) <br> • [`node.rotation`](https://www.figma.com/plugin-docs/api/node-properties/) |
| **`getNodeSummary`** | Returns a bounded, normalized summary of a node (identity, geometry, constraints, key Auto Layout, role flags, simplified visuals, truncated text). Optimized for planning. | `nodeId: string`, `options?: { textLimit?: number }` | • [Shared Node Properties](https://www.figma.com/plugin-docs/api/node-properties/) |
| **`getNodesSummary`** | Batch version of `getNodeSummary` for multiple nodes. | `nodeIds: string[]`, `options?: { textLimit?: number }` | • [Shared Node Properties](https://www.figma.com/plugin-docs/api/node-properties/) |
| **`getFrameContext`** | Returns a bounded context tree for a frame (limited depth/fields) for quick assessment and review. | `frameId: string`, `options?: { maxDepth?: number }` | • [All Node Types](https://www.figma.com/plugin-docs/api/nodes/) |
| **`getFullContext`** | Returns a full context tree (expensive). Use sparingly for deep assessment or final review. | `rootId: string`, `options?: { includeText?: boolean }` | • [All Node Types](https://www.figma.com/plugin-docs/api/nodes/) |

## 3. Node & Layer Manipulation Tools
The agent's hands for creating, modifying, and organizing layers on the canvas (`mutatesCanvas: true`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`createNode`** | Creates a new `SceneNode` of a specified type. Can accept initial properties. The agent will resolve the `parentNode` internally before appending. | `type: 'RECTANGLE' \| ...`, `parentId: string`, `properties?: { ... }` | • [`figma.createRectangle`](https://www.figma.com/plugin-docs/api/properties/figma-createrectangle/) <br> • [`figma.createFrame`](https://www.figma.com/plugin-docs/api/properties/figma-createframe/) <br> • [`figma.createText`](https://www.figma.com/plugin-docs/api/properties/figma-createtext/) |
| **`setNodeProperties`** | A smart dispatcher that modifies one or more properties of a given node ID. Pre-checks for `locked` status. Handles immutable arrays (`fills`, `strokes`) correctly. | `nodeId: string`, `properties: { name?: string, fills?: Paint[], ... }` | • [Shared Node Properties](https://www.figma.com/plugin-docs/api/node-properties/) |
| **`resizeNode`** | Resizes a node to a specified width and height. Fails if `textAutoResize` is not `'NONE'` for `TextNode`s. | `nodeId: string`, `width: number`, `height: number` | • [`node.resize`](https://www.figma.com/plugin-docs/api/properties/nodes-resize/) |
| **`group`** | Groups a list of nodes into a new `GroupNode`. Returns the ID of the new group. | `nodeIds: string[]`, `parentId: string`, `index?: number` | • [`figma.group`](https://www.figma.com/plugin-docs/api/properties/figma-group/) |
| **`ungroup`** | Ungroups a `GroupNode`, releasing its children into the parent container. | `nodeId: string` | • [`figma.ungroup`](https://www.figma.com/plugin-docs/api/properties/figma-ungroup/) |
| **`reorderLayer`** | Moves an existing child node to a new index. If the parent is the same, it reorders. If the parent is different, it reparents. | `nodeId: string`, `newParentId: string`, `newIndex: number` | • [`parent.insertChild`](https://www.figma.com/plugin-docs/api/properties/nodes-insertchild/) |
| **`appendChild`** | Appends a child as the last element of a parent's children. Useful for assembling layouts. | `parentId: string`, `childId: string` | • [`nodes.appendChild`](https://www.figma.com/plugin-docs/api/properties/nodes-appendchild/) |
| **`insertChild`** | Inserts a child at a specific index within the parent. Can also be used to move a node across parents (reparenting). | `parentId: string`, `childId: string`, `index: number` | • [`nodes.insertChild`](https://www.figma.com/plugin-docs/api/properties/nodes-insertchild/) |
| **`setSelection`** | Sets the current selection to the provided nodes. Selection must belong to the current page. | `nodeIds: string[]` | • [`PageNode.selection`](https://www.figma.com/plugin-docs/api/properties/PageNode-selection/) |
| **`renameNodes`** | Renames one or more nodes. Can apply patterns. | `nodeIds: string[]`, `pattern: { text: string, type: 'REPLACE' \| ... }` | • [`node.name`](https://www.figma.com/plugin-docs/api/properties/nodes-name/) |
| **`removeNodes`** | Deletes the specified nodes from the document. | `nodeIds: string[]` | • [`node.remove`](https://www.figma.com/plugin-docs/api/properties/nodes-remove/) |
| **`duplicateNode`** | Clones a supported node type and inserts the clone near the original (same parent by default). | `nodeId: string`, `targetParentId?: string`, `index?: number` | • [`node.clone()`](https://www.figma.com/plugin-docs/api/FrameNode/) |
| **`flattenNodes`** | Flattens vector-like nodes into a single `VectorNode`. | `nodeIds: string[]`, `parentId: string` | • [`figma.flatten`](https://www.figma.com/plugin-docs/api/properties/figma-flatten/) |
| **`createBooleanOperation`** | Creates a `BooleanOperationNode` from nodes with specified operation (e.g., UNION/INTERSECT/SUBTRACT/EXCLUDE). | `nodeIds: string[]`, `parentId: string`, `operation: 'UNION' \| 'INTERSECT' \| 'SUBTRACT' \| 'EXCLUDE'` | • [`figma.createBooleanOperation`](https://www.figma.com/plugin-docs/api/properties/figma-createbooleanoperation/) |

> Auto Layout rule: For children inside Auto Layout, do not set `x`/`y` directly. Adjust parent Auto Layout (padding, `itemSpacing`, order) or set `layoutPositioning = 'ABSOLUTE'` when intentional.

## 4. Layout & Alignment Tools
Tools for creating structured and responsive layouts (`mutatesCanvas: true`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`configureAutoLayout`** | A powerful batch tool to apply or modify Auto Layout on a Frame. Include container properties: `layoutMode`, `itemSpacing`, `padding{Top,Right,Bottom,Left}`, `primaryAxisSizingMode`, `counterAxisSizingMode`, `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutWrap`, `counterAxisAlignContent`, `strokesIncludedInLayout`. | `nodeId: string`, `properties: { ... }` | • [FrameNode Auto Layout Properties](https://www.figma.com/plugin-docs/api/FrameNode/#auto-layout-properties) |
| **`configureChildInAutoLayout`** | Sets resizing/positioning for a child in Auto Layout. Constraints are ignored unless `layoutPositioning` is `'ABSOLUTE'`. `layoutAlign` and `layoutGrow` apply only to non-absolute children. | `nodeId: string`, `properties: { layoutAlign?, layoutGrow?, layoutPositioning?, ... }` | • [`layoutAlign`](https://www.figma.com/plugin-docs/api/node-properties/#layoutalign) <br> • [`layoutGrow`](https://www.figma.com/plugin-docs/api/node-properties/#layoutgrow) <br> • [`layoutPositioning`](https://www.figma.com/plugin-docs/api/node-properties/#layoutpositioning) |
| **`alignNodes`** | Aligns a selection of two or more nodes (e.g., align left, align vertical centers). For Auto Layout children, prefer order/spacing/padding edits; `x`/`y` may be ignored unless `layoutPositioning = 'ABSOLUTE'`. | `nodeIds: string[]`, `alignment: 'LEFT' \| 'RIGHT' \| ...` | • [`node.x`](https://www.figma.com/plugin-docs/api/properties/nodes-x/), [`node.y`](https://www.figma.com/plugin-docs/api/properties/nodes-y/) <br> • [`node.absoluteTransform`](https://www.figma.com/plugin-docs/api/node-properties/#absolutetransform) |
| **`distributeSpacing`** | Distributes three or more nodes with equal spacing. | `nodeIds: string[]`, `direction: 'HORIZONTAL' \| 'VERTICAL'` | • Same as `alignNodes`. |
| **`setConstraints`** | Sets constraints for non-Auto Layout positioning and responsiveness. For Auto Layout children, constraints apply only when `layoutPositioning = 'ABSOLUTE'`. | `nodeId: string`, `constraints: Constraints` | • [Constraints](https://www.figma.com/plugin-docs/api/Constraints/) <br> • [Node Properties](https://www.figma.com/plugin-docs/api/node-properties/) |

## 5. Styling & Design System Tools
Tools for applying visual styles and leveraging design system assets (`mutatesCanvas: true`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`applyStyling`** | A multipurpose batch tool to set visual properties on a selection, such as fills, strokes, effects, corner radius. | `nodeIds: string[]`, `styles: { fills?: Paint[], ... }` | • [`node.fills`](https://www.figma.com/plugin-docs/api/properties/nodes-fills/) <br> • [`node.strokes`](https://www.figma.com/plugin-docs/api/node-properties/#strokes) <br> • [`node.effects`](https://www.figma.com/plugin-docs/api/properties/nodes-effects/) <br> • [`figma.util.solidPaint`](https://www.figma.com/plugin-docs/api/properties/figma-util-solidpaint/) |
| **`createStyle`** | Creates a new local style (Paint, Text, Effect) from provided properties. Returns the new style's ID. | `properties: { name: string, type: 'PAINT' \| ..., ... }` | • [`figma.createPaintStyle`](https://www.figma.com/plugin-docs/api/figma/#createpaintstyle) <br> • [`figma.createTextStyle`](https://www.figma.com/plugin-docs/api/figma/#createtextstyle) |
| **`applyStyle`** | ***(Async)*** Applies an existing local style to a node by setting its style ID. Supports Fill/Text/Stroke/Effect/Grid where applicable. | `nodeId: string`, `styleId: string`, `styleType: 'FILL' \| 'TEXT' \| 'STROKE' \| 'EFFECT' \| 'GRID'` | • [`node.setFillStyleIdAsync`](https://www.figma.com/plugin-docs/api/properties/nodes-setfillstyleidasync/) <br> • [`node.setTextStyleIdAsync`](https://www.figma.com/plugin-docs/api/TextNode/#settextstyleidasync) <br> • [PaintStyle](https://www.figma.com/plugin-docs/api/PaintStyle/) <br> • [EffectStyle](https://www.figma.com/plugin-docs/api/EffectStyle/) <br> • [GridStyle](https://www.figma.com/plugin-docs/api/GridStyle/) |
| **`bindVariableToProperty`** | Binds a node's property to a design variable. **Note:** The `variable` parameter must be a `Variable` or `VariableAlias` object, not just an ID. | `nodeId: string`, `field: string`, `variable: Variable \| VariableAlias` | • [`node.setBoundVariable`](https://www.figma.com/plugin-docs/api/properties/nodes-setboundvariable/) <br> • [`figma.variables.createVariableAlias`](https://www.figma.com/plugin-docs/api/figma-variables/#createvariablealias) |
| **`removeBoundVariable`** | Unbinds a property from a variable. | `nodeId: string`, `field: string` | • [`node.setBoundVariable(field, null)`](https://www.figma.com/plugin-docs/api/properties/nodes-setboundvariable/) |
| **`createImagePaintFromBytes`** | Creates an `ImagePaint` from bytes/Uint8Array and returns a ready-to-apply fill. Useful for thumbnails and avatars. | `bytes: Uint8Array`, `overrides?: Partial<ImagePaint>` | • [`figma.createImage`](https://www.figma.com/plugin-docs/api/properties/figma-createimage/) <br> • [`figma.createImageAsync`](https://www.figma.com/plugin-docs/api/properties/figma-createimageasync/) |
| **`setLayoutGrids`** | Replaces a node's layout grids immutably. | `nodeId: string`, `layoutGrids: LayoutGrid[]` | • [`node.layoutGrids`](https://www.figma.com/plugin-docs/api/node-properties/#layoutgrids) <br> • [LayoutGrid](https://www.figma.com/plugin-docs/api/LayoutGrid/) |
| **`clearLayoutGrids`** | Clears all layout grids on a node. | `nodeId: string` | • [`node.layoutGrids`](https://www.figma.com/plugin-docs/api/node-properties/#layoutgrids) |

## 6. Text & Content Tools
Tools for managing textual content (`mutatesCanvas: true`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`loadFont`** | ***(Prerequisite Tool) (Async)*** Loads a specified font for use. **Crucially**, this must be called for *every unique `FontName`* that will be applied or is present in a `TextNode` being edited. For multi‑range text, collect distinct `FontName`s via `getStyledTextSegments` and load them all before editing `characters` or ranges. | `fontName: FontName` | • [`figma.loadFontAsync`](https://www.figma.com/plugin-docs/api/properties/figma-loadfontasync/) |
| **`setTextCharacters`** | Updates the text content of a `TextNode`. Requires `loadFont` to have been called for the node's existing font(s). | `nodeId: string`, `characters: string` | • [`node.characters`](https://www.figma.com/plugin-docs/api/properties/TextNode-characters/) |
| **`applyTextStyleRange`** | Applies specific styling (e.g., font size, weight, fills) to a range of characters within a `TextNode`. Requires `loadFont` for any new fonts being applied. | `nodeId: string`, `start: number`, `end: number`, `styles: { ... }` | • [Text Range Functions](https://www.figma.com/plugin-docs/api/TextNode/#text-range-functions) (e.g., `setRangeFontSize`) |
| **`getStyledTextSegments`** | Reads styled text segments for analysis of existing styles. Useful for assessment loops and planning. | `nodeId: string`, `fields: StyledTextSegmentFields[]` | • [`TextNode.getStyledTextSegments`](https://www.figma.com/plugin-docs/api/properties/TextNode-getstyledtextsegments/) |

## 7. Component & Prototyping Tools
Advanced tools for building reusable systems and interactive prototypes (`mutatesCanvas: true`).

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`createComponent`** | Converts a selected node into a new `ComponentNode`. | `nodeId: string` | • [`figma.createComponentFromNode`](https://www.figma.com/plugin-docs/api/properties/figma-createcomponentfromnode/) |
| **`createInstance`** | Creates an instance of a specified component. | `componentId: string`, `parentId: string` | • [`component.createInstance()`](https://www.figma.com/plugin-docs/api/ComponentNode/#createinstance) |
| **`createDesignVariations`** | Duplicates a selected frame or component multiple times and applies specified modifications to each copy, for rapid exploration. | `nodeId: string`, `count: number`, `modifications: (node, index) => void` | • [`FrameNode`](https://www.figma.com/plugin-docs/api/FrameNode/) |
| **`createVariants`** | Combines `ComponentNode`s into a `ComponentSetNode` for variants. | `componentIds: string[]`, `parentId: string` | • [`figma.combineAsVariants`](https://www.figma.com/plugin-docs/api/properties/figma-combineasvariants/) |
| **`detachInstance`** | Detaches an instance into a regular frame. Use sparingly; prefer instance properties. | `instanceId: string` | • [`InstanceNode.detachInstance`](https://www.figma.com/plugin-docs/api/InstanceNode/#detachinstance) |
| **`setComponentProperties`** | Modifies the variant properties and other component properties of an `InstanceNode`. **Note:** The agent must validate the `properties` against the main component's `componentPropertyDefinitions`. | `instanceId: string`, `properties: { [prop: string]: string \| boolean }` | • [`instance.setProperties`](https://www.figma.com/plugin-docs/api/InstanceNode/#setproperties) <br> • [ComponentProperties](https://www.figma.com/plugin-docs/api/ComponentProperties/) |
| **`createPrototypeInteraction`** | Adds or updates prototyping interactions on a node. Ensure destinations exist and provide required fields for overlays and animated transitions. Under `'documentAccess': 'dynamic-page'`, `.reactions` is read-only; use `setReactionsAsync` and update immutably. | `sourceNodeId: string`, `reactions: Reaction[]` | • [`node.setReactionsAsync`](https://www.figma.com/plugin-docs/api/properties/nodes-setreactionsasync/) <br> • [Reaction](https://www.figma.com/plugin-docs/api/Reaction/), [Trigger](https://www.figma.com/plugin-docs/api/Trigger/), [Action](https://www.figma.com/plugin-docs/api/Action/) |
| **`getFlowStartingPoints`** | Reads the current page’s prototype flow starting points (read‑only). | `None` | • [`page.flowStartingPoints`](https://www.figma.com/plugin-docs/api/properties/PageNode-flowstartingpoints/) |
| **`exportSelection`** | ***(Async)*** Exports the selected node(s) as an image (PNG, JPG) or vector (SVG). | `nodeId: string`, `settings: ExportSettings` | • [`node.exportAsync`](https://www.figma.com/plugin-docs/api/properties/nodes-exportasync/) <br> • [ExportSettings](https://www.figma.com/plugin-docs/api/ExportSettings/) |
| **`getReactions`** | Reads the `reactions` array from a node (read‑only). | `nodeId: string` | • [`node.reactions`](https://www.figma.com/plugin-docs/api/node-properties/#reactions) <br> • [Reaction](https://www.figma.com/plugin-docs/api/Reaction/) |
| **`swapInstanceComponent`** | Swaps an instance's main component while preserving overrides per Figma heuristics. | `instanceId: string`, `componentId: string` | • [`InstanceNode.swapComponent`](https://www.figma.com/plugin-docs/api/properties/InstanceNode-swapcomponent/) |

## 8. Viewport & User Experience Tools
Tools for managing the user's view and providing a clear, guided experience.

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`getViewport`** | (`mutatesCanvas: false`) Retrieves the current viewport's center coordinates and zoom level. Useful for saving and restoring the user's view. | `None` | • [`figma.viewport.center`](https://www.figma.com/plugin-docs/api/figma-viewport/) <br> • [`figma.viewport.zoom`](https://www.figma.com/plugin-docs/api/figma-viewport/) |
| **`setViewport`** | (`mutatesCanvas: true`) Programmatically sets the viewport's center and zoom. Allows for precise camera control. | `center?: Vector`, `zoom?: number` | • [`figma.viewport.center = vector`](https://www.figma.com/plugin-docs/api/figma-viewport/) <br> • [`figma.viewport.zoom = num`](https://www.figma.com/plugin-docs/api/figma-viewport/) |
| **`scrollAndZoomIntoView`** | (`mutatesCanvas: true`) Adjusts the user's viewport to focus perfectly on the specified nodes. **Crucial for providing visual feedback** during multi-step operations. | `nodeIds: string[]` | • [`figma.viewport.scrollAndZoomIntoView`](https://www.figma.com/plugin-docs/api/figma-viewport/) |
| **`selectAndReveal`** | (`mutatesCanvas: true`) Helper that optionally switches pages, sets selection, then scrolls and zooms into view. | `nodeIds: string[]`, `pageId?: string` | • [`figma.currentPage`](https://www.figma.com/plugin-docs/api/figma/#currentpage) <br> • [`PageNode.selection`](https://www.figma.com/plugin-docs/api/properties/PageNode-selection/) <br> • [`figma.viewport.scrollAndZoomIntoView`](https://www.figma.com/plugin-docs/api/figma-viewport/) |

> Cross-page: `scrollAndZoomIntoView` works on the current page only—call `setCurrentPage` first for nodes on another page.

## 9. Agent & Environment Utilities
Meta-tools for managing the agent's workflow, safety, and performance.

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`withUndoGroup`** | ***(Wrapper Tool)*** Runs multi‑step edits within one plugin invocation so they collapse into a single undo step by default. Call `figma.commitUndo()` inside only when you intentionally want to split the history into multiple steps. | `label: string`, `actions: () => Promise<void>` | • [`figma.commitUndo`](https://www.figma.com/plugin-docs/api/properties/figma-commitundo/) |
| **`setSkipInvisibleInstanceChildren`** | (`mutatesCanvas: false`) Performance optimization. When `true`, traversal operations (`findNodes`) are significantly faster by ignoring invisible nodes within instances. | `value: boolean` | • [`figma.skipInvisibleInstanceChildren`](https://www.figma.com/plugin-docs/api/properties/figma-skipinvisibleinstancechildren/) |
| **`archiveSelectionToPage`** | Duplicates the current selection and moves copies to an `…/Archive` page (creates it if missing) before edits. | `archivePageName?: string` | • [`FrameNode`](https://www.figma.com/plugin-docs/api/FrameNode/) <br> • [`figma.createPage`](https://www.figma.com/plugin-docs/api/properties/figma-createpage/) |
| **`saveVersionCheckpoint`** | Saves a version history checkpoint before large refactors, aiding rollback. | `message: string` | • [`figma.saveVersionHistoryAsync`](https://www.figma.com/plugin-docs/api/properties/figma-saveversionhistoryasync/) |
| **`setClientStorage`** | Stores persistent, local data for the user and plugin. | `key: string`, `value: any` | • [`figma.clientStorage.setAsync`](https://www.figma.com/plugin-docs/api/figma-clientStorage/) |
| **`getClientStorage`** | Retrieves data from client storage. | `key: string` | • [`figma.clientStorage.getAsync`](https://www.figma.com/plugin-docs/api/figma-clientStorage/) |
| **`setPluginData`** | Stores plugin‑scoped metadata on a node. | `nodeId: string`, `key: string`, `value: string` | • [`node.setPluginData`](https://www.figma.com/plugin-docs/api/node-properties/#plugindata) |
| **`getPluginData`** | Retrieves plugin‑scoped metadata from a node. | `nodeId: string`, `key: string` | • [`node.getPluginData`](https://www.figma.com/plugin-docs/api/node-properties/#plugindata) |
| **`setSharedPluginData`** | Stores shared metadata under a namespace accessible to other plugins. | `nodeId: string`, `namespace: string`, `key: string`, `value: string` | • [`node.setSharedPluginData`](https://www.figma.com/plugin-docs/api/node-properties/#sharedplugindata) |
| **`getSharedPluginData`** | Retrieves shared metadata under a namespace. | `nodeId: string`, `namespace: string`, `key: string` | • [`node.getSharedPluginData`](https://www.figma.com/plugin-docs/api/node-properties/#sharedplugindata) |
| **`showNotification`** | (`mutatesCanvas: false`) Displays a toast message at the bottom of the Figma UI. | `message: string`, `options?: NotificationOptions` | • [`figma.notify`](https://www.figma.com/plugin-docs/api/properties/figma-notify/) |
| **`closePlugin`** | (`mutatesCanvas: false`) Terminates the plugin's execution, optionally showing a final message. | `message?: string` | • [`figma.closePlugin`](https://www.figma.com/plugin-docs/api/properties/figma-closeplugin/) |
| **`showUI`** | Shows the plugin UI iframe (wrapper uses `htmlPath` to resolve HTML passed to `figma.showUI`). | `htmlPath: string`, `options?: { width?: number, height?: number, visible?: boolean }` | • [`figma.showUI`](https://www.figma.com/plugin-docs/api/properties/figma-showui/) |
| **`resizeUI`** | Resizes the plugin UI iframe to the given dimensions. | `width: number`, `height: number` | • [`figma.ui.resize`](https://www.figma.com/plugin-docs/api/figma-ui/#resize) |
| **`postMessageToUI`** | Sends a message to the plugin UI. | `pluginMessage: any` | • [`figma.ui.postMessage`](https://www.figma.com/plugin-docs/api/properties/figma-ui-postmessage/) |
| **`onUIMessage`** | Subscribes to UI messages. | `handler: (msg: any) => void` | • [`figma.ui.onmessage`](https://www.figma.com/plugin-docs/api/properties/figma-ui-onmessage/) <br> • [`figma.ui.on('message')`](https://www.figma.com/plugin-docs/api/properties/figma-ui-on/) |
| **`openExternal`** | Opens a URL in the user's default browser. | `url: string` | • [`figma.openExternal`](https://www.figma.com/plugin-docs/api/properties/figma-openexternal/) |
| **`computeSelectionSignature`** | Produces a short-lived hash/signature for the current selection to drive caching. | `nodeIds: string[]` | • Derived helper (no direct API) |

---

## 10. Events & Observability
Event hooks for reactive assessment and UI sync.

| Tool Name | Description & Purpose | Parameters | Primary API Reference |
| :--- | :--- | :--- | :--- |
| **`onSelectionChange`** | Subscribes to selection changes to drive Assess/Correct loops or UI updates. | `handler: () => void` | • [`figma.on('selectionchange')`](https://www.figma.com/plugin-docs/api/properties/figma-on/) |
| **`onCurrentPageChange`** | Subscribes to current page changes; helpful when navigation occurs programmatically. | `handler: () => void` | • [`figma.on('currentpagechange')`](https://www.figma.com/plugin-docs/api/properties/figma-on/) |
| **`onDocumentChange`** | Subscribes to document diffs to observe mutations and validate outcomes. | `handler: (event: DocumentChangeEvent) => void` | • [`figma.on('documentchange')`](https://www.figma.com/plugin-docs/api/properties/figma-on/) <br> • [DocumentChangeEvent](https://www.figma.com/plugin-docs/api/DocumentChangeEvent/) |

---

### Additional Guidance and Safety Rails

- **Auto Layout vs Positioning**: Prefer container edits (padding, spacing, order) over absolute positioning. For exceptions, set `layoutPositioning = 'ABSOLUTE'` explicitly and document why.
- **Auto Layout Sizing Modes**: Resizing Auto Layout frames can change `primaryAxisSizingMode`/`counterAxisSizingMode`. Prefer setting sizing modes directly (HUG/FILL/FIXED) and use `resize` cautiously. `TextNode.resize` requires `textAutoResize = 'NONE'`.
- **Dynamic Page Loading & Gating**: With `"documentAccess": "dynamic-page"`, use `figma.getNodeByIdAsync` and call `page.loadAsync`/`figma.loadAllPagesAsync` before cross‑page traversal. Some properties are read‑only (e.g., `.reactions`); use the async setter APIs (e.g., `setReactionsAsync`).
- **Instance Mutability**: Many instance fields are read‑only unless exposed by the main component. Prefer `setComponentProperties` for variant swaps and boolean/text props. Consider editing the main component when appropriate.
- **Prototyping Reactions**: Read existing `reactions` first and update immutably. Under `dynamic-page`, do not assign `.reactions` directly; always call `setReactionsAsync`. Ensure destinations exist and required `Transition` fields are provided (especially for overlays and animated navigations).
- **Variables Binding Limits**: Not all fields are bindable. Use `setBoundVariableForPaint` for paints/gradients and `setRangeBoundVariable` for text ranges. Load fonts for any ranges being updated.
- **Fonts Discipline**: Load every `FontName` present in affected ranges before `characters` or range styling APIs.
- **Locked/Hidden Nodes**: Mutation tools should check `locked`/`visible` and fail with helpful errors instead of no‑ops.
- **Immutable Arrays**: Replace arrays immutably (`fills`, `strokes`, `effects`, `layoutGrids`): copy → modify → set.
- **Undo Semantics**: One plugin run collapses into a single undo step by default. Call `figma.commitUndo()` to intentionally split the undo history into multiple steps.
- **Error Semantics**: Tools should return a canonical error object `{ code, message, nodeId?, property? }` for failed operations to support the Assess/Correct loop.
- **Ungroup Caution**: Ungrouping can remove container semantics (especially Frames/Auto Layout). Prefer editing layout properties; ungroup only with intent and archive first.