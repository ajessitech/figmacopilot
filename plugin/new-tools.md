
# Figma Agent: The Complete Tools Atlas

## 1. Introduction & Guiding Principles

This document is the single source of truth for the complete toolset available to the Figma Copilot Agent. It provides an exhaustive definition for every function the agent can call to observe the canvas, mutate designs, and interact with the user. The design of this toolset is guided by a set of core principles to ensure the agent is powerful, predictable, and safe.

### Core Principles

1.  **Observe, Plan, Mutate, Verify:** The agent must always understand its environment before acting. Every significant task follows this lifecycle:
    *   **Observe:** Use the "Scoping" and "Observation" tools to understand the user's context and find target nodes.
    *   **Plan:** Formulate a clear internal plan, breaking the task into a logical sequence of tool calls.
    *   **Mutate:** Use the atomic "Mutation" tools to enact precise changes.
    *   **Verify:** Use "Observation" tools again (`get_node_details`) on the modified nodes to confirm the mutation was successful.
2.  **Selection-First Context:** The user's current selection is the most important piece of context. The agent's default scope is always the selection. Page-wide operations are a deliberate exception, not the default.
3.  **Scoped & Batched Mutations:** All mutation tools operate on specific `node_ids` and are designed to accept arrays of IDs for efficient, batch operations. There are no ambiguous, page-wide mutations.
4.  **Atomicity & Clarity:** Tools are broken down into logical, single-purpose functions (e.g., `set_fills`, `set_size`). This makes the agent's reasoning chain clear, debuggable, and less prone to complex failures.
5.  **System Awareness:** The agent is not just manipulating shapes; it is a design system-aware partner. The toolset provides comprehensive access to Styles, Components, and Variables, enabling the agent to work within the file's established rules.

---

## 2. Tool Categories

The agent's tools are grouped into four distinct categories, mapping to its cognitive process.

| Category | Purpose | Core Tools |
| :--- | :--- | :--- |
| **1. Scoping & Orientation (The Compass)** | Establish the user's primary context at the start of any task. | `get_canvas_snapshot` |
| **2. Observation & Inspection (The Senses)** | Gather detailed, read-only information about nodes, styles, components, and prototypes. | `find_nodes`, `get_node_details`, `get_document_styles`, `get_image_of_node` |
| **3. Mutation & Creation (The Hands)** | Actively create, delete, or modify nodes and resources on the canvas. | `create_frame`, `set_fills`, `set_auto_layout`, `apply_style` |
| **4. Meta & Utility (The Interface)** | Control the user's view, provide feedback, and manage state. | `scroll_and_zoom_into_view`, `show_notification`, `commit_undo_step` |

---

## Category 1: Scoping & Orientation (The Compass)

*This category contains a single, critical tool that should be the starting point for every agent task.*

### **1.1. `get_canvas_snapshot`** DONE

*   **Purpose:** The agent's entry point for every task. Its primary goal is to determine the user's context by inspecting the current page and selection (`figma.currentPage.selection`). This tool establishes the initial scope for all subsequent actions.
*   **When to Use:** **ALWAYS** call this tool first at the beginning of any new task. The `selection` array in the output is the most critical piece of information for your next step.
*   **Input Schema:** `{}` (No parameters)
*   **Output Schema:**
    ```json
    {
      "page": { "id": "string", "name": "string" },
      // ALWAYS present. An array of the user's current selection. This is your primary context.
      "selection": [ /* Array of RichNodeSummary objects */ ],
      // The top-level nodes on the page. Use this for context only if the selection is empty.
      "root_nodes_on_page": [ /* Array of BasicNodeSummary objects */ ]
    }
    ```
*   **Example Agent Thought:** *"The user said 'change the title'. My first step is to see what they have selected. I will call `get_canvas_snapshot`. The output shows one 'User Card' FRAME in the `selection` array. This card is now my primary scope. My next step will be to find a TEXT node *within* this card."*

---

