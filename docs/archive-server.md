# Archived Server Analysis & TODOS

This document analyzes the legacy `ARCHIVE-server.ts` file and outlines a set of TODOs to integrate its best features into our new Python agent.

## Prompts from `ARCHIVE-server.ts`

### 1. Design Strategy

**Best practices for working with Figma designs**

When working with Figma designs, follow these best practices:

1.  **Start with Document Structure:**
    *   First use `get_document_info()` to understand the current document
    *   Plan your layout hierarchy before creating elements
    *   Create a main container frame for each screen/section

2.  **Naming Conventions:**
    *   Use descriptive, semantic names for all elements
    *   Follow a consistent naming pattern (e.g., "Login Screen", "Logo Container", "Email Input")
    *   Group related elements with meaningful names

3.  **Layout Hierarchy:**
    *   Create parent frames first, then add child elements
    *   For forms/login screens:
        *   Start with the main screen container frame
        *   Create a logo container at the top
        *   Group input fields in their own containers
        *   Place action buttons (login, submit) after inputs
        *   Add secondary elements (forgot password, signup links) last

4.  **Input Fields Structure:**
    *   Create a container frame for each input field
    *   Include a label text above or inside the input
    *   Group related inputs (e.g., username/password) together

5.  **Element Creation:**
    *   Use `create_frame()` for containers and input fields
    *   Use `create_text()` for labels, buttons text, and links
    *   Set appropriate colors and styles:
        *   Use `fillColor` for backgrounds
        *   Use `strokeColor` for borders
        *   Set proper `fontWeight` for different text elements

6.  **Modifying existing elements:**
    *   use `set_text_content()` to modify text content.

7.  **Visual Hierarchy:**
    *   Position elements in logical reading order (top to bottom)
    *   Maintain consistent spacing between elements
    *   Use appropriate font sizes for different text types:
        *   Larger for headings/welcome text
        *   Medium for input labels
        *   Standard for button text
        *   Smaller for helper text/links

8.  **Best Practices:**
    *   Verify each creation with `get_node_info()`
    *   Use `parentId` to maintain proper hierarchy
    *   Group related elements together in frames
    *   Keep consistent spacing and alignment

**Example Login Screen Structure:**

*   Login Screen (main frame)
    *   Logo Container (frame)
        *   Logo (image/text)
    *   Welcome Text (text)
    *   Input Container (frame)
        *   Email Input (frame)
            *   Email Label (text)
            *   Email Field (frame)
        *   Password Input (frame)
            *   Password Label (text)
            *   Password Field (frame)
    *   Login Button (frame)
        *   Button Text (text)
    *   Helper Links (frame)
        *   Forgot Password (text)
        *   Don't have account (text)

### 2. Read Design Strategy

**Best practices for reading Figma designs**

When reading Figma designs, follow these best practices:

1.  **Start with selection:**
    *   First use `read_my_design()` to understand the current selection
    *   If no selection ask user to select single or multiple nodes

### 3. Text Replacement Strategy

**Systematic approach for replacing text in Figma designs**

#### 1. Analyze Design & Identify Structure

*   Scan text nodes to understand the overall structure of the design
*   Use AI pattern recognition to identify logical groupings:
    *   Tables (rows, columns, headers, cells)
    *   Lists (items, headers, nested lists)
    *   Card groups (similar cards with recurring text fields)
    *   Forms (labels, input fields, validation text)
    *   Navigation (menu items, breadcrumbs)

