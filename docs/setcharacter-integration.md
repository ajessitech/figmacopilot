# Integration Plan: Activating Smart Text Editing (`setCharacters`)

## 1. Objective

To fully integrate the advanced text editing capabilities of the `plugin/setcharacters.js` module with the Python agent. This will empower the agent to intelligently modify text content in Figma while preserving complex, mixed-font styling, preventing the destructive behavior of the default text-setting method.

## 2. Problem Analysis

Currently, a significant capabilities gap exists between the frontend utility and the backend agent:

- **`setcharacters.js`:** Can perform sophisticated, style-preserving text updates using strategies like `"experimental"` and `"prevail"`.
- **`plugin/code.js`:** The `setTextContent` handler (line 1387) calls `setCharacters` (line 1410) but omits the crucial `options` parameter, forcing it into a basic, style-destroying default mode.
- **`backend/figma_tools.py`:** The `set_text_content` tool (line 614) is defined with only `node_id` and `text` parameters. It is completely unaware of the "smart strategies" available on the frontend.
- **Agent (LLM):** The agent has no knowledge of this capability and cannot request it.

This plan will bridge this gap in three stages.

## 3. Implementation Plan

### Stage 1: Backend - Exposing the Capability

We will start by updating the agent's tool definition in `backend/figma_tools.py` to make it aware of the new functionality.

**File:** `backend/figma_tools.py`

1.  **Modify `set_text_content` Signature:**
    - Add a new optional parameter `smart_strategy: Optional[str] = None`. This will allow the agent to specify which styling strategy to use.

2.  **Update Docstring:**
    - The docstring is critical as it's the primary way the LLM learns how to use a tool. We will update it to explain the new parameter and its possible values (`"experimental"`, `"prevail"`, `"strict"`), clearly stating that `"experimental"` is the preferred default for preserving styles.

3.  **Update Function Body:**
    - The `params` dictionary sent to the `send_command` function must be updated to include the `smartStrategy` if it is provided.

**📝 Code Changes (`figma_tools.py`, starting around line 614):**

```python
# --- BEFORE ---
@function_tool
async def set_text_content(node_id: str, text: str) -> str:
    """
    Sets the text content of a text node.
    
    Args:
        node_id: The ID of the text node to modify
        text: New text content
    """
    try:
        logger.info(f"📝 Setting text content for node {node_id} to '{text}'")
        params = {
            "nodeId": node_id,
            "text": text
        }
        result = await send_command("set_text_content", params)
        return f"Successfully set text content..."
    # ...

# --- AFTER ---
from typing import Literal

@function_tool
async def set_text_content(
    node_id: str, 
    text: str,
    smart_strategy: Optional[Literal["experimental", "prevail", "strict"]] = None
) -> str:
    """
    Sets the text content of a text node, with an option to preserve existing styling.
    
    Args:
        node_id: The ID of the text node to modify.
        text: New text content.
        smart_strategy: Optional. The strategy for handling mixed fonts.
            - "experimental": (Recommended) Intelligently preserves style patterns like bolding and italics.
            - "prevail": Applies the most common style from the original text to the new text.
            - "strict": Tries to maintain ranges of styles.
            - If omitted, styles may be reset.
    """
    try:
        logger.info(f"📝 Setting text content for node {node_id} with strategy: {smart_strategy}")
        params = {
            "nodeId": node_id,
            "text": text
        }
        if smart_strategy:
            params["smartStrategy"] = smart_strategy
        
        result = await send_command("set_text_content", params)
        return f"Successfully set text content..."
    # ...
```

### Stage 2: Frontend - Plumbing the Parameters

Next, we will modify the plugin command handler to accept and use the new `smartStrategy` parameter.

**File:** `plugin/code.js`

1.  **Update `setTextContent` Handler:**
    - The function at **line 1387** currently destructures `nodeId` and `text` from `params`. We will update it to also destructure `smartStrategy`.
    - The call to `setCharacters` at **line 1410** will be updated to pass the new options.

**📝 Code Changes (`plugin/code.js`, starting around line 1387):**

```javascript
// --- BEFORE ---
async function setTextContent(params) {
  const { nodeId, text } = params || {};
  // ...
  try {
    // ...
    await setCharacters(node, text);
    // ...
  }
  // ...
}

// --- AFTER ---
async function setTextContent(params) {
  const { nodeId, text, smartStrategy } = params || {}; // <-- MODIFIED
  // ...
  try {
    // ...
    const options = { smartStrategy: smartStrategy }; // <-- ADDED
    await setCharacters(node, text, options); // <-- MODIFIED
    // ...
  }
  // ...
}
```

### Stage 3: Agent - Teaching the Skill

Finally, we need to instruct the agent on *when* and *why* to use this new capability. Simply exposing the tool is not enough; we must guide its reasoning.

**File:** `backend/main.py`

1.  **Update System Prompt:**
    - We will add a new point to the "Core Operating Principles" or a dedicated "Text Editing" section.
    - This instruction will tell the agent that when modifying existing text, it should **always prefer using the `"experimental"` strategy** to avoid destroying user work. It should only omit the strategy if the goal is to explicitly reset the styling.

**📝 Prompt Addition (`main.py`, within the `instructions` string around line 80):**

> **"Text Modification Principle:**
> When using the `set_text_content` tool to modify an existing text node, you **MUST** use the `smart_strategy="experimental"` parameter. This is critical to preserve the user's existing font styles (like bolding, italics, etc.). Only omit this parameter if you are intentionally resetting the text to a single, uniform style."

## 4. Success Criteria

The integration will be considered successful when the following scenario works:

1.  A user creates a text box in Figma with mixed styles (e.g., "This is **important** text.").
2.  The user tells the agent, "Change the text to 'This is **very significant** information.'"
3.  The agent correctly calls the `set_text_content` tool with `smart_strategy="experimental"`.
4.  The text on the Figma canvas updates to "This is **very significant** information," preserving the bold style on the correct words.
5.  The agent's action does not destroy the original mixed-font styling.