## Category 2: Observation & Inspection (The Senses)

*These tools are the agent's eyes and ears. They are used to find nodes, gather detailed data about them, and understand the file's underlying design system.*

### **2.1. `find_nodes`** DONE 

*   **Purpose:** The primary tool for locating nodes using a flexible combination of filters, typically within a specific scope. This is a powerful abstraction over `node.findAllWithCriteria`.
*   **When to Use:** Use this to find descendant nodes *within a specific scope*. If the user has a single frame selected, you **must** use its ID as the `scope_node_id`. Only perform a page-wide search as a last resort.
*   **Input Schema:**
    ```json
    {
      "filters": {
        "type": "object",
        "properties": {
          "name_regex": "string", // Find nodes where `node.name` matches this regex.
          "text_regex": "string", // Find TEXT nodes where `node.characters` match this regex.
          "node_types": ["string"], // Find nodes where `node.type` is one of these.
          "main_component_id": "string", // Find instances of a specific component.
          "style_id": "string" // Find nodes using a specific style.
        }
      },
      "scope_node_id": "string" | null, // The ID of a node to search within. Use null for a page-wide search.
      "highlight_results": { "type": "boolean", "default": false } // Briefly highlights the found nodes.
    }
    ```
*   **Output Schema:** `{"matching_nodes": [ /* Array of RichNodeSummary objects */ ]}`
*   **Example Agent Thought:** *"My context is the selected 'User Card' frame (ID: '123:45'). I will call `find_nodes` with `scope_node_id: '123:45'` and `filters: { 'node_types': ['TEXT'] }` to find the title text *inside* the card."*

### **2.2. `get_node_details`** DONE

*   **Purpose:** The agent's "microscope." Provides the complete, unabridged data for one or more nodes. This is the ultimate source of ground truth before a mutation and for verification after.
*   **When to Use:**
    1.  **Pre-Mutation Inspection:** Call this on your target node(s) immediately before you plan to modify them.
    2.  **Post-Mutation Verification:** Call this on the modified node(s) immediately after a mutation to confirm the change.
*   **Input Schema:** `{"node_ids": ["string"]}`
*   **Output Schema:**
    ```json
    {
      "details": {
        "<nodeId>": {
          "target_node": { /* See Appendix A: Unified Node Data Model */ },
          "parent_summary": { /* RichNodeSummary */ } | null,
          "children_summaries": [ /* Array of RichNodeSummary objects */ ]
        }
      }
    }
    ```

### **2.3. `get_image_of_node`** DONE

*   **Purpose:** Generates visual PNG images for one or more nodes. This is the sole tool for getting visual representations.
*   **When to Use:** When you need to "see" what a node looks like, either for your own understanding or to show the user a before/after comparison.
*   **Input Schema:**
    ```json
    {
      "node_ids": ["string"],
      "export_settings": {
        "format": "PNG", // Or JPG, SVG
        "constraint": { "type": "SCALE", "value": 2 } // Example: export at 2x resolution
      }
    }
    ```
*   **Output Schema:** `{"images": { "<nodeId>": "<base64-encoded PNG>" }}`
*   **Example Agent Thought:** *"I have just applied a drop shadow. To verify it looks correct, I will call `get_image_of_node` on the modified frame's ID."*

### **2.4. `get_node_ancestry` & `get_node_hierarchy`** DONE

*   **Purpose:** Tools for exploring the scene graph structure. `get_node_ancestry` looks upwards to the page root. `get_node_hierarchy` looks one level up (parent) and one level down (direct children).
*   **When to Use:** Use `ancestry` to understand a node's full context ("is this in the header or the footer?"). Use `hierarchy` to explore the immediate contents of a selected container.
*   **Input Schemas:** `{"node_id": "string"}`
*   **Output Schemas:**
    *   `get_node_ancestry`: `{"ancestors": [ /* Array of BasicNodeSummary objects */ ]}`
    *   `get_node_hierarchy`: `{"parent_summary": { /* BasicNodeSummary */ } | null, "children": [ /* Array of BasicNodeSummary objects */ ]}`