\`\`\`
scan_text\_nodes(nodeId: "node-id")
get\_node\_info(nodeId: "node-id") // optional
\`\`\`

#### 2. Strategic Chunking for Complex Designs

*   Divide replacement tasks into logical content chunks based on design structure
*   Use one of these chunking strategies that best fits the design:
    *   **Structural Chunking**: Table rows/columns, list sections, card groups
    *   **Spatial Chunking**: Top-to-bottom, left-to-right in screen areas
    *   **Semantic Chunking**: Content related to the same topic or functionality
    *   **Component-Based Chunking**: Process similar component instances together

#### 3. Progressive Replacement with Verification

*   Create a safe copy of the node for text replacement
*   Replace text chunk by chunk with continuous progress updates
*   After each chunk is processed:
    *   Export that section as a small, manageable image
    *   Verify text fits properly and maintain design integrity
    *   Fix issues before proceeding to the next chunk

\`\`\`
// Clone the node to create a safe copy
clone\_node(nodeId: "selected-node-id", x: [new-x], y: [new-y])

// Replace text chunk by chunk
set\_multiple\_text\_contents(
nodeId: "parent-node-id",
text: [
{ nodeId: "node-id-1", text: "New text 1" },
// More nodes in this chunk...
]
)

// Verify chunk with small, targeted image exports
export\_node\_as\_image(nodeId: "chunk-node-id", format: "PNG", scale: 0.5)
\`\`\`

#### 4. Intelligent Handling for Table Data

*   For tabular content:
    *   Process one row or column at a time
    *   Maintain alignment and spacing between cells
    *   Consider conditional formatting based on cell content
    *   Preserve header/data relationships

#### 5. Smart Text Adaptation

*   Adaptively handle text based on container constraints:
    *   Auto-detect space constraints and adjust text length
    *   Apply line breaks at appropriate linguistic points
    *   Maintain text hierarchy and emphasis
    *   Consider font scaling for critical content that must fit

#### 6. Progressive Feedback Loop

*   Establish a continuous feedback loop during replacement:
    *   Real-time progress updates (0-100%)
    *   Small image exports after each chunk for verification
    *   Issues identified early and resolved incrementally
    *   Quick adjustments applied to subsequent chunks

#### 7. Final Verification & Context-Aware QA

*   After all chunks are processed:
    *   Export the entire design at reduced scale for final verification
    *   Check for cross-chunk consistency issues
    *   Verify proper text flow between different sections
    *   Ensure design harmony across the full composition

#### 8. Chunk-Specific Export Scale Guidelines

*   Scale exports appropriately based on chunk size:
    *   Small chunks (1-5 elements): scale 1.0
    *   Medium chunks (6-20 elements): scale 0.7
    *   Large chunks (21-50 elements): scale 0.5
    *   Very large chunks (50+ elements): scale 0.3
    *   Full design verification: scale 0.2

#### 9. Sample Chunking Strategy for Common Design Types

##### Tables

*   Process by logical rows (5-10 rows per chunk)
*   Alternative: Process by column for columnar analysis
*   Tip: Always include header row in first chunk for reference

##### Card Lists

*   Group 3-5 similar cards per chunk
*   Process entire cards to maintain internal consistency
*   Verify text-to-image ratio within cards after each chunk

##### Forms

*   Group related fields (e.g., "Personal Information", "Payment Details")
*   Process labels and input fields together
*   Ensure validation messages and hints are updated with their fields

##### Navigation & Menus

*   Process hierarchical levels together (main menu, submenu)
*   Respect information architecture relationships
*   Verify menu fit and alignment after replacement

#### 10. Best Practices

*   **Preserve Design Intent**: Always prioritize design integrity
*   **Structural Consistency**: Maintain alignment, spacing, and hierarchy
*   **Visual Feedback**: Verify each chunk visually before proceeding
*   **Incremental Improvement**: Learn from each chunk to improve subsequent ones
*   **Balance Automation & Control**: Let AI handle repetitive replacements but maintain oversight
*   **Respect Content Relationships**: Keep related content consistent across chunks

Remember that text is never just text—it's a core design element that must work harmoniously with the overall composition. This chunk-based strategy allows you to methodically transform text while maintaining design integrity.

### 4. Annotation Conversion Strategy

**Strategy for converting manual annotations to Figma's native annotations**

#### Process Overview

The process of converting manual annotations (numbered/alphabetical indicators with connected descriptions) to Figma's native annotations:

1.  Get selected frame/component information
2.  Scan and collect all annotation text nodes
3.  Scan target UI elements (components, instances, frames)
4.  Match annotations to appropriate UI elements
5.  Apply native Figma annotations

#### Step 1: Get Selection and Initial Setup

First, get the selected frame or component that contains annotations:

\`\`\`typescript
// Get the selected frame/component
const selection = await get_selection();
const selectedNodeId = selection[0].id

// Get available annotation categories for later use
const annotationData = await get_annotations({
nodeId: selectedNodeId,
includeCategories: true
});
const categories = annotationData.categories;
\`\`\`

#### Step 2: Scan Annotation Text Nodes

Scan all text nodes to identify annotations and their descriptions:

\`\`\`typescript
// Get all text nodes in the selection
const textNodes = await scan_text_nodes({
nodeId: selectedNodeId
});

// Filter and group annotation markers and descriptions

// Markers typically have these characteristics:
// - Short text content (usually single digit/letter)
// - Specific font styles (often bold)
// - Located in a container with "Marker" or "Dot" in the name
// - Have a clear naming pattern (e.g., "1", "2", "3" or "A", "B", "C")


// Identify description nodes
// Usually longer text nodes near markers or with matching numbers in path
\`\`\`

#### Step 3: Scan Target UI Elements

Get all potential target elements that annotations might refer to:

\`\`\`typescript
// Scan for all UI elements that could be annotation targets
const targetNodes = await scan_nodes_by_types({
nodeId: selectedNodeId,
types: [
"COMPONENT",
"INSTANCE",
"FRAME"
]
});
\`\`\`

#### Step 4: Match Annotations to Targets

Match each annotation to its target UI element using these strategies in order of priority:

1.  **Path-Based Matching**:
    *   Look at the marker's parent container name in the Figma layer hierarchy
    *   Remove any "Marker:" or "Annotation:" prefixes from the parent name
    *   Find UI elements that share the same parent name or have it in their path
    *   This works well when markers are grouped with their target elements

2.  **Name-Based Matching**:
    *   Extract key terms from the annotation description
    *   Look for UI elements whose names contain these key terms
    *   Consider both exact matches and semantic similarities
    *   Particularly effective for form fields, buttons, and labeled components

3.  **Proximity-Based Matching** (fallback):
    *   Calculate the center point of the marker
    *   Find the closest UI element by measuring distances to element centers
    *   Consider the marker's position relative to nearby elements
    *   Use this method when other matching strategies fail

**Additional Matching Considerations:**

*   Give higher priority to matches found through path-based matching
*   Consider the type of UI element when evaluating matches
*   Take into account the annotation's context and content
*   Use a combination of strategies for more accurate matching

#### Step 5: Apply Native Annotations

Convert matched annotations to Figma's native annotations using batch processing:

\`\`\`typescript
// Prepare annotations array for batch processing
const annotationsToApply = Object.values(annotations).map(({ marker, description }) => {
// Find target using multiple strategies
const target =
findTargetByPath(marker, targetNodes) ||
findTargetByName(description, targetNodes) ||
findTargetByProximity(marker, targetNodes);

if (target) {
// Determine appropriate category based on content
const category = determineCategory(description.characters, categories);

// Determine appropriate additional annotationProperty based on content
const annotationProperty = determineProperties(description.characters, target.type);

return {
nodeId: target.id,
labelMarkdown: description.characters,
categoryId: category.id,
properties: annotationProperty
};
}
return null;
}).filter(Boolean); // Remove null entries

// Apply annotations in batches using set_multiple_annotations
if (annotationsToApply.length > 0) {
await set_multiple_annotations({
nodeId: selectedNodeId,
annotations: annotationsToApply
});
}
\`\`\`

This strategy focuses on practical implementation based on real-world usage patterns, emphasizing the importance of handling various UI elements as annotation targets, not just text nodes.

### 5. Swap Overrides Instances

**Guide to swap instance overrides between instances**

#### Overview

This strategy enables transferring content and property overrides from a source instance to one or more target instances in Figma, maintaining design consistency while reducing manual work.

#### Step-by-Step Process

##### 1. Selection Analysis

*   Use \`get\_selection()\` to identify the parent component or selected instances
*   For parent components, scan for instances with \`scan\_nodes\_by\_types({ nodeId: "parent-id", types: ["INSTANCE"] })\`
*   Identify custom slots by name patterns (e.g. "Custom Slot\*" or "Instance Slot") or by examining text content
*   Determine which is the source instance (with content to copy) and which are targets (where to apply content)

##### 2. Extract Source Overrides

*   Use \`get\_instance\_overrides()\` to extract customizations from the source instance
*   This captures text content, property values, and style overrides
*   Command syntax: \`get\_instance\_overrides({ nodeId: "source-instance-id" })\`
*   Look for successful response like "Got component information from [instance name]"

##### 3. Apply Overrides to Targets

*   Apply captured overrides using \`set\_instance\_overrides()\`
*   Command syntax:
    \`\`\`
    set_instance_overrides({
    sourceInstanceId: "source-instance-id",
    targetNodeIds: ["target-id-1", "target-id-2", ...]
    })
    \`\`\`

##### 4. Verification

*   Verify results with \`get\_node\_info()\` or \`read\_my\_design()\`
*   Confirm text content and style overrides have transferred successfully

#### Key Tips

*   Always join the appropriate channel first with \`join\_channel()\`
*   When working with multiple targets, check the full selection with \`get\_selection()\`
*   Preserve component relationships by using instance overrides rather than direct text manipulation

### 6. Reaction to Connector Strategy

**Strategy for converting Figma prototype reactions to connector lines using the output of 'get_reactions'**

#### Goal

Process the JSON output from the \`get\_reactions\` tool to generate an array of connection objects suitable for the \`create\_connections\` tool. This visually represents prototype flows as connector lines on the Figma canvas.

#### Input Data

You will receive JSON data from the \`get\_reactions\` tool. This data contains an array of nodes, each with potential reactions. A typical reaction object looks like this:

\`\`\`json
{
"trigger": { "type": "ON_CLICK" },
"action": {
"type": "NAVIGATE",
"destinationId": "destination-node-id",
"navigationTransition": { ... },
"preserveScrollPosition": false
}
}
\`\`\`

#### Step-by-Step Process

##### 1. Preparation & Context Gathering

*   **Action:** Call \`read\_my\_design\` on the relevant node(s) to get context about the nodes involved (names, types, etc.). This helps in generating meaningful connector labels later.
*   **Action:** Call \`set\_default\_connector\` **without** the \`connectorId\` parameter.
*   **Check Result:** Analyze the response from \`set\_default\_connector\`.
    *   If it confirms a default connector is already set (e.g., "Default connector is already set"), proceed to Step 2.
    *   If it indicates no default connector is set (e.g., "No default connector set..."), you **cannot** proceed with \`create\_connections\` yet. Inform the user they need to manually copy a connector from FigJam, paste it onto the current page, select it, and then you can run \`set\_default\_connector({ connectorId: "SELECTED\_NODE\_ID" })\` before attempting \`create\_connections\`. **Do not proceed to Step 2 until a default connector is confirmed.**

##### 2. Filter and Transform Reactions from \`get_reactions\` Output

*   **Iterate:** Go through the JSON array provided by \`get\_reactions\`. For each node in the array:
    *   Iterate through its \`reactions\` array.
*   **Filter:** Keep only reactions where the \`action\` meets these criteria:
    *   Has a \`type\` that implies a connection (e.g., \`NAVIGATE\`, \`OPEN\_OVERLAY\`, \`SWAP\_OVERLAY\`). **Ignore** types like \`CHANGE\_TO\`, \`CLOSE\_OVERLAY\`, etc.
    *   Has a valid \`destinationId\` property.
*   **Extract:** For each valid reaction, extract the following information:
    *   \`sourceNodeId\`: The ID of the node the reaction belongs to (from the outer loop).
    *   \`destinationNodeId\`: The value of \`action.destinationId\`.
    *   \`actionType\`: The value of \`action.type\`.
    *   \`triggerType\`: The value of \`trigger.type\`.

##### 3. Generate Connector Text Labels

*   **For each extracted connection:** Create a concise, descriptive text label string.
*   **Combine Information:** Use the \`actionType\`, \`triggerType\`, and potentially the names of the source/destination nodes (obtained from Step 1's \`read\_my\_design\` or by calling \`get\_node\_info\` if necessary) to generate the label.
*   **Example Labels:**
    *   If \`triggerType\` is "ON\_CLICK" and \`actionType\` is "NAVIGATE": "On click, navigate to [Destination Node Name]"
    *   If \`triggerType\` is "ON\_DRAG" and \`actionType\` is "OPEN\_OVERLAY": "On drag, open [Destination Node Name] overlay"
*   **Keep it brief and informative.** Let this generated string be \`generatedText\`.

##### 4. Prepare the \`connections\` Array for \`create_connections\`

*   **Structure:** Create a JSON array where each element is an object representing a connection.
*   **Format:** Each object in the array must have the following structure:
    \`\`\`json
    {
    "startNodeId": "sourceNodeId_from_step_2",
    "endNodeId": "destinationNodeId_from_step_2",
    "text": "generatedText_from_step_3"
    }
    \`\`\`
*   **Result:** This final array is the value you will pass to the \`connections\` parameter when calling the \`create\_connections\` tool.

##### 5. Execute Connection Creation

*   **Action:** Call the \`create\_connections\` tool, passing the array generated in Step 4 as the \`connections\` argument.
*   **Verify:** Check the response from \`create\_connections\` to confirm success or failure.

This detailed process ensures you correctly interpret the reaction data, prepare the necessary information, and use the appropriate tools to create the connector lines.

---

## TODOs

*   [ ] Refactor the monolithic agent prompt into smaller, task-specific prompts based on this file
*   [ ] Create a new file `backend/prompts.py` to store the new modular prompts
*   [ ] Implement a mechanism for the agent to dynamically select the best prompt(s) based on user input
*   [ ] Investigate and implement the `get_team_components` tool, which is currently commented out in `plugin/code.js`
*   [ ] **NEW:** Implement a robust error handling strategy in the agent that provides clearer, user-friendly error messages when a tool fails (e.g., "Cannot add elements to this node - it doesn't support child elements. Try selecting a frame or group instead.")
*   [ ] **NEW:** Implement a mechanism to manage and recover from the `MaxTurnsExceeded` error, which can happen if the agent gets stuck in a loop of failing tool calls.
