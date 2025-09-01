// This is the main code file for the Cursor MCP Figma plugin
// It handles Figma API commands

// Plugin state
const state = {
  serverPort: 3055, // Default port
};


// Helper function for progress updates
function sendProgressUpdate(
  commandId,
  commandType,
  status,
  progress,
  totalItems,
  processedItems,
  message,
  payload = null
) {
  const update = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  // Add optional chunk information if present
  if (payload) {
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  return update;
}

// Show UI
figma.showUI(__html__, { width: 420, height: 640 });

// ======================================================
// Section: Selection Snapshot Utilities (Tier A)
// ======================================================
// Selection snapshot utilities (Tier A)
const selectionSummaryState = {
  lastSelectionSignature: "",
  lastDocumentInfo: null,
};

// Cache for gather_full_context results (heavy traversal)
const FULL_CONTEXT_TTL_MS = 45000; // 45s
const fullContextCache = {
  lastSignature: null,
  includeComments: true,
  data: null,
  ts: 0,
};

function debounce(fn, wait) {
  let t = null;
  return function() {
    const args = Array.prototype.slice.call(arguments);
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

function solidPaintToHex(paint) {
  try {
    if (!paint || paint.type !== "SOLID" || !paint.color) return null;
    const r = Math.round((paint.color.r || 0) * 255);
    const g = Math.round((paint.color.g || 0) * 255);
    const b = Math.round((paint.color.b || 0) * 255);
    const toHex = (v) => v.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  } catch (_) {
    return null;
  }
}

function getPrimaryFillHex(node) {
  try {
    const fills = (node.fills && Array.isArray(node.fills)) ? node.fills : [];
    for (const paint of fills) {
      if (paint.type === "SOLID") {
        const hex = solidPaintToHex(paint);
        if (hex) return hex;
      }
    }
  } catch (_) { /* noop */ }
  return null;
}

function getStrokeInfo(node) {
  try {
    const strokes = (node.strokes && Array.isArray(node.strokes)) ? node.strokes : [];
    let hex = null;
    for (const paint of strokes) {
      if (paint.type === "SOLID") {
        hex = solidPaintToHex(paint);
        if (hex) break;
      }
    }
    const weight = ("strokeWeight" in node) ? node.strokeWeight : undefined;
    return hex ? { hex, weight } : null;
  } catch (_) {
    return null;
  }
}

function getEffectsInfo(node) {
  try {
    const effects = (node.effects && Array.isArray(node.effects)) ? node.effects : [];
    const shadows = effects.filter(e => e && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"));
    return { hasShadows: shadows.length > 0, shadowCount: shadows.length };
  } catch (_) {
    return { hasShadows: false, shadowCount: 0 };
  }
}

function getLayoutGridInfo(node) {
  try {
    const grids = (node.layoutGrids && Array.isArray(node.layoutGrids)) ? node.layoutGrids : [];
    const types = Array.from(new Set(grids.map(g => g.type))).filter(Boolean);
    return { count: grids.length, types };
  } catch (_) {
    return { count: 0, types: [] };
  }
}

function isInstanceNode(node) {
  return node.type === "INSTANCE";
}

function nodeHasVariants(node) {
  try {
    if (node.type === "COMPONENT_SET") return true;
    if (node.type === "COMPONENT" && node.parent && node.parent.type === "COMPONENT_SET") return true;
    if (node.type === "INSTANCE" && node.mainComponent) {
      const mc = node.mainComponent;
      if (mc && mc.parent && mc.parent.type === "COMPONENT_SET") return true;
      if ("variantProperties" in mc && mc.variantProperties && Object.keys(mc.variantProperties).length > 0) return true;
    }
    return false;
  } catch (_) { return false; }
}

function getTextNodeMeta(node) {
  if (node.type !== "TEXT") return null;
  try {
    const text = node.characters || "";
    const textLength = text.length;
    let typography = undefined;
    try {
      if (node.fontName && typeof node.fontName === "object" && node.fontName.family) {
        const fontSize = ("fontSize" in node) ? node.fontSize : undefined;
        const fontWeight = (typeof node.fontName.style === "string") ? node.fontName.style : undefined;
        const lineHeightPx = (node.lineHeight && node.lineHeight.unit === "PIXELS") ? node.lineHeight.value : undefined;
        const letterSpacing = (node.letterSpacing && node.letterSpacing.unit === "PIXELS") ? node.letterSpacing.value : undefined;
        typography = {
          fontFamily: node.fontName.family,
          fontSize,
          fontWeight,
          lineHeightPx,
          letterSpacing,
        };
      }
    } catch (_) { /* ignore mixed or inaccessible font props */ }
    return { textLength, text, typography };
  } catch (_) {
    return { textLength: 0 };
  }
}

function getComponentInfo(node) {
  try {
    const isInstance = isInstanceNode(node);
    const info = { role: node.type, isInstance };
    if (isInstance && node.mainComponent) {
      info.mainComponent = { id: node.mainComponent.id, name: node.mainComponent.name };
    }
    return info;
  } catch (_) {
    return { role: node.type, isInstance: isInstanceNode(node) };
  }
}

function getAutoLayoutInfo(node) {
  try {
    if (!(node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET")) return undefined;
    const layoutMode = ("layoutMode" in node) ? node.layoutMode : "NONE";
    const autoLayout = {
      layoutMode,
      layoutWrap: ("layoutWrap" in node) ? node.layoutWrap : undefined,
      primaryAxisAlignItems: ("primaryAxisAlignItems" in node) ? node.primaryAxisAlignItems : undefined,
      counterAxisAlignItems: ("counterAxisAlignItems" in node) ? node.counterAxisAlignItems : undefined,
      primaryAxisSizingMode: ("primaryAxisSizingMode" in node) ? node.primaryAxisSizingMode : undefined,
      counterAxisSizingMode: ("counterAxisSizingMode" in node) ? node.counterAxisSizingMode : undefined,
      paddingTop: ("paddingTop" in node) ? node.paddingTop : undefined,
      paddingRight: ("paddingRight" in node) ? node.paddingRight : undefined,
      paddingBottom: ("paddingBottom" in node) ? node.paddingBottom : undefined,
      paddingLeft: ("paddingLeft" in node) ? node.paddingLeft : undefined,
      itemSpacing: ("itemSpacing" in node) ? node.itemSpacing : undefined,
    };
    return autoLayout;
  } catch (_) {
    return undefined;
  }
}

function getStyleRefs(node) {
  const refs = {};
  if ("fillStyleId" in node) refs.fillStyleId = node.fillStyleId;
  if ("strokeStyleId" in node) refs.strokeStyleId = node.strokeStyleId;
  if ("effectStyleId" in node) refs.effectStyleId = node.effectStyleId;
  if (node.type === "TEXT" && "textStyleId" in node) refs.textStyleId = node.textStyleId;
  return refs;
}

function getTokensPresence(node) {
  try {
    const bound = node.boundVariables || {};
    const hasFillVariables = !!bound.fills;
    const hasTextVariables = node.type === "TEXT" && (
      !!bound.characters || !!bound.fills || !!bound.fontSize || !!bound.lineHeight || !!bound.letterSpacing
    );
    return { hasFillVariables: !!hasFillVariables, hasTextVariables: !!hasTextVariables };
  } catch (_) { return { hasFillVariables: false, hasTextVariables: false }; }
}

function getHierarchyInfo(node) {
  try {
    const parent = node.parent;
    const index = parent && parent.children ? parent.children.indexOf(node) : -1;
    const childCount = ("children" in node && Array.isArray(node.children)) ? node.children.length : 0;
    const parentType = parent ? parent.type : "PAGE";
    const parentName = parent ? parent.name : figma.currentPage.name;
    const parentId = parent ? parent.id : figma.currentPage.id;
    return { parentId, parentType, parentName, index, childCount };
  } catch (_) {
    return { parentId: figma.currentPage.id, parentType: "PAGE", parentName: figma.currentPage.name, index: -1, childCount: 0 };
  }
}

function getGeometryInfo(node) {
  try {
    const rotation = ("rotation" in node) ? node.rotation : 0;
    return { x: node.x, y: node.y, width: node.width, height: node.height, rotation };
  } catch (_) {
    return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  }
}

function getConstraintsInfo(node) {
  try {
    const c = ("constraints" in node) ? node.constraints : undefined;
    if (!c) return undefined;
    return { horizontal: c.horizontal, vertical: c.vertical };
  } catch (_) { return undefined; }
}

function getSampleChildren(node) {
  try {
    if (!("children" in node) || !Array.isArray(node.children)) return [];
    const samples = [];
    for (let i = 0; i < Math.min(12, node.children.length); i++) {
      const child = node.children[i];
      const entry = { id: child.id, type: child.type, width: child.width, height: child.height };
      if (child.type === "TEXT") entry.hasText = !!child.characters && child.characters.length > 0;
      samples.push(entry);
    }
    return samples;
  } catch (_) { return []; }
}

function collectNodeSummary(node) {
  const identity = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false, locked: !!node.locked };
  const geometry = getGeometryInfo(node);
  const hierarchy = getHierarchyInfo(node);
  const constraints = getConstraintsInfo(node);
  const autoLayout = getAutoLayoutInfo(node);
  const component = getComponentInfo(node);
  const fills = getPrimaryFillHex(node) ? [{ hex: getPrimaryFillHex(node) }] : [];
  const stroke = getStrokeInfo(node);
  const effects = getEffectsInfo(node);
  const styleRefs = getStyleRefs(node);
  const tokensPresence = getTokensPresence(node);
  const layoutGrids = getLayoutGridInfo(node);
  const sampleChildren = getSampleChildren(node);

  let out = {
    id: identity.id,
    name: identity.name,
    type: identity.type,
    visible: identity.visible,
    locked: identity.locked,
    geometry: geometry,
    hierarchy: hierarchy,
    constraints: constraints,
    autoLayout: autoLayout,
    component: component,
    fills: fills,
    stroke: stroke,
    effects: effects,
    styleRefs: styleRefs,
    tokensPresence: tokensPresence,
    layoutGrids: layoutGrids,
    sampleChildren: sampleChildren,
  };

  if (node.type === "TEXT") {
    const textMeta = getTextNodeMeta(node);
    out.textMeta = { textLength: (textMeta && textMeta.textLength) || 0 };
    if (textMeta && typeof textMeta.text === "string") {
      const totalLength = textMeta.text.length;
      const cap = 1200;
      if (totalLength <= cap) {
        out.text = textMeta.text;
      } else {
        const headLen = Math.floor(cap * 0.8);
        const tailLen = cap - headLen;
        out.text = textMeta.text.slice(0, headLen) + "…" + textMeta.text.slice(-tailLen);
        out.textTruncation = { truncated: true, totalLength };
      }
      if (textMeta.typography) out.typography = textMeta.typography;
    }
  }

  return out;
}

function computeSelectionSignature(nodes) {
  try {
    const tuples = nodes.map((n) => {
      const isInstance = n.type === "INSTANCE";
      const isText = n.type === "TEXT";
      const textLen = isText ? (n.characters ? n.characters.length : 0) : 0;
      const rot = ("rotation" in n) ? n.rotation : 0;
      return `${n.id}:${n.type}:${Math.round(n.x)}:${Math.round(n.y)}:${Math.round(n.width)}:${Math.round(n.height)}:${Math.round(rot)}:${textLen}:${isInstance ? 1 : 0}`;
    }).sort();
    const input = `${figma.currentPage.id}|${tuples.join("|")}`;
    // DJB2 hash
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash) + input.charCodeAt(i);
      hash |= 0; // force 32-bit
    }
    return `sig_${Math.abs(hash)}`;
  } catch (e) {
    return `sig_error_${Date.now()}`;
  }
}

function buildSelectionSummary(selectedNodes) {
  const nodes = selectedNodes.map(collectNodeSummary);
  const typesCount = {};
  let hasInstances = false;
  let hasVariants = false;
  let hasAutoLayout = false;
  let stickyNoteCount = 0;
  let totalTextChars = 0;
  for (const n of selectedNodes) {
    typesCount[n.type] = (typesCount[n.type] || 0) + 1;
    if (n.type === "INSTANCE") hasInstances = true;
    if (nodeHasVariants(n)) hasVariants = true;
    if (("layoutMode" in n) && n.layoutMode && n.layoutMode !== "NONE") hasAutoLayout = true;
    if (n.type === "STICKY") stickyNoteCount += 1;
    if (n.type === "TEXT") totalTextChars += (n.characters ? n.characters.length : 0);
  }
  return {
    selectionCount: selectedNodes.length,
    typesCount,
    hints: { hasInstances, hasVariants, hasAutoLayout, stickyNoteCount, totalTextChars },
    nodes,
  };
}

function postDocumentInfo() {
  const pageId = figma.currentPage.id;
  const pageName = figma.currentPage.name;
  selectionSummaryState.lastDocumentInfo = { pageId, pageName };
  figma.ui.postMessage({ type: "document_info", pageId, pageName });
}

const handleSelectionChange = debounce(() => {
  try {
    const sel = figma.currentPage.selection || [];
    const selectionSignature = computeSelectionSignature(sel);
    const selectionSummary = buildSelectionSummary(sel);
    const document = selectionSummaryState.lastDocumentInfo || { pageId: figma.currentPage.id, pageName: figma.currentPage.name };
    selectionSummaryState.lastSelectionSignature = selectionSignature;
    figma.ui.postMessage({
      type: "selection_summary",
      document,
      selectionSignature,
      selectionSummary,
    });
    // Emoji log per user preference
    console.log(`🧩 Selection summary sent (${selectionSummary.selectionCount} nodes)`);
  } catch (e) {
    console.warn("Failed to build selection summary", e);
  }
}, 200);

figma.on("run", () => {
  postDocumentInfo();
  // Emit initial selection summary on run as a convenience
  // No automatic selection summary; selections are only sent on explicit request
  // Auto-connect UI bridge on run
  try { figma.ui.postMessage({ type: "auto-connect" }); } catch (_) {}
});

// Re-enable lightweight selection summary broadcasting so UI can invalidate cache
figma.on("selectionchange", handleSelectionChange);
figma.on("currentpagechange", () => {
  try { postDocumentInfo(); } catch (_) {}
  try { handleSelectionChange(); } catch (_) {}
});

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        // Send result back to UI
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
    
    case "ui_ready":
      // UI loaded and ready to receive snapshot → resend immediately
      try {
        postDocumentInfo();
      } catch (e) {
        console.warn("Failed to send initial snapshot on ui_ready", e);
      }
      break;

    
      
    // Tool execution using existing command registry infrastructure
    case "tool_call":
      // Reuse existing execute-command infrastructure
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "tool_response",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "tool_response", 
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
    case "request_selections_context":
      try {
        const result = await selectionsContext({
          mode: msg.mode || 'snapshot',
          includeComments: msg.includeComments,
          force: msg.force === true,
        });
        figma.ui.postMessage({ type: 'selections_context', result });
      } catch (e) {
        figma.ui.postMessage({ type: 'selections_context_error', error: (e && e.message) || String(e) });
      }
      break;
    default:
      // ignore unknown UI messages
      break;
  }
};

 

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// ======================================================
// Command Registry & Registration
// ======================================================
const commandRegistry = new Map();
let commandsRegistered = false;
function registerDefaultCommands() {
  if (commandsRegistered) return;
  commandsRegistered = true;
  // Core document/selection
  commandRegistry.set("get_document_info", getDocumentInfo);
  commandRegistry.set("get_selection", getSelection);
  commandRegistry.set("get_node_info", (p) => getNodeInfo(p.nodeId));
  commandRegistry.set("get_nodes_info", (p) => getNodesInfo(p.nodeIds));
  // Context
  commandRegistry.set("selections_context", selectionsContext);
  commandRegistry.set("gather_full_context", (p) => selectionsContext({ mode: 'complete', includeComments: p && p.includeComments !== false, force: p && p.force === true }));
  // Create & edit
  commandRegistry.set("create_rectangle", createRectangle);
  commandRegistry.set("create_frame", createFrame);
  commandRegistry.set("create_text", createText);
  commandRegistry.set("set_text_content", setTextContent);
  commandRegistry.set("set_fill_color", setFillColor);
  commandRegistry.set("set_stroke_color", setStrokeColor);
  commandRegistry.set("set_corner_radius", setCornerRadius);
  commandRegistry.set("move_node", moveNode);
  commandRegistry.set("resize_node", resizeNode);
  commandRegistry.set("delete_node", deleteNode);
  commandRegistry.set("delete_multiple_nodes", deleteMultipleNodes);
  commandRegistry.set("clone_node", cloneNode);
  // Layout
  commandRegistry.set("set_layout_mode", setLayoutMode);
  commandRegistry.set("set_padding", setPadding);
  commandRegistry.set("set_axis_align", setAxisAlign);
  commandRegistry.set("set_layout_sizing", setLayoutSizing);
  commandRegistry.set("set_item_spacing", setItemSpacing);
  // Components
  commandRegistry.set("get_local_components", getLocalComponents);
  commandRegistry.set("create_component_instance", createComponentInstance);
  commandRegistry.set("create_component", createComponent);
  commandRegistry.set("publish_components", publishComponents);
  commandRegistry.set("get_instance_overrides", async (p) => {
    try {
      if (p && p.instanceNodeId) {
        const instanceNode = await figma.getNodeByIdAsync(p.instanceNodeId);
        if (!instanceNode) {
          const payload = { code: "node_not_found", message: "Instance node not found", details: { nodeId: p.instanceNodeId } };
          logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
        return await getInstanceOverrides(instanceNode);
      }
      return await getInstanceOverrides();
    } catch (error) {
      try {
        const maybe = JSON.parse(error && error.message ? error.message : String(error));
        if (maybe && maybe.code) throw error;
      } catch (_) {}
      const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
      logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
  });
  commandRegistry.set("set_instance_overrides", async (p) => {
    try {
      if (!(p && p.targetNodeIds)) {
        const payload = { code: "missing_parameter", message: "Missing targetNodeIds parameter", details: {} };
        logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (!Array.isArray(p.targetNodeIds)) {
        const payload = { code: "invalid_parameter", message: "targetNodeIds must be an array", details: { receivedType: typeof p.targetNodeIds } };
        logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      const targetNodes = await getValidTargetInstances(p.targetNodeIds);
      if (!targetNodes.success) {
        const payload = { code: "no_valid_instances", message: targetNodes.message || "No valid instances provided", details: { targetNodeIds: p.targetNodeIds } };
        logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (!p.sourceInstanceId) {
        const payload = { code: "missing_parameter", message: "Missing sourceInstanceId parameter", details: {} };
        logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      const sourceInstanceData = await getSourceInstanceData(p.sourceInstanceId);
      if (!sourceInstanceData.success) {
        const payload = { code: "source_instance_invalid", message: sourceInstanceData.message || "Invalid source instance", details: { sourceInstanceId: p.sourceInstanceId } };
        logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      return await setInstanceOverrides(targetNodes.targetInstances, sourceInstanceData, p || {});
    } catch (error) {
      try {
        const maybe = JSON.parse(error && error.message ? error.message : String(error));
        if (maybe && maybe.code) throw error;
      } catch (_) {}
      const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
      logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
  });
  // Text batch ops
  commandRegistry.set("scan_text_nodes", scanTextNodes);
  // Analysis / inspection
  commandRegistry.set("scan_nodes_by_types", scanNodesByTypes);
  commandRegistry.set("set_multiple_text_contents", setMultipleTextContents);
  // Grouping / parentage
  commandRegistry.set("group", group);
  commandRegistry.set("ungroup", ungroup);
  commandRegistry.set("reparent", reparent);
  commandRegistry.set("insert_child", insertChild);
  // Viewport
  commandRegistry.set("zoom", zoom);
  commandRegistry.set("center", center);
  commandRegistry.set("scroll_and_zoom_into_view", scrollAndZoomIntoView);
  // Assets
  commandRegistry.set("export_node_as_image", exportNodeAsImage);
  commandRegistry.set("create_image", createImage);
  commandRegistry.set("get_image_by_hash", getImageByHash);
  // Styles
  commandRegistry.set("get_styles", getStyles);
  commandRegistry.set("set_gradient_fill", setGradientFill);
  commandRegistry.set("set_range_text_style", setRangeTextStyle);
  commandRegistry.set("list_available_fonts", listAvailableFonts);
  // Style creation
  commandRegistry.set("create_paint_style", createPaintStyle);
  commandRegistry.set("create_text_style", createTextStyle);
  commandRegistry.set("create_effect_style", createEffectStyle);
  commandRegistry.set("create_grid_style", createGridStyle);
  // Comments (read-only)
  commandRegistry.set("get_comments", getComments);
  // Prototyping & analysis
  commandRegistry.set("read_my_design", () => readMyDesign());
  commandRegistry.set("get_reactions", (p) => getReactions(p && p.nodeIds, p && p.silent === true));
}

// ======================================================
// Command Router
// ======================================================
async function handleCommand(command, params) {
  registerDefaultCommands();

  // Resolve the action/handler to execute
  let action = null;
  const handler = commandRegistry.get(command);
  if (handler) {
    action = () => handler(params || {});
  } else {
    switch (command) {
      case "create_rectangle":
        action = () => createRectangle(params);
        break;
      case "delete_node":
        action = () => deleteNode(params);
        break;
      case "get_styles":
        action = () => getStyles(params);
        break;
      // case "get_team_components":
      //   action = () => getTeamComponents();

      case "set_text_content":
        action = () => setTextContent(params);
        break;
      case "clone_node":
        action = () => cloneNode(params);
        break;
      case "set_layout_mode":
        action = () => setLayoutMode(params);
        break;
      case "set_padding":
        action = () => setPadding(params);
        break;
      case "set_axis_align":
        action = () => setAxisAlign(params);
        break;
      case "set_layout_sizing":
        action = () => setLayoutSizing(params);
        break;
      case "set_item_spacing":
        action = () => setItemSpacing(params);
        break;
      
      
      case "create_image":
        action = () => createImage(params);
        break;
      case "get_image_by_hash":
        action = () => getImageByHash(params);
        break;
      
      case "selections_context":
        action = () => selectionsContext(params);
        break;
      case "gather_full_context":
        // Back-compat: map to selections_context complete mode
        action = () => selectionsContext({
          mode: 'complete',
          includeComments: params && params.includeComments !== false,
          force: params && params.force === true,
        });
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  // Compute a human-friendly step label for logging/undo grouping
  const stepLabel = (params && (params.stepLabel || params.label || params.name || params.toolName)) || command;

  // Avoid redundant reveal for viewport-only commands
  const viewportOnly = new Set(["zoom", "center", "scroll_and_zoom_into_view"]);
  const autoReveal = !(params && params.autoReveal === false) && !viewportOnly.has(command);

  // Wrap the execution in an undo group for atomic step semantics and UX reveal
  return await withUndoGroup(stepLabel, async () => {
    return await action();
  }, { autoReveal });
}

// ======================================================
// Tools: Implementations (organized by category)
// ======================================================
// Lightweight logger abstraction for consistent, emoji-friendly logs
const logger = {
  info: (message, context) => {
    try { console.log(`🧠 ${message}`, context ? context : ""); } catch (_) {}
  },
  error: (message, context) => {
    try { console.error(`❌ ${message}`, context ? context : ""); } catch (_) {}
  },
};

// ======================================================
// Undo Group Wrapper: withUndoGroup(label, actions, options)
// - Ensures step-level logging
// - Optionally reveals first affected node for UX via scrollAndZoomIntoView
// - Does NOT call figma.commitUndo() automatically (split only when intentional)
// ======================================================
async function withUndoGroup(label, actions, options) {
  const opts = options || {};
  const reveal = opts.autoReveal !== false;
  const log = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : logger;
  log.info(`▶️ Step start`, { label });
  try {
    const result = await actions();

    // Determine first affected node id, if any
    let firstAffectedId = null;
    if (result && typeof result === 'object') {
      if (Array.isArray(result.modifiedNodeIds) && result.modifiedNodeIds.length > 0) {
        firstAffectedId = result.modifiedNodeIds[0];
      } else if (result.node && result.node.id) {
        firstAffectedId = result.node.id;
      } else if (result.nodeId) {
        firstAffectedId = result.nodeId;
      } else if (result.createdNodeId) {
        firstAffectedId = result.createdNodeId;
      } else if (Array.isArray(result.resolvedNodeIds) && result.resolvedNodeIds.length > 0) {
        firstAffectedId = result.resolvedNodeIds[0];
      }
    }

    if (reveal && firstAffectedId) {
      try {
        const node = await figma.getNodeByIdAsync(firstAffectedId);
        if (node) {
          // Best-effort: switch page if target is on a different page
          let p = node.parent;
          while (p && p.type !== 'PAGE') p = p.parent;
          if (p && p.id && figma.currentPage && p.id !== figma.currentPage.id) {
            try { figma.currentPage = p; } catch (_) {}
          }
          try { figma.currentPage.selection = [node]; } catch (_) {}
          try { figma.viewport.scrollAndZoomIntoView([node]); } catch (_) {}
        }
      } catch (_) {}
    }

    log.info(`✅ Step success`, { label });
    return result;
  } catch (error) {
    log.error(`❌ Step failed`, { label, error: (error && error.message) || String(error) });
    throw error;
  }
}

// ======================================================
// Section: Core Document & Selection
// ======================================================
// -------- TOOL : get_document_info --------
async function getDocumentInfo() {
  try {
    await figma.currentPage.loadAsync();
    const page = figma.currentPage;
    const payload = {
      name: page.name,
      id: page.id,
      type: page.type,
      children: page.children.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
      })),
      currentPage: {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
      pages: [
        {
          id: page.id,
          name: page.name,
          childCount: page.children.length,
        },
      ],
    };
    logger.info("get_document_info succeeded", { pageId: page.id, pageName: page.name, childCount: page.children.length });
    return payload;
  } catch (error) {
    logger.error("get_document_info failed", { code: "page_load_failed", originalError: (error && error.message) || String(error) });
    throw new Error(JSON.stringify({
      code: "page_load_failed",
      message: `Failed to read document info: ${error && error.message ? error.message : String(error)}`,
      details: {}
    }));
  }
}

// -------- TOOL : get_selection --------
async function getSelection(params = {}) {
  try {
    const payload = {
      selectionCount: figma.currentPage.selection.length,
      selection: figma.currentPage.selection.map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible,
      })),
    };
    logger.info("✅ get_selection succeeded", { selectionCount: payload.selectionCount });
    return payload;
  } catch (error) {
    logger.error("❌ get_selection failed", { code: "selection_read_failed", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({
      code: "selection_read_failed",
      message: `Failed to read selection: ${error && error.message ? error.message : String(error)}`,
      details: {}
    }));
  }
}

// ------------------------- Helpers: Color and Node Filtering -------------------------
function rgbaToHex(color) {
  var r = Math.round(color.r * 255);
  var g = Math.round(color.g * 255);
  var b = Math.round(color.b * 255);
  var a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  return (
    "#" +
    [r, g, b, a]
      .map((x) => {
        return x.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

function filterFigmaNode(node) {
  if (node.type === "VECTOR") {
    return null;
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      var processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop) => {
            var processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            delete processedStop.boundVariables;
            return processedStop;
          }
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      var processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child) => {
        return filterFigmaNode(child);
      })
      .filter((child) => {
        return child !== null;
      });
  }

  return filtered;
}

// -------- TOOL : get_node_info --------
async function getNodeInfo(nodeId) {
  try {
    if (!nodeId || typeof nodeId !== "string") {
      logger.error("❌ get_node_info failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
      throw new Error(JSON.stringify({
        code: "missing_parameter",
        message: "Parameter 'nodeId' is required",
        details: { nodeId }
      }));
    }

    const node = await figma.getNodeByIdAsync(nodeId);

    if (!node) {
      logger.error("❌ get_node_info failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
      throw new Error(JSON.stringify({
        code: "node_not_found",
        message: `Node not found: ${nodeId}`,
        details: { nodeId }
      }));
    }

    let response;
    try {
      response = await node.exportAsync({
        format: "JSON_REST_V1",
      });
    } catch (exportErr) {
      logger.error("❌ get_node_info failed", { code: "export_failed", originalError: (exportErr && exportErr.message) || String(exportErr), details: { nodeId } });
      throw new Error(JSON.stringify({
        code: "export_failed",
        message: `Failed to export node JSON for ${nodeId}`,
        details: { nodeId }
      }));
    }

    const document = filterFigmaNode(response.document);
    logger.info("✅ get_node_info succeeded", { nodeId, type: response && response.document && response.document.type, name: response && response.document && response.document.name });
    return document;
  } catch (error) {
    // If error is already structured, rethrow; else normalize
    try {
      const parsed = JSON.parse(error && error.message ? error.message : "{}");
      if (parsed && parsed.code) {
        throw error; // already structured
      }
    } catch (_) {
      // not JSON, normalize to structured error
      logger.error("❌ get_node_info failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: { nodeId } });
      throw new Error(JSON.stringify({
        code: "unknown_plugin_error",
        message: (error && error.message) || "Unknown error in get_node_info",
        details: { nodeId }
      }));
    }
    throw error;
  }
}

// -------- TOOL : get_nodes_info --------
async function getNodesInfo(nodeIds) {
  try {
    // Validate params
    if (!nodeIds) {
      logger.error("❌ get_nodes_info failed", { code: "missing_parameter", originalError: "nodeIds is required", details: { nodeIds } });
      throw new Error(JSON.stringify({
        code: "missing_parameter",
        message: "Parameter 'nodeIds' is required",
        details: { nodeIds }
      }));
    }
    if (!Array.isArray(nodeIds)) {
      logger.error("❌ get_nodes_info failed", { code: "invalid_parameter", originalError: "nodeIds must be an array of strings", details: { nodeIds } });
      throw new Error(JSON.stringify({
        code: "invalid_parameter",
        message: "Parameter 'nodeIds' must be an array of strings",
        details: { nodeIds }
      }));
    }
    const invalidTypeIndices = [];
    for (let i = 0; i < nodeIds.length; i++) {
      if (typeof nodeIds[i] !== "string") invalidTypeIndices.push(i);
    }
    if (invalidTypeIndices.length > 0) {
      logger.error("❌ get_nodes_info failed", { code: "invalid_parameter", originalError: "nodeIds contains non-string entries", details: { invalidTypeIndices } });
      throw new Error(JSON.stringify({
        code: "invalid_parameter",
        message: "Parameter 'nodeIds' must contain only strings",
        details: { invalidTypeIndices }
      }));
    }
    if (nodeIds.length === 0) {
      logger.error("❌ get_nodes_info failed", { code: "missing_parameter", originalError: "nodeIds is empty", details: {} });
      throw new Error(JSON.stringify({
        code: "missing_parameter",
        message: "Parameter 'nodeIds' must include at least one id",
        details: {}
      }));
    }

    // Build per-id tasks to preserve order and capture per-item errors
    const results = await Promise.all(
      nodeIds.map(async (id) => {
        try {
          const node = await figma.getNodeByIdAsync(id);
          if (!node) {
            return { nodeId: id, document: null, error: { code: "node_not_found", message: `Node not found: ${id}` } };
          }
          try {
            const response = await node.exportAsync({ format: "JSON_REST_V1" });
            return { nodeId: node.id, document: filterFigmaNode(response.document) };
          } catch (exportErr) {
            return { nodeId: id, document: null, error: { code: "export_failed", message: (exportErr && exportErr.message) || String(exportErr) } };
          }
        } catch (e) {
          // Unexpected failure resolving the node
          return { nodeId: id, document: null, error: { code: "unknown_plugin_error", message: (e && e.message) || String(e) } };
        }
      })
    );

    const missingNodeIds = results.filter(r => r.error && r.error.code === "node_not_found").map(r => r.nodeId);
    const exportFailedNodeIds = results.filter(r => r.error && r.error.code === "export_failed").map(r => r.nodeId);
    const successCount = results.filter(r => r.document != null).length;

    if (successCount === 0) {
      logger.error("❌ get_nodes_info failed", { code: "no_valid_nodes", originalError: "No nodes could be resolved or exported", details: { requested: nodeIds.length, missingNodeIds, exportFailedNodeIds } });
      throw new Error(JSON.stringify({
        code: "no_valid_nodes",
        message: "No requested nodes could be resolved or exported",
        details: { requested: nodeIds.length, missingNodeIds, exportFailedNodeIds }
      }));
    }

    logger.info("✅ get_nodes_info succeeded", { requested: nodeIds.length, succeeded: successCount, missing: missingNodeIds.length, exportFailed: exportFailedNodeIds.length });
    return results;
  } catch (error) {
    // If already structured JSON, rethrow; else normalize
    try {
      const parsed = JSON.parse(error && error.message ? error.message : "{}");
      if (parsed && parsed.code) {
        throw error;
      }
    } catch (_) {
      logger.error("❌ get_nodes_info failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: { count: Array.isArray(nodeIds) ? nodeIds.length : undefined } });
      throw new Error(JSON.stringify({
        code: "unknown_plugin_error",
        message: (error && error.message) || "Unknown error in get_nodes_info",
        details: { count: Array.isArray(nodeIds) ? nodeIds.length : undefined }
      }));
    }
    throw error;
  }
}

// ======================================================
// Section: Prototyping & Reactions
// ======================================================
// -------- TOOL : get_reactions --------
async function getReactions(nodeIds, silent = false) {
  try {
    // Validate parameters
    if (!Array.isArray(nodeIds)) {
      logger.error("❌ get_reactions failed", { code: "invalid_parameter", originalError: "'nodeIds' must be an array of strings", details: { nodeIds } });
      throw new Error(JSON.stringify({
        code: "invalid_parameter",
        message: "Parameter 'nodeIds' must be a non-empty array of strings",
        details: { provided: nodeIds }
      }));
    }
    if (nodeIds.length === 0) {
      logger.error("❌ get_reactions failed", { code: "missing_parameter", originalError: "nodeIds is empty", details: {} });
      throw new Error(JSON.stringify({
        code: "missing_parameter",
        message: "Parameter 'nodeIds' must include at least one id",
        details: {}
      }));
    }
    const invalidTypeIndices = [];
    for (let i = 0; i < nodeIds.length; i++) {
      if (typeof nodeIds[i] !== "string") invalidTypeIndices.push(i);
    }
    if (invalidTypeIndices.length > 0) {
      logger.error("❌ get_reactions failed", { code: "invalid_parameter", originalError: "nodeIds contains non-string entries", details: { invalidTypeIndices } });
      throw new Error(JSON.stringify({
        code: "invalid_parameter",
        message: "Parameter 'nodeIds' must contain only strings",
        details: { invalidTypeIndices }
      }));
    }

    const commandId = generateCommandId();
    sendProgressUpdate(
      commandId,
      "get_reactions",
      "started",
      0,
      nodeIds.length,
      0,
      `Starting deep search for reactions in ${nodeIds.length} nodes and their children`
    );

    // Helper: find nodes with reactions recursively
    async function findNodesWithReactions(node, processedNodes = new Set(), depth = 0, results = []) {
      if (processedNodes.has(node.id)) return results;
      processedNodes.add(node.id);

      let filteredReactions = [];
      if (node.reactions && node.reactions.length > 0) {
        filteredReactions = node.reactions.filter(r => {
          if (r.action && r.action.navigation === 'CHANGE_TO') return false;
          if (Array.isArray(r.actions)) return !r.actions.some(a => a.navigation === 'CHANGE_TO');
          return true;
        });
      }
      const hasFilteredReactions = filteredReactions.length > 0;

      if (hasFilteredReactions) {
        results.push({
          id: node.id,
          name: node.name,
          type: node.type,
          depth: depth,
          hasReactions: true,
          reactions: filteredReactions,
          path: getNodePath(node)
        });
        if (!silent) {
          try { await highlightNodeWithAnimation(node); } catch (_) {}
        }
      }

      if (node.children) {
        for (const child of node.children) {
          await findNodesWithReactions(child, processedNodes, depth + 1, results);
        }
      }
      return results;
    }

    // Helper: animated highlight
    async function highlightNodeWithAnimation(node) {
      const originalStrokeWeight = node.strokeWeight;
      const originalStrokes = node.strokes ? node.strokes.slice() : [];
      try {
        node.strokeWeight = 4;
        node.strokes = [{
          type: 'SOLID',
          color: { r: 1, g: 0.5, b: 0 },
          opacity: 0.8
        }];
        setTimeout(() => {
          try {
            node.strokeWeight = originalStrokeWeight;
            node.strokes = originalStrokes;
          } catch (restoreError) {
            console.error(`Error restoring node stroke: ${restoreError.message}`);
          }
        }, 1500);
      } catch (highlightError) {
        console.error(`Error highlighting node: ${highlightError.message}`);
      }
    }

    function getNodePath(node) {
      const path = [];
      let current = node;
      while (current && current.parent) {
        path.unshift(current.name);
        current = current.parent;
      }
      return path.join(' > ');
    }

    let allResults = [];
    let processedCount = 0;
    const totalCount = nodeIds.length;
    const notFoundNodeIds = [];

    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const nodeId = nodeIds[i];
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
          notFoundNodeIds.push(nodeId);
          processedCount++;
          sendProgressUpdate(
            commandId,
            "get_reactions",
            "in_progress",
            processedCount / totalCount,
            totalCount,
            processedCount,
            `Node not found: ${nodeId}`
          );
          continue;
        }
        const processedNodes = new Set();
        const nodeResults = await findNodesWithReactions(node, processedNodes);
        allResults = allResults.concat(nodeResults);
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Processed node ${processedCount}/${totalCount}, found ${nodeResults.length} nodes with reactions`
        );
      } catch (error) {
        processedCount++;
        sendProgressUpdate(
          commandId,
          "get_reactions",
          "in_progress",
          processedCount / totalCount,
          totalCount,
          processedCount,
          `Error processing node: ${error && error.message ? error.message : String(error)}`
        );
      }
    }

    sendProgressUpdate(
      commandId,
      "get_reactions",
      "completed",
      1,
      totalCount,
      totalCount,
      `Completed deep search: found ${allResults.length} nodes with reactions.`
    );

    const result = {
      nodesCount: nodeIds.length,
      nodesWithReactions: allResults.length,
      nodes: allResults
    };
    logger.info("✅ get_reactions succeeded", { nodesCount: result.nodesCount, nodesWithReactions: result.nodesWithReactions, notFound: notFoundNodeIds.length });
    return result;
  } catch (error) {
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ get_reactions failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // not a structured error, normalize
    }
    logger.error("❌ get_reactions failed", { code: "get_reactions_failed", originalError: (error && error.message) || String(error), details: { count: Array.isArray(nodeIds) ? nodeIds.length : undefined } });
    throw new Error(JSON.stringify({
      code: "get_reactions_failed",
      message: `Failed to get reactions: ${error && error.message ? error.message : String(error)}`,
      details: { count: Array.isArray(nodeIds) ? nodeIds.length : undefined }
    }));
  }
}

// -------- TOOL : read_my_design --------
async function readMyDesign() {
  try {
    const selection = figma.currentPage.selection || [];
    if (selection.length === 0) {
      logger.info("✅ read_my_design succeeded", { selectionCount: 0 });
      return [];
    }

    const results = await Promise.allSettled(
      selection.map(async (node) => {
        const n = await figma.getNodeByIdAsync(node.id);
        if (!n) {
          return { nodeId: node.id, document: null, error: { code: "node_not_found", message: `Node not found: ${node.id}` } };
        }
        const response = await n.exportAsync({ format: "JSON_REST_V1" });
        return { nodeId: n.id, document: filterFigmaNode(response.document) };
      })
    );

    const mapped = results.map((res, idx) => {
      if (res.status === "fulfilled") return res.value;
      return {
        nodeId: selection[idx].id,
        document: null,
        error: { code: "export_failed", message: res.reason && res.reason.message ? res.reason.message : String(res.reason) }
      };
    });

    const okCount = mapped.filter(e => e.document != null).length;
    logger.info("✅ read_my_design succeeded", { selectionCount: selection.length, successCount: okCount, failedCount: selection.length - okCount });
    return mapped;
  } catch (error) {
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ read_my_design failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // fall-through to normalized error
    }
    logger.error("❌ read_my_design failed", { code: "read_my_design_failed", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({
      code: "read_my_design_failed",
      message: `Failed to read design: ${error && error.message ? error.message : String(error)}`,
      details: {}
    }));
  }
}

// ======================================================
// Section: Creation & Editing
// ======================================================
// -------- TOOL : create_rectangle --------
async function createRectangle(params) {
  const toNumber = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const makeSolidPaint = (color) => {
    if (!color || typeof color !== "object") {
      throw new Error(
        JSON.stringify({ code: "invalid_fills", message: "Invalid fill color object", details: { color } })
      );
    }
    const r = clamp01(toNumber(color.r, NaN));
    const g = clamp01(toNumber(color.g, NaN));
    const b = clamp01(toNumber(color.b, NaN));
    const a = clamp01(
      toNumber((color.a === null || color.a === undefined) ? 1 : color.a, 1)
    );
    if ([r, g, b, a].some((v) => !Number.isFinite(v))) {
      throw new Error(
        JSON.stringify({ code: "invalid_fills", message: "Color components must be numbers in [0,1]", details: { color } })
      );
    }
    return [{ type: "SOLID", color: { r, g, b }, opacity: a }];
  };

  try {
    const {
      x = 0,
      y = 0,
      width = 100,
      height = 100,
      name = "Rectangle",
      parentId,
      // Styling
      fill, // { r,g,b,a? } in [0,1]
      stroke, // { r,g,b,a? } in [0,1]
      strokeWeight,
      strokeAlign, // 'CENTER' | 'INSIDE' | 'OUTSIDE'
      // Corners
      cornerRadius, // uniform
      topLeftRadius,
      topRightRadius,
      bottomLeftRadius,
      bottomRightRadius,
      // Misc geometry
      rotation,
      opacity,
      // Visibility/locking
      visible,
      locked,
      // Layout
      layoutAlign, // 'MIN'|'CENTER'|'MAX'|'STRETCH'|'INHERIT'
      constraints, // { horizontal: 'MIN'|'CENTER'|'MAX'|'STRETCH'|'SCALE', vertical: same }
      // UX helpers
      select: shouldSelect = false,
    } = params || {};

    // Basic validation
    const w = toNumber(width, NaN);
    const h = toNumber(height, NaN);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      logger.error("❌ create_rectangle failed", { code: "invalid_size", originalError: "Width/height must be positive numbers", details: { width, height } });
      throw new Error(
        JSON.stringify({ code: "invalid_size", message: "Width/height must be positive numbers", details: { width, height } })
      );
    }

    const rect = figma.createRectangle();
    rect.x = toNumber(x, 0);
    rect.y = toNumber(y, 0);
    rect.resize(w, h);
    rect.name = typeof name === "string" && name.length ? name : "Rectangle";

    // Styling
    if (fill) {
      try {
        rect.fills = makeSolidPaint(fill);
      } catch (err) {
        const originalError = (err && err.message) || String(err);
        logger.error("❌ create_rectangle failed", { code: "invalid_fills", originalError, details: { fill } });
        throw new Error(
          JSON.stringify({ code: "invalid_fills", message: "Failed to apply fill", details: { fill } })
        );
      }
    }
    if (stroke) {
      try {
        rect.strokes = makeSolidPaint(stroke);
      } catch (err) {
        const originalError = (err && err.message) || String(err);
        logger.error("❌ create_rectangle failed", { code: "invalid_strokes", originalError, details: { stroke } });
        throw new Error(
          JSON.stringify({ code: "invalid_strokes", message: "Failed to apply stroke", details: { stroke } })
        );
      }
    }
    if (strokeWeight !== undefined) {
      const sw = toNumber(strokeWeight, NaN);
      if (!Number.isFinite(sw) || sw < 0) {
        logger.error("❌ create_rectangle failed", { code: "invalid_stroke_weight", originalError: "strokeWeight must be >= 0", details: { strokeWeight } });
        throw new Error(
          JSON.stringify({ code: "invalid_stroke_weight", message: "strokeWeight must be >= 0", details: { strokeWeight } })
        );
      }
      rect.strokeWeight = sw;
    }
    if (strokeAlign !== undefined) {
      const validAlign = ["CENTER", "INSIDE", "OUTSIDE"];
      if (!validAlign.includes(strokeAlign)) {
        logger.error("❌ create_rectangle failed", { code: "invalid_stroke_align", originalError: "strokeAlign invalid", details: { strokeAlign } });
        throw new Error(
          JSON.stringify({ code: "invalid_stroke_align", message: "strokeAlign must be CENTER|INSIDE|OUTSIDE", details: { strokeAlign } })
        );
      }
      rect.strokeAlign = strokeAlign;
    }

    // Corners
    if (cornerRadius !== undefined) {
      const cr = toNumber(cornerRadius, NaN);
      if (!Number.isFinite(cr) || cr < 0) {
        logger.error("❌ create_rectangle failed", { code: "invalid_corner_radius", originalError: "cornerRadius must be >= 0", details: { cornerRadius } });
        throw new Error(
          JSON.stringify({ code: "invalid_corner_radius", message: "cornerRadius must be >= 0", details: { cornerRadius } })
        );
      }
      rect.cornerRadius = cr;
    }
    const cornerMap = [
      ["topLeftRadius", topLeftRadius],
      ["topRightRadius", topRightRadius],
      ["bottomLeftRadius", bottomLeftRadius],
      ["bottomRightRadius", bottomRightRadius],
    ];
    for (const [prop, raw] of cornerMap) {
      if (raw !== undefined) {
        const v = toNumber(raw, NaN);
        if (!Number.isFinite(v) || v < 0) {
          logger.error("❌ create_rectangle failed", { code: "invalid_corner_radius", originalError: `${prop} must be >= 0`, details: { [prop]: raw } });
          throw new Error(
            JSON.stringify({ code: "invalid_corner_radius", message: `${prop} must be >= 0`, details: { [prop]: raw } })
          );
        }
        rect[prop] = v;
      }
    }

    // Misc geometry
    if (rotation !== undefined) {
      const rot = toNumber(rotation, NaN);
      if (!Number.isFinite(rot)) {
        logger.error("❌ create_rectangle failed", { code: "invalid_rotation", originalError: "rotation must be a number", details: { rotation } });
        throw new Error(
          JSON.stringify({ code: "invalid_rotation", message: "rotation must be a number", details: { rotation } })
        );
      }
      rect.rotation = rot;
    }
    if (opacity !== undefined) {
      const op = clamp01(toNumber(opacity, NaN));
      if (!Number.isFinite(op)) {
        logger.error("❌ create_rectangle failed", { code: "invalid_opacity", originalError: "opacity must be a number in [0,1]", details: { opacity } });
        throw new Error(
          JSON.stringify({ code: "invalid_opacity", message: "opacity must be a number in [0,1]", details: { opacity } })
        );
      }
      rect.opacity = op;
    }

    // Visibility/locking
    if (visible !== undefined) rect.visible = !!visible;
    if (locked !== undefined) rect.locked = !!locked;

    // Layout
    if (layoutAlign !== undefined) {
      const allowed = ["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"];
      if (!allowed.includes(layoutAlign)) {
        logger.error("❌ create_rectangle failed", { code: "invalid_layout_align", originalError: "layoutAlign invalid", details: { layoutAlign } });
        throw new Error(
          JSON.stringify({ code: "invalid_layout_align", message: "layoutAlign must be one of MIN|CENTER|MAX|STRETCH|INHERIT", details: { layoutAlign } })
        );
      }
      rect.layoutAlign = layoutAlign;
    }
    if (constraints !== undefined) {
      try {
        const { horizontal, vertical } = constraints || {};
        const allowedC = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"];
        if (!allowedC.includes(horizontal) || !allowedC.includes(vertical)) {
          logger.error("❌ create_rectangle failed", { code: "invalid_constraints", originalError: "constraints invalid", details: { constraints } });
          throw new Error("bad_constraints");
        }
        rect.constraints = { horizontal, vertical };
      } catch (e) {
        throw new Error(
          JSON.stringify({ code: "invalid_constraints", message: "constraints must include valid horizontal and vertical keys", details: { constraints } })
        );
      }
    }

    // If parentId is provided, append to that node, otherwise append to current page
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        logger.error("❌ create_rectangle failed", { code: "parent_not_found", originalError: `Parent not found`, details: { parentId } });
        throw new Error(
          JSON.stringify({ code: "parent_not_found", message: `Parent node not found`, details: { parentId } })
        );
      }
      if (!("appendChild" in parentNode)) {
        logger.error("❌ create_rectangle failed", { code: "invalid_parent", originalError: `Parent cannot accept children`, details: { parentId, parentType: parentNode.type } });
        throw new Error(
          JSON.stringify({ code: "invalid_parent", message: `Parent node does not support children`, details: { parentId, parentType: parentNode.type } })
        );
      }
      parentNode.appendChild(rect);
    } else {
      figma.currentPage.appendChild(rect);
    }

    if (shouldSelect) {
      try {
        figma.currentPage.selection = [rect];
        figma.viewport.scrollAndZoomIntoView([rect]);
      } catch (_) {}
    }

    const payload = {
      success: true,
      summary: `Created rectangle '${rect.name}' at (${rect.x}, ${rect.y}) with size ${rect.width}x${rect.height}`,
      modifiedNodeIds: [rect.id],
      node: {
        id: rect.id,
        name: rect.name,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        parentId: rect.parent ? rect.parent.id : undefined,
      },
    };
    logger.info("✅ create_rectangle succeeded", { id: rect.id, name: rect.name });
    return payload;
  } catch (error) {
    // Forward structured errors or wrap unknowns
    try {
      // If already structured JSON, ensure it contains a code
      const maybe = JSON.parse(error && error.message ? error.message : "{}");
      if (maybe && typeof maybe === "object" && maybe.code) {
        logger.error("❌ create_rectangle failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    logger.error("❌ create_rectangle failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(
      JSON.stringify({ code: "unknown_plugin_error", message: (error && error.message) || "Failed to create rectangle", details: {} })
    );
  }
}

// -------- TOOL : create_frame --------
async function createFrame(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Frame",
    parentId,
    fillColor,
    strokeColor,
    strokeWeight,
    layoutMode = "NONE",
    layoutWrap = "NO_WRAP",
    paddingTop = 10,
    paddingRight = 10,
    paddingBottom = 10,
    paddingLeft = 10,
    primaryAxisAlignItems = "MIN",
    counterAxisAlignItems = "MIN",
    layoutSizingHorizontal = "FIXED",
    layoutSizingVertical = "FIXED",
    itemSpacing = 0,
  } = params || {};

  try {
    const frame = figma.createFrame();
    frame.x = x;
    frame.y = y;
    frame.resize(width, height);
    frame.name = name;

    // Set layout mode if provided
    if (layoutMode !== "NONE") {
      frame.layoutMode = layoutMode;
      frame.layoutWrap = layoutWrap;

      // Set padding values only when layoutMode is not NONE
      frame.paddingTop = paddingTop;
      frame.paddingRight = paddingRight;
      frame.paddingBottom = paddingBottom;
      frame.paddingLeft = paddingLeft;

      // Set axis alignment only when layoutMode is not NONE
      frame.primaryAxisAlignItems = primaryAxisAlignItems;
      frame.counterAxisAlignItems = counterAxisAlignItems;

      // Set layout sizing only when layoutMode is not NONE
      frame.layoutSizingHorizontal = layoutSizingHorizontal;
      frame.layoutSizingVertical = layoutSizingVertical;

      // Set item spacing only when layoutMode is not NONE
      frame.itemSpacing = itemSpacing;
    }

    // Set fill color if provided
    if (fillColor) {
      const paintStyle = {
        type: "SOLID",
        color: {
          r: parseFloat(fillColor.r) || 0,
          g: parseFloat(fillColor.g) || 0,
          b: parseFloat(fillColor.b) || 0,
        },
        opacity: parseFloat(fillColor.a) || 1,
      };
      frame.fills = [paintStyle];
    }

    // Set stroke color and weight if provided
    if (strokeColor) {
      const strokeStyle = {
        type: "SOLID",
        color: {
          r: parseFloat(strokeColor.r) || 0,
          g: parseFloat(strokeColor.g) || 0,
          b: parseFloat(strokeColor.b) || 0,
        },
        opacity: parseFloat(strokeColor.a) || 1,
      };
      frame.strokes = [strokeStyle];
    }

    // Set stroke weight if provided
    if (strokeWeight !== undefined) {
      frame.strokeWeight = strokeWeight;
    }

    // If parentId is provided, append to that node, otherwise append to current page
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        logger.error("create_frame failed", { code: "parent_not_found", details: { parentId } });
        throw new Error(JSON.stringify({
          code: "parent_not_found",
          message: `Parent node not found with ID: ${parentId}`,
          details: { parentId }
        }));
      }
      if (!("appendChild" in parentNode)) {
        logger.error("create_frame failed", { code: "invalid_parent_type", details: { parentId, parentType: parentNode.type } });
        throw new Error(JSON.stringify({
          code: "invalid_parent_type",
          message: `Parent node does not support children: ${parentId}`,
          details: { parentId, parentType: parentNode.type }
        }));
      }
      try {
        parentNode.appendChild(frame);
      } catch (e) {
        const originalError = (e && e.message) ? e.message : String(e);
        const isLocked = /lock/i.test(originalError);
        const code = isLocked ? "locked_parent" : "append_failed";
        logger.error("create_frame failed", { code, originalError, details: { parentId } });
        throw new Error(JSON.stringify({
          code,
          message: `Failed to append frame to parent ${parentId}: ${originalError}`,
          details: { parentId }
        }));
      }
    } else {
      figma.currentPage.appendChild(frame);
    }

    const payload = {
      success: true,
      summary: `Created frame '${frame.name}' at (${frame.x}, ${frame.y}) sized ${Math.round(frame.width)}x${Math.round(frame.height)}`,
      modifiedNodeIds: [frame.id],
      node: {
        id: frame.id,
        name: frame.name,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        fills: frame.fills,
        strokes: frame.strokes,
        strokeWeight: frame.strokeWeight,
        layoutMode: frame.layoutMode,
        layoutWrap: frame.layoutWrap,
        parentId: frame.parent ? frame.parent.id : undefined,
      },
    };

    logger.info("create_frame succeeded", { id: payload.node.id, name: payload.node.name });
    return payload;
  } catch (error) {
    // If error is already structured JSON, rethrow; else wrap
    try {
      const asObj = JSON.parse(error && error.message ? error.message : String(error));
      if (asObj && typeof asObj === "object" && asObj.code) {
        // Already structured
        throw error;
      }
    } catch (_) {
      // not JSON; fall through to wrap
    }
    const originalError = (error && error.message) ? error.message : String(error);
    logger.error("create_frame failed", { code: "create_frame_failed", originalError, details: { name, x, y, width, height, parentId } });
    throw new Error(JSON.stringify({
      code: "create_frame_failed",
      message: `Failed to create frame: ${originalError}`,
      details: { name, x, y, width, height, parentId }
    }));
  }
}

// -------- TOOL : create_text --------
async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 },
    name = "",
    parentId,
  } = params || {};

  const toNumber = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const makeSolidPaint = (color) => {
    if (!color || typeof color !== "object") {
      logger.error("❌ create_text failed", { code: "invalid_font_color", originalError: "Invalid color object", details: { color } });
      throw new Error(JSON.stringify({ code: "invalid_font_color", message: "Invalid color object for fontColor", details: { color } }));
    }
    const r = clamp01(toNumber(color.r, NaN));
    const g = clamp01(toNumber(color.g, NaN));
    const b = clamp01(toNumber(color.b, NaN));
    const a = clamp01(toNumber((color.a === null || color.a === undefined) ? 1 : color.a, 1));
    if ([r, g, b, a].some((v) => !Number.isFinite(v))) {
      logger.error("❌ create_text failed", { code: "invalid_font_color", originalError: "Color components must be numbers in [0,1]", details: { color } });
      throw new Error(JSON.stringify({ code: "invalid_font_color", message: "Color components must be numbers in [0,1]", details: { color } }));
    }
    return [{ type: "SOLID", color: { r, g, b }, opacity: a }];
  };

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100: return "Thin";
      case 200: return "Extra Light";
      case 300: return "Light";
      case 400: return "Regular";
      case 500: return "Medium";
      case 600: return "Semi Bold";
      case 700: return "Bold";
      case 800: return "Extra Bold";
      case 900: return "Black";
      default: return "Regular";
    }
  };

  try {
    // Validate provided numeric parameters if present
    const size = toNumber(fontSize, NaN);
    if (!Number.isFinite(size) || size <= 0) {
      logger.error("❌ create_text failed", { code: "invalid_font_size", originalError: "fontSize must be a positive number", details: { fontSize } });
      throw new Error(JSON.stringify({ code: "invalid_font_size", message: "fontSize must be a positive number", details: { fontSize } }));
    }
    const allowedWeights = [100,200,300,400,500,600,700,800,900];
    if (fontWeight !== undefined && !allowedWeights.includes(Number(fontWeight))) {
      logger.error("❌ create_text failed", { code: "invalid_font_weight", originalError: "fontWeight must be one of 100..900", details: { fontWeight } });
      throw new Error(JSON.stringify({ code: "invalid_font_weight", message: "fontWeight must be one of 100,200,...,900", details: { fontWeight } }));
    }

    const textNode = figma.createText();
    textNode.x = toNumber(x, 0);
    textNode.y = toNumber(y, 0);
    textNode.name = (typeof name === "string" && name.length) ? name : (typeof text === "string" ? text : "Text");

    // Load requested font; fallback to Regular if style missing
    const requestedStyle = getFontStyle(Number(fontWeight));
    const requestedFont = { family: "Inter", style: requestedStyle };
    try {
      await figma.loadFontAsync(requestedFont);
    } catch (err) {
      const originalError = (err && err.message) || String(err);
      logger.error("❌ create_text failed", { code: "font_load_failed", originalError, details: { requestedFont } });
      // Attempt fallback to Regular
      try {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      } catch (err2) {
        const originalError2 = (err2 && err2.message) || String(err2);
        logger.error("❌ create_text failed", { code: "font_load_failed", originalError: originalError2, details: { requestedFont: { family: "Inter", style: "Regular" } } });
        throw new Error(JSON.stringify({ code: "font_load_failed", message: "Failed to load font for text node", details: { requestedFont, fallbackTried: true } }));
      }
    }

    try { textNode.fontName = { family: "Inter", style: requestedStyle }; } catch (_) {}
    try { textNode.fontSize = size; } catch (e) {
      logger.error("❌ create_text failed", { code: "invalid_font_size", originalError: (e && e.message) || String(e), details: { fontSize } });
      throw new Error(JSON.stringify({ code: "invalid_font_size", message: "Failed to set font size", details: { fontSize } }));
    }

    // Set characters with helper (await for consistency)
    try {
      await setCharacters(textNode, String(text));
    } catch (e) {
      logger.error("❌ create_text failed", { code: "set_characters_failed", originalError: (e && e.message) || String(e), details: {} });
      throw new Error(JSON.stringify({ code: "set_characters_failed", message: "Failed to set text characters", details: {} }));
    }

    // Set text fill color
    try {
      textNode.fills = makeSolidPaint(fontColor);
    } catch (e) {
      // makeSolidPaint throws structured error already
      throw e;
    }

    // If parentId is provided, append; otherwise append to current page
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        logger.error("❌ create_text failed", { code: "parent_not_found", originalError: `Parent not found`, details: { parentId } });
        throw new Error(JSON.stringify({ code: "parent_not_found", message: `Parent node not found`, details: { parentId } }));
      }
      if (!("appendChild" in parentNode)) {
        logger.error("❌ create_text failed", { code: "invalid_parent", originalError: `Parent cannot accept children`, details: { parentId, parentType: parentNode.type } });
        throw new Error(JSON.stringify({ code: "invalid_parent", message: `Parent node does not support children`, details: { parentId, parentType: parentNode.type } }));
      }
      try {
        parentNode.appendChild(textNode);
      } catch (e) {
        const originalError = (e && e.message) || String(e);
        const isLocked = /lock/i.test(originalError);
        const code = isLocked ? "locked_parent" : "append_failed";
        logger.error("❌ create_text failed", { code, originalError, details: { parentId } });
        throw new Error(JSON.stringify({ code, message: `Failed to append text to parent ${parentId}: ${originalError}`, details: { parentId } }));
      }
    } else {
      figma.currentPage.appendChild(textNode);
    }

    let fontNameResult = null;
    try { fontNameResult = (textNode.fontName === figma.mixed) ? "MIXED" : textNode.fontName; } catch (_) { fontNameResult = null; }

    const payload = {
      success: true,
      summary: `Created text '${textNode.name}' at (${textNode.x}, ${textNode.y})`,
      modifiedNodeIds: [textNode.id],
      node: {
        id: textNode.id,
        name: textNode.name,
        x: textNode.x,
        y: textNode.y,
        width: textNode.width,
        height: textNode.height,
        characters: textNode.characters,
        fontSize: textNode.fontSize,
        fontWeight: Number(fontWeight),
        fontName: fontNameResult,
        fills: textNode.fills,
        parentId: textNode.parent ? textNode.parent.id : undefined,
      },
    };
    logger.info("✅ create_text succeeded", { id: textNode.id, name: textNode.name });
    return payload;
  } catch (error) {
    // Forward structured errors or wrap unknowns
    try {
      const maybe = JSON.parse(error && error.message ? error.message : "{}");
      if (maybe && typeof maybe === "object" && maybe.code) {
        logger.error("❌ create_text failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    logger.error("❌ create_text failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: "unknown_plugin_error", message: (error && error.message) || "Failed to create text", details: {} }));
  }
}

// -------- TOOL : set_fill_color --------
async function setFillColor(params) {
  logger.info("🎨 set_fill_color called", params);
  const clamp01 = (v) => {
    const n = Number.isFinite(v) ? v : parseFloat(v);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
  };

  try {
    const { nodeId, nodeIds, color, styleId, replace } = params || {};

    // Validate targets
    const hasSingle = typeof nodeId === "string" && nodeId.length > 0;
    const hasMany = Array.isArray(nodeIds) && nodeIds.length > 0;
    if (!hasSingle && !hasMany) {
      const payload = { code: "missing_parameter", message: "Provide nodeId or nodeIds.", details: { received: params || {} } };
      logger.error("❌ set_fill_color failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Validate mode
    const hasColor = color && typeof color === "object";
    const hasStyle = typeof styleId === "string" && styleId.length > 0;
    if (!hasColor && !hasStyle) {
      const payload = { code: "missing_parameter", message: "Provide color or styleId.", details: { received: params || {} } };
      logger.error("❌ set_fill_color failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const targetIds = hasMany ? nodeIds : [nodeId];
    const foundNodes = [];
    const notFoundIds = [];
    for (const id of targetIds) {
      try {
        const n = await figma.getNodeByIdAsync(id);
        if (n) foundNodes.push(n); else notFoundIds.push(id);
      } catch (_) {
        notFoundIds.push(id);
      }
    }

    const unsupportedNodes = [];
    const lockedNodes = [];
    const validNodes = [];
    for (const n of foundNodes) {
      if (!("fills" in n)) {
        unsupportedNodes.push(n.id);
        continue;
      }
      if (n.locked) {
        lockedNodes.push(n.id);
        continue;
      }
      validNodes.push(n);
    }

    if (validNodes.length === 0) {
      const payload = { code: "no_valid_nodes", message: "No valid, paintable, unlocked nodes to modify.", details: { notFoundIds, unsupportedNodes, lockedNodes } };
      logger.error("❌ set_fill_color failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Build paint if using color
    let paint = null;
    if (hasColor) {
      const { r, g, b, a } = color || {};
      const rr = clamp01(parseFloat(r));
      const gg = clamp01(parseFloat(g));
      const bb = clamp01(parseFloat(b));
      const aa = a !== undefined && a !== null ? clamp01(parseFloat(a)) : 1;

      if ([rr, gg, bb, aa].some((v) => isNaN(v))) {
        const payload = { code: "invalid_parameter", message: "Color components must be numeric between 0 and 1.", details: { color } };
        logger.error("❌ set_fill_color failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }

      paint = { type: "SOLID", color: { r: rr, g: gg, b: bb }, opacity: aa };
    }

    const modifiedNodeIds = [];
    const styleNotSupported = [];
    const applyFailures = [];

    const almostEqual = (x, y) => Math.abs((x || 0) - (y || 0)) < 0.001;

    for (const node of validNodes) {
      try {
        if (hasStyle) {
          if (typeof node.setFillStyleIdAsync !== "function") {
            styleNotSupported.push(node.id);
            continue;
          }
          await node.setFillStyleIdAsync(styleId);
          modifiedNodeIds.push(node.id);
        } else if (paint) {
          const prev = Array.isArray(node.fills) ? node.fills : [];
          const doReplace = replace !== false;
          const nextFills = doReplace ? [paint] : prev.concat([paint]);
          node.fills = nextFills;
          // Verify
          try {
            const applied = Array.isArray(node.fills) && (doReplace ? node.fills[0] : node.fills[node.fills.length - 1]);
            const ok = applied && applied.type === "SOLID" && applied.color &&
              almostEqual(applied.color.r, paint.color.r) &&
              almostEqual(applied.color.g, paint.color.g) &&
              almostEqual(applied.color.b, paint.color.b) &&
              almostEqual(applied.opacity, paint.opacity);
            if (ok) {
              modifiedNodeIds.push(node.id);
            } else {
              applyFailures.push({ nodeId: node.id, code: "verification_failed", message: "Applied fill did not verify" });
            }
          } catch (ve) {
            applyFailures.push({ nodeId: node.id, code: "verification_failed", message: (ve && ve.message) || String(ve) });
          }
        }
      } catch (e) {
        applyFailures.push({ nodeId: node.id, code: "set_fill_failed", message: (e && e.message) || String(e) });
      }
    }

    // If any were modified, return standardized success
    if (modifiedNodeIds.length > 0) {
      const mode = hasStyle ? "style" : "color";
      const summary = `Applied ${mode} fill to ${modifiedNodeIds.length} node(s)`;
      logger.info("✅ set_fill_color succeeded", { modifiedNodeIds, mode, replaced: replace !== false });
      return {
        success: true,
        summary,
        modifiedNodeIds,
        mode,
        replaced: replace !== false,
        // Provide partial failure context if any
        failures: applyFailures.length ? applyFailures : undefined,
        notFoundIds: notFoundIds.length ? notFoundIds : undefined,
        unsupportedNodes: unsupportedNodes.length ? unsupportedNodes : undefined,
        lockedNodes: lockedNodes.length ? lockedNodes : undefined,
        styleNotSupported: styleNotSupported.length ? styleNotSupported : undefined,
      };
    }

    // Nothing modified → raise structured error
    const details = { notFoundIds, unsupportedNodes, lockedNodes, styleNotSupported, applyFailures };
    const payload = { code: "set_fill_failed", message: "No nodes were updated.", details };
    logger.error("❌ set_fill_color failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));

  } catch (error) {
    // If error.message is already structured JSON, rethrow it; otherwise wrap
    try {
      const maybe = JSON.parse(error && error.message ? error.message : "{}");
      if (maybe && typeof maybe === "object" && maybe.code) {
        logger.error("❌ set_fill_color failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    logger.error("❌ set_fill_color failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: "unknown_plugin_error", message: (error && error.message) || "Failed to set fill color", details: {} }));
  }
}

// -------- TOOL : set_stroke_color --------
async function setStrokeColor(params) {
  const { nodeId, color, weight } = params || {};

  // Helpers
  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // Validate required params
  if (!nodeId) {
    const payload = { code: "missing_parameter", message: "Missing nodeId parameter", details: { param: "nodeId" } };
    logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  if (!color || typeof color !== "object") {
    const payload = { code: "missing_parameter", message: "Missing color parameter", details: { param: "color" } };
    logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  const { r, g, b, a } = color;
  if (!isFiniteNumber(r) || !isFiniteNumber(g) || !isFiniteNumber(b)) {
    const payload = { code: "invalid_parameter", message: "Color components r,g,b must be finite numbers in [0,1]", details: { color } };
    logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  if (a !== undefined && a !== null && !isFiniteNumber(a)) {
    const payload = { code: "invalid_parameter", message: "Alpha component a must be a finite number in [0,1] when provided", details: { color } };
    logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  if (weight !== undefined && weight !== null && (!isFiniteNumber(weight) || weight < 0)) {
    const payload = { code: "invalid_parameter", message: "weight must be a non-negative number when provided", details: { weight } };
    logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node not found with ID: ${nodeId}`, details: { nodeId } };
      logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (!("strokes" in node)) {
      const payload = { code: "unsupported_strokes", message: `Node does not support strokes: ${nodeId}`, details: { nodeId, type: node.type } };
      logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Prevent modifying locked nodes to enable agent self-correction
    if (node.locked === true) {
      const payload = { code: "locked_nodes", message: "Target node is locked", details: { nodeIds: [node.id] } };
      logger.error("❌ set_stroke_color failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const rgba = {
      r: clamp01(r),
      g: clamp01(g),
      b: clamp01(b),
      a: clamp01((a === undefined || a === null) ? 1 : a)
    };

    const paint = {
      type: "SOLID",
      color: { r: rgba.r, g: rgba.g, b: rgba.b },
      opacity: rgba.a,
    };

    // Apply stroke color
    node.strokes = [paint];

    // Apply weight only when provided and supported
    if (weight !== undefined && weight !== null && "strokeWeight" in node) {
      node.strokeWeight = weight;
    }

    const result = {
      success: true,
      summary: `Applied stroke color to '${node.name}'${weight !== undefined && weight !== null ? ` at ${weight}px` : ""}.`,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        strokes: node.strokes,
        strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
      },
    };
    logger.info("✅ set_stroke_color succeeded", { nodeId: node.id });
    return result;
  } catch (error) {
    // If error is already structured JSON, rethrow as-is
    try {
      const maybe = typeof (error && error.message) === "string" ? JSON.parse(error.message) : null;
      if (maybe && typeof maybe === "object" && maybe.code) {
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_stroke_color" } };
    logger.error("❌ set_stroke_color failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : move_node --------
async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

  if (!nodeId) {
    const payload = { code: "missing_parameter", message: "Missing nodeId parameter", details: { param: "nodeId" } };
    logger.error("❌ move_node failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    const payload = { code: "invalid_parameter", message: "x and y must be finite numbers", details: { x, y } };
    logger.error("❌ move_node failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node not found with ID: ${nodeId}`, details: { nodeId } };
      logger.error("❌ move_node failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (!("x" in node) || !("y" in node)) {
      const payload = { code: "unsupported_position", message: `Node does not support position: ${nodeId}`, details: { nodeId, type: node.type } };
      logger.error("❌ move_node failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (node.locked === true) {
      const payload = { code: "locked_nodes", message: "Target node is locked", details: { nodeIds: [node.id] } };
      logger.error("❌ move_node failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    node.x = x;
    node.y = y;

    const result = {
      success: true,
      summary: `Moved '${node.name}' to (${node.x}, ${node.y}).`,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        x: node.x,
        y: node.y,
      },
    };
    logger.info("✅ move_node succeeded", { nodeId: node.id });
    return result;
  } catch (error) {
    // If error is already structured JSON, rethrow as-is
    try {
      const maybe = typeof (error && error.message) === "string" ? JSON.parse(error.message) : null;
      if (maybe && typeof maybe === "object" && maybe.code) {
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "move_node" } };
    logger.error("❌ move_node failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : resize_node --------
async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

  if (!nodeId) {
    const payload = { code: "missing_parameter", message: "Missing nodeId parameter", details: { param: "nodeId" } };
    logger.error("❌ resize_node failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
    const payload = { code: "invalid_parameter", message: "width and height must be finite numbers", details: { width, height } };
    logger.error("❌ resize_node failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  if (width < 0 || height < 0) {
    const payload = { code: "invalid_parameter", message: "width and height must be non-negative", details: { width, height } };
    logger.error("❌ resize_node failed", { code: payload.code, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node not found with ID: ${nodeId}`, details: { nodeId } };
      logger.error("❌ resize_node failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (!("resize" in node)) {
      const payload = { code: "unsupported_resize", message: `Node does not support resizing: ${nodeId}`, details: { nodeId, type: node.type } };
      logger.error("❌ resize_node failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (node.locked === true) {
      const payload = { code: "locked_nodes", message: "Target node is locked", details: { nodeIds: [node.id] } };
      logger.error("❌ resize_node failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    node.resize(width, height);

    const result = {
      success: true,
      summary: `Resized '${node.name}' to ${node.width}×${node.height}.`,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        width: node.width,
        height: node.height,
      },
    };
    logger.info("✅ resize_node succeeded", { nodeId: node.id });
    return result;
  } catch (error) {
    // If error is already structured JSON, rethrow as-is
    try {
      const maybe = typeof (error && error.message) === "string" ? JSON.parse(error.message) : null;
      if (maybe && typeof maybe === "object" && maybe.code) {
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "resize_node" } };
    logger.error("❌ resize_node failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : clone_node --------
async function cloneNode(params) {
  try {
    const {
      nodeId,
      x,
      y,
      offsetX,
      offsetY,
      parentId,
      insertIndex,
      select,
      name,
      locked,
      visible,
    } = params || {};

    // Validate required param
    if (!nodeId || typeof nodeId !== "string") {
      logger.error("❌ clone_node failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "missing_parameter", message: "Parameter 'nodeId' is required", details: { nodeId } }));
    }

    // Validate optional params types
    const invalids = [];
    if (x !== undefined && typeof x !== "number") invalids.push("x");
    if (y !== undefined && typeof y !== "number") invalids.push("y");
    if (offsetX !== undefined && typeof offsetX !== "number") invalids.push("offsetX");
    if (offsetY !== undefined && typeof offsetY !== "number") invalids.push("offsetY");
    if (insertIndex !== undefined && (!Number.isInteger(insertIndex) || insertIndex < 0)) invalids.push("insertIndex");
    if (parentId !== undefined && typeof parentId !== "string") invalids.push("parentId");
    if (select !== undefined && typeof select !== "boolean") invalids.push("select");
    if (name !== undefined && typeof name !== "string") invalids.push("name");
    if (locked !== undefined && typeof locked !== "boolean") invalids.push("locked");
    if (visible !== undefined && typeof visible !== "boolean") invalids.push("visible");
    if (invalids.length > 0) {
      logger.error("❌ clone_node failed", { code: "invalid_parameter", originalError: `Invalid parameter types: ${invalids.join(", ")}` , details: { invalids } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: `Invalid parameter types: ${invalids.join(", ")}`, details: { invalids } }));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      logger.error("❌ clone_node failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "node_not_found", message: `Node not found with ID: ${nodeId}`, details: { nodeId } }));
    }

    // Perform clone
    let clone;
    try {
      clone = node.clone();
    } catch (err) {
      const originalError = (err && err.message) || String(err);
      logger.error("❌ clone_node failed", { code: "clone_failed", originalError, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "clone_failed", message: "Failed to clone node", details: { nodeId } }));
    }

    // Optional rename / visibility / locked state
    try { if (typeof name === "string") clone.name = name; } catch (_) {}
    try { if (typeof visible === "boolean" && "visible" in clone) clone.visible = visible; } catch (_) {}
    try { if (typeof locked === "boolean" && "locked" in clone) clone.locked = locked; } catch (_) {}

    // Positioning: absolute or relative offset
    if (x !== undefined || y !== undefined || offsetX !== undefined || offsetY !== undefined) {
      if (!("x" in clone) || !("y" in clone)) {
        logger.error("❌ clone_node failed", { code: "position_not_supported", originalError: "Target node does not support position", details: { nodeId, cloneId: clone.id } });
        throw new Error(JSON.stringify({ code: "position_not_supported", message: "Node does not support x/y positioning", details: { nodeId, cloneId: clone.id } }));
      }
      if (x !== undefined) clone.x = x;
      if (y !== undefined) clone.y = y;
      if (offsetX !== undefined) clone.x = clone.x + offsetX;
      if (offsetY !== undefined) clone.y = clone.y + offsetY;
    }

    // Parent placement: target parent or default to original's parent or currentPage
    let targetParent = null;
    if (parentId) {
      const maybeParent = await figma.getNodeByIdAsync(parentId);
      if (!maybeParent) {
        logger.error("❌ clone_node failed", { code: "parent_not_found", originalError: "Parent not found", details: { parentId } });
        throw new Error(JSON.stringify({ code: "parent_not_found", message: `Parent not found with ID: ${parentId}` , details: { parentId } }));
      }
      targetParent = maybeParent;
    } else if (node.parent) {
      targetParent = node.parent;
    } else {
      targetParent = figma.currentPage;
    }

    // Insert into parent
    try {
      if (insertIndex !== undefined && typeof targetParent.insertChild === "function") {
        targetParent.insertChild(insertIndex, clone);
      } else if (typeof targetParent.appendChild === "function") {
        targetParent.appendChild(clone);
      } else {
        logger.error("❌ clone_node failed", { code: "invalid_parent_container", originalError: "Parent is not a container", details: { parentId: targetParent.id } });
        throw new Error(JSON.stringify({ code: "invalid_parent_container", message: "Parent does not support child insertion", details: { parentId: targetParent.id } }));
      }
    } catch (err) {
      const originalError = (err && err.message) || String(err);
      logger.error("❌ clone_node failed", { code: "insert_failed", originalError, details: { parentId: targetParent && targetParent.id } });
      throw new Error(JSON.stringify({ code: "insert_failed", message: "Failed to insert cloned node into parent", details: { parentId: targetParent && targetParent.id } }));
    }

    // Optional selection
    if (select === true) {
      try { figma.currentPage.selection = [clone]; } catch (_) {}
    }

    const result = {
      success: true,
      summary: `Cloned node '${node.name}' to '${clone.name}'`,
      modifiedNodeIds: [clone.id],
      node: {
        id: clone.id,
        name: clone.name,
        type: clone.type,
        x: "x" in clone ? clone.x : undefined,
        y: "y" in clone ? clone.y : undefined,
        width: "width" in clone ? clone.width : undefined,
        height: "height" in clone ? clone.height : undefined,
        parentId: clone.parent ? clone.parent.id : undefined,
      },
      originalNodeId: node.id,
      parentId: (clone.parent && clone.parent.id) || undefined,
    };
    logger.info("✅ clone_node succeeded", { nodeId: nodeId, cloneId: clone.id });
    return result;
  } catch (error) {
    // If error is already structured JSON, rethrow as-is to preserve code/details
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && typeof payload === "object" && payload.code) {
        logger.error("❌ clone_node failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // not JSON, normalize to structured error
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "clone_node" } };
    logger.error("❌ clone_node failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : delete_node --------
async function deleteNode(params) {
  try {
    const { nodeId, force, selectParent } = params || {};

    if (!nodeId || typeof nodeId !== "string") {
      logger.error("❌ delete_node failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "missing_parameter", message: "Parameter 'nodeId' is required", details: { nodeId } }));
    }
    if (force !== undefined && typeof force !== "boolean") {
      logger.error("❌ delete_node failed", { code: "invalid_parameter", originalError: "force must be a boolean", details: { force } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Parameter 'force' must be a boolean", details: { force } }));
    }
    if (selectParent !== undefined && typeof selectParent !== "boolean") {
      logger.error("❌ delete_node failed", { code: "invalid_parameter", originalError: "selectParent must be a boolean", details: { selectParent } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Parameter 'selectParent' must be a boolean", details: { selectParent } }));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      logger.error("❌ delete_node failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "node_not_found", message: `Node not found with ID: ${nodeId}`, details: { nodeId } }));
    }

    if (node.type === "PAGE" || node.type === "DOCUMENT") {
      logger.error("❌ delete_node failed", { code: "cannot_delete_root_or_page", originalError: "Cannot delete document or page", details: { nodeId, type: node.type } });
      throw new Error(JSON.stringify({ code: "cannot_delete_root_or_page", message: "Cannot delete the document or a page", details: { nodeId, type: node.type } }));
    }

    // Handle locked nodes
    if ("locked" in node && node.locked === true) {
      if (force === true) {
        try { node.locked = false; } catch (_) {}
      } else {
        logger.error("❌ delete_node failed", { code: "locked_node", originalError: "Node is locked", details: { nodeId } });
        throw new Error(JSON.stringify({ code: "locked_node", message: "Node is locked", details: { nodeId } }));
      }
    }

    const parentId = node.parent ? node.parent.id : undefined;
    const name = node.name;
    const type = node.type;
    const id = node.id;

    try {
      node.remove();
    } catch (err) {
      const originalError = (err && err.message) || String(err);
      logger.error("❌ delete_node failed", { code: "delete_failed", originalError, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "delete_failed", message: "Failed to delete node", details: { nodeId } }));
    }

    if (selectParent === true && parentId) {
      try {
        const maybeParent = await figma.getNodeByIdAsync(parentId);
        if (maybeParent && maybeParent.type !== "DOCUMENT") {
          figma.currentPage.selection = [maybeParent];
        }
      } catch (_) {}
    }

    const result = {
      success: true,
      summary: `Deleted node '${name}' (${id})`,
      modifiedNodeIds: [id],
      node: { id, name, type },
      parentId,
    };
    logger.info("✅ delete_node succeeded", { nodeId: id });
    return result;
  } catch (error) {
    // If error is already structured JSON, rethrow as-is to preserve code/details
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && typeof payload === "object" && payload.code) {
        logger.error("❌ delete_node failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // not JSON, normalize to structured error
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "delete_node" } };
    logger.error("❌ delete_node failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// ======================================================
// Section: Styles (Paints, Text, Effects, Grids)
// ======================================================
// -------- TOOL : get_styles --------
async function getStyles(params) {
  try {
    const { kinds, name, caseSensitive, includeAllPaints, sortBy, sortDirection } = params || {};

    // Validate params
    const allowedKinds = ["paint", "text", "effect", "grid"];
    if (kinds !== undefined && !Array.isArray(kinds)) {
      logger.error("❌ get_styles failed", { code: "invalid_parameter", originalError: "'kinds' must be an array", details: { kinds } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'kinds' must be an array of 'paint'|'text'|'effect'|'grid'", details: { kinds } }));
    }
    if (Array.isArray(kinds)) {
      const invalid = kinds.filter((k) => !allowedKinds.includes(k));
      if (invalid.length > 0 || kinds.length === 0) {
        logger.error("❌ get_styles failed", { code: "invalid_kinds", originalError: "Unsupported or empty kinds provided", details: { invalid, allowedKinds } });
        throw new Error(JSON.stringify({ code: "invalid_kinds", message: "'kinds' must contain any of ['paint','text','effect','grid']", details: { invalid, allowedKinds } }));
      }
    }
    if (name !== undefined && typeof name !== "string") {
      logger.error("❌ get_styles failed", { code: "invalid_parameter", originalError: "'name' must be a string", details: { nameType: typeof name } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'name' must be a string", details: { nameType: typeof name } }));
    }
    if (sortBy !== undefined && sortBy !== "name") {
      logger.error("❌ get_styles failed", { code: "invalid_sort", originalError: "Only sortBy='name' is supported", details: { sortBy } });
      throw new Error(JSON.stringify({ code: "invalid_sort", message: "Only sortBy='name' is supported", details: { sortBy } }));
    }
    if (sortDirection !== undefined && sortDirection !== "asc" && sortDirection !== "desc") {
      logger.error("❌ get_styles failed", { code: "invalid_sort", originalError: "sortDirection must be 'asc'|'desc'", details: { sortDirection } });
      throw new Error(JSON.stringify({ code: "invalid_sort", message: "sortDirection must be 'asc'|'desc'", details: { sortDirection } }));
    }

    const wantPaints = !Array.isArray(kinds) || kinds.includes("paint");
    const wantTexts = !Array.isArray(kinds) || kinds.includes("text");
    const wantEffects = !Array.isArray(kinds) || kinds.includes("effect");
    const wantGrids = !Array.isArray(kinds) || kinds.includes("grid");

    const styles = {
      colors: wantPaints ? await figma.getLocalPaintStylesAsync() : [],
      texts: wantTexts ? await figma.getLocalTextStylesAsync() : [],
      effects: wantEffects ? await figma.getLocalEffectStylesAsync() : [],
      grids: wantGrids ? await figma.getLocalGridStylesAsync() : [],
    };

    const insensitive = !(caseSensitive === true);
    const matchByName = (style) => {
      if (typeof name !== "string" || name.length === 0) return true;
      const styleName = String(style.name || "");
      return insensitive
        ? styleName.toLowerCase().includes(name.toLowerCase())
        : styleName.includes(name);
    };

    const sortAsc = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));
    const sortDesc = (a, b) => -sortAsc(a, b);
    const doSort = (arr) => {
      if (sortBy === "name" || sortBy === undefined) {
        return arr.slice().sort(sortDirection === "desc" ? sortDesc : sortAsc);
      }
      return arr;
    };

    const colors = doSort(styles.colors.filter(matchByName).map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key == null ? null : style.key,
      paints: Array.isArray(style.paints) ? style.paints : [],
    })));
    const texts = doSort(styles.texts.filter(matchByName).map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key == null ? null : style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })));
    const effects = doSort(styles.effects.filter(matchByName).map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key == null ? null : style.key,
    })));
    const grids = doSort(styles.grids.filter(matchByName).map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key == null ? null : style.key,
    })));

    const result = {
      colors: wantPaints ? (includeAllPaints === false ? colors.map((c) => (Object.assign({}, c, { paints: c.paints.slice(0, 1) }))) : colors) : [],
      texts: wantTexts ? texts : [],
      effects: wantEffects ? effects : [],
      grids: wantGrids ? grids : [],
    };

    const totalCount = (result.colors.length + result.texts.length + result.effects.length + result.grids.length);
    if (totalCount === 0) {
      logger.error("❌ get_styles failed", { code: "no_styles_found", originalError: "No styles match the given filters", details: { kinds: kinds || allowedKinds, name, caseSensitive, sortBy, sortDirection } });
      throw new Error(JSON.stringify({ code: "no_styles_found", message: "No styles were found for the given filters", details: { kinds: kinds || allowedKinds, name, caseSensitive, sortBy, sortDirection } }));
    }

    logger.info("✅ get_styles succeeded", { counts: { colors: result.colors.length, texts: result.texts.length, effects: result.effects.length, grids: result.grids.length } });
    // Read-only tool: return data directly
    return result;
  } catch (error) {
    try {
      const payload = JSON.parse((error && error.message) || String(error));
      if (payload && payload.code) {
        logger.error("❌ get_styles failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // not JSON, normalize to structured error
    }
    logger.error("❌ get_styles failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: "unknown_plugin_error", message: "Failed to list styles", details: {} }));
  }
}

// -------- TOOL : set_gradient_fill --------
async function setGradientFill(params) {
    try {
        const { nodeId, gradient } = params || {};

        // Validate required params
        if (!nodeId) {
            logger.error("❌ set_gradient_fill failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
            throw new Error(JSON.stringify({ code: "missing_parameter", message: "'nodeId' is required", details: { nodeId } }));
        }
        if (!gradient) {
            logger.error("❌ set_gradient_fill failed", { code: "missing_parameter", originalError: "gradient is required", details: {} });
            throw new Error(JSON.stringify({ code: "missing_parameter", message: "'gradient' is required", details: {} }));
        }

        // Resolve node and capabilities
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
            logger.error("❌ set_gradient_fill failed", { code: "node_not_found", originalError: "Node not found", details: { nodeId } });
            throw new Error(JSON.stringify({ code: "node_not_found", message: "Target node not found", details: { nodeId } }));
        }
        if (!('fills' in node)) {
            logger.error("❌ set_gradient_fill failed", { code: "node_not_supported", originalError: "Node does not support fills", details: { nodeId, type: node.type } });
            throw new Error(JSON.stringify({ code: "node_not_supported", message: "Node does not support fills", details: { nodeId, type: node.type } }));
        }
        if ('locked' in node && node.locked) {
            logger.error("❌ set_gradient_fill failed", { code: "locked_nodes", originalError: "Node is locked", details: { nodeIds: [node.id] } });
            throw new Error(JSON.stringify({ code: "locked_nodes", message: "Cannot modify locked node", details: { nodeIds: [node.id] } }));
        }

        // Validate gradient paint shape
        const allowedTypes = ["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"];
        if (typeof gradient !== 'object' || gradient == null) {
            logger.error("❌ set_gradient_fill failed", { code: "invalid_parameter", originalError: "gradient must be an object", details: {} });
            throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'gradient' must be an object conforming to GradientPaint", details: {} }));
        }
        if (!allowedTypes.includes(gradient.type)) {
            logger.error("❌ set_gradient_fill failed", { code: "invalid_paint_type", originalError: "Invalid gradient type", details: { type: gradient.type } });
            throw new Error(JSON.stringify({ code: "invalid_paint_type", message: "'gradient.type' must be GRADIENT_LINEAR|GRADIENT_RADIAL|GRADIENT_ANGULAR|GRADIENT_DIAMOND", details: { type: gradient.type } }));
        }
        if (!Array.isArray(gradient.gradientStops) || gradient.gradientStops.length < 2) {
            logger.error("❌ set_gradient_fill failed", { code: "invalid_gradient_stops", originalError: "gradientStops must be an array with at least 2 stops", details: { stops: gradient.gradientStops && gradient.gradientStops.length } });
            throw new Error(JSON.stringify({ code: "invalid_gradient_stops", message: "'gradient.gradientStops' must be an array with at least 2 stops", details: {} }));
        }
        for (let i = 0; i < gradient.gradientStops.length; i++) {
            const stop = gradient.gradientStops[i];
            const posOk = typeof stop.position === 'number' && stop.position >= 0 && stop.position <= 1;
            const color = stop.color || {};
            const colOk = typeof color.r === 'number' && color.r >= 0 && color.r <= 1 &&
                          typeof color.g === 'number' && color.g >= 0 && color.g <= 1 &&
                          typeof color.b === 'number' && color.b >= 0 && color.b <= 1 &&
                          (color.a === undefined || (typeof color.a === 'number' && color.a >= 0 && color.a <= 1));
            if (!posOk || !colOk) {
                logger.error("❌ set_gradient_fill failed", { code: "invalid_gradient_stops", originalError: "Invalid stop at index", details: { index: i, stop } });
                throw new Error(JSON.stringify({ code: "invalid_gradient_stops", message: `Invalid gradient stop at index ${i}`, details: { index: i } }));
            }
        }
        if (!Array.isArray(gradient.gradientTransform) || gradient.gradientTransform.length !== 2 ||
            !Array.isArray(gradient.gradientTransform[0]) || gradient.gradientTransform[0].length !== 3 ||
            !Array.isArray(gradient.gradientTransform[1]) || gradient.gradientTransform[1].length !== 3) {
            logger.error("❌ set_gradient_fill failed", { code: "invalid_gradient_transform", originalError: "gradientTransform must be a 2x3 matrix", details: { gradientTransform: gradient.gradientTransform } });
            throw new Error(JSON.stringify({ code: "invalid_gradient_transform", message: "'gradient.gradientTransform' must be a 2x3 matrix", details: {} }));
        }

        // Attempt to apply the gradient
        try {
            node.fills = [gradient];
        } catch (applyErr) {
            const originalError = (applyErr && applyErr.message) || String(applyErr);
            logger.error("❌ set_gradient_fill failed", { code: "plugin_write_failed", originalError, details: { nodeId: node.id } });
            throw new Error(JSON.stringify({ code: "plugin_write_failed", message: "Failed to apply gradient to node", details: { nodeId: node.id } }));
        }

        const payload = {
            success: true,
            summary: `Applied ${gradient.type} gradient to node ${node.name || node.id}.`,
            modifiedNodeIds: [node.id],
            nodeId: node.id,
            fills: node.fills,
            gradientType: gradient.type,
        };
        logger.info("✅ set_gradient_fill succeeded", { nodeId: node.id, type: gradient.type });
        return payload;
    } catch (error) {
        // Normalize to structured error if needed
        try {
            const payload = JSON.parse(error && error.message ? error.message : String(error));
            if (payload && payload.code) {
                logger.error("❌ set_gradient_fill failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
                throw new Error(JSON.stringify(payload));
            }
        } catch (_) {
            // Not JSON – normalize
        }
        const normalized = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_gradient_fill" } };
        logger.error("❌ set_gradient_fill failed", { code: normalized.code, originalError: normalized.message, details: normalized.details });
        throw new Error(JSON.stringify(normalized));
    }
}

// -------- TOOL INCOMPLETE : set_range_text_style --------
async function setRangeTextStyle(params) {
    const { nodeId, start, end, textStyleId, autoClamp } = params || {};
    try {
        // Validate parameters
        const missing = [];
        if (!nodeId) missing.push("nodeId");
        if (start === undefined) missing.push("start");
        if (end === undefined) missing.push("end");
        if (!textStyleId) missing.push("textStyleId");
        if (missing.length > 0) {
            logger.error("❌ set_range_text_style failed", { code: "missing_parameter", originalError: `Missing: ${missing.join(", ")}`, details: { missing } });
            throw new Error(JSON.stringify({ code: "missing_parameter", message: `Missing required parameter(s): ${missing.join(", ")}`, details: { missing } }));
        }

        if (typeof start !== "number" || typeof end !== "number") {
            logger.error("❌ set_range_text_style failed", { code: "invalid_parameter", originalError: "'start' and 'end' must be numbers", details: { start, end } });
            throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'start' and 'end' must be numbers", details: { start, end } }));
        }

        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
            logger.error("❌ set_range_text_style failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
            throw new Error(JSON.stringify({ code: "node_not_found", message: `Node not found: ${nodeId}`, details: { nodeId } }));
        }
        if (node.type !== 'TEXT') {
            logger.error("❌ set_range_text_style failed", { code: "invalid_node_type", originalError: `Node type is ${node.type}`, details: { nodeId, nodeType: node.type } });
            throw new Error(JSON.stringify({ code: "invalid_node_type", message: `Node is not a TEXT node`, details: { nodeId, nodeType: node.type } }));
        }
        if (node.locked) {
            logger.error("❌ set_range_text_style failed", { code: "node_locked", originalError: `Node is locked`, details: { nodeId } });
            throw new Error(JSON.stringify({ code: "node_locked", message: `Node is locked`, details: { nodeId } }));
        }

        const length = node.characters.length;
        const useAutoClamp = (autoClamp === undefined) ? true : Boolean(autoClamp);
        let effectiveStart = start;
        let effectiveEnd = end;
        if (!Number.isInteger(effectiveStart) || !Number.isInteger(effectiveEnd)) {
            logger.error("❌ set_range_text_style failed", { code: "invalid_parameter", originalError: "'start' and 'end' must be integers", details: { start, end } });
            throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'start' and 'end' must be integers", details: { start, end } }));
        }
        if (useAutoClamp) {
            effectiveStart = Math.max(0, Math.min(effectiveStart, length));
            effectiveEnd = Math.max(0, Math.min(effectiveEnd, length));
            if (effectiveEnd < effectiveStart) {
                const tmp = effectiveStart; effectiveStart = effectiveEnd; effectiveEnd = tmp;
            }
            if (length === 0 || effectiveStart === effectiveEnd) {
                logger.error("❌ set_range_text_style failed", { code: "empty_range", originalError: `No characters to style after clamping`, details: { start, end, length } });
                throw new Error(JSON.stringify({ code: "empty_range", message: `No characters to style (text length ${length})`, details: { start, end, length } }));
            }
        } else {
            if (!(effectiveStart >= 0 && effectiveEnd <= length && effectiveStart < effectiveEnd)) {
                logger.error("❌ set_range_text_style failed", { code: "invalid_range", originalError: `Range [${start}, ${end}) invalid for length ${length}` , details: { start, end, length } });
                throw new Error(JSON.stringify({ code: "invalid_range", message: `Range [${start}, ${end}) is invalid for text length ${length}`, details: { start, end, length } }));
            }
        }

        // Style existence check using async API (required in dynamic-page access)
        try {
            const style = await figma.getStyleByIdAsync(textStyleId);
            if (!style || style.type !== 'TEXT') {
                let suggestions = [];
                try {
                    const local = typeof figma.getLocalTextStyles === 'function' ? figma.getLocalTextStyles() : [];
                    suggestions = Array.isArray(local) ? local.slice(0, 10).map(s => ({ id: s.id, name: s.name })) : [];
                } catch (_) {}
                logger.error("❌ set_range_text_style failed", { code: "style_not_found", originalError: `Text style not found or not a TEXT style`, details: { textStyleId, suggestions } });
                throw new Error(JSON.stringify({ code: "style_not_found", message: `Text style not found: ${textStyleId}`, details: { textStyleId, suggestions } }));
            }
        } catch (styleErr) {
            const msg = (styleErr && styleErr.message) || String(styleErr);
            const isAccess = msg && msg.toLowerCase().includes("documentaccess");
            const code = isAccess ? "document_access_denied" : "style_not_found";
            let suggestions = [];
            if (!isAccess) {
                try {
                    const local = typeof figma.getLocalTextStyles === 'function' ? figma.getLocalTextStyles() : [];
                    suggestions = Array.isArray(local) ? local.slice(0, 10).map(s => ({ id: s.id, name: s.name })) : [];
                } catch (_) {}
            }
            logger.error("❌ set_range_text_style failed", { code, originalError: msg, details: { textStyleId, suggestions } });
            throw new Error(JSON.stringify({ code, message: isAccess ? `Style lookup not permitted: ${msg}` : `Text style not found: ${textStyleId}`, details: { textStyleId, suggestions } }));
        }

        // Load fonts for the target range, handling MIXED font states
        const fontsToLoad = [];
        try {
            const fontName = node.fontName;
            if (fontName === figma.mixed) {
                for (let i = start; i < end; i++) {
                    const f = node.getRangeFontName(i, i + 1);
                    const key = `${f.family}__${f.style}`;
                    if (!fontsToLoad.some(x => x.family === f.family && x.style === f.style)) {
                        fontsToLoad.push({ family: f.family, style: f.style });
                    }
                }
            } else if (fontName && fontName.family && fontName.style) {
                fontsToLoad.push({ family: fontName.family, style: fontName.style });
            }
            for (const f of fontsToLoad) {
                await figma.loadFontAsync({ family: f.family, style: f.style });
            }
        } catch (fontErr) {
            logger.error("❌ set_range_text_style failed", { code: "font_load_failed", originalError: (fontErr && fontErr.message) || String(fontErr), details: { nodeId, fontsToLoad } });
            throw new Error(JSON.stringify({ code: "font_load_failed", message: `Failed to load required font(s) for range`, details: { nodeId, fontsToLoad } }));
        }

        // Apply the text style using the async API
        try {
            if (typeof node.setRangeTextStyleIdAsync === 'function') {
                await node.setRangeTextStyleIdAsync(effectiveStart, effectiveEnd, textStyleId);
            } else {
                // Fallback for older runtimes; may throw with dynamic-page access
                node.setRangeTextStyleId(effectiveStart, effectiveEnd, textStyleId);
            }
        } catch (applyErr) {
            const msg = (applyErr && applyErr.message) || String(applyErr);
            const code = msg && msg.toLowerCase().includes("documentaccess") ? "document_access_denied" : "set_style_failed";
            logger.error("❌ set_range_text_style failed", { code, originalError: msg, details: { nodeId, start: effectiveStart, end: effectiveEnd, textStyleId } });
            throw new Error(JSON.stringify({ code, message: `Failed to apply text style to range: ${msg}`, details: { nodeId, start: effectiveStart, end: effectiveEnd, textStyleId } }));
        }

        const clamped = useAutoClamp && (effectiveStart !== start || effectiveEnd !== end);
        const summary = `Applied text style ${textStyleId} to [${effectiveStart}, ${effectiveEnd}) on node ${nodeId}` + (clamped ? " (clamped)" : "");
        const payload = { success: true, summary, modifiedNodeIds: [nodeId], nodeId, start: effectiveStart, end: effectiveEnd, textStyleId, clamped: clamped || undefined, originalStart: clamped ? start : undefined, originalEnd: clamped ? end : undefined };
        logger.info("✅ set_range_text_style succeeded", { nodeId, start: effectiveStart, end: effectiveEnd, textStyleId, clamped });
        return payload;
    } catch (error) {
        // Ensure errors are structured
        try {
            const parsed = JSON.parse(error && error.message);
            if (parsed && parsed.code) throw error; // already structured
        } catch (_) {
            logger.error("❌ set_range_text_style failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: { nodeId, start, end, textStyleId } });
            throw new Error(JSON.stringify({ code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { nodeId, start, end, textStyleId } }));
        }
        throw error;
    }
}

// -------- TOOL INCOMPLETE : list_available_fonts --------
async function listAvailableFonts(params) {
    const { family, style, query, limit, includePostScriptName } = params || {};
    try {
        const fonts = await figma.listAvailableFontsAsync();

        // Map to minimal entries and optionally include PostScript name
        let entries = fonts.map((font) => {
            const base = { family: font.fontName.family, style: font.fontName.style };
            if (includePostScriptName && "fontPostScriptName" in font && font.fontPostScriptName) {
                return Object.assign({}, base, { postScriptName: font.fontPostScriptName });
            }
            return base;
        });

        // Normalize potential filters
        const toArray = (v) => (v == null ? null : Array.isArray(v) ? v : [v]);
        const families = toArray(family);
        const styles = toArray(style);
        const q = typeof query === "string" && query.trim().length > 0 ? query.trim().toLowerCase() : null;

        if (families && families.length > 0) {
            const familySet = new Set(families.map((f) => String(f).toLowerCase()));
            entries = entries.filter((e) => familySet.has(e.family.toLowerCase()));
        }
        if (styles && styles.length > 0) {
            const styleSet = new Set(styles.map((s) => String(s).toLowerCase()));
            entries = entries.filter((e) => styleSet.has(e.style.toLowerCase()));
        }
        if (q) {
            entries = entries.filter((e) => e.family.toLowerCase().includes(q) || e.style.toLowerCase().includes(q));
        }
        if (typeof limit === "number" && isFinite(limit) && limit > 0) {
            entries = entries.slice(0, Math.floor(limit));
        }

        logger.info("✅ list_available_fonts succeeded", {
            count: entries.length,
            filters: {
                family: families || undefined,
                style: styles || undefined,
                query: q || undefined,
                limit: limit || undefined,
                includePostScriptName: !!includePostScriptName,
            },
        });
        // Read-only tool: return the data directly
        return entries;
    } catch (error) {
        const msg = (error && error.message) || String(error);
        let code = "figma_api_error";
        const lower = msg.toLowerCase();
        if (lower.includes("not allowed") || lower.includes("permission") || lower.includes("denied")) {
            code = "permission_denied";
        }
        logger.error("❌ list_available_fonts failed", {
            code,
            originalError: msg,
            details: { params: { family, style, query, limit, includePostScriptName } },
        });
        throw new Error(
            JSON.stringify({
                code,
                message: "Failed to list available fonts",
                details: { params: { family, style, query, limit, includePostScriptName } },
            })
        );
    }
}

// ======================================================
// Section: Components (Local, Instances, Overrides)
// ======================================================
// -------- TOOL : get_local_components --------
async function getLocalComponents(params) {
  try {
    const { includeComponentSets = false, nameContains, onlyPublishable = false } = params || {};
    await figma.loadAllPagesAsync();

    const types = includeComponentSets ? ["COMPONENT", "COMPONENT_SET"] : ["COMPONENT"];
    let nodes = figma.root.findAllWithCriteria({ types });

    if (nameContains && typeof nameContains === "string" && nameContains.trim().length > 0) {
      const needle = nameContains.toLowerCase();
      nodes = nodes.filter((n) => (n && typeof n.name === "string") ? n.name.toLowerCase().includes(needle) : false);
    }

    if (onlyPublishable === true) {
      nodes = nodes.filter((n) => ("key" in n) && !!n.key);
    }

    const components = nodes.map((node) => ({
      id: node.id,
      name: node.name,
      key: "key" in node ? node.key : null,
      type: node.type,
    }));

    const payload = { count: components.length, components };
    logger.info("✅ get_local_components succeeded", { count: payload.count, includeComponentSets, onlyPublishable, nameContains: !!nameContains });
    return payload;
  } catch (error) {
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ get_local_components failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {}
    logger.error("❌ get_local_components failed", { code: "get_local_components_failed", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: "get_local_components_failed", message: "Failed to list local components", details: {} }));
  }
}


// -------- TOOL INCOMPLETE : create_component_instance --------
async function createComponentInstance(params) {
  const { componentKey, x = 0, y = 0, parentId } = params || {};

  // Validate required parameter
  if (!componentKey || typeof componentKey !== "string") {
    logger.error("❌ create_component_instance failed", { code: "missing_parameter", originalError: "componentKey is required", details: { componentKey } });
    throw new Error(JSON.stringify({ code: "missing_parameter", message: "Missing 'componentKey' parameter", details: { componentKey } }));
  }

  // Validate optional params
  if (x !== undefined && typeof x !== "number") {
    logger.error("❌ create_component_instance failed", { code: "invalid_parameter", originalError: "x must be a number", details: { x } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'x' must be a number", details: { x } }));
  }
  if (y !== undefined && typeof y !== "number") {
    logger.error("❌ create_component_instance failed", { code: "invalid_parameter", originalError: "y must be a number", details: { y } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'y' must be a number", details: { y } }));
  }
  if (parentId !== undefined && typeof parentId !== "string") {
    logger.error("❌ create_component_instance failed", { code: "invalid_parameter", originalError: "parentId must be a string", details: { parentId } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'parentId' must be a string", details: { parentId } }));
  }

  try {
    logger.info("🧩 Creating component instance", { componentKey, x, y, parentId });

    // Import component by key (may throw if invalid or not published)
    let component;
    try {
      component = await figma.importComponentByKeyAsync(componentKey);
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      const isPermission = /permission|access/i.test(originalError);
      const isMissing = /no published component|not found|404/i.test(originalError);
      const code = isMissing ? "component_not_found" : (isPermission ? "permission_denied" : "component_import_failed");
      logger.error("❌ create_component_instance failed", { code, originalError, details: { componentKey } });
      throw new Error(JSON.stringify({ code, message: `Failed to import component by key: ${originalError}`, details: { componentKey } }));
    }

    // Create instance
    let instance;
    try {
      instance = component.createInstance();
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      logger.error("❌ create_component_instance failed", { code: "instance_creation_failed", originalError, details: { componentKey } });
      throw new Error(JSON.stringify({ code: "instance_creation_failed", message: `Failed to create instance: ${originalError}`, details: { componentKey } }));
    }

    // Initial positioning (may be ignored in auto-layout parents)
    try {
      instance.x = x;
      instance.y = y;
    } catch (_) {
      // non-fatal; some nodes may not expose x/y in certain contexts
    }

    // Parent placement
    if (parentId) {
      const parentNode = await figma.getNodeByIdAsync(parentId);
      if (!parentNode) {
        logger.error("❌ create_component_instance failed", { code: "parent_not_found", originalError: "Parent node not found", details: { parentId } });
        throw new Error(JSON.stringify({ code: "parent_not_found", message: `Parent node not found with ID: ${parentId}` , details: { parentId } }));
      }
      if (!("appendChild" in parentNode)) {
        logger.error("❌ create_component_instance failed", { code: "invalid_parent", originalError: "Parent cannot accept children", details: { parentId, parentType: parentNode.type } });
        throw new Error(JSON.stringify({ code: "invalid_parent", message: `Parent node does not support children`, details: { parentId, parentType: parentNode.type } }));
      }
      try {
        parentNode.appendChild(instance);
      } catch (e) {
        const originalError = (e && e.message) || String(e);
        const isLocked = /lock/i.test(originalError);
        const code = isLocked ? "locked_parent" : "append_failed";
        logger.error("❌ create_component_instance failed", { code, originalError, details: { parentId } });
        throw new Error(JSON.stringify({ code, message: `Failed to append instance to parent ${parentId}: ${originalError}`, details: { parentId } }));
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    const result = {
      success: true,
      summary: `Placed instance '${instance.name}' at (${"x" in instance ? instance.x : x}, ${"y" in instance ? instance.y : y})`,
      modifiedNodeIds: [instance.id],
      node: {
        id: instance.id,
        name: instance.name,
        x: "x" in instance ? instance.x : x,
        y: "y" in instance ? instance.y : y,
        width: "width" in instance ? instance.width : undefined,
        height: "height" in instance ? instance.height : undefined,
        componentId: instance.componentId,
        parentId: instance.parent ? instance.parent.id : undefined,
      },
    };
    logger.info("✅ create_component_instance succeeded", { id: instance.id, name: instance.name });
    return result;
  } catch (error) {
    // Pass through structured errors when possible
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ create_component_instance failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // fall-through
    }
    const originalError = (error && error.message) || String(error);
    logger.error("❌ create_component_instance failed", { code: "create_component_instance_failed", originalError, details: { componentKey, x, y, parentId } });
    throw new Error(JSON.stringify({ code: "create_component_instance_failed", message: `Error creating component instance: ${originalError}`, details: { componentKey, x, y, parentId } }));
  }
}

// -------- TOOL : create_component --------
async function createComponent(params) {
  const { nodeId } = params || {};
  try {
    // Validate parameters
    if (nodeId === undefined || nodeId === null) {
      logger.error("❌ create_component failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "missing_parameter", message: "Missing 'nodeId' parameter.", details: { nodeId } }));
    }
    if (typeof nodeId !== "string") {
      logger.error("❌ create_component failed", { code: "invalid_parameter", originalError: "nodeId must be a string", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'nodeId' must be a string", details: { nodeId } }));
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
      logger.error("❌ create_component failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "node_not_found", message: `Node not found: ${nodeId}`, details: { nodeId } }));
    }

    let component;
    try {
      component = figma.createComponent();
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      logger.error("❌ create_component failed", { code: "creation_failed", originalError, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "creation_failed", message: `Failed to create component: ${originalError}`, details: { nodeId } }));
    }

    try {
      component.name = node.name || "Component";
      if (typeof node.width === "number" && typeof node.height === "number") {
  component.resize(node.width, node.height);
      }
      if (typeof node.x === "number") component.x = node.x;
      if (typeof node.y === "number") component.y = node.y;

  if ('children' in node) {
    for (const child of node.children) {
      component.appendChild(child.clone());
    }
      }
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      logger.error("❌ create_component failed", { code: "creation_failed", originalError, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "creation_failed", message: `Failed to configure component from node: ${originalError}`, details: { nodeId } }));
    }

    let instance;
    try {
      instance = component.createInstance();
      if (typeof node.x === "number") instance.x = node.x;
      if (typeof node.y === "number") instance.y = node.y;
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      logger.error("❌ create_component failed", { code: "instance_creation_failed", originalError, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "instance_creation_failed", message: `Failed to create instance: ${originalError}`, details: { nodeId } }));
    }

    try {
      const parent = node.parent;
      if (parent && 'appendChild' in parent) {
        parent.appendChild(instance);
  } else {
    figma.currentPage.appendChild(instance);
      }
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      const isLocked = /lock/i.test(originalError || "");
      const code = isLocked ? "locked_parent" : "append_failed";
      logger.error("❌ create_component failed", { code, originalError, details: { nodeId } });
      throw new Error(JSON.stringify({ code, message: `Failed to append instance to parent: ${originalError}`, details: { nodeId } }));
    }

    const result = {
    success: true,
      summary: `Created component '${component.name}' and placed an instance next to the original`,
      modifiedNodeIds: [component.id, instance.id],
    componentId: component.id,
    instanceId: instance.id,
    name: component.name,
  };
    logger.info("✅ create_component succeeded", { componentId: component.id, instanceId: instance.id, name: component.name });
    return result;
  } catch (error) {
    // If error is already structured, rethrow; else normalize
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ create_component failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // fall-through
    }
    const originalError = (error && error.message) || String(error);
    logger.error("❌ create_component failed", { code: "create_component_failed", originalError, details: { nodeId } });
    throw new Error(JSON.stringify({ code: "create_component_failed", message: `Error creating component: ${originalError}`, details: { nodeId } }));
  }
}

// -------- TOOL INCOMPLETE : publish_component --------
async function publishComponents(params) {
  const {
    description,
    cancelIfNoChanges = true,
    timeoutMs,
    includeComponents = true,
    includeComponentSets = true,
    includeStylesPaint = true,
    includeStylesText = true,
    includeStylesEffect = true,
    includeStylesGrid = true,
  } = params || {};

  function withTimeout(promise, ms) {
    if (!ms || typeof ms !== "number" || ms <= 0) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(JSON.stringify({ code: "timeout", message: `Publish timed out after ${ms}ms`, details: { timeoutMs: ms } }))), ms);
      promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }

  async function getChangedComponentsAndSets() {
    const changedComponentIds = [];
    const changedComponentSetIds = [];
    try {
      const nodes = figma.root.findAllWithCriteria({
        types: ["COMPONENT", "COMPONENT_SET"]
      });
      for (const n of nodes) {
        try {
          const status = await n.getPublishStatusAsync();
          if (status === "CHANGED") {
            if (n.type === "COMPONENT" && includeComponents) changedComponentIds.push(n.id);
            if (n.type === "COMPONENT_SET" && includeComponentSets) changedComponentSetIds.push(n.id);
          }
        } catch (_) {
          // Ignore publish status read failures for individual nodes
        }
      }
    } catch (_) {
      // fall-through; return what we have
    }
    return { changedComponentIds, changedComponentSetIds };
  }

  async function getChangedStyles() {
    const changedStyleIds = [];
    try {
      if (includeStylesPaint) {
        const paints = figma.getLocalPaintStyles();
        for (const s of paints) {
          try { const st = await s.getPublishStatusAsync(); if (st === "CHANGED") changedStyleIds.push(s.id); } catch (_) {}
        }
      }
      if (includeStylesText) {
        const texts = figma.getLocalTextStyles();
        for (const s of texts) {
          try { const st = await s.getPublishStatusAsync(); if (st === "CHANGED") changedStyleIds.push(s.id); } catch (_) {}
        }
      }
      if (includeStylesEffect) {
        const effects = figma.getLocalEffectStyles();
        for (const s of effects) {
          try { const st = await s.getPublishStatusAsync(); if (st === "CHANGED") changedStyleIds.push(s.id); } catch (_) {}
        }
      }
      if (includeStylesGrid) {
        const grids = figma.getLocalGridStyles();
        for (const s of grids) {
          try { const st = await s.getPublishStatusAsync(); if (st === "CHANGED") changedStyleIds.push(s.id); } catch (_) {}
        }
      }
    } catch (_) {
      // fall-through
    }
    return { changedStyleIds };
  }

  try {
    // Basic validation
    if (description !== undefined && typeof description !== "string") {
      logger.error("❌ publish_components failed", { code: "invalid_parameter", originalError: "'description' must be a string", details: { description } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'description' must be a string", details: { description } }));
    }
    const boolParams = [
      ["cancelIfNoChanges", cancelIfNoChanges],
      ["includeComponents", includeComponents],
      ["includeComponentSets", includeComponentSets],
      ["includeStylesPaint", includeStylesPaint],
      ["includeStylesText", includeStylesText],
      ["includeStylesEffect", includeStylesEffect],
      ["includeStylesGrid", includeStylesGrid],
    ];
    for (const [name, val] of boolParams) {
      if (val !== undefined && typeof val !== "boolean") {
        logger.error("❌ publish_components failed", { code: "invalid_parameter", originalError: `${name} must be a boolean`, details: { [name]: val } });
        throw new Error(JSON.stringify({ code: "invalid_parameter", message: `${name} must be a boolean`, details: { [name]: val } }));
      }
    }
    if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || timeoutMs <= 0)) {
      logger.error("❌ publish_components failed", { code: "invalid_parameter", originalError: "timeoutMs must be a positive number", details: { timeoutMs } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'timeoutMs' must be a positive number", details: { timeoutMs } }));
    }
    const nothingSelected = !includeComponents && !includeComponentSets && !includeStylesPaint && !includeStylesText && !includeStylesEffect && !includeStylesGrid;
    if (nothingSelected) {
      logger.error("❌ publish_components failed", { code: "no_targets_selected", originalError: "No categories selected to publish or check", details: {} });
      throw new Error(JSON.stringify({ code: "no_targets_selected", message: "Select at least one of components, component sets, or styles to consider.", details: {} }));
    }

    // Preflight: gather changed publishables
    const [{ changedComponentIds, changedComponentSetIds }, { changedStyleIds }] = await Promise.all([
      getChangedComponentsAndSets(),
      getChangedStyles(),
    ]);
    const counts = {
      components: changedComponentIds.length,
      componentSets: changedComponentSetIds.length,
      styles: changedStyleIds.length,
    };
    const totalChanged = counts.components + counts.componentSets + counts.styles;
    if (cancelIfNoChanges && totalChanged === 0) {
      logger.error("❌ publish_components failed", { code: "no_changes_to_publish", originalError: "No changed components/styles to publish", details: { counts } });
      throw new Error(JSON.stringify({ code: "no_changes_to_publish", message: "There are no changed components or styles to publish.", details: { counts } }));
    }

    // Execute publish
    let result;
    try {
      const msg = typeof description === "string" && description.length > 0 ? description : "Publishing library updates";
      result = await withTimeout(figma.publishAsync(msg), timeoutMs);
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      const isPermission = /permission|access|not allowed/i.test(originalError || "");
      const code = isPermission ? "permission_denied" : "publish_failed";
      logger.error("❌ publish_components failed", { code, originalError, details: {} });
      throw new Error(JSON.stringify({ code, message: `Failed to publish components/styles: ${originalError}` , details: {} }));
    }

    if (!result || result.ok !== true) {
      logger.error("❌ publish_components failed", { code: "publish_canceled", originalError: "User canceled the publish dialog", details: {} });
      throw new Error(JSON.stringify({ code: "publish_canceled", message: "Publishing was canceled by the user.", details: {} }));
    }

    const summaryParts = [];
    if (counts.components) summaryParts.push(`${counts.components} component${counts.components === 1 ? "" : "s"}`);
    if (counts.componentSets) summaryParts.push(`${counts.componentSets} component set${counts.componentSets === 1 ? "" : "s"}`);
    if (counts.styles) summaryParts.push(`${counts.styles} style${counts.styles === 1 ? "" : "s"}`);
    const summary = summaryParts.length ? `Published ${summaryParts.join(", ")}.` : "Published library with no detected local changes.";

    const payload = {
      success: true,
      summary,
      modifiedNodeIds: [...changedComponentIds, ...changedComponentSetIds],
      publishedComponentIds: changedComponentIds,
      publishedComponentSetIds: changedComponentSetIds,
      publishedStyleIds: changedStyleIds,
      counts,
    };
    logger.info("✅ publish_components succeeded", { counts });
    return payload;
  } catch (error) {
    // If error is already structured, rethrow; else normalize
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ publish_components failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      // fall-through
    }
    const originalError = (error && error.message) || String(error);
    logger.error("❌ publish_components failed", { code: "publish_failed", originalError, details: {} });
    throw new Error(JSON.stringify({ code: "publish_failed", message: `Error publishing components/styles: ${originalError}`, details: {} }));
  }
}

 

// ======================================================
// Section: Assets (Export, Create Image, Get Image By Hash)
// ======================================================
// -------- TOOL : export_node_as_image --------
async function exportNodeAsImage(params) {
  const { 
    nodeId, 
    format = "PNG", 
    scale, 
    width, 
    height,
    contentsOnly,
    useAbsoluteBounds,
    suffix,
    colorProfile,
    svgOutlineText,
    svgIdAttribute,
    svgSimplifyStroke
  } = params || {};

  logger.info("📷 Starting export_node_as_image", { nodeId, format });

  // Validate required parameters
  if (!nodeId) {
    const errorPayload = { 
      code: "missing_parameter", 
      message: "Missing required parameter: nodeId",
      details: { parameter: "nodeId" }
    };
    logger.error("❌ export_node_as_image failed", { code: "missing_parameter", nodeId });
    throw new Error(JSON.stringify(errorPayload));
  }

  // Get the node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    const errorPayload = { 
      code: "node_not_found", 
      message: `Node not found with ID: ${nodeId}`,
      details: { nodeId }
    };
    logger.error("❌ export_node_as_image failed", { code: "node_not_found", nodeId });
    throw new Error(JSON.stringify(errorPayload));
  }

  // Check if node supports exporting
  if (!("exportAsync" in node)) {
    const errorPayload = { 
      code: "export_not_supported", 
      message: `Node type '${node.type}' does not support exporting`,
      details: { nodeId, nodeType: node.type }
    };
    logger.error("❌ export_node_as_image failed", { code: "export_not_supported", nodeId, nodeType: node.type });
    throw new Error(JSON.stringify(errorPayload));
  }

  try {
    // Build export settings based on format
    let settings;
    
    if (format === "PNG" || format === "JPG") {
      // Image export settings
      settings = { format };
      
      // Add constraint (scale, width, or height)
      if (width) {
        settings.constraint = { type: "WIDTH", value: width };
      } else if (height) {
        settings.constraint = { type: "HEIGHT", value: height };
      } else {
        settings.constraint = { type: "SCALE", value: scale || 1 };
      }
      
      // Add optional image settings
      if (contentsOnly !== undefined) settings.contentsOnly = contentsOnly;
      if (useAbsoluteBounds !== undefined) settings.useAbsoluteBounds = useAbsoluteBounds;
      if (suffix !== undefined) settings.suffix = suffix;
      if (colorProfile !== undefined) settings.colorProfile = colorProfile;
      
    } else if (format === "SVG") {
      // SVG export settings
      settings = { format };
      
      if (svgOutlineText !== undefined) settings.svgOutlineText = svgOutlineText;
      if (svgIdAttribute !== undefined) settings.svgIdAttribute = svgIdAttribute;
      if (svgSimplifyStroke !== undefined) settings.svgSimplifyStroke = svgSimplifyStroke;
      if (contentsOnly !== undefined) settings.contentsOnly = contentsOnly;
      if (useAbsoluteBounds !== undefined) settings.useAbsoluteBounds = useAbsoluteBounds;
      if (suffix !== undefined) settings.suffix = suffix;
      if (colorProfile !== undefined) settings.colorProfile = colorProfile;
      
    } else if (format === "SVG_STRING") {
      // SVG string export settings
      settings = { format: "SVG_STRING" };
      
      if (svgOutlineText !== undefined) settings.svgOutlineText = svgOutlineText;
      if (svgIdAttribute !== undefined) settings.svgIdAttribute = svgIdAttribute;
      if (svgSimplifyStroke !== undefined) settings.svgSimplifyStroke = svgSimplifyStroke;
      if (contentsOnly !== undefined) settings.contentsOnly = contentsOnly;
      if (useAbsoluteBounds !== undefined) settings.useAbsoluteBounds = useAbsoluteBounds;
      if (suffix !== undefined) settings.suffix = suffix;
      if (colorProfile !== undefined) settings.colorProfile = colorProfile;
      
    } else if (format === "PDF") {
      // PDF export settings
      settings = { format };
      
      if (contentsOnly !== undefined) settings.contentsOnly = contentsOnly;
      if (useAbsoluteBounds !== undefined) settings.useAbsoluteBounds = useAbsoluteBounds;
      if (suffix !== undefined) settings.suffix = suffix;
      if (colorProfile !== undefined) settings.colorProfile = colorProfile;
      
    } else if (format === "JSON_REST_V1") {
      // REST API export settings
      settings = { format: "JSON_REST_V1" };
      
    } else {
      const errorPayload = { 
        code: "invalid_format", 
        message: `Unsupported export format: ${format}. Supported formats: PNG, JPG, SVG, SVG_STRING, PDF, JSON_REST_V1`,
        details: { format, supportedFormats: ["PNG", "JPG", "SVG", "SVG_STRING", "PDF", "JSON_REST_V1"] }
      };
      logger.error("❌ export_node_as_image failed", { code: "invalid_format", format });
      throw new Error(JSON.stringify(errorPayload));
    }

    logger.info("📷 Exporting with settings", { settings });
    const exportResult = await node.exportAsync(settings);

    // Handle different result types
    let result;
    if (format === "SVG_STRING") {
      // SVG_STRING returns a string directly
      result = {
        nodeId,
        format,
        mimeType: "image/svg+xml",
        data: exportResult,
        settings: settings
      };
    } else if (format === "JSON_REST_V1") {
      // JSON_REST_V1 returns a structured object
      result = {
        nodeId,
        format,
        mimeType: "application/json",
        data: exportResult,
        settings: settings
      };
    } else {
      // Image formats (PNG, JPG, SVG, PDF) return Uint8Array
      let mimeType;
      switch (format) {
        case "PNG":
          mimeType = "image/png";
          break;
        case "JPG":
          mimeType = "image/jpeg";
          break;
        case "SVG":
          mimeType = "image/svg+xml";
          break;
        case "PDF":
          mimeType = "application/pdf";
          break;
        default:
          mimeType = "application/octet-stream";
      }

      // Convert Uint8Array to base64
      const base64 = customBase64Encode(exportResult);
      
      result = {
        nodeId,
        format,
        mimeType,
        imageData: base64,
        settings: settings
      };
    }

    logger.info("✅ export_node_as_image completed successfully", { nodeId, format, dataSize: (result.imageData && result.imageData.length) || (result.data && result.data.length) || 0 });
    return result;

  } catch (error) {
    const errorPayload = { 
      code: "export_failed", 
      message: `Failed to export node: ${error.message}`,
      details: { nodeId, format, originalError: error.message }
    };
    logger.error("❌ export_node_as_image failed", { code: "export_failed", originalError: error.message, nodeId, format });
    throw new Error(JSON.stringify(errorPayload));
  }
}

function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3 = 2^2 - 1

    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}

 

// -------- TOOL : set_corner_radius --------
async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    const error = {
      code: "missing_node_id",
      message: "Missing nodeId parameter",
      details: {}
    };
    logger.error("❌ set_corner_radius failed", { code: error.code, originalError: error.message });
    throw new Error(JSON.stringify(error));
  }

  if (radius === undefined) {
    const error = {
      code: "missing_radius",
      message: "Missing radius parameter",
      details: {}
    };
    logger.error("❌ set_corner_radius failed", { code: error.code, originalError: error.message });
    throw new Error(JSON.stringify(error));
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    const error = {
      code: "node_not_found",
      message: `Node not found with ID: ${nodeId}`,
      details: { nodeId }
    };
    logger.error("❌ set_corner_radius failed", { code: error.code, originalError: error.message, details: error.details });
    throw new Error(JSON.stringify(error));
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    const error = {
      code: "unsupported_node_type",
      message: `Node does not support corner radius: ${nodeId}`,
      details: { nodeId, nodeType: node.type }
    };
    logger.error("❌ set_corner_radius failed", { code: error.code, originalError: error.message, details: error.details });
    throw new Error(JSON.stringify(error));
  }

  // Store original values for summary
  const originalRadius = node.cornerRadius;
  const originalCorners = {
    topLeft: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRight: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRight: "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeft: "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined
  };

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  const result = {
    success: true,
    summary: corners 
      ? `Set corner radius to ${radius}px for selected corners on "${node.name}"`
      : `Set uniform corner radius to ${radius}px on "${node.name}"`,
    modifiedNodeIds: [node.id],
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };

  logger.info(`✅ set_corner_radius succeeded: ${result.summary}`);
  return result;
}

// -------- TOOL : set_text_content --------
async function setTextContent(params) {
  const { nodeId, text, smartStrategy, fallbackFont, select } = params || {};

  if (!nodeId || typeof nodeId !== "string") {
    logger.error("❌ set_text_content failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
    throw new Error(JSON.stringify({ code: "missing_parameter", message: "Missing required parameter 'nodeId'", details: { nodeId } }));
  }

  if (text === undefined || text === null) {
    logger.error("❌ set_text_content failed", { code: "missing_parameter", originalError: "text is required", details: { text } });
    throw new Error(JSON.stringify({ code: "missing_parameter", message: "Missing required parameter 'text'", details: {} }));
  }

  // Validate smartStrategy when provided
  const allowedStrategies = ["prevail", "strict", "experimental"];
  if (smartStrategy !== undefined && smartStrategy !== null && !allowedStrategies.includes(smartStrategy)) {
    logger.error("❌ set_text_content failed", { code: "invalid_parameter", originalError: "Invalid smartStrategy", details: { smartStrategy, allowed: allowedStrategies } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Invalid 'smartStrategy' value", details: { smartStrategy, allowed: allowedStrategies } }));
  }

  // Validate fallbackFont when provided
  let validatedFallbackFont = undefined;
  if (fallbackFont !== undefined) {
    if (fallbackFont && typeof fallbackFont === "object" && typeof fallbackFont.family === "string" && typeof fallbackFont.style === "string") {
      validatedFallbackFont = { family: fallbackFont.family, style: fallbackFont.style };
    } else {
      logger.error("❌ set_text_content failed", { code: "invalid_parameter", originalError: "fallbackFont must be { family, style }", details: { fallbackFont } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'fallbackFont' must be an object with string family and style", details: {} }));
    }
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    logger.error("❌ set_text_content failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
    throw new Error(JSON.stringify({ code: "node_not_found", message: `Node not found`, details: { nodeId } }));
  }

  if (node.type !== "TEXT") {
    logger.error("❌ set_text_content failed", { code: "invalid_node_type", originalError: `Node is not a TEXT node`, details: { nodeId, nodeType: node.type } });
    throw new Error(JSON.stringify({ code: "invalid_node_type", message: `Node is not a TEXT node`, details: { nodeId, nodeType: node.type } }));
  }

  if (node.locked === true) {
    logger.error("❌ set_text_content failed", { code: "node_locked", originalError: `Node is locked`, details: { nodeId } });
    throw new Error(JSON.stringify({ code: "node_locked", message: `Node is locked`, details: { nodeId } }));
  }

  try {
    // Only load a concrete font; figma.mixed cannot be loaded
    try {
      if (node.fontName !== figma.mixed) {
        await figma.loadFontAsync(node.fontName);
      }
    } catch (_) {}

    const textValue = typeof text === "string" ? text : String(text);
    const options = (smartStrategy || validatedFallbackFont) ? { smartStrategy, fallbackFont: validatedFallbackFont } : undefined;
    const ok = await setCharacters(node, textValue, options);
    if (!ok) {
      logger.error("❌ set_text_content failed", { code: "set_characters_failed", originalError: "Failed to set characters", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "set_characters_failed", message: "Failed to set characters on text node", details: { nodeId } }));
    }

    if (select === true) {
      try { figma.currentPage.selection = [node]; } catch (_) {}
    }

    let fontNameResult = null;
    try {
      fontNameResult = (node.fontName === figma.mixed) ? "MIXED" : node.fontName;
    } catch (_) { fontNameResult = null; }

    const payload = {
      success: true,
      summary: `Updated text content on '${node.name}'`,
      modifiedNodeIds: [node.id],
      nodeId: node.id,
      name: node.name,
      characters: node.characters,
      fontName: fontNameResult,
      smartStrategy: smartStrategy || null,
    };
    logger.info("✅ set_text_content succeeded", { nodeId: node.id, name: node.name, textLength: textValue.length });
    return payload;
  } catch (error) {
    try {
      const parsed = JSON.parse(error && error.message ? error.message : String(error));
      if (parsed && parsed.code) {
        logger.error("❌ set_text_content failed", { code: parsed.code, originalError: (error && error.message) || String(error), details: parsed.details || {} });
        throw new Error(JSON.stringify(parsed));
      }
    } catch (_) {
      // Not JSON, normalize
    }
    logger.error("❌ set_text_content failed", { code: "set_text_content_failed", originalError: (error && error.message) || String(error), details: { nodeId } });
    throw new Error(JSON.stringify({ code: "set_text_content_failed", message: `Error setting text content: ${(error && error.message) || String(error)}`, details: { nodeId } }));
  }
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return Array.from(
    arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values()
  );
}
// ======================================================
// Section: Text Helpers (Font loading and character utilities) INCOMPLETE
// ======================================================
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1]
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  console.log(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      console.log(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    })
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0]
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all(fontsToLoad.concat([fallbackFont]).map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// ======================================================
// Section: Batch Operations (Scanning and Bulk Text Updates)
// ======================================================
// -------- TOOL : scan_text_nodes --------
async function scanTextNodes(params) {
  try {
    const {
      nodeId,
      useChunking = true,
      chunkSize = 10,
      includeInvisible = false,
      highlight = true,
      maxDepth,
      textFilter,
      caseSensitive = false,
      includeCharacters = true,
      commandId = generateCommandId(),
    } = params || {};

    if (!nodeId || typeof nodeId !== "string") {
      logger.error("scan_text_nodes failed", { code: "missing_parameter", originalError: "'nodeId' is required", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "missing_parameter", message: "'nodeId' is required", details: { nodeId } }));
    }
    if (typeof useChunking !== "boolean") {
      logger.error("scan_text_nodes failed", { code: "invalid_parameter", originalError: "'useChunking' must be boolean", details: { useChunking } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'useChunking' must be boolean", details: { useChunking } }));
    }
    if (chunkSize != null && (!Number.isFinite(chunkSize) || chunkSize <= 0)) {
      logger.error("scan_text_nodes failed", { code: "invalid_parameter", originalError: "'chunkSize' must be a positive number", details: { chunkSize } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'chunkSize' must be a positive number", details: { chunkSize } }));
    }
    if (maxDepth != null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
      logger.error("scan_text_nodes failed", { code: "invalid_parameter", originalError: "'maxDepth' must be a non-negative integer", details: { maxDepth } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'maxDepth' must be a non-negative integer", details: { maxDepth } }));
    }
    if (textFilter != null && typeof textFilter !== "string") {
      logger.error("scan_text_nodes failed", { code: "invalid_parameter", originalError: "'textFilter' must be a string", details: { textFilter } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'textFilter' must be a string", details: { textFilter } }));
    }

    logger.info("🔎 Starting to scan text nodes", { nodeId, useChunking, chunkSize, includeInvisible, highlight, maxDepth, hasTextFilter: !!textFilter, caseSensitive, includeCharacters });

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const message = `Node not found`;
      sendProgressUpdate(commandId, "scan_text_nodes", "error", 0, 0, 0, message, { nodeId });
      logger.error("❌ scan_text_nodes failed", { code: "node_not_found", originalError: message, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "node_not_found", message, details: { nodeId } }));
    }

    const matchesFilter = (chars) => {
      if (!textFilter) return true;
      try {
        if (chars == null) return false;
        const source = String(chars);
        return caseSensitive ? source.includes(textFilter) : source.toLowerCase().includes(textFilter.toLowerCase());
      } catch (_) { return false; }
    };

    if (!useChunking) {
      const textNodes = [];
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "started",
        0,
        1,
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null
      );

      await findTextNodes(node, [], 0, textNodes, { includeInvisible, highlight, maxDepth, includeCharacters });

      const filtered = textNodes.filter(n => matchesFilter(n.characters));

      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "completed",
        100,
        filtered.length,
        filtered.length,
        `Scan complete. Found ${filtered.length} text nodes.`,
        { textNodes: filtered }
      );

      const payload = { nodesCount: filtered.length, textNodes: filtered, commandId };
      logger.info("✅ scan_text_nodes succeeded", { nodesCount: payload.nodesCount });
      return payload;
    }

    logger.info("⏩ Using chunked scanning", { chunkSize });
    const nodesToProcess = [];
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "started",
      0,
      0,
      0,
      `Starting chunked scan of node "${node.name || nodeId}"`,
      { chunkSize }
    );

    await collectNodesToProcess(node, [], 0, nodesToProcess, { includeInvisible, maxDepth });

    const totalNodes = nodesToProcess.length;
    const totalChunks = Math.ceil(totalNodes / chunkSize);

    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      5,
      totalNodes,
      0,
      `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
      { totalNodes, totalChunks, chunkSize }
    );

    const allTextNodes = [];
    let processedNodes = 0;
    let chunksProcessed = 0;

    for (let i = 0; i < totalNodes; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, totalNodes);
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "in_progress",
        Math.round(5 + (chunksProcessed / totalChunks) * 90),
        totalNodes,
        processedNodes,
        `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
        { currentChunk: chunksProcessed + 1, totalChunks, textNodesFound: allTextNodes.length }
      );

      const chunkNodes = nodesToProcess.slice(i, chunkEnd);
      const chunkTextNodes = [];

      for (const nodeInfo of chunkNodes) {
        if (nodeInfo.node.type === "TEXT") {
          try {
            const textNodeInfo = await processTextNode(
              nodeInfo.node,
              nodeInfo.parentPath,
              nodeInfo.depth,
              { highlight, includeCharacters }
            );
            if (textNodeInfo && matchesFilter(textNodeInfo.characters)) {
              chunkTextNodes.push(textNodeInfo);
            }
          } catch (error) {
            logger.error("scan_text_nodes text node processing failed", { code: "process_text_node_failed", originalError: (error && error.message) || String(error) });
          }
        }
        await delay(5);
      }

      Array.prototype.push.apply(allTextNodes, chunkTextNodes);
      processedNodes += chunkNodes.length;
      chunksProcessed++;

      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "in_progress",
        Math.round(5 + (chunksProcessed / totalChunks) * 90),
        totalNodes,
        processedNodes,
        `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
        { currentChunk: chunksProcessed, totalChunks, processedNodes, textNodesFound: allTextNodes.length, chunkResult: chunkTextNodes }
      );

      if (i + chunkSize < totalNodes) {
        await delay(50);
      }
    }

    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "completed",
      100,
      totalNodes,
      processedNodes,
      `Scan complete. Found ${allTextNodes.length} text nodes.`,
      { textNodes: allTextNodes, processedNodes, chunks: chunksProcessed }
    );

    const payload = { nodesCount: allTextNodes.length, textNodes: allTextNodes, commandId };
    logger.info("✅ scan_text_nodes succeeded", { nodesCount: payload.nodesCount });
    return payload;
  } catch (error) {
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ scan_text_nodes failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {}
    logger.error("❌ scan_text_nodes failed", { code: "scan_failed", originalError: (error && error.message) || String(error) });
    throw new Error(JSON.stringify({ code: "scan_failed", message: "Failed to scan text nodes", details: {} }));
  }
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(
  node,
  parentPath = [],
  depth = 0,
  nodesToProcess = [],
  opts = {}
) {
  const { includeInvisible = false, maxDepth } = opts || {};
  if (typeof maxDepth === "number" && depth > maxDepth) return;
  if (!includeInvisible && node.visible === false) return;

  // Get the path to this node
  const nodePath = parentPath.concat([node.name || `Unnamed ${node.type}`]);

  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth,
  });

  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess, opts);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth, opts = {}) {
  if (node.type !== "TEXT") return null;
  const { highlight = true, includeCharacters = true } = opts || {};

  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };
    if (includeCharacters) {
      safeTextNode.characters = node.characters;
    }

    if (highlight) {
      try {
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [ { type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.3 } ];
        await delay(100);
        try { node.fills = originalFills; } catch (err) { logger.error("scan_text_nodes highlight reset failed", { code: "highlight_reset_failed", originalError: (err && err.message) || String(err) }); }
      } catch (highlightErr) {
        logger.error("scan_text_nodes highlight failed", { code: "highlight_failed", originalError: (highlightErr && highlightErr.message) || String(highlightErr) });
      }
    }

    return safeTextNode;
  } catch (nodeErr) {
    logger.error("scan_text_nodes processing failed", { code: "process_text_node_failed", originalError: (nodeErr && nodeErr.message) || String(nodeErr) });
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = [], opts = {}) {
  const { includeInvisible = false, highlight = true, maxDepth, includeCharacters = true } = opts || {};
  if (typeof maxDepth === "number" && depth > maxDepth) return;
  if (!includeInvisible && node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = parentPath.concat([node.name || `Unnamed ${node.type}`]);

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };
      if (includeCharacters) {
        safeTextNode.characters = node.characters;
      }
      if (highlight) {
        try {
          const originalFills = JSON.parse(JSON.stringify(node.fills));
          node.fills = [ { type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.3 } ];
          await delay(500);
          try { node.fills = originalFills; } catch (err) { logger.error("scan_text_nodes highlight reset failed", { code: "highlight_reset_failed", originalError: (err && err.message) || String(err) }); }
        } catch (highlightErr) {
          logger.error("scan_text_nodes highlight failed", { code: "highlight_failed", originalError: (highlightErr && highlightErr.message) || String(highlightErr) });
        }
      }

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes, opts);
    }
  }
}

// Replace text in a specific node
// -------- TOOL : set_multiple_text_contents --------
async function setMultipleTextContents(params) {
  const {
    nodeId,
    text,
    smartStrategy,
    fallbackFont,
    select,
    chunkSize,
    delayMsBetweenChunks,
    highlight,
    skipLocked,
    stopOnFailure,
    ignoreMissing,
    previewOnly,
  } = params || {};
  const commandId = (params && params.commandId) || generateCommandId();

  // Validate required params
  if (!nodeId || typeof nodeId !== "string") {
    logger.error("❌ set_multiple_text_contents failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
    throw new Error(JSON.stringify({ code: "missing_parameter", message: "Missing required parameter 'nodeId'", details: { nodeId } }));
  }
  if (!Array.isArray(text)) {
    logger.error("❌ set_multiple_text_contents failed", { code: "invalid_parameter", originalError: "'text' must be an array", details: { textType: typeof text } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Parameter 'text' must be an array of { nodeId, text }", details: {} }));
  }
  if (text.length === 0 && !previewOnly) {
    logger.error("❌ set_multiple_text_contents failed", { code: "invalid_parameter", originalError: "'text' cannot be empty", details: {} });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Parameter 'text' cannot be empty", details: {} }));
  }

  // Validate optional parameters
  const allowedStrategies = ["prevail", "strict", "experimental"];
  if (smartStrategy !== undefined && smartStrategy !== null && !allowedStrategies.includes(smartStrategy)) {
    logger.error("❌ set_multiple_text_contents failed", { code: "invalid_parameter", originalError: "Invalid smartStrategy", details: { smartStrategy, allowed: allowedStrategies } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Invalid 'smartStrategy' value", details: { smartStrategy, allowed: allowedStrategies } }));
  }
  let validatedFallbackFont = undefined;
  if (fallbackFont !== undefined) {
    if (fallbackFont && typeof fallbackFont === "object" && typeof fallbackFont.family === "string" && typeof fallbackFont.style === "string") {
      validatedFallbackFont = { family: fallbackFont.family, style: fallbackFont.style };
    } else {
      logger.error("❌ set_multiple_text_contents failed", { code: "invalid_parameter", originalError: "fallbackFont must be { family, style }", details: { fallbackFont } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'fallbackFont' must be an object with string family and style", details: {} }));
    }
  }
  const CHUNK_SIZE = Number.isInteger(chunkSize) && chunkSize > 0 && chunkSize <= 50 ? chunkSize : 5;
  const INTER_CHUNK_DELAY = Number.isInteger(delayMsBetweenChunks) && delayMsBetweenChunks >= 0 ? delayMsBetweenChunks : 1000;
  const SHOULD_HIGHLIGHT = highlight !== false; // default true
  const SKIP_LOCKED = skipLocked !== false; // default true
  const STOP_ON_FAILURE = stopOnFailure === true; // default false
  const IGNORE_MISSING = ignoreMissing === true; // default false
  const PREVIEW_ONLY = previewOnly === true; // default false

  // Normalize entries and validate each replacement shape quickly
  const replacements = text.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      return { __invalid: true, index: idx, reason: "invalid_entry_type" };
    }
    const nid = entry.nodeId;
    const t = entry.text;
    if (typeof nid !== "string") {
      return { __invalid: true, index: idx, reason: "missing_node_id", nodeId: nid };
    }
    if (t === undefined || t === null) {
      return { __invalid: true, index: idx, reason: "missing_text", nodeId: nid };
    }
    return { nodeId: nid, text: String(t) };
  });

  const invalidEntries = replacements.filter(r => r.__invalid);
  if (invalidEntries.length > 0) {
    logger.error("❌ set_multiple_text_contents failed", { code: "invalid_parameter", originalError: "Invalid replacement entries", details: { invalidCount: invalidEntries.length } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "Some replacement entries are invalid", details: { invalidCount: invalidEntries.length } }));
  }

  logger.info("🛠️ set_multiple_text_contents starting", { nodeId, totalReplacements: replacements.length, chunkSize: CHUNK_SIZE, previewOnly: PREVIEW_ONLY });

  // Emit progress: started
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    replacements.length,
    0,
    `Starting text replacement for ${replacements.length} nodes`,
    { totalReplacements: replacements.length }
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;
  let stoppedEarly = false;

  // Split into chunks
  const chunks = [];
  for (let i = 0; i < replacements.length; i += CHUNK_SIZE) {
    chunks.push(replacements.slice(i, i + CHUNK_SIZE));
  }

  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5,
    replacements.length,
    0,
    `Preparing to replace text using ${chunks.length} chunks`,
    { totalReplacements: replacements.length, chunks: chunks.length, chunkSize: CHUNK_SIZE }
  );

  // Process each chunk sequentially to avoid UI freezes
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];

    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      replacements.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount }
    );

    // Process in parallel within a chunk
    const chunkPromises = chunk.map(async (replacement) => {
      const { nodeId: targetId, text: nextText } = replacement;
      try {
        // Resolve node
        const textNode = await figma.getNodeByIdAsync(targetId);
        if (!textNode) {
          return { success: false, nodeId: targetId, errorCode: "node_not_found", errorMessage: `Node not found: ${targetId}` };
        }
        if (textNode.type !== "TEXT") {
          return { success: false, nodeId: targetId, errorCode: "invalid_node_type", errorMessage: `Node is not a TEXT node: ${textNode.type}` };
        }
        if (textNode.locked === true) {
          if (SKIP_LOCKED) {
            return { success: false, nodeId: targetId, errorCode: "node_locked", errorMessage: `Node is locked` };
          } else {
            return { success: false, nodeId: targetId, errorCode: "node_locked", errorMessage: `Node is locked` };
          }
        }

        const originalText = textNode.characters;

        if (PREVIEW_ONLY) {
          return { success: true, nodeId: targetId, originalText, translatedText: nextText, preview: true };
        }

        // Optional highlight
        let originalFills;
        if (SHOULD_HIGHLIGHT) {
          try {
            originalFills = JSON.parse(JSON.stringify(textNode.fills));
            textNode.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.3 }];
          } catch (_) {
            // ignore highlight errors
          }
        }

        // Delegate to setTextContent to handle font loading and replacement with structured errors
        try {
          await setTextContent({ nodeId: targetId, text: nextText, smartStrategy, fallbackFont: validatedFallbackFont });
        } catch (err) {
          try {
            const parsed = JSON.parse(err && err.message ? err.message : String(err));
            return { success: false, nodeId: targetId, errorCode: parsed.code || "set_text_content_failed", errorMessage: parsed.message || String(err) };
          } catch (_) {
            return { success: false, nodeId: targetId, errorCode: "set_text_content_failed", errorMessage: (err && err.message) || String(err) };
          }
        }

        // Restore highlight
        if (originalFills) {
          try { await delay(500); textNode.fills = originalFills; } catch (_) {}
        }

        return { success: true, nodeId: targetId, originalText, translatedText: nextText };
      } catch (error) {
        return { success: false, nodeId: targetId, errorCode: "unexpected_error", errorMessage: (error && error.message) || String(error) };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);

    for (const r of chunkResults) {
      if (r && r.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(r);
    }

    // Emit per-chunk completion update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      replacements.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
      { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount, chunkResults }
    );

    if (STOP_ON_FAILURE && failureCount > 0) {
      stoppedEarly = true;
      break;
    }

    if (chunkIndex < chunks.length - 1 && INTER_CHUNK_DELAY > 0) {
      try { await delay(INTER_CHUNK_DELAY); } catch (_) {}
    }
  }

  const modifiedNodeIds = results.filter(r => r && r.success).map(r => r.nodeId);

  // Optionally select modified nodes
  if (select === true && !PREVIEW_ONLY) {
    try {
      const nodes = [];
      for (const id of modifiedNodeIds) {
        const n = await figma.getNodeByIdAsync(id);
        if (n) nodes.push(n);
      }
      if (nodes.length > 0) figma.currentPage.selection = nodes;
    } catch (_) {}
  }

  // Completed progress
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "completed",
    100,
    replacements.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    { totalReplacements: replacements.length, replacementsApplied: successCount, replacementsFailed: failureCount, completedInChunks: Math.max(1, chunks.length), results, stoppedEarly, preview: PREVIEW_ONLY }
  );

  if (successCount === 0 && !PREVIEW_ONLY) {
    // Nothing was applied → specialize error for better self-correction
    const failures = results.filter(r => !r.success);
    const byCode = failures.reduce((acc, r) => { const c = r.errorCode || "unknown"; (acc[c] = acc[c] || []).push(r.nodeId); return acc; }, {});
    let code = "all_replacements_failed";
    if (byCode["node_locked"] && Object.keys(byCode).length === 1) code = "locked_nodes";
    else if (byCode["node_not_found"] && Object.keys(byCode).length === 1) code = "nodes_not_found";
    else if (byCode["invalid_node_type"] && Object.keys(byCode).length === 1) code = "invalid_node_types";
    const details = { nodeId, total: replacements.length, failureCount, failureGroups: byCode };
    logger.error("❌ set_multiple_text_contents failed", { code, originalError: "No replacements succeeded", details });
    throw new Error(JSON.stringify({ code, message: "No replacements succeeded", details }));
  }

  const payload = {
    success: true,
    summary: PREVIEW_ONLY
      ? `Previewed ${replacements.length} text updates (no changes applied)`
      : `Applied ${successCount}/${replacements.length} text updates (${failureCount} failed)` ,
    modifiedNodeIds,
    nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: replacements.length,
    results,
    completedInChunks: Math.max(1, chunks.length),
    stoppedEarly: stoppedEarly || undefined,
    preview: PREVIEW_ONLY || undefined,
    commandId,
  };
  logger.info("✅ set_multiple_text_contents succeeded", { nodeId, applied: successCount, failed: failureCount, preview: PREVIEW_ONLY });
  return payload;
}

// ======================================================
// Section: Progress & Command Utilities
// ======================================================
// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return (
    "cmd_" +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// Progress helper to standardize progress updates and emoji logs
function withProgress(commandType, totalItems, runner) {
  const commandId = generateCommandId();
  const api = {
    id: commandId,
    start(message, payload) {
      return sendProgressUpdate(commandId, commandType, "started", 0, totalItems || 0, 0, message || `Starting ${commandType}`, payload);
    },
    update(processed, message, payload) {
      const progress = totalItems && totalItems > 0 ? Math.min(1, processed / totalItems) : 0;
      return sendProgressUpdate(commandId, commandType, "in_progress", progress, totalItems || 0, processed || 0, message || "", payload);
    },
    complete(message, payload) {
      return sendProgressUpdate(commandId, commandType, "completed", 1, totalItems || 0, totalItems || 0, message || `Completed ${commandType}`, payload);
    }
  };
  return runner(api);
}

 

// ======================================================
// Section: Batch Operations (Node Type Scan)
// ======================================================
/**
 * Scan for nodes with specific types within a node
 * @param {Object} params - Parameters object
 * @param {string} params.nodeId - ID of the node to scan within
 * @param {Array<string>} params.types - Array of node types to find (e.g. ['COMPONENT', 'FRAME'])
 * @returns {Object} - Object containing found nodes
 */
// -------- TOOL : scan_nodes_by_types --------
async function scanNodesByTypes(params) {
  try {
    const { nodeId, types } = params || {};

    if (!nodeId || typeof nodeId !== "string") {
      logger.error("scan_nodes_by_types failed", { code: "missing_parameter", originalError: "nodeId is required", details: { nodeId } });
      throw new Error(JSON.stringify({ code: "missing_parameter", message: "'nodeId' is required", details: { nodeId } }));
    }
    if (!Array.isArray(types) || types.length === 0) {
      logger.error("scan_nodes_by_types failed", { code: "invalid_parameter", originalError: "types must be a non-empty string[]", details: { types } });
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'types' must be a non-empty array of strings", details: { types } }));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      logger.error("scan_nodes_by_types failed", { code: "node_not_found", originalError: `Node not found`, details: { nodeId } });
      throw new Error(JSON.stringify({ code: "node_not_found", message: `Node with ID ${nodeId} not found`, details: { nodeId } }));
    }

    const matchingNodes = [];

    const commandId = generateCommandId();
    sendProgressUpdate(
      commandId,
      "scan_nodes_by_types",
      "started",
      0,
      1,
      0,
      `Starting scan of node "${node.name || nodeId}" for types: ${types.join(", ")}`,
      null
    );

    await findNodesByTypes(node, types, matchingNodes);

    sendProgressUpdate(
      commandId,
      "scan_nodes_by_types",
      "completed",
      100,
      matchingNodes.length,
      matchingNodes.length,
      `Scan complete. Found ${matchingNodes.length} matching nodes.`,
      { matchingNodes }
    );

    const payload = { nodesCount: matchingNodes.length, matchingNodes, searchedTypes: types, commandId };
    logger.info("✅ scan_nodes_by_types succeeded", { nodesCount: payload.nodesCount });
    return payload;
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : "");
      if (maybe && typeof maybe === "object" && maybe.code) {
        throw error; // Already structured; let bridge/backend parse
      }
    } catch (_) {
      // fall through
    }
    logger.error("❌ scan_nodes_by_types failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} }));
  }
}

/**
 * Helper function to recursively find nodes with specific types
 * @param {SceneNode} node - The root node to start searching from
 * @param {Array<string>} types - Array of node types to find
 * @param {Array} matchingNodes - Array to store found nodes
 */
async function findNodesByTypes(node, types, matchingNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Check if this node is one of the specified types
  if (types.includes(node.type)) {
    // Create a minimal representation with just ID, type and bbox
    matchingNodes.push({
      id: node.id,
      name: node.name || `Unnamed ${node.type}`,
      type: node.type,
      // Basic bounding box info
      bbox: {
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
      },
    });
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findNodesByTypes(child, types, matchingNodes);
    }
  }
}

 

// ======================================================
// Section: Batch Operations (Multi-node Deletion)
// ======================================================
// -------- TOOL : delete_multiple_nodes --------
async function deleteMultipleNodes(params) {
  const logger = (globalThis && globalThis.logger) || console;
  const commandId = generateCommandId();
  try {
    const {
      nodeIds,
      chunkSize,
      delayMsBetweenChunks,
      skipLocked,
      stopOnFailure,
      previewOnly,
    } = params || {};

    // Validate params
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
      const payload = {
        code: "invalid_params",
        message: "Missing or invalid nodeIds parameter",
        details: { receivedType: typeof nodeIds, isArray: Array.isArray(nodeIds), length: nodeIds && nodeIds.length },
      };
      sendProgressUpdate(commandId, "delete_multiple_nodes", "error", 0, 0, 0, payload.message, { error: payload });
      logger.error("❌ delete_multiple_nodes failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const TOTAL = nodeIds.length;
    const CHUNK_SIZE = Math.max(1, Math.min(50, Number.isFinite(chunkSize) ? Math.floor(chunkSize) : 5));
    const DELAY_MS = Number.isFinite(delayMsBetweenChunks) ? Math.max(0, Math.floor(delayMsBetweenChunks)) : 1000;
    const SKIP_LOCKED = skipLocked !== false; // default true
    const STOP_ON_FAILURE = stopOnFailure === true; // default false
    const PREVIEW_ONLY = previewOnly === true; // default false

    logger.info(`🗑️ Starting deletion of ${TOTAL} nodes (chunkSize=${CHUNK_SIZE}, delayMs=${DELAY_MS}, skipLocked=${SKIP_LOCKED}, stopOnFailure=${STOP_ON_FAILURE}, previewOnly=${PREVIEW_ONLY})`);

    // Send started progress update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "started",
      0,
      TOTAL,
      0,
      `Starting deletion of ${TOTAL} nodes`,
      { totalNodes: TOTAL }
    );

    const results = [];
    const modifiedNodeIds = [];
    let successCount = 0;
    let failureCount = 0;
    let stoppedEarly = false;

    const chunks = [];
    for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
      chunks.push(nodeIds.slice(i, i + CHUNK_SIZE));
    }

    logger.info(`🧩 Split ${TOTAL} deletions into ${chunks.length} chunks`);

    // Send chunking info update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      5,
      TOTAL,
      0,
      `Preparing to delete ${TOTAL} nodes using ${chunks.length} chunks`,
      { totalNodes: TOTAL, chunks: chunks.length, chunkSize: CHUNK_SIZE }
    );

    // Process each chunk sequentially
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      if (stoppedEarly) break;
      const chunk = chunks[chunkIndex];
      logger.info(`🔧 Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} nodes`);

      // Send chunk processing start update
      sendProgressUpdate(
        commandId,
        "delete_multiple_nodes",
        "in_progress",
        Math.round(5 + (chunkIndex / chunks.length) * 90),
        TOTAL,
        successCount + failureCount,
        `Processing deletion chunk ${chunkIndex + 1}/${chunks.length}`,
        { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount }
      );

      // Process deletions within a chunk in parallel
      const chunkPromises = chunk.map(async (nodeId) => {
        try {
          const node = await figma.getNodeByIdAsync(nodeId);

          if (!node) {
            return { success: false, nodeId, code: "node_not_found", error: `Node not found: ${nodeId}` };
          }

          // Cannot delete Document or Page
          if (node.type === "DOCUMENT" || node.type === "PAGE") {
            return { success: false, nodeId, code: "cannot_delete_root_or_page", error: `Cannot delete ${node.type}` };
          }

          // Locked node handling
          if (node.locked) {
            if (SKIP_LOCKED) {
              return { success: false, nodeId, code: "locked_node", error: `Node is locked: ${nodeId}` };
            }
            return { success: false, nodeId, code: "locked_node", error: `Node is locked: ${nodeId}` };
          }

          // Save node info before deleting
          const nodeInfo = { id: node.id, name: node.name, type: node.type };

          if (PREVIEW_ONLY) {
            return { success: true, nodeId, nodeInfo, preview: true, wouldDelete: true };
          }

          // Delete the node
          node.remove();

          return { success: true, nodeId, nodeInfo };
        } catch (error) {
          return { success: false, nodeId, code: "delete_failed", error: (error && error.message) || String(error) };
        }
      });

      // Wait for all deletions in this chunk to complete
      const chunkResults = await Promise.all(chunkPromises);

      // Process results for this chunk
      for (const result of chunkResults) {
        if (result.success && !result.preview) {
          successCount++;
          modifiedNodeIds.push(result.nodeId);
        } else if (!result.success) {
          failureCount++;
        }
        results.push(result);
        if (STOP_ON_FAILURE && !result.success) {
          stoppedEarly = true;
          break;
        }
      }

      // Send chunk processing complete update
      sendProgressUpdate(
        commandId,
        "delete_multiple_nodes",
        "in_progress",
        Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
        TOTAL,
        successCount + failureCount,
        `Completed chunk ${chunkIndex + 1}/${chunks.length}. ${successCount} successful, ${failureCount} failed so far.`,
        { currentChunk: chunkIndex + 1, totalChunks: chunks.length, successCount, failureCount, chunkResults }
      );

      // Add a small delay between chunks
      if (!stoppedEarly && chunkIndex < chunks.length - 1) {
        await delay(DELAY_MS);
      }
    }

    const completedChunks = stoppedEarly ? results.length === 0 ? 0 : Math.ceil(results.length / CHUNK_SIZE) : chunks.length;
    const summary = PREVIEW_ONLY
      ? `Previewed deletion for ${TOTAL} nodes`
      : `Deleted ${successCount}/${TOTAL} nodes (${failureCount} failed)`;

    if (!PREVIEW_ONLY && successCount === 0) {
      const payload = {
        code: failureCount > 0 ? "all_deletions_failed" : "no_nodes_deleted",
        message: failureCount > 0 ? "No nodes were deleted (all failed)" : "No nodes were deleted",
        details: {
          totalNodes: TOTAL,
          nodesDeleted: successCount,
          nodesFailed: failureCount,
          completedInChunks: completedChunks,
          stoppedEarly,
          results,
        },
      };
      sendProgressUpdate(commandId, "delete_multiple_nodes", "error", 100, TOTAL, successCount + failureCount, payload.message, payload);
      logger.error("❌ delete_multiple_nodes failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Send completed progress update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "completed",
      100,
      TOTAL,
      successCount + failureCount,
      PREVIEW_ONLY ? `Preview complete: ${TOTAL} nodes would be deleted` : `Node deletion complete: ${successCount} successful, ${failureCount} failed`,
      { totalNodes: TOTAL, nodesDeleted: successCount, nodesFailed: failureCount, completedInChunks: completedChunks, results, stoppedEarly, preview: PREVIEW_ONLY }
    );

    logger.info("✅ delete_multiple_nodes succeeded", { deleted: successCount, failed: failureCount, preview: PREVIEW_ONLY });

    return {
      success: true,
      summary,
      modifiedNodeIds,
      nodesDeleted: successCount,
      nodesFailed: failureCount,
      totalNodes: TOTAL,
      results,
      completedInChunks: completedChunks,
      stoppedEarly,
      preview: PREVIEW_ONLY,
      commandId,
    };
  } catch (error) {
    // Pass through structured errors; wrap unknowns
    try {
      const parsed = JSON.parse(error && error.message);
      if (parsed && parsed.code) {
        throw error;
      }
    } catch (_) {
      const payload = { code: "unexpected_error", message: (error && error.message) || String(error), details: { commandId } };
      const logger2 = (globalThis && globalThis.logger) || console;
      logger2.error("❌ delete_multiple_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    throw error;
  }
}

// ------------------------- Instance Overrides -------------------------
// -------- TOOL INCOMPLETE : get_instance_overrides --------
async function getInstanceOverrides(instanceNode = null) {
  try {
    logger.info("🔎 get_instance_overrides called");

    let sourceInstance = null;

    if (instanceNode) {
      if (instanceNode.type !== "INSTANCE") {
        const payload = { code: "invalid_node_type", message: "Provided node is not a component instance", details: { nodeId: instanceNode.id, nodeType: instanceNode.type } };
        logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        figma.notify("Provided node is not a component instance");
        throw new Error(JSON.stringify(payload));
      }
      sourceInstance = instanceNode;
    } else {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        const payload = { code: "selection_empty", message: "Please select at least one instance", details: {} };
        logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        figma.notify("Please select at least one instance");
        throw new Error(JSON.stringify(payload));
      }
      const instances = selection.filter(node => node.type === "INSTANCE");
      if (instances.length === 0) {
        const payload = { code: "no_instances_in_selection", message: "Please select at least one component instance", details: { selectionCount: selection.length } };
        logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        figma.notify("Please select at least one component instance");
        throw new Error(JSON.stringify(payload));
      }
      sourceInstance = instances[0];
    }

    // Read component overrides and main component
    const overrides = sourceInstance.overrides || [];
    const mainComponent = await sourceInstance.getMainComponentAsync();
    if (!mainComponent) {
      const payload = { code: "main_component_not_found", message: "Failed to get main component", details: { instanceId: sourceInstance.id } };
      logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
      figma.notify("Failed to get main component");
      throw new Error(JSON.stringify(payload));
    }

    const data = {
      sourceInstanceId: sourceInstance.id,
      sourceInstanceName: sourceInstance.name,
      mainComponentId: mainComponent.id,
      overridesCount: overrides.length,
      overrides
    };
    logger.info("✅ get_instance_overrides succeeded", { overridesCount: overrides.length, instanceId: sourceInstance.id });
    figma.notify(`Got component information from "${sourceInstance.name}"`);
    // Read-only tools must return data directly
    return data;
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) throw error;
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ get_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

/**
 * Helper function to validate and get target instances
 * @param {string[]} targetNodeIds - Array of instance node IDs
 * @returns {instanceNode[]} targetInstances - Array of target instances
 */
async function getValidTargetInstances(targetNodeIds) {
  let targetInstances = [];

  // Handle array of instances or single instance
  if (Array.isArray(targetNodeIds)) {
    if (targetNodeIds.length === 0) {
      return { success: false, message: "No instances provided" };
    }
    for (const targetNodeId of targetNodeIds) {
      const targetNode = await figma.getNodeByIdAsync(targetNodeId);
      if (targetNode && targetNode.type === "INSTANCE") {
        targetInstances.push(targetNode);
      }
    }
    if (targetInstances.length === 0) {
      return { success: false, message: "No valid instances provided" };
    }
  } else {
    return { success: false, message: "Invalid target node IDs provided" };
  }


  return { success: true, message: "Valid target instances provided", targetInstances };
}

/**
 * Helper function to validate and get saved override data
 * @param {string} sourceInstanceId - Source instance ID
 * @returns {Promise<Object>} - Validation result with source instance data or error
 */
async function getSourceInstanceData(sourceInstanceId) {
  if (!sourceInstanceId) {
    return { success: false, message: "Missing source instance ID" };
  }

  // Get source instance by ID
  const sourceInstance = await figma.getNodeByIdAsync(sourceInstanceId);
  if (!sourceInstance) {
    return {
      success: false,
      message: "Source instance not found. The original instance may have been deleted."
    };
  }

  // Verify it's an instance
  if (sourceInstance.type !== "INSTANCE") {
    return {
      success: false,
      message: "Source node is not a component instance."
    };
  }

  // Get main component
  const mainComponent = await sourceInstance.getMainComponentAsync();
  if (!mainComponent) {
    return {
      success: false,
      message: "Failed to get main component from source instance."
    };
  }

  return {
    success: true,
    sourceInstance,
    mainComponent,
    overrides: sourceInstance.overrides || []
  };
}

/**
 * Sets saved overrides to the selected component instance(s)
 * @param {InstanceNode[] | null} targetInstances - Array of instance nodes to set overrides to
 * @param {Object} sourceResult - Source instance data from getSourceInstanceData
 * @returns {Promise<Object>} - Result of the set operation
 */
// -------- TOOL INCOMPLETE : set_instance_overrides --------
async function setInstanceOverrides(targetInstances, sourceResult, options = {}) {
  const {
    swapComponent = true,
    includeFields,
    excludeFields,
    previewOnly = false,
    stopOnFirstError = false
  } = options || {};

  const includeSet = Array.isArray(includeFields) ? new Set(includeFields) : null;
  const excludeSet = Array.isArray(excludeFields) ? new Set(excludeFields) : null;

  try {
    const { sourceInstance, mainComponent, overrides } = sourceResult;
    logger.info("🧩 set_instance_overrides started", { targets: targetInstances.length, overrides: overrides.length, swapComponent, previewOnly });

    const results = [];
    let totalAppliedCount = 0;
    const modifiedNodeIdsSet = new Set();

    for (const targetInstance of targetInstances) {
      try {
        let instanceAppliedCount = 0;

        // Swap component (optional)
        if (swapComponent) {
          try {
            if (!previewOnly) {
              targetInstance.swapComponent(mainComponent);
              modifiedNodeIdsSet.add(targetInstance.id);
            }
          } catch (error) {
            const payload = { code: "swap_failed", message: `Failed to swap component for instance`, details: { instanceId: targetInstance.id, name: targetInstance.name, error: (error && error.message) || String(error) } };
            logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
            if (stopOnFirstError) throw new Error(JSON.stringify(payload));
            results.push({ success: false, instanceId: targetInstance.id, instanceName: targetInstance.name, code: payload.code, message: payload.message });
          }
        }

        for (const override of overrides) {
          if (!override.id || !override.overriddenFields || override.overriddenFields.length === 0) continue;

          // Map override path to target instance
          const overrideNodeId = override.id.replace(sourceInstance.id, targetInstance.id);
          const overrideNode = await figma.getNodeByIdAsync(overrideNodeId);
          if (!overrideNode) {
            // Missing target node for this override, skip
            continue;
          }
          const sourceNode = await figma.getNodeByIdAsync(override.id);
          if (!sourceNode) {
            continue;
          }

          let fieldApplied = false;
          for (const field of override.overriddenFields) {
            if (includeSet && !includeSet.has(field)) continue;
            if (excludeSet && excludeSet.has(field)) continue;

            try {
              if (previewOnly) {
                fieldApplied = true; // would apply
                continue;
              }

              if (field === "componentProperties") {
                if (sourceNode.componentProperties && overrideNode.componentProperties) {
                  const properties = {};
                  for (const key in sourceNode.componentProperties) {
                    properties[key] = sourceNode.componentProperties[key].value;
                  }
                  overrideNode.setProperties(properties);
                  fieldApplied = true;
                }
              } else if (field === "characters" && overrideNode.type === "TEXT") {
                // Load font from overrideNode or fallback to sourceNode
                const fontNameToLoad = (overrideNode.fontName !== figma.mixed) ? overrideNode.fontName : (sourceNode.fontName !== figma.mixed ? sourceNode.fontName : null);
                if (fontNameToLoad) {
                  try {
                    await figma.loadFontAsync(fontNameToLoad);
                  } catch (fontErr) {
                    const payload = { code: "font_load_failed", message: `Cannot load font for text override`, details: { nodeId: overrideNode.id, font: fontNameToLoad, error: (fontErr && fontErr.message) || String(fontErr) } };
                    logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
                    if (stopOnFirstError) throw new Error(JSON.stringify(payload));
                    continue;
                  }
                }
                overrideNode.characters = sourceNode.characters;
                fieldApplied = true;
              } else if (field in overrideNode) {
                overrideNode[field] = sourceNode[field];
                fieldApplied = true;
              }
            } catch (fieldError) {
              const payload = { code: "override_field_error", message: `Error applying field ${field}`, details: { nodeId: overrideNode.id, field, error: (fieldError && fieldError.message) || String(fieldError) } };
              logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
              if (stopOnFirstError) throw new Error(JSON.stringify(payload));
            }
          }

          if (!previewOnly && fieldApplied) {
            instanceAppliedCount++;
            modifiedNodeIdsSet.add(overrideNode.id);
          } else if (previewOnly && fieldApplied) {
            instanceAppliedCount++;
          }
        }

        if (instanceAppliedCount > 0) {
          totalAppliedCount += instanceAppliedCount;
          results.push({ success: true, instanceId: targetInstance.id, instanceName: targetInstance.name, appliedCount: instanceAppliedCount });
        } else {
          results.push({ success: false, instanceId: targetInstance.id, instanceName: targetInstance.name, message: previewOnly ? "No changes would be applied" : "No overrides were applied" });
        }
      } catch (instanceError) {
        const payload = { code: "instance_process_failed", message: `Error processing instance`, details: { instanceId: targetInstance.id, name: targetInstance.name, error: (instanceError && instanceError.message) || String(instanceError) } };
        logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
        if (stopOnFirstError) throw new Error(JSON.stringify(payload));
        results.push({ success: false, instanceId: targetInstance.id, instanceName: targetInstance.name, code: payload.code, message: payload.message });
      }
    }

    const modifiedNodeIds = Array.from(modifiedNodeIdsSet);

    if (previewOnly) {
      const summary = `Would apply ${totalAppliedCount} overrides to ${results.filter(r => r.success).length} instances`;
      logger.info("✅ set_instance_overrides preview", { totalAppliedCount, targets: targetInstances.length });
      return { success: true, summary, modifiedNodeIds: [], sourceInstanceId: sourceResult.sourceInstance.id, mainComponentId: sourceResult.mainComponent.id, targetInstanceIds: targetInstances.map(i => i.id), totalOverridesApplied: totalAppliedCount, results, preview: true };
    }

    if (totalAppliedCount > 0) {
      const instanceCount = results.filter(r => r.success).length;
      const summary = `Applied ${totalAppliedCount} overrides to ${instanceCount} instances`;
      figma.notify(summary);
      logger.info("✅ set_instance_overrides succeeded", { totalAppliedCount, instanceCount });
      return { success: true, summary, modifiedNodeIds, sourceInstanceId: sourceResult.sourceInstance.id, mainComponentId: sourceResult.mainComponent.id, targetInstanceIds: targetInstances.map(i => i.id), totalOverridesApplied: totalAppliedCount, results };
    } else {
      const payload = { code: "no_overrides_applied", message: "No overrides applied to any instance", details: { targetInstanceIds: targetInstances.map(i => i.id) } };
      logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
      figma.notify(payload.message);
      throw new Error(JSON.stringify(payload));
    }
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) throw error;
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ set_instance_overrides failed", { code: payload.code, originalError: payload.message, details: payload.details });
    figma.notify(payload.message);
    throw new Error(JSON.stringify(payload));
  }
}

// ======================================================
// Section: Layout (Auto-layout, Padding, Alignment, Sizing, Spacing)
// ======================================================
// -------- TOOL : set_layout_mode --------
async function setLayoutMode(params) {
  const { nodeId, layoutMode = "NONE", layoutWrap = "NO_WRAP" } = params || {};
  try {
    if (!nodeId) {
      const payload = { code: "missing_parameter", message: "Provide nodeId", details: { command: "set_layout_mode" } };
      logger.error("❌ set_layout_mode failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node with ID ${nodeId} not found`, details: { nodeId } };
      logger.error("❌ set_layout_mode failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Check if node supports layout properties (exclude COMPONENT_SET)
    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") {
      const payload = { code: "unsupported_node_type", message: `Node type ${node.type} does not support layoutMode`, details: { nodeId, type: node.type } };
      logger.error("❌ set_layout_mode failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if ("locked" in node && node.locked) {
      const payload = { code: "locked_node", message: "Target node is locked", details: { nodeIds: [nodeId] } };
      logger.error("❌ set_layout_mode failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const allowedModes = ["NONE", "HORIZONTAL", "VERTICAL", "GRID"];
    const allowedWrap = ["NO_WRAP", "WRAP"];
    if (!allowedModes.includes(layoutMode)) {
      const payload = { code: "invalid_parameter", message: `Invalid layoutMode: ${layoutMode}`, details: { allowedModes } };
      logger.error("❌ set_layout_mode failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!allowedWrap.includes(layoutWrap)) {
      const payload = { code: "invalid_parameter", message: `Invalid layoutWrap: ${layoutWrap}`, details: { allowedWrap } };
      logger.error("❌ set_layout_mode failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    node.layoutMode = layoutMode;
    if (layoutMode === "HORIZONTAL" || layoutMode === "VERTICAL") {
      node.layoutWrap = layoutWrap;
    }

    const summary = `Set layout mode to ${node.layoutMode}${node.layoutMode !== "NONE" && node.layoutMode !== "GRID" ? ` (${node.layoutWrap})` : ""} on '${node.name}'`;
    const payload = {
      success: true,
      summary,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        layoutMode: node.layoutMode,
        layoutWrap: node.layoutWrap,
      },
    };
    logger.info("✅ set_layout_mode succeeded", { nodeId: node.id, layoutMode: node.layoutMode, layoutWrap: node.layoutWrap });
    return payload;
  } catch (error) {
    // Normalize unknown errors
    try {
      if (typeof (error && error.message) === "string") {
        JSON.parse(error.message);
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_layout_mode" } };
    logger.error("❌ set_layout_mode failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_padding --------
async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } = params || {};
  try {
    if (!nodeId) {
      const payload = { code: "missing_parameter", message: "Provide nodeId", details: { command: "set_padding" } };
      logger.error("❌ set_padding failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (paddingTop === undefined && paddingRight === undefined && paddingBottom === undefined && paddingLeft === undefined) {
      const payload = { code: "missing_parameter", message: "Provide at least one of paddingTop|paddingRight|paddingBottom|paddingLeft", details: { nodeId } };
      logger.error("❌ set_padding failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node with ID ${nodeId} not found`, details: { nodeId } };
      logger.error("❌ set_padding failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") {
      const payload = { code: "unsupported_node_type", message: `Node type ${node.type} does not support padding`, details: { nodeId, type: node.type } };
      logger.error("❌ set_padding failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if ("locked" in node && node.locked) {
      const payload = { code: "locked_node", message: "Target node is locked", details: { nodeIds: [nodeId] } };
      logger.error("❌ set_padding failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (node.layoutMode === "NONE") {
      const payload = { code: "auto_layout_required", message: "Padding can only be set on auto-layout frames", details: { nodeId } };
      logger.error("❌ set_padding failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Validate numbers if provided
    const checks = [
      ["paddingTop", paddingTop],
      ["paddingRight", paddingRight],
      ["paddingBottom", paddingBottom],
      ["paddingLeft", paddingLeft],
    ];
    for (const [key, value] of checks) {
      if (value !== undefined && typeof value !== "number") {
        const payload = { code: "invalid_parameter", message: `${key} must be a number`, details: { key, value } };
        logger.error("❌ set_padding failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    }

    if (paddingTop !== undefined) node.paddingTop = paddingTop;
    if (paddingRight !== undefined) node.paddingRight = paddingRight;
    if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
    if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;

    const changedKeys = checks.filter(([, v]) => v !== undefined).map(([k]) => k);
    const summary = `Updated padding ${changedKeys.join(", ")} on '${node.name}'`;
    const payload = {
      success: true,
      summary,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        paddingTop: node.paddingTop,
        paddingRight: node.paddingRight,
        paddingBottom: node.paddingBottom,
        paddingLeft: node.paddingLeft,
      },
    };
    logger.info("✅ set_padding succeeded", { nodeId: node.id, changed: changedKeys });
    return payload;
  } catch (error) {
    try {
      if (typeof (error && error.message) === "string") {
        JSON.parse(error.message);
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_padding" } };
    logger.error("❌ set_padding failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_axis_align --------
async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params || {};
  try {
    if (!nodeId) {
      const payload = { code: "missing_parameter", message: "Provide nodeId", details: { command: "set_axis_align" } };
      logger.error("❌ set_axis_align failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node with ID ${nodeId} not found`, details: { nodeId } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") {
      const payload = { code: "unsupported_node_type", message: `Node type ${node.type} does not support axis alignment`, details: { nodeId, type: node.type } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if ("locked" in node && node.locked) {
      const payload = { code: "locked_node", message: "Target node is locked", details: { nodeIds: [nodeId] } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (node.layoutMode === "NONE") {
      const payload = { code: "auto_layout_required", message: "Axis alignment can only be set on auto-layout frames", details: { nodeId } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const primaryAllowed = ["MIN", "MAX", "CENTER", "SPACE_BETWEEN"];
    const counterAllowed = ["MIN", "MAX", "CENTER", "BASELINE"];
    if (primaryAxisAlignItems !== undefined && !primaryAllowed.includes(primaryAxisAlignItems)) {
      const payload = { code: "invalid_parameter", message: `Invalid primaryAxisAlignItems: ${primaryAxisAlignItems}`, details: { allowed: primaryAllowed } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (counterAxisAlignItems !== undefined && !counterAllowed.includes(counterAxisAlignItems)) {
      const payload = { code: "invalid_parameter", message: `Invalid counterAxisAlignItems: ${counterAxisAlignItems}`, details: { allowed: counterAllowed } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (counterAxisAlignItems === "BASELINE" && node.layoutMode !== "HORIZONTAL") {
      const payload = { code: "baseline_requires_horizontal_layout", message: "BASELINE alignment is only valid for horizontal auto-layout frames", details: { nodeId, layoutMode: node.layoutMode } };
      logger.error("❌ set_axis_align failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (primaryAxisAlignItems !== undefined) node.primaryAxisAlignItems = primaryAxisAlignItems;
    if (counterAxisAlignItems !== undefined) node.counterAxisAlignItems = counterAxisAlignItems;

    const summary = `Aligned '${node.name}' (primary=${node.primaryAxisAlignItems}, counter=${node.counterAxisAlignItems})`;
    const payload = {
      success: true,
      summary,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        layoutMode: node.layoutMode,
        primaryAxisAlignItems: node.primaryAxisAlignItems,
        counterAxisAlignItems: node.counterAxisAlignItems,
      },
    };
    logger.info("✅ set_axis_align succeeded", { nodeId: node.id, primary: node.primaryAxisAlignItems, counter: node.counterAxisAlignItems });
    return payload;
  } catch (error) {
    try {
      if (typeof (error && error.message) === "string") {
        JSON.parse(error.message);
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_axis_align" } };
    logger.error("❌ set_axis_align failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_layout_sizing --------
async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params || {};
  try {
    if (!nodeId) {
      const payload = { code: "missing_parameter", message: "Provide nodeId", details: { command: "set_layout_sizing" } };
      logger.error("❌ set_layout_sizing failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (layoutSizingHorizontal === undefined && layoutSizingVertical === undefined) {
      const payload = { code: "missing_parameter", message: "Provide at least one of layoutSizingHorizontal|layoutSizingVertical", details: { nodeId } };
      logger.error("❌ set_layout_sizing failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node with ID ${nodeId} not found`, details: { nodeId } };
      logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    // Allow TEXT nodes in addition to FRAME/COMPONENT/INSTANCE
    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE" && node.type !== "TEXT") {
      const payload = { code: "unsupported_node_type", message: `Node type ${node.type} does not support layout sizing`, details: { nodeId, type: node.type } };
      logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if ("locked" in node && node.locked) {
      const payload = { code: "locked_node", message: "Target node is locked", details: { nodeIds: [nodeId] } };
      logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    // For non-TEXT nodes, require auto-layout
    if (node.type !== "TEXT" && node.layoutMode === "NONE") {
      const payload = { code: "auto_layout_required", message: "Layout sizing can only be set on auto-layout frames or text nodes", details: { nodeId, type: node.type } };
      logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const allowed = ["FIXED", "HUG", "FILL"];
    if (layoutSizingHorizontal !== undefined) {
      if (!allowed.includes(layoutSizingHorizontal)) {
        const payload = { code: "invalid_parameter", message: `Invalid layoutSizingHorizontal: ${layoutSizingHorizontal}`, details: { allowed } };
        logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (layoutSizingHorizontal === "HUG" && !(node.type === "FRAME" || node.type === "TEXT")) {
        const payload = { code: "unsupported_sizing_target", message: "HUG sizing is only valid on auto-layout frames and text nodes", details: { nodeId, type: node.type } };
        logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (layoutSizingHorizontal === "FILL" && (!node.parent || node.parent.layoutMode === "NONE")) {
        const payload = { code: "fill_requires_autolayout_parent", message: "FILL sizing is only valid on auto-layout children", details: { nodeId, parentId: node.parent && node.parent.id } };
        logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      node.layoutSizingHorizontal = layoutSizingHorizontal;
    }

    if (layoutSizingVertical !== undefined) {
      if (!allowed.includes(layoutSizingVertical)) {
        const payload = { code: "invalid_parameter", message: `Invalid layoutSizingVertical: ${layoutSizingVertical}`, details: { allowed } };
        logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (layoutSizingVertical === "HUG" && !(node.type === "FRAME" || node.type === "TEXT")) {
        const payload = { code: "unsupported_sizing_target", message: "HUG sizing is only valid on auto-layout frames and text nodes", details: { nodeId, type: node.type } };
        logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (layoutSizingVertical === "FILL" && (!node.parent || node.parent.layoutMode === "NONE")) {
        const payload = { code: "fill_requires_autolayout_parent", message: "FILL sizing is only valid on auto-layout children", details: { nodeId, parentId: node.parent && node.parent.id } };
        logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      node.layoutSizingVertical = layoutSizingVertical;
    }

    const summary = `Updated layout sizing on '${node.name}' (h=${node.layoutSizingHorizontal || "unchanged"}, v=${node.layoutSizingVertical || "unchanged"})`;
    const payload = {
      success: true,
      summary,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        layoutMode: node.layoutMode,
        layoutSizingHorizontal: node.layoutSizingHorizontal,
        layoutSizingVertical: node.layoutSizingVertical,
      },
    };
    logger.info("✅ set_layout_sizing succeeded", { nodeId: node.id, h: node.layoutSizingHorizontal, v: node.layoutSizingVertical });
    return payload;
  } catch (error) {
    try {
      if (typeof (error && error.message) === "string") {
        JSON.parse(error.message);
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_layout_sizing" } };
    logger.error("❌ set_layout_sizing failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_item_spacing --------
async function setItemSpacing(params) {
  const { nodeId, itemSpacing, counterAxisSpacing } = params || {};
  try {
    if (!nodeId) {
      const payload = { code: "missing_parameter", message: "Provide nodeId", details: { command: "set_item_spacing" } };
      logger.error("❌ set_item_spacing failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (itemSpacing === undefined && counterAxisSpacing === undefined) {
      const payload = { code: "missing_parameter", message: "Provide at least one of itemSpacing|counterAxisSpacing", details: { nodeId } };
      logger.error("❌ set_item_spacing failed", { code: payload.code, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node with ID ${nodeId} not found`, details: { nodeId } };
      logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") {
      const payload = { code: "unsupported_node_type", message: `Node type ${node.type} does not support item spacing`, details: { nodeId, type: node.type } };
      logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if ("locked" in node && node.locked) {
      const payload = { code: "locked_node", message: "Target node is locked", details: { nodeIds: [nodeId] } };
      logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (node.layoutMode === "NONE") {
      const payload = { code: "auto_layout_required", message: "Item spacing can only be set on auto-layout frames", details: { nodeId } };
      logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (itemSpacing !== undefined) {
      if (typeof itemSpacing !== "number") {
        const payload = { code: "invalid_parameter", message: "itemSpacing must be a number", details: { value: itemSpacing } };
        logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      node.itemSpacing = itemSpacing;
    }

    if (counterAxisSpacing !== undefined) {
      if (typeof counterAxisSpacing !== "number") {
        const payload = { code: "invalid_parameter", message: "counterAxisSpacing must be a number", details: { value: counterAxisSpacing } };
        logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      if (node.layoutWrap !== "WRAP") {
        const payload = { code: "wrap_required_for_counter_axis_spacing", message: "counterAxisSpacing requires layoutWrap=WRAP", details: { nodeId, layoutWrap: node.layoutWrap } };
        logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      node.counterAxisSpacing = counterAxisSpacing;
    }

    const changed = [];
    if (itemSpacing !== undefined) changed.push("itemSpacing");
    if (counterAxisSpacing !== undefined) changed.push("counterAxisSpacing");
    const summary = `Updated ${changed.join(" and ")} on '${node.name}'`;
    const payload = {
      success: true,
      summary,
      modifiedNodeIds: [node.id],
      node: {
        id: node.id,
        name: node.name,
        layoutMode: node.layoutMode,
        layoutWrap: node.layoutWrap,
        itemSpacing: node.itemSpacing,
        counterAxisSpacing: node.counterAxisSpacing,
      },
    };
    logger.info("✅ set_item_spacing succeeded", { nodeId: node.id, changed });
    return payload;
  } catch (error) {
    try {
      if (typeof (error && error.message) === "string") {
        JSON.parse(error.message);
        throw error; // already structured
      }
    } catch (_) {
      // not structured, fall through
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_item_spacing" } };
    logger.error("❌ set_item_spacing failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}



 

// ======================================================
// Section: Viewport (Zoom, Center, Scroll & Zoom Into View)
// ======================================================
// -------- TOOL : zoom --------
async function zoom(params) {
  const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
  try {
    const { zoomLevel, center } = params || {};

    if (zoomLevel === undefined) {
      const payload = { code: "missing_required_parameter", message: "Parameter 'zoomLevel' is required.", details: { missing: ["zoomLevel"] } };
      logger.error("❌ zoom failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (typeof zoomLevel !== "number" || !isFinite(zoomLevel) || zoomLevel <= 0) {
      const payload = { code: "invalid_zoom_level_range", message: "zoomLevel must be a finite number > 0.", details: { zoomLevel } };
      logger.error("❌ zoom failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (center !== undefined) {
      if (!center || typeof center !== "object" || typeof center.x !== "number" || typeof center.y !== "number" || !isFinite(center.x) || !isFinite(center.y)) {
        const payload = { code: "invalid_coordinates", message: "center must be an object with numeric x and y.", details: { center } };
        logger.error("❌ zoom failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      figma.viewport.center = { x: center.x, y: center.y };
    }
  
    figma.viewport.zoom = zoomLevel;

    const result = {
      success: true,
      summary: `Set zoom to ${Number(figma.viewport.zoom).toFixed(2)}${center ? ` and centered at (${center.x.toFixed(1)}, ${center.y.toFixed(1)})` : ""}.`,
      modifiedNodeIds: [],
      zoom: figma.viewport.zoom,
      center: figma.viewport.center,
    };
    logger.info("✅ zoom succeeded", { zoom: result.zoom, center: result.center });
    return result;
  } catch (error) {
    if (error && typeof error.message === "string") {
      try {
        JSON.parse(error.message);
        throw error;
      } catch (_) {}
    }
    const payload = { code: "figma_api_error", message: "Failed to set zoom.", details: { originalError: String((error && error.message) || error) } };
    logger.error("❌ zoom failed", { code: payload.code, originalError: payload.details.originalError, details: {} });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : center --------
async function center(params) {
    const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
    try {
        const { x, y } = params || {};

        const missing = [];
        if (x === undefined) missing.push("x");
        if (y === undefined) missing.push("y");
        if (missing.length) {
            const payload = { code: "missing_required_parameter", message: "Parameters 'x' and 'y' are required.", details: { missing } };
            logger.error("❌ center failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) {
            const payload = { code: "invalid_coordinates", message: "x and y must be finite numbers.", details: { x, y } };
            logger.error("❌ center failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        figma.viewport.center = { x, y };

        const result = {
            success: true,
            summary: `Centered viewport at (${x.toFixed(1)}, ${y.toFixed(1)}).`,
            modifiedNodeIds: [],
            center: figma.viewport.center,
        };
        logger.info("✅ center succeeded", { center: result.center });
        return result;
    } catch (error) {
        if (error && typeof error.message === "string") {
            try { JSON.parse(error.message); throw error; } catch (_) {}
        }
        const payload = { code: "figma_api_error", message: "Failed to center viewport.", details: { originalError: String((error && error.message) || error) } };
        logger.error("❌ center failed", { code: payload.code, originalError: payload.details.originalError });
        throw new Error(JSON.stringify(payload));
    }
}

// -------- TOOL : scroll_and_zoom_into_view --------
async function scrollAndZoomIntoView(params) {
    const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
    try {
        const { nodeIds } = params || {};

        if (!Array.isArray(nodeIds)) {
            const payload = { code: "invalid_node_ids", message: "Parameter 'nodeIds' must be a non-empty string array.", details: { nodeIds } };
            logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const uniqueIds = Array.from(new Set(nodeIds)).filter((id) => typeof id === "string" && id.length > 0);
        if (uniqueIds.length === 0) {
            const payload = { code: "missing_required_parameter", message: "Parameter 'nodeIds' is required and must include at least one ID.", details: { missing: ["nodeIds"] } };
            logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const nodes = [];
        const resolvedNodeIds = [];
        const unresolvedNodeIds = [];
        for (const nodeId of uniqueIds) {
            try {
                const node = await figma.getNodeByIdAsync(nodeId);
                if (node) {
                    nodes.push(node);
                    resolvedNodeIds.push(nodeId);
                } else {
                    unresolvedNodeIds.push(nodeId);
                }
            } catch (_) {
                unresolvedNodeIds.push(nodeId);
            }
        }

        if (nodes.length === 0) {
            const payload = { code: "nodes_not_found", message: "None of the provided nodes exist.", details: { nodeIds: uniqueIds } };
            logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        figma.viewport.scrollAndZoomIntoView(nodes);
        const result = {
            success: true,
            summary: `Brought ${nodes.length} node(s) into view.${unresolvedNodeIds.length ? ` ${unresolvedNodeIds.length} unresolved.` : ''}`,
            modifiedNodeIds: [],
            resolvedNodeIds,
            unresolvedNodeIds,
            zoom: figma.viewport.zoom,
            center: figma.viewport.center,
        };
        logger.info("✅ scroll_and_zoom_into_view succeeded", { resolved: resolvedNodeIds.length, unresolved: unresolvedNodeIds.length, zoom: result.zoom, center: result.center });
        return result;
    } catch (error) {
        if (error && typeof error.message === "string") {
            try { JSON.parse(error.message); throw error; } catch (_) {}
        }
        const payload = { code: "figma_api_error", message: "Failed to scroll and zoom into view.", details: { originalError: String((error && error.message) || error) } };
        logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.details.originalError });
        throw new Error(JSON.stringify(payload));
    }
}

// ======================================================
// Section: Grouping & Hierarchy (Group, Ungroup, Reparent, Insert Child)
// ======================================================
// -------- TOOL : group --------
async function group(params) {
    const { nodeIds, parentId, name, index } = params || {};

    try {
        if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
            const payload = { code: "missing_parameter", message: "'nodeIds' must be a non-empty array", details: { nodeIds } };
            logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Resolve nodes and validate
        const nodes = [];
        const missingNodeIds = [];
        for (const nodeId of nodeIds) {
            const node = await figma.getNodeByIdAsync(nodeId);
            if (node) nodes.push(node); else missingNodeIds.push(nodeId);
        }
        if (missingNodeIds.length > 0) {
            const payload = { code: "node_not_found", message: "Some nodes were not found", details: { missingNodeIds } };
            logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (nodes.length === 0) {
            const payload = { code: "no_valid_nodes", message: "No valid nodes to group", details: {} };
            logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Resolve/validate parent
        let parent = figma.currentPage;
        if (parentId) {
            const parentNode = await figma.getNodeByIdAsync(parentId);
            if (!(parentNode && 'appendChild' in parentNode)) {
                const payload = { code: "invalid_parent", message: `Parent cannot accept children`, details: { parentId, parentType: parentNode ? parentNode.type : undefined } };
                logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
            parent = parentNode;
        }

        // Helper to find page root for a node
        function findPage(node) {
            let cur = node;
            while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
                cur = cur.parent;
            }
            return cur && cur.type === 'PAGE' ? cur : null;
        }

        // Enforce same page constraint
        const parentPage = findPage(parent) || figma.currentPage;
        const crossPageNodes = nodes.filter(n => (findPage(n) && findPage(n).id) !== parentPage.id);
        if (crossPageNodes.length > 0) {
            const payload = { code: "mixed_pages", message: "Grouped nodes must be in the same page as the parent", details: { parentPageId: parentPage.id, offendingNodeIds: crossPageNodes.map(n => n.id) } };
            logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Locked nodes check
        const locked = nodes.filter(n => n.locked === true);
        if (locked.length > 0) {
            const payload = { code: "locked_nodes", message: "Cannot group locked nodes", details: { nodeIds: locked.map(n => n.id) } };
            logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Validate optional index
        let usedIndex = undefined;
        if (index !== undefined) {
            if (typeof index !== 'number' || index < 0 || index > parent.children.length) {
                const payload = { code: "index_out_of_bounds", message: "Index must be between 0 and parent.children.length", details: { index, max: parent.children.length } };
                logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
            usedIndex = index;
        }

        // Create group
        let groupNode;
        try {
            groupNode = usedIndex === undefined ? figma.group(nodes, parent) : figma.group(nodes, parent, usedIndex);
        } catch (e) {
            const originalError = (e && e.message) || String(e);
            let code = "group_failed";
            if (/index greater than the number of existing siblings/i.test(originalError)) code = "index_out_of_bounds";
            else if (/must be in the same page/i.test(originalError)) code = "mixed_pages";
            else if (/scene root.*cannot be reparented/i.test(originalError)) code = "cannot_reparent_scene_root";
            else if (/create a parenting cycle/i.test(originalError)) code = "parenting_cycle";
            else if (/inside of an instance/i.test(originalError)) code = "inside_instance";
            const payload = { code, message: `Failed to group nodes: ${originalError}`, details: { parentId: parent.id, nodeIds } };
            logger.error("❌ group failed", { code: payload.code, originalError, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        if (name) {
            groupNode.name = name;
        }

        const createdIndex = parent.children.indexOf(groupNode);
        const result = {
            success: true,
            summary: `Grouped ${nodes.length} node(s) into parent ${parent.name}`,
            modifiedNodeIds: [groupNode.id, ...nodes.map(n => n.id)],
            groupId: groupNode.id,
            name: groupNode.name,
            parentId: parent.id,
            index: createdIndex,
            children: groupNode.children.map(child => child.id)
        };
        logger.info("✅ group succeeded", { groupId: groupNode.id, count: nodes.length, parentId: parent.id, index: createdIndex });
        return result;
    } catch (error) {
        try {
            const maybe = JSON.parse(error && error.message ? error.message : String(error));
            if (maybe && maybe.code) throw error;
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ group failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

// -------- TOOL : ungroup --------
async function ungroup(params) {
    const { nodeId } = params || {};
    try {
        if (!nodeId) {
            const payload = { code: "missing_parameter", message: "'nodeId' is required", details: {} };
            logger.error("❌ ungroup failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) {
            const payload = { code: "node_not_found", message: `Node not found with ID: ${nodeId}` , details: { nodeId } };
            logger.error("❌ ungroup failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (node.type !== 'GROUP') {
            const payload = { code: "invalid_node_type", message: `Node is not a GROUP`, details: { nodeId, type: node.type } };
            logger.error("❌ ungroup failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const parent = node.parent;
        const children = Array.prototype.slice.call(node.children);
        if (parent && 'insertChild' in parent) {
            const insertIndex = parent.children.indexOf(node);
            try {
                children.forEach((child, i) => parent.insertChild(insertIndex + i, child));
                node.remove();
            } catch (e) {
                const originalError = (e && e.message) || String(e);
                const payload = { code: "ungroup_failed", message: `Failed to ungroup: ${originalError}`, details: { nodeId } };
                logger.error("❌ ungroup failed", { code: payload.code, originalError, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
            const result = {
                success: true,
                summary: `Ungrouped ${children.length} node(s) from group`,
                modifiedNodeIds: [nodeId, ...children.map(c => c.id)],
                childrenIds: children.map(child => child.id),
                parentId: parent.id,
                removedGroupId: nodeId,
            };
            logger.info("✅ ungroup succeeded", { groupId: nodeId, childrenCount: children.length, parentId: parent.id });
            return result;
        }
        const payload = { code: "invalid_parent", message: "Parent does not support child insertion", details: { nodeId } };
        logger.error("❌ ungroup failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    } catch (error) {
        try {
            const maybe = JSON.parse(error && error.message ? error.message : String(error));
            if (maybe && maybe.code) throw error;
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ ungroup failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

 

// -------- TOOL : reparent --------
async function reparent(params) {
    const { nodeIds, newParentId, index } = params || {};
    try {
        if (!Array.isArray(nodeIds) || nodeIds.length === 0 || !newParentId) {
            const payload = { code: "missing_parameter", message: "'nodeIds' (non-empty) and 'newParentId' are required", details: { nodeIds, newParentId } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (nodeIds.includes(newParentId)) {
            const payload = { code: "invalid_parameter", message: "A node cannot be reparented to itself", details: { newParentId } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const newParent = await figma.getNodeByIdAsync(newParentId);
        if (!(newParent && ('appendChild' in newParent) && ('insertChild' in newParent))) {
            const payload = { code: "invalid_parent", message: `New parent cannot accept children`, details: { newParentId, parentType: newParent ? newParent.type : undefined } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (newParent.locked) {
            const payload = { code: "locked_parent", message: "Parent is locked", details: { newParentId } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Helper to find page
        function findPage(node) {
            let cur = node;
            while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') cur = cur.parent;
            return cur && cur.type === 'PAGE' ? cur : null;
        }
        const parentPage = findPage(newParent) || figma.currentPage;

        const nodes = [];
        const unresolvedNodeIds = [];
        for (const nodeId of nodeIds) {
            const node = await figma.getNodeByIdAsync(nodeId);
            if (!node) {
                unresolvedNodeIds.push(nodeId);
                continue;
            }
            nodes.push(node);
        }
        if (nodes.length === 0) {
            const payload = { code: "no_valid_nodes", message: "None of the provided nodeIds could be resolved", details: { unresolvedNodeIds } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Validate locked nodes
        const locked = nodes.filter(n => n.locked === true);
        if (locked.length > 0) {
            const payload = { code: "locked_nodes", message: "Cannot move locked nodes", details: { nodeIds: locked.map(n => n.id) } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Same-page constraint
        const crossPageNodes = nodes.filter(n => (findPage(n) && findPage(n).id) !== parentPage.id);
        if (crossPageNodes.length > 0) {
            const payload = { code: "mixed_pages", message: "Nodes must be in the same page as the new parent", details: { parentPageId: parentPage.id, offendingNodeIds: crossPageNodes.map(n => n.id) } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Validate optional index
        let usedIndex = undefined;
        if (index !== undefined) {
            if (typeof index !== 'number' || index < 0 || index > newParent.children.length) {
                const payload = { code: "index_out_of_bounds", message: "Index must be between 0 and parent.children.length", details: { index, max: newParent.children.length } };
                logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
            usedIndex = index;
        }

        const movedNodeIds = [];
        const failedNodeIds = [];
        let insertionIndex = usedIndex;
        for (const node of nodes) {
            try {
                if (insertionIndex === undefined) newParent.appendChild(node); else newParent.insertChild(insertionIndex, node), insertionIndex++;
                movedNodeIds.push(node.id);
            } catch (e) {
                failedNodeIds.push(node.id);
            }
        }

        if (failedNodeIds.length > 0) {
            const payload = { code: "reparent_failed", message: "Some nodes could not be reparented", details: { movedNodeIds, failedNodeIds, unresolvedNodeIds, parentId: newParentId } };
            logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const result = {
            success: true,
            summary: `Reparented ${movedNodeIds.length} node(s) to ${newParent.name}`,
            modifiedNodeIds: movedNodeIds,
            parentId: newParentId,
            insertIndex: usedIndex,
            movedNodeIds,
            unresolvedNodeIds,
        };
        logger.info("✅ reparent succeeded", { moved: movedNodeIds.length, parentId: newParentId, insertIndex: usedIndex });
        return result;
    } catch (error) {
        try {
            const maybe = JSON.parse(error && error.message ? error.message : String(error));
            if (maybe && maybe.code) throw error;
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ reparent failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

// -------- TOOL : insert_child --------
async function insertChild(params) {
    const { parentId, childId, index } = params || {};
    try {
        if (!parentId || !childId || index === undefined) {
            const payload = { code: "missing_parameter", message: "'parentId', 'childId', and 'index' are required", details: { parentId, childId, index } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (parentId === childId) {
            const payload = { code: "invalid_parameter", message: "A node cannot be inserted into itself", details: { parentId, childId } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const parent = await figma.getNodeByIdAsync(parentId);
        if (!(parent && 'insertChild' in parent)) {
            const payload = { code: "invalid_parent", message: `Parent cannot accept children`, details: { parentId, parentType: parent ? parent.type : undefined } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        const child = await figma.getNodeByIdAsync(childId);
        if (!child) {
            const payload = { code: "node_not_found", message: `Child node not found`, details: { childId } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (typeof index !== 'number' || index < 0 || index > parent.children.length) {
            const payload = { code: "index_out_of_bounds", message: "Index must be within [0, parent.children.length]", details: { index, max: parent.children.length } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (child.locked) {
            const payload = { code: "locked_nodes", message: "Child is locked", details: { nodeIds: [childId] } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        try {
            parent.insertChild(index, child);
        } catch (e) {
            const originalError = (e && e.message) || String(e);
            let code = "insert_failed";
            if (/index greater than the number of existing siblings/i.test(originalError)) code = "index_out_of_bounds";
            const payload = { code, message: `Failed to insert child: ${originalError}`, details: { parentId, childId, index } };
            logger.error("❌ insert_child failed", { code: payload.code, originalError, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const result = {
            success: true,
            summary: `Inserted child into parent at index ${index}`,
            modifiedNodeIds: [childId],
            parentId,
            childId,
            index,
        };
        logger.info("✅ insert_child succeeded", { parentId, childId, index });
        return result;
    } catch (error) {
        try {
            const maybe = JSON.parse(error && error.message ? error.message : String(error));
            if (maybe && maybe.code) throw error;
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ insert_child failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

// ======================================================
// Section: Style Creation (Paint/Text/Effect/Grid Styles)
// ======================================================
async function createPaintStyle(params) {
    try {
        const { name, paints, onConflict } = params || {};

        // Validate editor type
        if (figma.editorType !== 'figma') {
            const payload = { code: "unsupported_editor_type", message: "Style APIs are only available in Figma Design", details: { editorType: figma.editorType } };
            logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Validate params
        if (typeof name !== 'string' || name.trim().length === 0) {
            const payload = { code: "missing_parameter", message: "'name' is required and must be a non-empty string", details: { name } };
            logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (!Array.isArray(paints) || paints.length === 0) {
            const payload = { code: "invalid_parameter", message: "'paints' must be a non-empty array of Paint objects", details: { paintsType: Array.isArray(paints) ? 'array' : typeof paints } };
            logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const conflictMode = (onConflict === 'skip' || onConflict === 'suffix' || onConflict === 'error') ? onConflict : 'error';

        // Conflict handling by name
        const existing = await figma.getLocalPaintStylesAsync();
        const exact = existing.find(s => String(s.name) === name);
        if (exact) {
            if (conflictMode === 'skip') {
                logger.info("✅ create_paint_style skipped (name exists)", { styleId: exact.id, name: exact.name });
                return { success: true, summary: `Skipped: paint style '${name}' already exists`, modifiedNodeIds: [], createdStyleId: exact.id, name: exact.name, type: 'paint', skipped: true };
            }
            if (conflictMode === 'error') {
                const payload = { code: "conflict_style_name", message: `A paint style named '${name}' already exists`, details: { name, existingStyleId: exact.id } };
                logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
        }

        const style = figma.createPaintStyle();
        // If suffix mode, ensure unique name
        if (exact && conflictMode === 'suffix') {
            let i = 2; let candidate = `${name} (${i})`;
            const names = new Set(existing.map(s => String(s.name)));
            while (names.has(candidate)) { i += 1; candidate = `${name} (${i})`; }
            style.name = candidate;
        } else {
            style.name = name;
        }
        style.paints = paints;

        const result = { success: true, summary: `Created paint style '${style.name}'`, modifiedNodeIds: [], createdStyleId: style.id, name: style.name, type: 'paint' };
        logger.info("✅ create_paint_style succeeded", { styleId: style.id, name: style.name });
        return result;
    } catch (error) {
        try {
            const payload = JSON.parse((error && error.message) || String(error));
            if (payload && payload.code) {
                logger.error("❌ create_paint_style failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
                throw new Error(JSON.stringify(payload));
            }
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

async function createTextStyle(params) {
    try {
        const { name, style, onConflict } = params || {};

        if (figma.editorType !== 'figma') {
            const payload = { code: "unsupported_editor_type", message: "Style APIs are only available in Figma Design", details: { editorType: figma.editorType } };
            logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        if (typeof name !== 'string' || name.trim().length === 0) {
            const payload = { code: "missing_parameter", message: "'name' is required and must be a non-empty string", details: { name } };
            logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (typeof style !== 'object' || style == null) {
            const payload = { code: "invalid_parameter", message: "'style' must be an object with text style properties", details: {} };
            logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const conflictMode = (onConflict === 'skip' || onConflict === 'suffix' || onConflict === 'error') ? onConflict : 'error';
        const existing = await figma.getLocalTextStylesAsync();
        const exact = existing.find(s => String(s.name) === name);
        if (exact) {
            if (conflictMode === 'skip') {
                logger.info("✅ create_text_style skipped (name exists)", { styleId: exact.id, name: exact.name });
                return { success: true, summary: `Skipped: text style '${name}' already exists`, modifiedNodeIds: [], createdStyleId: exact.id, name: exact.name, type: 'text', skipped: true };
            }
            if (conflictMode === 'error') {
                const payload = { code: "conflict_style_name", message: `A text style named '${name}' already exists`, details: { name, existingStyleId: exact.id } };
                logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
        }

        const textStyle = figma.createTextStyle();
        if (exact && conflictMode === 'suffix') {
            let i = 2; let candidate = `${name} (${i})`;
            const names = new Set(existing.map(s => String(s.name)));
            while (names.has(candidate)) { i += 1; candidate = `${name} (${i})`; }
            textStyle.name = candidate;
        } else {
            textStyle.name = name;
        }

        // Ensure font is loaded BEFORE setting any font-dependent properties
        let targetFontName = (style && style.fontName && typeof style.fontName === 'object') ? style.fontName : textStyle.fontName;
        try {
            if (targetFontName && typeof targetFontName === 'object') {
                await figma.loadFontAsync(targetFontName);
            }
        } catch (e) {
            const payload = { code: "font_load_failed", message: (e && e.message) || "Failed to load specified font", details: { fontName: targetFontName } };
            logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        // Apply fontName first (if provided), then remaining properties
        if (style && typeof style === 'object') {
            if (style.fontName) {
                try { textStyle.fontName = style.fontName; } catch (e) {
                    const payload = { code: "invalid_parameter", message: (e && e.message) || "Invalid fontName provided", details: { fontName: style.fontName } };
                    logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                    throw new Error(JSON.stringify(payload));
                }
            }
            for (const key of Object.keys(style)) {
                if (key === 'fontName' || key === 'name') continue;
                try {
                    textStyle[key] = style[key];
                } catch (e) {
                    const payload = { code: "invalid_parameter", message: (e && e.message) || `Invalid style property '${key}'`, details: { key, valueType: typeof style[key] } };
                    logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                    throw new Error(JSON.stringify(payload));
                }
            }
        }

        const result = { success: true, summary: `Created text style '${textStyle.name}'`, modifiedNodeIds: [], createdStyleId: textStyle.id, name: textStyle.name, type: 'text' };
        logger.info("✅ create_text_style succeeded", { styleId: textStyle.id, name: textStyle.name });
        return result;
    } catch (error) {
        try {
            const payload = JSON.parse((error && error.message) || String(error));
            if (payload && payload.code) {
                logger.error("❌ create_text_style failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
                throw new Error(JSON.stringify(payload));
            }
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ create_text_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

async function createEffectStyle(params) {
    try {
        const { name, effects, onConflict } = params || {};

        if (figma.editorType !== 'figma') {
            const payload = { code: "unsupported_editor_type", message: "Style APIs are only available in Figma Design", details: { editorType: figma.editorType } };
            logger.error("❌ create_effect_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (typeof name !== 'string' || name.trim().length === 0) {
            const payload = { code: "missing_parameter", message: "'name' is required and must be a non-empty string", details: { name } };
            logger.error("❌ create_effect_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (!Array.isArray(effects) || effects.length === 0) {
            const payload = { code: "invalid_parameter", message: "'effects' must be a non-empty array of Effect objects", details: { effectsType: Array.isArray(effects) ? 'array' : typeof effects } };
            logger.error("❌ create_effect_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const conflictMode = (onConflict === 'skip' || onConflict === 'suffix' || onConflict === 'error') ? onConflict : 'error';
        const existing = await figma.getLocalEffectStylesAsync();
        const exact = existing.find(s => String(s.name) === name);
        if (exact) {
            if (conflictMode === 'skip') {
                logger.info("✅ create_effect_style skipped (name exists)", { styleId: exact.id, name: exact.name });
                return { success: true, summary: `Skipped: effect style '${name}' already exists`, modifiedNodeIds: [], createdStyleId: exact.id, name: exact.name, type: 'effect', skipped: true };
            }
            if (conflictMode === 'error') {
                const payload = { code: "conflict_style_name", message: `An effect style named '${name}' already exists`, details: { name, existingStyleId: exact.id } };
                logger.error("❌ create_effect_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
        }

        const effectStyle = figma.createEffectStyle();
        if (exact && conflictMode === 'suffix') {
            let i = 2; let candidate = `${name} (${i})`;
            const names = new Set(existing.map(s => String(s.name)));
            while (names.has(candidate)) { i += 1; candidate = `${name} (${i})`; }
            effectStyle.name = candidate;
        } else {
            effectStyle.name = name;
        }
        effectStyle.effects = effects;

        const result = { success: true, summary: `Created effect style '${effectStyle.name}'`, modifiedNodeIds: [], createdStyleId: effectStyle.id, name: effectStyle.name, type: 'effect' };
        logger.info("✅ create_effect_style succeeded", { styleId: effectStyle.id, name: effectStyle.name });
        return result;
    } catch (error) {
        try {
            const payload = JSON.parse((error && error.message) || String(error));
            if (payload && payload.code) {
                logger.error("❌ create_effect_style failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
                throw new Error(JSON.stringify(payload));
            }
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ create_effect_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

async function createGridStyle(params) {
    try {
        const { name, layoutGrids, onConflict } = params || {};

        if (figma.editorType !== 'figma') {
            const payload = { code: "unsupported_editor_type", message: "Style APIs are only available in Figma Design", details: { editorType: figma.editorType } };
            logger.error("❌ create_grid_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (typeof name !== 'string' || name.trim().length === 0) {
            const payload = { code: "missing_parameter", message: "'name' is required and must be a non-empty string", details: { name } };
            logger.error("❌ create_grid_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
        if (!Array.isArray(layoutGrids) || layoutGrids.length === 0) {
            const payload = { code: "invalid_parameter", message: "'layoutGrids' must be a non-empty array of LayoutGrid objects", details: { layoutGridsType: Array.isArray(layoutGrids) ? 'array' : typeof layoutGrids } };
            logger.error("❌ create_grid_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }

        const conflictMode = (onConflict === 'skip' || onConflict === 'suffix' || onConflict === 'error') ? onConflict : 'error';
        const existing = await figma.getLocalGridStylesAsync();
        const exact = existing.find(s => String(s.name) === name);
        if (exact) {
            if (conflictMode === 'skip') {
                logger.info("✅ create_grid_style skipped (name exists)", { styleId: exact.id, name: exact.name });
                return { success: true, summary: `Skipped: grid style '${name}' already exists`, modifiedNodeIds: [], createdStyleId: exact.id, name: exact.name, type: 'grid', skipped: true };
            }
            if (conflictMode === 'error') {
                const payload = { code: "conflict_style_name", message: `A grid style named '${name}' already exists`, details: { name, existingStyleId: exact.id } };
                logger.error("❌ create_grid_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
        }

        const gridStyle = figma.createGridStyle();
        if (exact && conflictMode === 'suffix') {
            let i = 2; let candidate = `${name} (${i})`;
            const names = new Set(existing.map(s => String(s.name)));
            while (names.has(candidate)) { i += 1; candidate = `${name} (${i})`; }
            gridStyle.name = candidate;
        } else {
            gridStyle.name = name;
        }
        gridStyle.layoutGrids = layoutGrids;

        const result = { success: true, summary: `Created grid style '${gridStyle.name}'`, modifiedNodeIds: [], createdStyleId: gridStyle.id, name: gridStyle.name, type: 'grid' };
        logger.info("✅ create_grid_style succeeded", { styleId: gridStyle.id, name: gridStyle.name });
        return result;
    } catch (error) {
        try {
            const payload = JSON.parse((error && error.message) || String(error));
            if (payload && payload.code) {
                logger.error("❌ create_grid_style failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details || {} });
                throw new Error(JSON.stringify(payload));
            }
        } catch (_) {}
        const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
        logger.error("❌ create_grid_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
    }
}

// -------- TOOL : create_image --------
// TODO: nano-banana
async function createImage(params) {
    throw new Error("Not implemented: create_image");
}

// -------- TOOL : get_image_by_hash --------
async function getImageByHash(params) {
    const { hash } = params || {};
    if (!hash) {
        throw new Error("Missing 'hash' parameter.");
    }

    const image = figma.getImageByHash(hash);
    
    if (image) {
        const bytes = await image.getBytesAsync();
        // a mini polyfill for base64 encoding
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        return {
            success: true,
            base64: base64,
            size: image.getSize(),
        };
    } else {
        return {
            success: false,
            message: `Image with hash "${hash}" not found.`
        };
    }
}

 

 


// ======================================================
// Section: Comments (Read-only)
// ======================================================
// -------- TOOL : get_comments --------
async function getComments(params = {}) {
  try {
    // Guard: editor type and feature availability
    if (figma && figma.editorType && figma.editorType !== 'figma') {
      const payload = { code: "unsupported_editor_type", message: "Comments API is only available in Figma Design", details: { editorType: figma.editorType } };
      logger.error("❌ get_comments failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!(figma && figma.root && typeof figma.root.getCommentsAsync === "function")) {
      const payload = { code: "comments_feature_unavailable", message: "Comments API not available in this context", details: { editorType: figma && figma.editorType ? figma.editorType : undefined } };
      logger.error("❌ get_comments failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const comments = await figma.root.getCommentsAsync();
    const payload = comments.map(c => ({
      id: c.id,
      message: c.message,
      clientMeta: c.clientMeta,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
      user: c.user,
    }));
    logger.info("✅ get_comments succeeded", { count: payload.length });
    // Read-only tool: return data directly
    return payload;
  } catch (error) {
    // Pass through structured errors if already formatted
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error("❌ get_comments failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) { /* ignore parse attempt */ }

    const isUnavailable = !(figma && figma.root && typeof figma.root.getCommentsAsync === "function");
    const code = isUnavailable ? "comments_feature_unavailable" : "figma_api_error";
    const message = isUnavailable ? "Comments API not available in this context" : ((error && error.message) || "Failed to get comments");
    const payload = { code, message, details: {} };
    logger.error("❌ get_comments failed", { code: payload.code, originalError: (error && error.message) || String(error), details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}
 

 

// ======================================================
// Section: Context Gathering (Snapshot and Full Context)
// ======================================================
// === Full-context gatherer (max depth, no truncation) ===
// -------- TOOL : gather_full_context --------
async function gatherFullContext(params) {
  try {
    const includeComments = params && params.includeComments !== false;

    const page = figma.currentPage;
    const selection = page.selection || [];

    const selectionSignature = computeSelectionSignature(selection);
    const force = !!(params && params.force === true);

    if (!force && fullContextCache.data && fullContextCache.lastSignature === selectionSignature && fullContextCache.includeComments === includeComments && (Date.now() - fullContextCache.ts) <= FULL_CONTEXT_TTL_MS) {
      const cached = Object.assign({}, fullContextCache.data, { cache: { hit: true, ageMs: Date.now() - fullContextCache.ts, ttlMs: FULL_CONTEXT_TTL_MS } });
      return sanitize(cached);
    }

    function safeAssign(target, node, key) {
      try {
        if (key in node) target[key] = node[key];
      } catch (_) {}
    }

    function collectAutoLayout(node, out) {
      if (!('layoutMode' in node)) return;
      out.autoLayout = {
        layoutMode: node.layoutMode,
        layoutWrap: ('layoutWrap' in node) ? node.layoutWrap : undefined,
        primaryAxisAlignItems: ('primaryAxisAlignItems' in node) ? node.primaryAxisAlignItems : undefined,
        counterAxisAlignItems: ('counterAxisAlignItems' in node) ? node.counterAxisAlignItems : undefined,
        primaryAxisSizingMode: ('primaryAxisSizingMode' in node) ? node.primaryAxisSizingMode : undefined,
        counterAxisSizingMode: ('counterAxisSizingMode' in node) ? node.counterAxisSizingMode : undefined,
        itemSpacing: ('itemSpacing' in node) ? node.itemSpacing : undefined,
        counterAxisSpacing: ('counterAxisSpacing' in node) ? node.counterAxisSpacing : undefined,
        paddingTop: ('paddingTop' in node) ? node.paddingTop : undefined,
        paddingRight: ('paddingRight' in node) ? node.paddingRight : undefined,
        paddingBottom: ('paddingBottom' in node) ? node.paddingBottom : undefined,
        paddingLeft: ('paddingLeft' in node) ? node.paddingLeft : undefined,
      };
      safeAssign(out, node, 'strokesIncludedInLayout');
      safeAssign(out, node, 'layoutAlign');
      safeAssign(out, node, 'layoutGrow');
      safeAssign(out, node, 'layoutSizingHorizontal');
      safeAssign(out, node, 'layoutSizingVertical');
    }

    function collectStyles(node, out) {
      // Paints / Strokes / Effects / Grids
      if ('fills' in node) out.fills = node.fills;
      if ('strokes' in node) out.strokes = node.strokes;
      safeAssign(out, node, 'strokeWeight');
      safeAssign(out, node, 'strokeAlign');
      safeAssign(out, node, 'strokeCap');
      safeAssign(out, node, 'strokeJoin');
      safeAssign(out, node, 'dashPattern');
      safeAssign(out, node, 'miterLimit');
      if ('effects' in node) out.effects = node.effects;
      if ('layoutGrids' in node) out.layoutGrids = node.layoutGrids;
      // Style refs
      safeAssign(out, node, 'fillStyleId');
      safeAssign(out, node, 'strokeStyleId');
      safeAssign(out, node, 'effectStyleId');
      safeAssign(out, node, 'gridStyleId');
      if (node.type === 'TEXT') safeAssign(out, node, 'textStyleId');
      // Backgrounds on Frames/Components
      safeAssign(out, node, 'backgrounds');
      safeAssign(out, node, 'backgroundStyleId');
    }

    function collectGeometry(node, out) {
      out.visible = node.visible !== false;
      safeAssign(out, node, 'locked');
      safeAssign(out, node, 'opacity');
      safeAssign(out, node, 'blendMode');
      safeAssign(out, node, 'isMask');
      // Size only (omit x,y/transforms/constraints)
      out.width = node.width; out.height = node.height;
      safeAssign(out, node, 'rotation');
      // Corners
      safeAssign(out, node, 'cornerRadius');
      safeAssign(out, node, 'rectangleCornerRadii');
      safeAssign(out, node, 'cornerSmoothing');
      // Clipping only (omit export settings)
      safeAssign(out, node, 'clipsContent');
    }

    function collectVariables(node, out) {
      safeAssign(out, node, 'boundVariables');
    }

    async function collectComponentInfo(node, out) {
      if (node.type === 'INSTANCE') {
        try {
          const mc = await node.getMainComponentAsync();
          out.instanceOf = mc ? { id: mc.id, name: mc.name, key: ('key' in mc) ? mc.key : undefined } : null;
        } catch (_) {
          out.instanceOf = node.mainComponent ? { id: node.mainComponent.id, name: node.mainComponent.name } : null;
        }
        safeAssign(out, node, 'componentProperties');
        safeAssign(out, node, 'componentPropertyReferences');
        safeAssign(out, node, 'variantProperties');
        safeAssign(out, node, 'scaleFactor');
      } else if (node.type === 'COMPONENT') {
        safeAssign(out, node, 'key');
        // omit description/documentationLinks and global instances
        safeAssign(out, node, 'variantProperties');
      } else if (node.type === 'COMPONENT_SET') {
      safeAssign(out, node, 'key');
      // omit description
      safeAssign(out, node, 'componentPropertyDefinitions');
    }
  }

  function collectConnectorsAndVectors(node, out) {
    // Intentionally omitted per design workflow scope
  }

  function collectText(node, out) {
    if (node.type !== 'TEXT') return;
    out.characters = node.characters || '';
    out.typography = {
      fontName: node.fontName,
      fontSize: node.fontSize,
      textAlignHorizontal: node.textAlignHorizontal,
      textAlignVertical: node.textAlignVertical,
      letterSpacing: node.letterSpacing,
      lineHeight: node.lineHeight,
      paragraphSpacing: ('paragraphSpacing' in node) ? node.paragraphSpacing : undefined,
      paragraphIndent: ('paragraphIndent' in node) ? node.paragraphIndent : undefined,
      textCase: ('textCase' in node) ? node.textCase : undefined,
      textDecoration: ('textDecoration' in node) ? node.textDecoration : undefined,
      textAutoResize: ('textAutoResize' in node) ? node.textAutoResize : undefined,
    };
    // Styled text segments if supported
    try {
      if ('getStyledTextSegments' in node) {
        out.styledTextSegments = node.getStyledTextSegments([
          'fontName','fontSize','fill','fills','textCase','textDecoration','letterSpacing','lineHeight','textStyleId','hyperlink'
        ]);
      }
    } catch (_) {}
  }

  function collectPluginData(node, out) { /* omitted */ }

  async function collectNodeDeep(node) {
    const info = {
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parent ? node.parent.id : null,
      index: (node.parent && node.parent.children) ? node.parent.children.indexOf(node) : -1,
    };

    collectGeometry(node, info);
    collectAutoLayout(node, info);
    collectStyles(node, info);
    collectVariables(node, info);
    collectText(node, info);
    collectConnectorsAndVectors(node, info);
    await collectComponentInfo(node, info);
    safeAssign(info, node, 'reactions');

    collectPluginData(node, info);

    if ('children' in node && Array.isArray(node.children)) {
      info.children = [];
      for (const child of node.children) {
        info.children.push(await collectNodeDeep(child));
      }
    }

    return info;
  }

    const nodesData = [];
    for (const n of selection) {
      nodesData.push(await collectNodeDeep(n));
    }

  // Optional enrichments
    let comments = undefined;
    if (includeComments) {
      try {
        const all = await figma.root.getCommentsAsync();
        const selectedIds = new Set(selection.map(n => n.id));
        comments = all.filter(c => {
          try {
            const meta = c.clientMeta || {};
            const nodeId = meta && (meta.nodeId || meta.node_id || (meta.node && meta.node.id));
            return nodeId ? selectedIds.has(nodeId) : false;
          } catch (_) { return false; }
        }).map(c => ({ id: c.id, message: c.message, clientMeta: c.clientMeta, createdAt: c.createdAt, resolvedAt: c.resolvedAt, user: c.user }));
      } catch (_) {}
    }

  function sanitize(value) {
    if (value === figma.mixed) return "MIXED";
    if (typeof value === 'symbol') return null;
    if (!value) return value;
    if (Array.isArray(value)) return value.map(sanitize);
    if (typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        const v = value[k];
        const sv = sanitize(v);
        if (sv !== undefined) out[k] = sv;
      }
      return out;
    }
    return value;
  }

    const result = {
      document: { pageId: page.id, pageName: page.name },
      selectionCount: selection.length,
      selectedNodeIds: selection.map(n => n.id),
      gatheredAt: Date.now(),
      selectionSignature: selectionSignature,
      nodes: nodesData,
      comments
    };
    // update cache
    fullContextCache.lastSignature = selectionSignature;
    fullContextCache.includeComments = includeComments;
    fullContextCache.data = result;
    fullContextCache.ts = Date.now();

    logger.info("✅ gather_full_context succeeded", { selectionCount: selection.length, includeComments, force });
    return sanitize(result);
  } catch (error) {
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ gather_full_context failed", { code: payload.code, originalError: payload.message, details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {}
    const payload2 = { code: "gather_full_context_failed", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ gather_full_context failed", { code: payload2.code, originalError: payload2.message, details: payload2.details });
    throw new Error(JSON.stringify(payload2));
  }
}

// Unified selections_context API with modes: 'snapshot' (fast summary) and 'complete' (deep context)
// -------- TOOL : selections_context --------
async function selectionsContext(params) {
  const modeRaw = params && params.mode;
  const mode = modeRaw || 'snapshot';
  const includeComments = !!(params && params.includeComments);
  const force = !!(params && params.force);

  try {
    if (mode !== 'snapshot' && mode !== 'complete') {
      const payload = { code: "invalid_parameter", message: "mode must be 'snapshot' or 'complete'", details: { received: modeRaw } };
      logger.error("❌ selections_context failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const page = figma.currentPage;
    const selection = page.selection || [];
    const selectionSignature = computeSelectionSignature(selection);

    if (mode === 'complete') {
      const res = await gatherFullContext({ includeComments, force });
      logger.info("✅ selections_context complete succeeded", { selectionCount: selection.length, includeComments, force });
      return res;
    }

    // snapshot mode (Tier‑A summary)
    const selectionSummary = buildSelectionSummary(selection);
    const result = {
      document: { pageId: page.id, pageName: page.name },
      selectionSignature,
      selectionSummary,
      gatheredAt: Date.now(),
    };
    logger.info("✅ selections_context snapshot succeeded", { selectionCount: selectionSummary.selectionCount });
    return result;
  } catch (error) {
    try {
      const payload = JSON.parse(error && error.message ? error.message : String(error));
      if (payload && payload.code) {
        logger.error("❌ selections_context failed", { code: payload.code, originalError: payload.message, details: payload.details || {} });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {}
    const payload2 = { code: "selections_context_failed", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ selections_context failed", { code: payload2.code, originalError: payload2.message, details: payload2.details });
    throw new Error(JSON.stringify(payload2));
  }
}