### **2.5. `get_document_styles`** DONE

*   **Purpose:** Discovers the reusable design tokens (colors, text styles, effects) available in the file.
*   **When to Use:** When the user asks to use a named style (e.g., "Primary Color," "H1"), call this to find the corresponding style ID before using the `apply_style` tool.
*   **Input Schema:** `{"style_types": ["PAINT" | "TEXT" | "EFFECT" | "GRID"] | null}`
*   **Output Schema:** `{"styles": [{"id": "string", "name": "string", "type": "string"}]}`
*   **Example Agent Thought:** *"User wants to use the 'Brand/Primary' color. I'll call `get_document_styles` with `style_types: ['PAINT']`, find the style named 'Brand/Primary' in the result, and get its ID."*

### **2.6. `get_style_consumers`** DONE

*   **Purpose:** Finds all nodes on the current page that are using a specific style. Critical for understanding the impact of a style change.
*   **When to Use:** Before modifying a style, or when the user asks "Show me everything using this color."
*   **Input Schema:** `{"style_id": "string"}`
*   **Output Schema:** `{"consuming_nodes": [ /* Array of RichNodeSummary objects */ ]}`

### **2.7. `get_document_components`**

*   **Purpose:** Discovers all local and available library components that can be instantiated.
*   **When to Use:** When the user asks to "add a button" or "find the avatar component," call this to find the component's definition (`id` or `key`) before using `create_component_instance`.
*   **Input Schema:** `{}`
*   **Output Schema:** `{"components": [{"id": "string", "key": "string", "name": "string", "type": "string"}]}`

### **2.8. `get_prototype_interactions`**

*   **Purpose:** Inspects the prototyping connections on a node.
*   **When to Use:** When the user asks "Where does this button link to?" or "Fix this prototype."
*   **Input Schema:** `{"node_id": "string"}`
*   **Output Schema:** `{"reactions": [ /* Array of Reaction objects, define using figma-documentation.md */ ]}`

---

## Category 3: Mutation & Creation (The Hands)
*These tools actively change the canvas. They are organized by function. Every tool operates on specific `node_ids` and returns a consistent output (`{"modified_node_ids": [...], "summary": "...", "error": "..."}`) unless it's a creation or structural tool.*

### Sub-Category 3.1: Create Tools

*   **`create_frame`** DONE: `{"name": "string", "parent_id": "string", "width": 100, "height": 100, "x": 0, "y": 0}` -> `{"created_node_id": "string"}`
*   **`create_rectangle`** DONE: `{"name": "string", "parent_id": "string", "width": 100, "height": 100, "x": 0, "y": 0}` -> `{"created_node_id": "string"}`
*   **`create_ellipse`** DONE: `{"name": "string", "parent_id": "string", "width": 100, "height": 100, "x": 0, "y": 0}` -> `{"created_node_id": "string"}`
*   **`create_polygon`** DONE: `{"name": "string", "parent_id": "string", "side_count": 3, "radius": 50, "x": 0, "y": 0}` -> `{"created_node_id": "string"}`
*   **`create_star`** DONE: `{"name": "string", "parent_id": "string", "point_count": 5, "outer_radius": 50, ...}` -> `{"created_node_id": "string"}`
*   **`create_line`** DONE: `{"name": "string", "parent_id": "string", "length": 100, "x": 0, "y": 0, ...}` -> `{"created_node_id": "string"}`
*   **`create_text`** DONE: `{"characters": "string", "parent_id": "string", "x": 0, "y": 0}` -> `{"created_node_id": "string"}`

### Sub-Category 3.2: Modify (General Properties)

*   **`set_fills` DONE **: `{"node_ids": ["string"], "paints": [Paint]}` (Use `[]` to remove)
*   **`set_strokes` DONE **: `{"node_ids": ["string"], "paints": [Paint], "stroke_weight": number|null, ...}`
*   **`set_corner_radius`** DONE : `{"node_ids": ["string"], "uniform_radius": number|null, "top_left": number|null, ...}`
*   **`set_size`** DONE : `{"node_ids": ["string"], "width": number|null, "height": number|null}`
*   **`set_position`** DONE : `{"node_ids": ["string"], "x": number, "y": number}`
*   **`set_rotation`** DONE : `{"node_ids": ["string"], "rotation_degrees": number}`
*   **`set_layer_properties`** DONE : `{"node_ids": ["string"], "name": string|null, "opacity": number|null, "visible": boolean|null, ...}`
*   **`set_effects`** DONE : `{"node_ids": ["string"], "effects": [Effect]}` (Use `[]` to remove)

### Sub-Category 3.3: Modify (Layout)

*   **`set_auto_layout`** DONE : `{"node_ids": ["string"], "layout_mode": "'HORIZONTAL'|'VERTICAL'|'NONE'", "item_spacing": number|null, "padding_top": number|null, ...}`
*   **`set_auto_layout_child`** DONE : `{"node_ids": ["string"], "layout_align": "'STRETCH'|'INHERIT'|...", "layout_grow": 0|1|null}`
*   **`set_constraints`** DONE : `{"node_ids": ["string"], "horizontal": "'MIN'|'MAX'|...", "vertical": "'MIN'|'MAX'|..."}`

### Sub-Category 3.4: Modify (Text)

*   **`set_text_characters`**: `{"node_id": "string", "new_characters": "string"}` (Operates on single node for clarity)
*   **`set_text_style`**: `{"node_ids": ["string"], "font_size": number|null, "font_name": {"family":"..","style":".."}, ...}`

### Sub-Category 3.5: Hierarchy & Structure

*   **`clone_nodes`**: `{"node_ids": ["string"]} -> {"created_node_ids": ["string"], "summary": "string"}`
*   **`group_nodes`**: `{"node_ids": ["string"], "new_group_name": "string", "parent_id": "string"}` -> `{"created_group_id": "string"}`
*   **`ungroup_node`**: `{"node_id": "string"}` -> `{"moved_child_ids": ["string"]}`
*   **`reparent_nodes`**: `{"node_ids_to_move": ["string"], "new_parent_id": "string"}`
*   **`reorder_nodes`**: `{"node_ids": ["string"], "mode": "'BRING_FORWARD' | 'SEND_TO_BACK' | ..."}`

### Sub-Category 3.6: Vector & Boolean

*   **`perform_boolean_operation`**: `{"node_ids": ["string"], "operation": "'UNION'|'SUBTRACT'|...", "parent_id": "string"}` -> `{"created_node_id": "string"}`
*   **`flatten_nodes`**: `{"node_ids": ["string"], "parent_id": "string"}` -> `{"created_node_id": "string"}`

### Sub-Category 3.7: Components & Styles

*   **`create_component_from_node`**: `{"node_id": "string", "name": "string"}` -> `{"created_component_id": "string"}`
*   **`create_component_instance`**: `{"component_id": string|null, "component_key": string|null, "parent_id": "string", ...}` -> `{"created_node_id": "string"}`
*   **`set_instance_properties`**: `{"node_ids": ["string"], "properties": {"prop_name#id": "value", ...}}`
*   **`detach_instance`**: `{"node_ids": ["string"]}` -> `{"created_frame_ids": ["string"]}`
*   **`create_style`**: `{"name": "string", "type": "'PAINT'|'TEXT'|...", "style_properties": {...}}` -> `{"created_style_id": "string"}`
*   **`apply_style`**: `{"node_ids": ["string"], "style_id": "string", "style_type": "'FILL'|'STROKE'|..."}`

### Sub-Category 3.8: Variables

*   **`create_variable_collection`**: `{"name": "string", ...}` -> `{"collection_id": "string"}`
*   **`create_variable`**: `{"name": "string", "collection_id": "string", "resolved_type": "'COLOR'|'FLOAT'|..."}` -> `{"variable_id": "string"}`
*   **`set_variable_value`**: `{"variable_id": "string", "mode_id": "string", "value": "..."}`
*   **`bind_variable_to_property`**: `{"node_id": "string", "property": "'fills[0].color'|...", "variable_id": "string"}`

### Sub-Category 3.9: Prototyping

*   **`set_reaction`**: `{"node_ids": ["string"], "reactions": [Reaction]}` (Use `[]` to remove)

---

## Category 4: Meta & Utility (The Interface)

*These tools manage the user's view, provide feedback, and handle state.*

### **4.1. `scroll_and_zoom_into_view`** DONE
*   **Purpose:** Programmatically moves the user's viewport to focus on a set of specified nodes. This is essential for guiding the user's attention.
*   **When to Use:**
    *   After `find_nodes` to show the user the located items.
    *   Before a mutation on an off-screen element to show the user what is about to change.
    *   After creating new elements to focus the canvas on them.
*   **Input Schema:** `{"node_ids": ["string"]}`
*   **Output Schema:** `{"success": true, "summary": "string", "resolved_node_ids": ["string"], "unresolved_node_ids": ["string"]}`
*   **Example Agent Thought:** *"I have found the three 'icon' components the user asked for. To show them where they are, I will call `scroll_and_zoom_into_view` with their IDs."*

### **4.2. `delete_nodes`**

*   **Purpose:** Permanently deletes nodes from the canvas.
*   **When to Use:** When a user explicitly asks to remove elements, or to clean up temporary helper objects.
*   **Input Schema:** `{"node_ids": ["string"]}`
*   **Output Schema:** `{"deleted_node_ids": ["string"], "summary": "string"}`

### **4.3. `show_notification`** DONE

*   **Purpose:** Displays a temporary toast message to the user.
*   **When to Use:** To give the user feedback, confirm a long-running action is complete, or report a non-blocking error or warning.
*   **Input Schema:** `{"message": "string", "is_error": "boolean|null"}`
*   **Output Schema:** `{"success": true}`

### **4.4. `commit_undo_step`** DONE

*   **Purpose:** Commits the previous sequence of operations into a single step in the user's undo history (`Ctrl+Z`).
*   **When to Use:** After completing a logical task that involved multiple mutation calls (e.g., after building an entire card), call this so the user can undo the entire operation in one go.
*   **Input Schema:** `{}`
*   **Output Schema:** `{"success": true}`

---

## Appendices

### Appendix A: Data Structures (Nodes)

*   **`BasicNodeSummary`**: Lightweight representation for hierarchy and discovery.
    ```json
    {"id": "string", "name": "string", "type": "string", "has_children": "boolean"}
    ```
*   **`RichNodeSummary`**: More informative summary with position and layout info.
    ```json
    {
      "id": "string", "name": "string", "type": "string", "has_children": "boolean",
      "absolute_bounding_box": { "x": "number", "y": "number", "width": "number", "height": "number" },
      "auto_layout_mode": "string" | null
    }
    ```
*   **`UnifiedNodeDataModel`**: The complete, unabridged data for a node, returned by `get_node_details`. This is a comprehensive object containing dozens of fields for geometry, layout, styling, text, component properties, etc. (See original prompt for full structure).

### Appendix B: Data Structures (Styling)

*   **`Paint` Object**: Follows the Figma Plugin API `Paint` type.
    *   **Solid:** `{"type": "SOLID", "color": {"r": 1, "g": 0, "b": 0}}`
    *   **Gradient:** `{"type": "GRADIENT_LINEAR", "gradientStops": [...], ...}`
*   **`Effect` Object**: Follows the Figma Plugin API `Effect` type.
    *   **Drop Shadow:** `{"type": "DROP_SHADOW", "color": ..., "offset": ..., "radius": ...}`
    *   **Layer Blur:** `{"type": "LAYER_BLUR", "radius": ...}`

### Appendix C: Data Structures (Prototyping)

*   **`Reaction` Object**: Defines a single prototype interaction.
    *   **Structure:** `{"trigger": Trigger, "action": Action}`
    *   **`Trigger`:** `{"type": "ON_CLICK"}` or `{"type": "AFTER_TIMEOUT", "timeout": 500}`
    *   **`Action`:** `{"type": "NAVIGATE", "destinationId": "123:456"}` or `{"type": "URL", "url": "..."}`

---




Scope to my current selection if it’s a top-level frame; otherwise create a 1200×800 frame named “Hero Test” on the current page and zoom to it. Turn on vertical auto‑layout (padding 32 on all sides, item spacing 16, center align). Add three text layers inside: “Welcome”, “Subheading lorem ipsum”, and “Get Started”. Style them: sizes 48/700, 20/400, 16/600 respectively; center align; auto‑resize height; reasonable contrast (e.g., near #111 for headings, #444 for body). If requested fonts aren’t available, pick the closest available. Set text layers’ names to H1, Body, and CTA Label. For these text layers, set auto‑layout child props (layout_align center or stretch where valid, layout_grow 0). Show a short toast when done and bundle the whole change into a single undo step.


Inside “Hero Test” (or the selected container), create a rectangle (280×160), ellipse (120×120), polygon (5 sides, radius 60), star (5 points, outer 60), and a line (length 220). Lay them out in a neat grid (explicit x/y), then: set fills to distinct colors, add 2px strokes (outside), give the rectangle 12px corners, rotate the star 18°, set a soft drop shadow on the rectangle, and set constraints so each stays centered within its parent. Group them as “Shape Group”, then clone the group once and move the clone to the right. Reorder so the original group stays on top. Perform a UNION between the first rectangle and ellipse to create a “Pill” shape; also flatten the cloned group to a single vector. Export lightweight PNG snapshots (e.g., 2×) for the “Pill” and the flattened result and return their base64 lengths as a quick verification. Temporarily set the line’s opacity to 0.8 and lock it, then unlock it again. Show a toast and make all of this one undo step.


Find a card‑like element in selection or build one: a 320×200 rectangle (12px corner radius) with a title text “Card Title” centered on it. Convert that into a component named “Card / Base”. Create two instances and place them side by side. If the component has instance properties, set a property like “State” to “Hover” on the first instance; if not, override the title text to “Card Title (Hover)”. Reparent one instance into “Hero Test” and send the detached variant behind other content. Detach the second instance and rename it to “Card Variant / Detached”. Fetch node details before and after for the modified nodes, and also report the ancestry of the CTA text and the immediate hierarchy of “Hero Test” for context. List local components in the document and confirm the component is present. Single undo step, with a short success toast.


Check document styles. If a PAINT style named “Brand / Primary” doesn’t exist, create it (#2684FF). Apply this fill style to all rectangles inside “Hero Test” and tell me how many nodes were updated. List consumers of that style on the current page. Create a variables collection “Theme” (with mode “Light” if missing), then create a COLOR variable “brand_primary” and set its value for Light to #2684FF. Bind “brand_primary” to the primary fill of the CTA’s background (or the first rectangle under “Hero Test”). If a TEXT style “Brand / H1” is missing, create it (48, bold, centered) and apply it to the H1 text. Keep the user informed with a short toast and make everything one undo step.


Find a CTA layer inside “Hero Test”. Also find or create a sibling 1200×800 frame named “Confirmation Screen”. Set a prototype interaction on CTA: On click → Navigate to “Confirmation Screen” with Smart Animate 300ms ease‑out; replace existing reactions if needed. Return the CTA’s reactions to confirm. Focus/zoom to both frames. Export quick images for both frames for visual verification and return base64 lengths. If any temporary nodes with names starting “TMP /” exist from prior runs, delete them safely. Show a short success toast and commit as a single undo step.