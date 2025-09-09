// ==============================================================
// This file contains the main code for the figma copilot plugin
// It handles Figma API commands 
// ==============================================================


// ======================================================
// Config
// ======================================================

// Plugin state
const state = {
  serverPort: 3055, // Default port
};

// Show UI
figma.showUI(__html__, { width: 380, height: 700 });

// Load persisted settings and inform UI
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

// Config helpers
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

  // TOOL SET
  commandRegistry.set("get_canvas_snapshot", (p) => getCanvasSnapshot(p));

  commandRegistry.set("find_nodes", (p) => findNodes(p));
  commandRegistry.set("get_node_details", (p) => getNodeDetails(p));
  commandRegistry.set("get_image_of_node", (p) => getImageOfNode(p));
  commandRegistry.set("get_node_ancestry", (p) => getNodeAncestry(p));
  commandRegistry.set("get_node_hierarchy", (p) => getNodeHierarchy(p));
  commandRegistry.set("get_document_styles", (p) => getDocumentStyles(p));
  commandRegistry.set("get_style_consumers", (p) => getStyleConsumers(p));
  commandRegistry.set("get_document_components", (p) => getDocumentComponents(p));

  commandRegistry.set("create_frame", (p) => createFrame(p));
  commandRegistry.set("create_text", (p) => createText(p));

  commandRegistry.set("set_fills", (p) => set_fills(p));
  commandRegistry.set("set_strokes", (p) => set_strokes(p));
  commandRegistry.set("set_corner_radius", (p) => set_corner_radius(p));
  commandRegistry.set("set_size", (p) => set_size(p));
  commandRegistry.set("set_position", (p) => set_position(p));
  commandRegistry.set("set_layer_properties", (p) => set_layer_properties(p));
  commandRegistry.set("set_effects", (p) => set_effects(p));

  commandRegistry.set("set_auto_layout", (p) => set_auto_layout(p));
  commandRegistry.set("set_auto_layout_child", (p) => set_auto_layout_child(p));
  commandRegistry.set("set_constraints", (p) => set_constraints(p));
  commandRegistry.set("set_child_index", (p) => set_child_index(p));

  commandRegistry.set("set_text_characters", (p) => setTextCharacters(p));
  commandRegistry.set("set_text_style", (p) => setTextStyle(p));

  commandRegistry.set("clone_nodes", (p) => clone_nodes(p));
  commandRegistry.set("reparent_nodes", (p) => reparent_nodes(p));
  commandRegistry.set("reorder_nodes", (p) => reorder_nodes(p));


  commandRegistry.set("create_component_from_node", (p) => createComponentFromNode(p));
  commandRegistry.set("create_component_instance", (p) => createComponentInstance(p));
  commandRegistry.set("set_instance_properties", (p) => setInstanceProperties(p));
  commandRegistry.set("detach_instance", (p) => detachInstance(p));

  commandRegistry.set("create_style", (p) => createStyle(p));
  commandRegistry.set("apply_style", (p) => applyStyle(p));

  commandRegistry.set("create_variable_collection", (p) => createVariableCollection(p));
  commandRegistry.set("create_variable", (p) => createVariable(p));
  commandRegistry.set("set_variable_value", (p) => setVariableValue(p));
  commandRegistry.set("bind_variable_to_property", (p) => bindVariableToProperty(p));


  commandRegistry.set("scroll_and_zoom_into_view", (p) => scroll_and_zoom_into_view(p));
  commandRegistry.set("delete_nodes", (p) => delete_nodes(p));

  commandRegistry.set("show_notification", (p) => show_notification(p));
  commandRegistry.set("commit_undo_step", () => commit_undo_step());

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
    const payload = { code: "unknown_command", message: `Unknown command: ${command}`, details: { command } };
    try { logger.error("unknown command", { code: payload.code, originalError: payload.message, details: payload.details }); } catch (_) {}
    throw new Error(JSON.stringify(payload));
  }

  // Compute a human-friendly step label for logging/undo grouping
  const stepLabel = (params && (params.stepLabel || params.label || params.name || params.toolName)) || command;

  // Avoid redundant reveal for viewport-only commands
  const viewportOnly = new Set(["zoom", "center", "scroll_and_zoom_into_view"]);
  const autoReveal = !(params && params.autoReveal === false) && !viewportOnly.has(command);

  // Wrap the execution in an undo group for atomic step semantics and UX reveal
  // Provide candidate ids from params so reveal can still work for read-only commands
  let candidate_ids = [];
  try {
    if (params && Array.isArray(params.node_ids)) {
      candidate_ids = params.node_ids.filter((id) => typeof id === 'string' && id.length > 0);
    }
    if (params && typeof params.node_id === 'string' && params.node_id.length > 0) {
      candidate_ids = [params.node_id, ...candidate_ids];
    }
  } catch (_) {}

  return await withUndoGroup(stepLabel, async () => {
    return await action();
  }, { autoReveal, candidate_ids });
}

// ======================================================
// Lightweight logger abstraction
// ======================================================
// Lightweight logger abstraction for consistent, emoji-friendly logs
// Normalizes contexts to structured { code, message, details } to satisfy
// cross-layer observability and automated remediation expectations.
const logger = {
  info: (message, context) => {
    try {
      const ctx = (context && typeof context === "object") ? context : {};
      const out = {
        code: ctx.code || ctx.error_code || "info",
        message: ctx.message || ctx.originalError || ctx.error || "",
        details: ctx.details || {},
        _raw: ctx,
      };
      console.log(`🧠 ${message}`, out);
    } catch (_) {}
  },
  warn: (message, context) => {
    try {
      const ctx = (context && typeof context === "object") ? context : {};
      const out = {
        code: ctx.code || ctx.error_code || "warning",
        message: ctx.message || ctx.originalError || ctx.error || "",
        details: ctx.details || {},
        _raw: ctx,
      };
      console.warn(`⚠️ ${message}`, out);
    } catch (_) {}
  },
  error: (message, context) => {
    try {
      const ctx = (context && typeof context === "object") ? context : {};
      const out = {
        code: ctx.code || ctx.error_code || "unknown_plugin_error",
        message: ctx.message || ctx.originalError || ctx.error || (typeof ctx === "string" ? ctx : String(ctx)),
        details: ctx.details || {},
        _raw: ctx,
      };
      console.error(`❌ ${message}`, out);
    } catch (_) {}
  },
};

// Small async delay helper used by highlight/preview flows
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}




// ============================================
// ===============  TOOLS  ====================
// ============================================

// ============================================
// === Category 1: Scoping & Orientation ======
// ============================================

// -------- TOOL : get_canvas_snapshot --------
const CANVAS_SNAPSHOT_TTL_MS = 60000;
let _lastCanvasSnapshot = null; // { signature, include_images, ts, payload }

async function getCanvasSnapshot(params) {
  try {
    const include_images = !!(params && params.include_images);
    const page = figma.currentPage;
    if (!page) {
      const payload = { code: "page_unavailable", message: "Current page unavailable", details: {} };
      logger.error("get_canvas_snapshot failed", { code: payload.code, message: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const selection = Array.isArray(page.selection) ? page.selection : [];
    const signature = computeSelectionSignature(selection || []);

    if (_lastCanvasSnapshot && _lastCanvasSnapshot.signature === signature && _lastCanvasSnapshot.include_images === include_images) {
      const age = Date.now() - _lastCanvasSnapshot.ts;
      if (age <= CANVAS_SNAPSHOT_TTL_MS) {
        logger.info("✅ get_canvas_snapshot cache_hit", { signature, ageMs: age });
        return _lastCanvasSnapshot.payload;
      }
    }

    const pageInfo = { id: page.id, name: page.name };
    const selectionSummaries = (selection || []).map(_toRichNodeSummary);
    const selectionSummary = buildSelectionSummary(selection || []);

    const roots = selectionSummaries.length === 0 && Array.isArray(page.children) ? page.children.map(_toBasicNodeSummary) : [];

    const payload = {
      page: pageInfo,
      selection: selectionSummaries,
      root_nodes_on_page: roots,
      selection_signature: signature,
      selection_summary: selectionSummary,
    };

    // Optionally include lightweight exported images for the current selection
    if (include_images && Array.isArray(selection) && selection.length > 0) {
      try {
        const maxExports = 2; // keep snapshot small; backend will further cap/validate
        const fmt = 'PNG';
        const constraint = { type: 'SCALE', value: 2 };
        const useAbsoluteBounds = true;
        const images = {};
        let exportedCount = 0;
        for (const node of selection) {
          if (exportedCount >= maxExports) break;
          try {
            if (node && typeof node.exportAsync === 'function') {
              const bytes = await node.exportAsync({ format: fmt, constraint, useAbsoluteBounds });
              images[node.id] = customBase64Encode(bytes);
              exportedCount++;
            }
          } catch (e) {
            try { logger.warn("⚠️ snapshot export failed for node", { node_id: node && node.id, error: (e && e.message) || String(e) }); } catch (_) {}
          }
        }
        if (exportedCount > 0) {
          payload.exported_images = images;
          try { logger.info("🖼️ get_canvas_snapshot included exported_images", { count: exportedCount }); } catch (_) {}
        }
      } catch (e) {
        try { logger.warn("⚠️ snapshot image export skipped due to error", { error: (e && e.message) || String(e) }); } catch (_) {}
      }
    }

    _lastCanvasSnapshot = { signature, include_images, ts: Date.now(), payload };

    logger.info("✅ get_canvas_snapshot succeeded", { selectionCount: selectionSummaries.length, roots: roots.length });
    return payload;
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error("❌ get_canvas_snapshot failed", { code: maybe.code, message: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ get_canvas_snapshot failed", { code: payload.code, message: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}


// ============================================
// === Category 2: Observation & Inspection ===
// ============================================


// -------- TOOL : find_nodes --------
async function findNodes(params) {
  try {
    const { filters, scope_node_id, highlight_results } = params || {};
    const f = (filters && typeof filters === "object") ? filters : {};

    // Resolve scope
    let scope = null;
    if (typeof scope_node_id === "string" && scope_node_id.length > 0) {
      scope = await figma.getNodeByIdAsync(scope_node_id);
      if (!scope) {
        const payload = { code: "scope_not_found", message: `Scope node not found: ${scope_node_id}`, details: { scope_node_id } };
        logger.error("❌ find_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    }

    const root = scope || figma.currentPage;
    if (!root || (root !== figma.currentPage && !("findAll" in root) && !("findAllWithCriteria" in root))) {
      const payload = { code: "invalid_scope", message: "Scope does not support search", details: { scope_node_id } };
      logger.error("❌ find_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Build initial candidate set
    let candidates = [];
    const nodeTypes = Array.isArray(f.node_types) ? Array.from(new Set(f.node_types.filter((t) => typeof t === "string" && t.length > 0))) : null;
    if (nodeTypes && nodeTypes.length > 0 && "findAllWithCriteria" in root) {
      try {
        candidates = root.findAllWithCriteria({ types: nodeTypes });
      } catch (e) {
        // Fallback to full scan if criteria fails in certain scopes
        try {
          logger.warn("⚠️ findAllWithCriteria failed; falling back to findAll", { error: (e && e.message) || String(e), node_types: nodeTypes, scope: scope ? scope.id : null });
        } catch (_) {}
        candidates = root.findAll(() => true);
      }
    } else {
      candidates = root.findAll(() => true);
    }

    // Compile regex filters
    let nameRegex = null;
    if (typeof f.name_regex === "string" && f.name_regex.length > 0) {
      try { nameRegex = new RegExp(f.name_regex); } catch (e) {
        const payload = { code: "invalid_regex", message: `Invalid name_regex: ${(e && e.message) || String(e)}`, details: { name_regex: f.name_regex } };
        logger.error("❌ find_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    }
    let textRegex = null;
    if (typeof f.text_regex === "string" && f.text_regex.length > 0) {
      try { textRegex = new RegExp(f.text_regex); } catch (e) {
        const payload = { code: "invalid_regex", message: `Invalid text_regex: ${(e && e.message) || String(e)}`, details: { text_regex: f.text_regex } };
        logger.error("❌ find_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    }

    const mainComponentId = (typeof f.main_component_id === "string" && f.main_component_id.length > 0) ? f.main_component_id : null;
    const styleId = (typeof f.style_id === "string" && f.style_id.length > 0) ? f.style_id : null;

    // Apply AND-composed filters
    let results = candidates.filter((n) => {
      if (nameRegex && !(typeof n.name === "string" && nameRegex.test(n.name))) return false;
      if (textRegex) {
        if (n.type !== "TEXT") return false;
        const chars = ("characters" in n) ? (n.characters || "") : "";
        if (!textRegex.test(chars)) return false;
      }
      if (mainComponentId) {
        if (n.type !== "INSTANCE") return false;
        try {
          const mc = ("mainComponent" in n && n.mainComponent) ? n.mainComponent : null;
          if (!mc || mc.id !== mainComponentId) return false;
        } catch (_) { return false; }
      }
      if (styleId) {
        const hasStyle = ("fillStyleId" in n && n.fillStyleId === styleId)
          || ("strokeStyleId" in n && n.strokeStyleId === styleId)
          || ("effectStyleId" in n && n.effectStyleId === styleId)
          || (n.type === "TEXT" && "textStyleId" in n && n.textStyleId === styleId);
        if (!hasStyle) return false;
      }
      return true;
    });

    const summaries = results.map((n) => _toRichNodeSummary(n));

    // Optional brief highlight
    if (highlight_results === true) {
      const MAX_HIGHLIGHTS = 25;
      const toHighlight = results.slice(0, MAX_HIGHLIGHTS);
      for (const node of toHighlight) {
        try {
          if (!("fills" in node)) continue;
          const originalFills = JSON.parse(JSON.stringify(node.fills));
          node.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.25 }];
          await delay(80);
          try { node.fills = originalFills; } catch (_) {}
        } catch (_) {}
      }
    }

    const payload = { matching_nodes: summaries };
    logger.info("✅ find_nodes succeeded", { matched: summaries.length, scope: scope ? scope.id : "page" });
    return payload;
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error("❌ find_nodes failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ find_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_node_details --------
async function getNodeDetails(params) {
  try {
    const { node_ids } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_parameter", message: "'node_ids' must be a non-empty array of strings", details: { node_ids } };
      logger.error("❌ get_node_details failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const details = {};
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) continue;
        // Reuse existing rich inspection
        const obs = await buildNodeDetailsInternal(id, false);
        const parent_summary = node.parent ? _toRichNodeSummary(node.parent) : null;
        let children_summaries = [];
        if ("children" in node && Array.isArray(node.children)) {
          children_summaries = node.children.map((c) => _toRichNodeSummary(c));
        }
        details[id] = {
          target_node: obs && obs.target_node ? obs.target_node : null,
          parent_summary,
          children_summaries,
        };
      } catch (e) {
        // skip this id
      }
    }
    logger.info("✅ get_node_details succeeded", { count: Object.keys(details).length });
    return { details };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error("❌ get_node_details failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ get_node_details failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_image_of_node --------
async function getImageOfNode(params) {
  try {
    const { node_ids, export_settings } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_parameter", message: "'node_ids' must be a non-empty array of strings", details: { node_ids } };
      logger.error("❌ get_image_of_node failed", { code: payload.code, message: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Normalize export settings (accept both snake_case and camelCase inputs)
    let fmt = 'PNG';
    if (export_settings && typeof export_settings.format === 'string') {
      let raw = String(export_settings.format).trim();
      if (/^jpeg$/i.test(raw) || /^jpg$/i.test(raw)) raw = 'JPG';
      fmt = raw.toUpperCase();
    }

    // Constraint normalization: accept only snake_case { type, value }
    let constraint = { type: 'SCALE', value: 2 };
    if (export_settings && export_settings.constraint && typeof export_settings.constraint === 'object') {
      const c = export_settings.constraint;
      if (typeof c.type === 'string' && (c.value !== undefined)) {
        constraint = { type: String(c.type).toUpperCase(), value: Number(c.value) };
      }
    }

    // Respect explicit use_absolute_bounds if provided; default to true for visual fidelity
    const useAbsoluteBounds = export_settings
      ? !((export_settings.use_absolute_bounds === false))
      : true;

    const images = {};
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || typeof node.exportAsync !== 'function') {
          images[id] = null;
          continue;
        }
        const bytes = await node.exportAsync({ format: fmt, constraint, useAbsoluteBounds });
        images[id] = customBase64Encode(bytes);
      } catch (e) {
        // Export failed for this node; log structured error and record null
        try {
          const details = { node_id: id, error: (e && e.message) || String(e) };
          logger.error("❌ export_failed", { code: "export_failed", message: "Export failed for node", details });
        } catch (_) {}
        images[id] = null;
      }
    }
    logger.info("✅ get_image_of_node succeeded", { count: Object.keys(images).length, format: fmt });
    return { images };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error("❌ get_image_of_node failed", { code: maybe.code, message: maybe.message || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ get_image_of_node failed", { code: payload.code, message: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_node_ancestry --------
async function getNodeAncestry(params) {
  try {
    const { node_id } = params || {};
    if (typeof node_id !== 'string' || node_id.length === 0) {
      const payload = { code: 'missing_parameter', message: "'node_id' must be a non-empty string", details: { node_id } };
      logger.error('❌ get_node_ancestry failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const node = await figma.getNodeByIdAsync(node_id);
    if (!node) {
      const payload = { code: 'node_not_found', message: `Node not found: ${node_id}`, details: { node_id } };
      logger.error('❌ get_node_ancestry failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const ancestors = [];
    let current = node.parent || null;
    while (current && current.type !== 'PAGE') {
      ancestors.push(_toBasicNodeSummary(current));
      current = current.parent || null;
    }
    if (current && current.type === 'PAGE') {
      ancestors.push(_toBasicNodeSummary(current));
    }
    logger.info('✅ get_node_ancestry succeeded', { count: ancestors.length });
    return { ancestors };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error('❌ get_node_ancestry failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ get_node_ancestry failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_node_hierarchy --------
async function getNodeHierarchy(params) {
  try {
    const { node_id } = params || {};
    if (typeof node_id !== 'string' || node_id.length === 0) {
      const payload = { code: 'missing_parameter', message: "'node_id' must be a non-empty string", details: { node_id } };
      logger.error('❌ get_node_hierarchy failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const node = await figma.getNodeByIdAsync(node_id);
    if (!node) {
      const payload = { code: 'node_not_found', message: `Node not found: ${node_id}`, details: { node_id } };
      logger.error('❌ get_node_hierarchy failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const parent = node.parent || null;
    const parent_summary = parent ? _toBasicNodeSummary(parent) : null;
    let children = [];
    try {
      if ('children' in node && Array.isArray(node.children)) {
        children = node.children.map((c) => _toBasicNodeSummary(c));
      }
    } catch (_) {}
    logger.info('✅ get_node_hierarchy succeeded', { childCount: children.length, hasParent: !!parent_summary });
    return { parent_summary, children };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error('❌ get_node_hierarchy failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ get_node_hierarchy failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_document_styles --------
async function getDocumentStyles(params) {
  try {
    const allowed = new Set(['PAINT', 'TEXT', 'EFFECT', 'GRID']);
    const style_types = (params && Array.isArray(params.style_types)) ? params.style_types.filter((t) => typeof t === 'string' && allowed.has(t)) : null;

    const include = style_types && style_types.length > 0 ? new Set(style_types) : allowed;
    const styles = [];

    // Guard: Styles APIs only in Figma Design
    if (figma.editorType !== 'figma') {
      logger.info('ℹ️ get_document_styles in non-design editor', { editorType: figma.editorType });
      return { styles };
    }

    if (include.has('PAINT') && typeof figma.getLocalPaintStylesAsync === 'function') {
      try { const arr = await figma.getLocalPaintStylesAsync(); for (const s of arr) styles.push({ id: s.id, name: String(s.name), type: 'PAINT' }); } catch (_) {}
    }
    if (include.has('TEXT') && typeof figma.getLocalTextStylesAsync === 'function') {
      try { const arr = await figma.getLocalTextStylesAsync(); for (const s of arr) styles.push({ id: s.id, name: String(s.name), type: 'TEXT' }); } catch (_) {}
    }
    if (include.has('EFFECT') && typeof figma.getLocalEffectStylesAsync === 'function') {
      try { const arr = await figma.getLocalEffectStylesAsync(); for (const s of arr) styles.push({ id: s.id, name: String(s.name), type: 'EFFECT' }); } catch (_) {}
    }
    if (include.has('GRID') && typeof figma.getLocalGridStylesAsync === 'function') {
      try { const arr = await figma.getLocalGridStylesAsync(); for (const s of arr) styles.push({ id: s.id, name: String(s.name), type: 'GRID' }); } catch (_) {}
    }
    logger.info('✅ get_document_styles succeeded', { count: styles.length });
    return { styles };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error('❌ get_document_styles failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ get_document_styles failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_style_consumers --------
async function getStyleConsumers(params) {
  try {
    const { style_id } = params || {};
    if (typeof style_id !== 'string' || style_id.length === 0) {
      const payload = { code: 'missing_parameter', message: "'style_id' must be a non-empty string", details: { style_id } };
      logger.error('❌ get_style_consumers failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const consumers = [];

    // Preferred: use the Style API if available to get canonical consumers and fields
    try {
      if (typeof figma.getStyleByIdAsync === 'function') {
        const style = await figma.getStyleByIdAsync(style_id);
        if (style && typeof style.getStyleConsumersAsync === 'function') {
          const style_consumers = await style.getStyleConsumersAsync();
          for (const sc of style_consumers) {
            try {
              const node = sc && sc.node ? sc.node : null;
              const fields = Array.isArray(sc && sc.fields) ? sc.fields.slice() : [];
              if (node) consumers.push({ node: _toRichNodeSummary(node), fields });
            } catch (_) {}
          }
          logger.info('✅ get_style_consumers succeeded', { count: consumers.length, method: 'style_api' });
          return { consuming_nodes: consumers };
        }
      }
    } catch (e) {
      // Non-fatal: fall back to scanning nodes on the page
    }

    // Fallback: scan nodes on the current page and detect style ids on known fields
    const page = figma.currentPage;
    const nodes = page ? page.findAll(() => true) : [];
    for (const n of nodes) {
      try {
        const applied_fields = [];
        if ('fillStyleId' in n && n.fillStyleId === style_id) applied_fields.push('fillStyleId');
        if ('strokeStyleId' in n && n.strokeStyleId === style_id) applied_fields.push('strokeStyleId');
        if ('effectStyleId' in n && n.effectStyleId === style_id) applied_fields.push('effectStyleId');
        if (n.type === 'TEXT' && 'textStyleId' in n && n.textStyleId === style_id) applied_fields.push('textStyleId');
        if (applied_fields.length > 0) {
          consumers.push({ node: _toRichNodeSummary(n), fields: applied_fields });
        }
      } catch (_) {}
    }

    logger.info('✅ get_style_consumers succeeded', { count: consumers.length, method: 'scan' });
    return { consuming_nodes: consumers };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error('❌ get_style_consumers failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ get_style_consumers failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : get_document_components --------
async function getDocumentComponents(params) {
  try {
    const components = [];
    // Optional filter: 'all' | 'published_only' | 'unpublished_only'
    let published_filter = (params && typeof params === 'object' && typeof params.published_filter === 'string') ? params.published_filter : 'all';
    if (published_filter !== 'published_only' && published_filter !== 'unpublished_only' && published_filter !== 'all') {
      published_filter = 'all';
    }
    try {
      const all = figma.root && typeof figma.root.findAll === 'function' ? figma.root.findAll(() => true) : [];
      for (const n of all) {
        if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') {
          const is_published = ("key" in n && !!n.key);
          if ((published_filter === 'published_only' && !is_published) || (published_filter === 'unpublished_only' && is_published)) {
            continue;
          }
          const entry = { id: n.id, component_key: ("key" in n && n.key) ? String(n.key) : null, name: n.name, type: n.type, is_published };
          components.push(entry);
        }
      }
    } catch (_) {}
    logger.info('✅ get_document_components succeeded', { count: components.length, published_filter });
    return { components };
  } catch (error) {
    try {
      const maybe = JSON.parse(error && error.message ? error.message : String(error));
      if (maybe && maybe.code) {
        logger.error('❌ get_document_components failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ get_document_components failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}








// ============================================
// ==== Category 3: Mutation & Creation =======
// ============================================


// ------------------------------------------------
// -------- Sub-Category 3.1: Create Tools --------
// ------------------------------------------------


// -------- TOOL : create_frame --------
async function createFrame(params) {
  try {
    const name = params && typeof params.name === 'string' ? params.name : 'Frame';
    const parent_id = params && (typeof params.parent_id === 'string' ? params.parent_id : undefined);
    const width = params && typeof params.width === 'number' ? params.width : 100;
    const height = params && typeof params.height === 'number' ? params.height : 100;
    const x = params && typeof params.x === 'number' ? params.x : 0;
    const y = params && typeof params.y === 'number' ? params.y : 0;

    const frame = figma.createFrame();
    frame.name = name;
    frame.x = x;
    frame.y = y;
    try { frame.resize(width, height); } catch (_) {}
    // Default: enable auto layout for new frames for efficiency
    try { frame.layoutMode = 'None'; } catch (_) {}

    if (!parent_id) {
      figma.currentPage.appendChild(frame);
    } else {
      const parentNode = await figma.getNodeByIdAsync(parent_id);
      if (!parentNode) {
        logger.error('create_frame failed', { code: 'parent_not_found', details: { parent_id } });
        throw new Error(JSON.stringify({ code: 'parent_not_found', message: `Parent node not found with ID: ${parent_id}`, details: { parent_id } }));
      }
      if (!('appendChild' in parentNode)) {
        logger.error('create_frame failed', { code: 'invalid_parent_type', details: { parent_id, parentType: parentNode.type } });
        throw new Error(JSON.stringify({ code: 'invalid_parent_type', message: `Parent node does not support children: ${parent_id}`, details: { parent_id, parentType: parentNode.type } }));
      }
      try { parentNode.appendChild(frame); } catch (e) {
        const originalError = (e && e.message) ? e.message : String(e);
        const isLocked = /lock/i.test(originalError);
        const code = isLocked ? 'locked_parent' : 'append_failed';
        logger.error('create_frame failed', { code, originalError, details: { parent_id } });
        throw new Error(JSON.stringify({ code, message: `Failed to append frame to parent ${parent_id}: ${originalError}`, details: { parent_id } }));
      }
    }

    logger.info('create_frame succeeded', { id: frame.id, name: frame.name });
    return {
      success: true,
      summary: `Created frame ${frame.id}`,
      created_node_id: frame.id,
      node: { id: frame.id, name: frame.name, x: frame.x, y: frame.y, width: frame.width || width, height: frame.height || height, parent_id }
    };
  } catch (error) {
    try { const asObj = JSON.parse(error && error.message ? error.message : String(error)); if (asObj && asObj.code) throw error; } catch(_) {}
    const originalError = (error && error.message) ? error.message : String(error);
    logger.error('create_frame failed', { code: 'create_frame_failed', originalError, details: {} });
    throw new Error(JSON.stringify({ code: 'create_frame_failed', message: `Failed to create frame: ${originalError}`, details: {} }));
  }
}


// -------- TOOL : create_text --------
async function createText(params) {
  try {
    const characters = params && (typeof params.characters === 'string' ? params.characters : 'Text');
    const parent_id = params && (typeof params.parent_id === 'string' ? params.parent_id : undefined);
    const x = params && typeof params.x === 'number' ? params.x : 0;
    const y = params && typeof params.y === 'number' ? params.y : 0;
    const name = params && typeof params.name === 'string' ? params.name : characters;

    // New snake_case params
    const font_size = params && typeof params.font_size === 'number' ? params.font_size : undefined;
    const font_weight = params && (typeof params.font_weight === 'number' || typeof params.font_weight === 'string') ? params.font_weight : undefined;
    const font_color = params && typeof params.font_color === 'object' ? params.font_color : undefined;

    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    const textNode = figma.createText();
    textNode.x = x;
    textNode.y = y;
    textNode.name = name;
    try { await setCharacters(textNode, String(characters)); } catch (_) {}

    // Apply optional typography overrides
    try {
      if (typeof font_size === 'number') textNode.fontSize = font_size;
    } catch (_) {}
    try {
      if (font_weight !== undefined && textNode.fontName && typeof textNode.fontName === 'object') {
        // Keep existing font family but attempt to set style if possible.
        const current_family = textNode.fontName.family || 'Inter';
        const style = typeof font_weight === 'string' ? font_weight : String(font_weight);
        try { textNode.fontName = { family: current_family, style }; } catch (_) {}
      }
    } catch (_) {}

    // Apply font color if provided (expects r,g,b in 0..1 and optional a)
    try {
      if (font_color && typeof font_color === 'object' && (font_color.r !== undefined || font_color.g !== undefined || font_color.b !== undefined)) {
        const c = { r: font_color.r || 0, g: font_color.g || 0, b: font_color.b || 0 };
        const opacity = (font_color.a !== undefined && font_color.a !== null) ? font_color.a : 1;
        try { textNode.fills = [{ type: 'SOLID', color: c, opacity }]; } catch (_) {}
      }
    } catch (_) {}

    if (!parent_id) {
      figma.currentPage.appendChild(textNode);
    } else {
      const parentNode = await figma.getNodeByIdAsync(parent_id);
      if (!parentNode) {
        logger.error('❌ create_text failed', { code: 'parent_not_found', originalError: 'Parent not found', details: { parent_id } });
        throw new Error(JSON.stringify({ code: 'parent_not_found', message: 'Parent node not found', details: { parent_id } }));
      }
      if (!('appendChild' in parentNode)) {
        logger.error('❌ create_text failed', { code: 'invalid_parent', originalError: 'Parent cannot accept children', details: { parent_id, parentType: parentNode.type } });
        throw new Error(JSON.stringify({ code: 'invalid_parent', message: 'Parent node does not support children', details: { parent_id, parentType: parentNode.type } }));
      }
      try { parentNode.appendChild(textNode); } catch (e) {
        const originalError = (e && e.message) || String(e);
        const isLocked = /lock/i.test(originalError);
        const code = isLocked ? 'locked_parent' : 'append_failed';
        logger.error('❌ create_text failed', { code, originalError, details: { parent_id } });
        throw new Error(JSON.stringify({ code, message: `Failed to append text to parent ${parent_id}: ${originalError}`, details: { parent_id } }));
      }
    }

    logger.info('✅ create_text succeeded', { id: textNode.id, name: textNode.name });
    return {
      success: true,
      summary: `Created text ${textNode.id}`,
      created_node_id: textNode.id,
      node: {
        id: textNode.id,
        name: textNode.name,
        x: textNode.x,
        y: textNode.y,
        characters,
        font_size: textNode.fontSize,
        font_weight: (textNode.fontName && textNode.fontName.style) ? textNode.fontName.style : undefined,
        parent_id
      }
    };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : '{}'); if (maybe && maybe.code) throw error; } catch (_) {}
    logger.error('❌ create_text failed', { code: 'unknown_plugin_error', originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: 'unknown_plugin_error', message: (error && error.message) || 'Failed to create text', details: {} }));
  }
}



// ---------------------------------------------------------------
// -------- Sub-Category 3.2: Modify (General Properties) --------
// ---------------------------------------------------------------


// Helpers: normalization & validation for Paint arrays (Figma Plugin API compliant)
function _deep_clone(value) {
  try { return structuredClone(value); } catch (_) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
}

function _clamp01(n) {
  if (typeof n !== "number" || !isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function _normalize_color_channels(color) {
  if (!color || typeof color !== "object") return { r: 0, g: 0, b: 0 };
  let { r, g, b, a } = color;
  const any_over_one = [r, g, b].some((v) => typeof v === "number" && v > 1);
  const to_unit = (v) => {
    if (typeof v !== "number" || !isFinite(v)) return 0;
    if (any_over_one) return Math.max(0, Math.min(1, v / 255));
    return _clamp01(v);
  };
  const to_alpha = (v) => {
    if (typeof v !== "number" || !isFinite(v)) return 1;
    if (v > 1 && v <= 255) return Math.max(0, Math.min(1, v / 255));
    return _clamp01(v);
  };
  const res = { r: to_unit(r), g: to_unit(g), b: to_unit(b) };
  if (a !== undefined) res.a = to_alpha(a);
  return res;
}

function _solid_from_hex(hex) {
  try {
    if (figma.util && typeof figma.util.solidPaint === "function") {
      return figma.util.solidPaint(String(hex));
    }
  } catch (_) {}
  // Fallback minimal hex parser (#RRGGBB or #RRGGBBAA)
  try {
    const h = String(hex).trim().replace(/^#/, "");
    if (!(h.length === 6 || h.length === 8)) throw new Error("bad_hex");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { type: "SOLID", color: { r, g, b }, opacity: a };
  } catch (_) {
    return { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
  }
}

function _normalize_gradient_stops(stops) {
  if (!Array.isArray(stops)) return [];
  const normalized = stops.map((s) => {
    const color = _normalize_color_channels(s && s.color);
    const position = _clamp01((s && typeof s.position === "number") ? s.position : 0);
    return { color, position };
  });
  // Sort by position ascending to please the API
  normalized.sort((a, b) => a.position - b.position);
  return normalized;
}

function _normalize_paint_type(type_value) {
  const t = String(type_value || "").toUpperCase();
  // Accept friendly aliases
  if (t === "LINEAR") return "GRADIENT_LINEAR";
  if (t === "RADIAL") return "GRADIENT_RADIAL";
  if (t === "ANGULAR") return "GRADIENT_ANGULAR";
  if (t === "DIAMOND") return "GRADIENT_DIAMOND";
  return t;
}

function _camelize_known_paint_fields(paint) {
  // Handle common snake_case inputs
  const p = _deep_clone(paint) || {};
  if (p.image_hash && !p.imageHash) { p.imageHash = p.image_hash; delete p.image_hash; }
  if (p.gradient_stops && !p.gradientStops) { p.gradientStops = p.gradient_stops; delete p.gradient_stops; }
  if (p.gradient_transform && !p.gradientTransform) { p.gradientTransform = p.gradient_transform; delete p.gradient_transform; }
  if (p.stops && !p.gradientStops) { p.gradientStops = p.stops; delete p.stops; }
  // Accept gradient_handle_positions from callers and convert to gradientTransform
  if (Array.isArray(p.gradient_handle_positions)) {
    try {
      const handles = p.gradient_handle_positions;
      // Compute a reasonable gradientTransform from handle positions
      let t;
      if (handles.length >= 3) {
        const h0 = handles[0] || { x: 0, y: 0 };
        const h1 = handles[1] || { x: 1, y: 0 };
        const h2 = handles[2] || { x: 0, y: 1 };
        t = [
          [ (h1.x - h0.x) || 0, (h2.x - h0.x) || 0, h0.x || 0 ],
          [ (h1.y - h0.y) || 0, (h2.y - h0.y) || 0, h0.y || 0 ],
        ];
      } else if (handles.length >= 2) {
        const h0 = handles[0] || { x: 0, y: 0 };
        const h1 = handles[1] || { x: 1, y: 0 };
        const vx = (h1.x - h0.x) || 1;
        const vy = (h1.y - h0.y) || 0;
        // Perpendicular vector for width; normalize length to match main vector length
        const t2x = -vy;
        const t2y = vx;
        t = [ [ vx, t2x, h0.x || 0 ], [ vy, t2y, h0.y || 0 ] ];
      }
      if (!p.gradientTransform && t) {
        p.gradientTransform = t;
      }
    } catch (_) {}
    // Remove unrecognized property regardless
    delete p.gradient_handle_positions;
  }
  if (p.visible !== undefined) p.visible = !!p.visible;
  return p;
}

async function _normalize_paints_input(paints) {
  const result = [];
  for (const raw of paints) {
    if (typeof raw === "string") {
      result.push(_solid_from_hex(raw));
      continue;
    }
    if (!raw || typeof raw !== "object") {
      const payload = { code: "invalid_fills", message: "Invalid paint entry", details: { entry: raw } };
      logger.error("❌ normalize_paints_input failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const p0 = _camelize_known_paint_fields(raw);
    const type = _normalize_paint_type(p0.type);
    if (!type) {
      const payload = { code: "invalid_fills", message: "Paint object missing type", details: { entry: p0 } };
      logger.error("❌ normalize_paints_input failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    if (type === "SOLID") {
      const clone = _deep_clone(p0);
      clone.type = "SOLID";
      clone.color = _normalize_color_channels(clone.color);
      // Move alpha from color.a to top-level opacity per Figma API expectations
      if (clone && clone.color && typeof clone.color === "object" && Object.prototype.hasOwnProperty.call(clone.color, "a")) {
        const alpha = clone.color.a;
        if (clone.opacity === undefined) {
          clone.opacity = _clamp01(alpha);
        } else {
          clone.opacity = _clamp01(clone.opacity);
        }
        // Remove unsupported channel from color
        delete clone.color.a;
      } else if (clone.opacity !== undefined) {
        clone.opacity = _clamp01(clone.opacity);
      }
      result.push(clone);
      continue;
    }
    if (type.startsWith("GRADIENT_")) {
      const clone = _deep_clone(p0);
      clone.type = type;
      // Normalize and validate stops
      clone.gradientStops = _normalize_gradient_stops(clone.gradientStops);
      if (!Array.isArray(clone.gradientStops) || clone.gradientStops.length < 2) {
        const payload = { code: "invalid_fills", message: "gradientStops must have at least 2 entries", details: { entry: p0 } };
        logger.error("❌ normalize_paints_input failed", payload);
        throw new Error(JSON.stringify(payload));
      }
      // Default transform to identity if missing
      if (!Array.isArray(clone.gradientTransform)) {
        clone.gradientTransform = [ [1, 0, 0], [0, 1, 0] ];
      }
      if (clone.opacity !== undefined) clone.opacity = _clamp01(clone.opacity);
      result.push(clone);
      continue;
    }
    if (type === "IMAGE") {
      const clone = _deep_clone(p0);
      clone.type = "IMAGE";
      // Expect imageHash to be present if caller pre-created image; otherwise keep as-is
      if (!clone.imageHash && clone.imageBytes) {
        try {
          const image = figma.createImage(clone.imageBytes);
          clone.imageHash = image.hash;
        } catch (_) {}
      }
      result.push(clone);
      continue;
    }
    // Pass through unmodified but cloned for any other paint subtypes (e.g., VIDEO)
    result.push(_deep_clone(p0));
  }
  return result;
}

// -------- TOOL : set_fills --------
async function set_fills(params) {
  logger.info("🎨 set_fills called", params);
  try {
    const { node_ids, paints } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_parameter", message: "Provide node_ids array", details: { received: params || {} } };
      logger.error("❌ set_fills failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    if (!Array.isArray(paints)) {
      const payload = { code: "invalid_parameter", message: "paints must be an array (use [] to remove)", details: {} };
      logger.error("❌ set_fills failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    // Dynamic page: ensure pages are loaded before mutating nodes
    try {
      if (typeof figma.loadAllPagesAsync === "function") {
        await figma.loadAllPagesAsync();
      }
      if (figma.currentPage && typeof figma.currentPage.loadAsync === "function") {
        await figma.currentPage.loadAsync();
      }
    } catch (e) {
      try { logger.error("⚠️ set_fills page preload failed (continuing)", { code: "page_preload_failed", originalError: (e && e.message) || String(e), details: {} }); } catch (_) {}
    }

    // Normalize paints per Figma API: ensure unit color channels, handle hex strings, clone to avoid readonly objects
    const normalized_paints = await _normalize_paints_input(paints);

    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    const readOnlyNodes = [];
    const nonOverridableNodes = [];
    const failedNodes = [];
    const failureReasons = {};
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (!("fills" in node)) { unsupportedNodes.push(id); continue; }
        const original = node.fills;
        try {
          node.fills = _deep_clone(normalized_paints);
          modified.push(id);
        } catch (e) {
          const msg = (e && e.message) ? String(e.message) : String(e);
          // Classify common failure reasons per Figma API
          if (/read-?only/i.test(msg) || /Cannot write to internal/i.test(msg)) {
            readOnlyNodes.push(id);
          } else if (/cannot be overriden|cannot be overridden|override/i.test(msg)) {
            nonOverridableNodes.push(id);
          } else {
            failedNodes.push(id);
          }
          try { failureReasons[id] = msg; } catch (_) {}
          try { node.fills = original; } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }

    if (modified.length === 0) {
      const payload = { code: "set_fills_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes, readOnlyNodes, nonOverridableNodes, failedNodes, failureReasons } };
      logger.error("❌ set_fills failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = paints.length === 0 ? `Removed fills from ${modified.length} node(s)` : `Applied fills to ${modified.length} node(s)`;
    logger.info("✅ set_fills succeeded", { modified_node_ids: modified });
    const unresolved = Array.from(new Set([...notFoundIds, ...lockedNodes, ...unsupportedNodes]));
    return { success: true, modified_node_ids: modified, unresolved_node_ids: unresolved, summary, details: { not_found_node_ids: notFoundIds, locked_node_ids: lockedNodes, unsupported_node_ids: unsupportedNodes } };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_fills" } };
    logger.error("❌ set_fills failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_strokes --------
async function set_strokes(params) {
  logger.info("🖊️ set_strokes called", params);
  try {
    const { node_ids, paints, stroke_weight, stroke_align, dash_pattern } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    if (!Array.isArray(paints)) throw new Error(JSON.stringify({ code: "invalid_parameter", message: "paints must be an array (use [] to remove)", details: {} }));

    // Validate stroke parameters per API
    if (stroke_weight !== undefined && (typeof stroke_weight !== "number" || !(stroke_weight >= 0))) {
      throw new Error(JSON.stringify({ code: "invalid_parameter", message: "stroke_weight must be a non-negative number", details: { stroke_weight } }));
    }
    let normalized_align = undefined;
    if (typeof stroke_align === "string") {
      const a = String(stroke_align).toUpperCase().trim();
      const allowed = ["CENTER", "INSIDE", "OUTSIDE"];
      if (!allowed.includes(a)) {
        throw new Error(JSON.stringify({ code: "invalid_parameter", message: "stroke_align must be one of CENTER|INSIDE|OUTSIDE", details: { stroke_align } }));
      }
      normalized_align = a;
    }
    let normalized_dash = undefined;
    if (dash_pattern !== undefined) {
      if (!Array.isArray(dash_pattern) || dash_pattern.some((n) => typeof n !== "number" || !isFinite(n) || n < 0)) {
        throw new Error(JSON.stringify({ code: "invalid_parameter", message: "dash_pattern must be an array of non-negative numbers", details: { dash_pattern } }));
      }
      normalized_dash = dash_pattern.slice();
    }

    const normalized_paints = await _normalize_paints_input(paints);

    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (!("strokes" in node)) { unsupportedNodes.push(id); continue; }
        const original = { strokes: node.strokes, strokeWeight: node.strokeWeight, strokeAlign: node.strokeAlign, dashPattern: node.dashPattern };
        try {
          node.strokes = _deep_clone(normalized_paints);
          if (typeof stroke_weight === "number") node.strokeWeight = stroke_weight;
          if (normalized_align) node.strokeAlign = normalized_align;
          if (normalized_dash) node.dashPattern = normalized_dash;
          modified.push(id);
        } catch (e) {
          try { node.strokes = original.strokes; node.strokeWeight = original.strokeWeight; node.strokeAlign = original.strokeAlign; node.dashPattern = original.dashPattern; } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }
    if (modified.length === 0) {
      const payload = { code: "set_strokes_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_strokes failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = paints.length === 0 ? `Removed strokes from ${modified.length} node(s)` : `Applied strokes to ${modified.length} node(s)`;
    logger.info("✅ set_strokes succeeded", { modified_node_ids: modified });
    const unresolved = Array.from(new Set([...notFoundIds, ...lockedNodes, ...unsupportedNodes]));
    return { success: true, modified_node_ids: modified, unresolved_node_ids: unresolved, summary, details: { not_found_node_ids: notFoundIds, locked_node_ids: lockedNodes, unsupported_node_ids: unsupportedNodes } };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_strokes" } };
    logger.error("❌ set_strokes failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_corner_radius --------
async function set_corner_radius(params) {
  logger.info("📐 set_corner_radius (v2) called", params);
  try {
    const { node_ids, uniform_radius, top_left, top_right, bottom_left, bottom_right } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    const hasAny = [uniform_radius, top_left, top_right, bottom_left, bottom_right].some(v => v !== undefined);
    if (!hasAny) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide uniform_radius or per-corner values", details: {} }));

    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        const supportsUniform = ("cornerRadius" in node);
        const supportsIndividual = ("topLeftRadius" in node) && ("topRightRadius" in node) && ("bottomLeftRadius" in node) && ("bottomRightRadius" in node);
        if (!supportsUniform && !supportsIndividual) { unsupportedNodes.push(id); continue; }
        const original = supportsUniform ? node.cornerRadius : null;
        const oTL = supportsIndividual ? node.topLeftRadius : null;
        const oTR = supportsIndividual ? node.topRightRadius : null;
        const oBL = supportsIndividual ? node.bottomLeftRadius : null;
        const oBR = supportsIndividual ? node.bottomRightRadius : null;
        try {
          if (typeof uniform_radius === "number") {
            if (supportsUniform) node.cornerRadius = uniform_radius;
            if (supportsIndividual) { node.topLeftRadius = uniform_radius; node.topRightRadius = uniform_radius; node.bottomLeftRadius = uniform_radius; node.bottomRightRadius = uniform_radius; }
          }
          if (supportsIndividual) {
            if (typeof top_left === "number") node.topLeftRadius = top_left;
            if (typeof top_right === "number") node.topRightRadius = top_right;
            if (typeof bottom_left === "number") node.bottomLeftRadius = bottom_left;
            if (typeof bottom_right === "number") node.bottomRightRadius = bottom_right;
          }
          modified.push(id);
        } catch (e) {
          try {
            if (supportsUniform && original !== null) node.cornerRadius = original;
            if (supportsIndividual) { node.topLeftRadius = oTL; node.topRightRadius = oTR; node.bottomLeftRadius = oBL; node.bottomRightRadius = oBR; }
          } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }
    if (modified.length === 0) {
      const payload = { code: "set_corner_radius_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_corner_radius failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Updated corner radius on ${modified.length} node(s)`;
    logger.info("✅ set_corner_radius succeeded", { modified_node_ids: modified });
    const unresolved = Array.from(new Set([...notFoundIds, ...lockedNodes, ...unsupportedNodes]));
    return { success: true, modified_node_ids: modified, unresolved_node_ids: unresolved, summary, details: { not_found_node_ids: notFoundIds, locked_node_ids: lockedNodes, unsupported_node_ids: unsupportedNodes } };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_corner_radius" } };
    logger.error("❌ set_corner_radius failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_size --------
async function set_size(params) {
  logger.info("📏 set_size called", params);
  try {
    const { node_ids, width, height } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    if (width === undefined && height === undefined) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide width and/or height", details: {} }));
    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        const canResize = typeof node.resize === "function";
        if (!canResize) { unsupportedNodes.push(id); continue; }
        const targetW = typeof width === "number" ? width : node.width;
        const targetH = typeof height === "number" ? height : node.height;
        try { node.resize(targetW, targetH); modified.push(id); } catch (_) { /* skip */ }
      } catch (_) { notFoundIds.push(id); }
    }
    if (modified.length === 0) {
      const payload = { code: "set_size_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_size failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Resized ${modified.length} node(s)`;
    logger.info("✅ set_size succeeded", { modified_node_ids: modified });
    const unresolved = Array.from(new Set([...notFoundIds, ...lockedNodes, ...unsupportedNodes]));
    return { success: true, modified_node_ids: modified, unresolved_node_ids: unresolved, summary, details: { not_found_node_ids: notFoundIds, locked_node_ids: lockedNodes, unsupported_node_ids: unsupportedNodes } };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_size" } };
    logger.error("❌ set_size failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_position --------
async function setPosition(params) {
  logger.info("📍 set_position called", params);
  try {
    const { node_ids, x, y } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    if (typeof x !== "number" || typeof y !== "number") throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide numeric x and y", details: {} }));
    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (!("x" in node) || !("y" in node)) { unsupportedNodes.push(id); continue; }
        try { node.x = x; node.y = y; modified.push(id); } catch (_) { /* skip */ }
      } catch (_) { notFoundIds.push(id); }
    }
    if (modified.length === 0) {
      const payload = { code: "set_position_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_position failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Moved ${modified.length} node(s)`;
    logger.info("✅ set_position succeeded", { modified_node_ids: modified });
    return { success: true, modified_node_ids: modified, summary };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_position" } };
    logger.error("❌ set_position failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}



// -------- TOOL : set_layer_properties --------
async function set_layer_properties(params) {
  logger.info("🧱 set_layer_properties called", params);
  try {
    const { node_ids, name, opacity, visible, locked, blend_mode } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    if (name === undefined && opacity === undefined && visible === undefined && locked === undefined && blend_mode === undefined) {
      throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide at least one property to change", details: {} }));
    }
    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        const before = { name: node.name, opacity: node.opacity, visible: node.visible, locked: node.locked, blendMode: node.blendMode };
        try {
          if (typeof name === "string") node.name = name;
          if (typeof opacity === "number") node.opacity = Math.max(0, Math.min(1, opacity));
          if (typeof visible === "boolean") node.visible = visible;
          if (typeof locked === "boolean") node.locked = locked;
          if (typeof blend_mode === "string") node.blendMode = blend_mode;
          modified.push(id);
        } catch (_) {
          try { node.name = before.name; node.opacity = before.opacity; node.visible = before.visible; node.locked = before.locked; node.blendMode = before.blendMode; } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }
    if (modified.length === 0) {
      const payload = { code: "set_layer_properties_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_layer_properties failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Updated layer properties on ${modified.length} node(s)`;
    logger.info("✅ set_layer_properties succeeded", { modified_node_ids: modified });
    const unresolved = Array.from(new Set([...notFoundIds, ...lockedNodes, ...unsupportedNodes]));
    return { success: true, modified_node_ids: modified, unresolved_node_ids: unresolved, summary, details: { not_found_node_ids: notFoundIds, locked_node_ids: lockedNodes, unsupported_node_ids: unsupportedNodes } };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_layer_properties" } };
    logger.error("❌ set_layer_properties failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_effects --------
async function set_effects(params) {
  logger.info("✨ set_effects called", params);
  try {
    const { node_ids, effects } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    if (!Array.isArray(effects)) throw new Error(JSON.stringify({ code: "invalid_parameter", message: "effects must be an array (use [] to remove)", details: {} }));
    // Basic per-item validation to fail fast with actionable details
    for (let i = 0; i < effects.length; i++) {
      const fx = effects[i];
      if (typeof fx !== "object" || fx === null || typeof fx.type !== "string") {
        const payload = { code: "invalid_parameter", message: "Each effect must be an object with a 'type' field", details: { index: i, received: fx } };
        logger.error("❌ set_effects failed", payload);
        throw new Error(JSON.stringify(payload));
      }
    }
    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];
    const failed_node_ids = [];
    const node_types = {};
    const failure_reasons = {};
    const capability_summary = {};
    
    // Helper: find or create an EffectStyle matching the desired effects (used for dynamic-page fallback)
    async function get_or_create_effect_style_for(effects_target) {
      try {
        const locals = await figma.getLocalEffectStylesAsync();
        for (const s of locals) {
          try { if (JSON.stringify(s.effects) === JSON.stringify(effects_target)) return s; } catch (_) {}
        }
        const style = figma.createEffectStyle();
        const signature = (JSON.stringify(effects_target) || "[]").slice(0, 40);
        style.name = `FRAY/Effects Auto (${signature})`;
        style.effects = effects_target;
        return style;
      } catch (_) {
        return null;
      }
    }
    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (!("effects" in node)) { unsupportedNodes.push(id); continue; }
        node_types[id] = (node && node.type) ? String(node.type) : "unknown";
        const hasSetEffectStyleIdAsync = ("setEffectStyleIdAsync" in node) && typeof node.setEffectStyleIdAsync === "function";
        const hasEffectStyleIdProp = ("effectStyleId" in node);
        const hadStyle = hasEffectStyleIdProp ? (node.effectStyleId || "") !== "" : false;
        capability_summary[id] = { hasSetEffectStyleIdAsync, hasEffectStyleIdProp, hadStyle };
        const original = node.effects;
        let updated = false;
        try {
          node.effects = effects;
          updated = true;
        } catch (_) {
          // Fallback for environments where direct assignment is read-only (e.g., dynamic-page)
          try {
            // Try to detach existing style, then retry direct assignment
            try {
              if (hasSetEffectStyleIdAsync) {
                await node.setEffectStyleIdAsync("");
              } else if (hasEffectStyleIdProp) {
                try { node.effectStyleId = ""; } catch (_) {}
              }
            } catch (_) {}
            if (!updated) {
              try { node.effects = effects; updated = true; } catch (_) {}
            }
            const style = await get_or_create_effect_style_for(effects);
            if (style) {
              const can_set_async = ("setEffectStyleIdAsync" in node) && typeof node.setEffectStyleIdAsync === "function";
              if (can_set_async) {
                await node.setEffectStyleIdAsync(style.id);
                updated = true;
              } else if ("effectStyleId" in node) {
                try { node.effectStyleId = style.id; updated = true; } catch (_) {}
              }
            }
          } catch (_) {}
          if (!updated) { try { node.effects = original; } catch (_) {} }
        }
        if (updated) { modified.push(id); } else { failed_node_ids.push(id); failure_reasons[id] = hadStyle ? "detached_and_apply_failed" : "apply_failed"; }
      } catch (_) { notFoundIds.push(id); }
    }
    if (modified.length === 0) {
      const payload = { code: "set_effects_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes, failed_node_ids, node_types, failure_reasons, capability_summary } };
      logger.error("❌ set_effects failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = effects.length === 0 ? `Removed effects from ${modified.length} node(s)` : `Applied effects to ${modified.length} node(s)`;
    logger.info("✅ set_effects succeeded", { modified_node_ids: modified });
    const unresolved = Array.from(new Set([...notFoundIds, ...lockedNodes, ...unsupportedNodes, ...failed_node_ids]));
    return { success: true, modified_node_ids: modified, unresolved_node_ids: unresolved, summary, details: { not_found_node_ids: notFoundIds, locked_node_ids: lockedNodes, unsupported_node_ids: unsupportedNodes, failed_node_ids, node_types, failure_reasons, capability_summary } };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_effects" } };
    logger.error("❌ set_effects failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}


// ---------------------------------------------------
// -------- Sub-Category 3.3: Modify (Layout) --------
// ---------------------------------------------------


// -------- TOOL : set_auto_layout --------
async function set_auto_layout(params) {
  logger.info("📐 set_auto_layout called", params);
  try {
    const { node_ids } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_parameter", message: "Provide node_ids array", details: { received: params || {} } };
      logger.error("❌ set_auto_layout failed", payload);
      throw new Error(JSON.stringify(payload));
    }

    const {
      layout_mode,
      padding_left,
      padding_right,
      padding_top,
      padding_bottom,
      item_spacing,
      primary_axis_align_items,
      counter_axis_align_items,
      primary_axis_sizing_mode,
      counter_axis_sizing_mode,
    } = params || {};

    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];

    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (!("layoutMode" in node)) { unsupportedNodes.push(id); continue; }

        const before = {
          layoutMode: node.layoutMode,
          paddingLeft: node.paddingLeft,
          paddingRight: node.paddingRight,
          paddingTop: node.paddingTop,
          paddingBottom: node.paddingBottom,
          itemSpacing: node.itemSpacing,
          primaryAxisAlignItems: node.primaryAxisAlignItems,
          counterAxisAlignItems: node.counterAxisAlignItems,
          primaryAxisSizingMode: node.primaryAxisSizingMode,
          counterAxisSizingMode: node.counterAxisSizingMode,
        };

        try {
          if (typeof layout_mode === "string") node.layoutMode = layout_mode;
          if (typeof padding_left === "number") node.paddingLeft = padding_left;
          if (typeof padding_right === "number") node.paddingRight = padding_right;
          if (typeof padding_top === "number") node.paddingTop = padding_top;
          if (typeof padding_bottom === "number") node.paddingBottom = padding_bottom;
          if (typeof item_spacing === "number") node.itemSpacing = item_spacing;
          if (typeof primary_axis_align_items === "string") node.primaryAxisAlignItems = primary_axis_align_items;
          if (typeof counter_axis_align_items === "string") node.counterAxisAlignItems = counter_axis_align_items;
          if (typeof primary_axis_sizing_mode === "string") node.primaryAxisSizingMode = primary_axis_sizing_mode;
          if (typeof counter_axis_sizing_mode === "string") node.counterAxisSizingMode = counter_axis_sizing_mode;
          modified.push(id);
        } catch (e) {
          try {
            node.layoutMode = before.layoutMode;
            node.paddingLeft = before.paddingLeft;
            node.paddingRight = before.paddingRight;
            node.paddingTop = before.paddingTop;
            node.paddingBottom = before.paddingBottom;
            node.itemSpacing = before.itemSpacing;
            node.primaryAxisAlignItems = before.primaryAxisAlignItems;
            node.counterAxisAlignItems = before.counterAxisAlignItems;
            node.primaryAxisSizingMode = before.primaryAxisSizingMode;
            node.counterAxisSizingMode = before.counterAxisSizingMode;
          } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }

    if (modified.length === 0) {
      const payload = { code: "set_auto_layout_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_auto_layout failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Updated auto layout on ${modified.length} node(s)`;
    logger.info("✅ set_auto_layout succeeded", { modified_node_ids: modified });
    return { success: true, modified_node_ids: modified, summary };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_auto_layout" } };
    logger.error("❌ set_auto_layout failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_child_index --------
async function set_child_index(params) {
  const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
  logger.info("↕️ set_child_index called", params);
  try {
    const { node_id, new_index } = params || {};
    if (typeof node_id !== 'string' || node_id.length === 0) {
      const payload = { code: "missing_parameter", message: "'node_id' is required and must be a string", details: { node_id } };
      logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (typeof new_index !== 'number' || !Number.isInteger(new_index)) {
      const payload = { code: "invalid_parameter", message: "'new_index' must be an integer", details: { new_index } };
      logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(node_id);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node not found: ${node_id}`, details: { node_id } };
      logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const parent = node.parent;
    if (!parent || !("insertChild" in parent) || !Array.isArray(parent.children)) {
      const payload = { code: "invalid_parent_container", message: "Parent is not a container with children", details: { node_id, parent_type: parent ? parent.type : null } };
      logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const currentIndex = parent.children.indexOf(node);
    if (currentIndex === -1) {
      const payload = { code: "not_a_child", message: "Node is not a child of its reported parent", details: { node_id } };
      logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Clamp new index to valid bounds
    const maxIndex = Math.max(0, parent.children.length - 1);
    const clampedIndex = Math.min(Math.max(0, new_index), maxIndex);

    // No-op if index is same
    if (clampedIndex === currentIndex) {
      const summaryNoop = `Child already at index ${clampedIndex}`;
      logger.info("✅ set_child_index no-op", { node_id, index: clampedIndex });
      return { success: true, modified_node_ids: [node_id], summary: summaryNoop };
    }

    try {
      parent.insertChild(clampedIndex, node);
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      const payload = { code: "set_child_index_failed", message: `Failed to set child index for ${node_id}`, details: { node_id, new_index: clampedIndex, originalError } };
      logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.details.originalError, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Moved child to index ${clampedIndex}`;
    logger.info("✅ set_child_index succeeded", { node_id, new_index: clampedIndex });
    return { success: true, modified_node_ids: [node_id], summary };
  } catch (error) {
    if (error && typeof error.message === 'string') {
      try { JSON.parse(error.message); throw error; } catch (_) {}
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_child_index" } };
    logger.error("❌ set_child_index failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_auto_layout_child --------
async function set_auto_layout_child(params) {
  logger.info("📐 set_auto_layout_child called", params);
  try {
    const { node_ids } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));

    const { layout_align, layout_grow, layout_positioning } = params || {};

    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];

    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        const supports = ("layoutAlign" in node) || ("layoutGrow" in node) || ("layoutPositioning" in node);
        if (!supports) { unsupportedNodes.push(id); continue; }
        const before = {
          layoutAlign: ("layoutAlign" in node) ? node.layoutAlign : undefined,
          layoutGrow: ("layoutGrow" in node) ? node.layoutGrow : undefined,
          layoutPositioning: ("layoutPositioning" in node) ? node.layoutPositioning : undefined,
        };
        try {
          if (typeof layout_align === "string" && ("layoutAlign" in node)) node.layoutAlign = layout_align;
          if ((layout_grow === 0 || layout_grow === 1) && ("layoutGrow" in node)) node.layoutGrow = layout_grow;
          if (typeof layout_positioning === "string" && ("layoutPositioning" in node)) node.layoutPositioning = layout_positioning;
          modified.push(id);
        } catch (e) {
          try {
            if ("layoutAlign" in node && before.layoutAlign !== undefined) node.layoutAlign = before.layoutAlign;
            if ("layoutGrow" in node && before.layoutGrow !== undefined) node.layoutGrow = before.layoutGrow;
            if ("layoutPositioning" in node && before.layoutPositioning !== undefined) node.layoutPositioning = before.layoutPositioning;
          } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }

    if (modified.length === 0) {
      const payload = { code: "set_auto_layout_child_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_auto_layout_child failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Updated auto layout child props on ${modified.length} node(s)`;
    logger.info("✅ set_auto_layout_child succeeded", { modified_node_ids: modified });
    return { success: true, modified_node_ids: modified, summary };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_auto_layout_child" } };
    logger.error("❌ set_auto_layout_child failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_constraints --------
async function set_constraints(params) {
  logger.info("📐 set_constraints called", params);
  try {
    const { node_ids, horizontal, vertical } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    if (typeof horizontal !== "string" || typeof vertical !== "string") throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide horizontal and vertical", details: {} }));

    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const unsupportedNodes = [];

    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (!("constraints" in node)) { unsupportedNodes.push(id); continue; }
        const before = node.constraints;
        try {
          node.constraints = { horizontal, vertical };
          modified.push(id);
        } catch (e) {
          try { node.constraints = before; } catch (_) {}
        }
      } catch (_) { notFoundIds.push(id); }
    }

    if (modified.length === 0) {
      const payload = { code: "set_constraints_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, unsupportedNodes } };
      logger.error("❌ set_constraints failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Updated constraints on ${modified.length} node(s)`;
    logger.info("✅ set_constraints succeeded", { modified_node_ids: modified });
    return { success: true, modified_node_ids: modified, summary };
  } catch (error) {
    try { const maybe = JSON.parse(error && error.message ? error.message : "{}"); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_constraints" } };
    logger.error("❌ set_constraints failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}



// -------------------------------------------------
// -------- Sub-Category 3.4: Modify (Text) --------
// -------------------------------------------------


// -------- TOOL : set_text_characters --------
async function setTextCharacters(params) {
  const { node_id, new_characters } = params || {};
  try {
    if (!node_id || typeof node_id !== "string") throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_id", details: {} }));
    if (typeof new_characters !== "string") throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide new_characters string", details: {} }));

    const node = await figma.getNodeByIdAsync(node_id);
    if (!node) throw new Error(JSON.stringify({ code: "node_not_found", message: `Node not found: ${node_id}`, details: { node_id } }));
    if (node.type !== 'TEXT') throw new Error(JSON.stringify({ code: "invalid_node_type", message: "Node is not a TEXT node", details: { node_id, node_type: node.type } }));
    if (node.locked) throw new Error(JSON.stringify({ code: "node_locked", message: "Node is locked", details: { node_id } }));

    // Load a font before changing characters
    try {
      if (node.fontName !== figma.mixed) {
        await figma.loadFontAsync(node.fontName);
      } else {
        // Use first character font as baseline when mixed
        if (node.characters && node.characters.length > 0) {
          const first = node.getRangeFontName(0, 1);
          await figma.loadFontAsync(first);
          node.fontName = first;
        }
      }
    } catch (_) {}

    node.characters = new_characters;
    logger.info("✅ set_text_characters succeeded", { node_id });
    return { success: true, modified_node_ids: [node_id], summary: `Updated text on '${node.name}'` };
  } catch (error) {
    try { const parsed = JSON.parse(error && error.message ? error.message : "{}"); if (parsed && parsed.code) throw error; } catch (_) {}
    const payload = { code: "set_text_characters_failed", message: (error && error.message) || String(error), details: { node_id } };
    logger.error("❌ set_text_characters failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : set_text_style --------
async function setTextStyle(params) {
  const { node_ids, font_size, font_name, text_align_horizontal, text_auto_resize, line_height_percent, letter_spacing_percent, text_case, text_decoration } = params || {};
  logger.info("🅰️ set_text_style called", params);
  try {
    if (!Array.isArray(node_ids) || node_ids.length === 0) throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide node_ids array", details: {} }));
    const modified = [];
    const notFoundIds = [];
    const lockedNodes = [];
    const nonTextNodes = [];

    const needFontLoad = !!(font_name);
    const requestedFont = font_name ? { family: font_name.family, style: font_name.style } : null;
    if (requestedFont) {
      try { await figma.loadFontAsync(requestedFont); } catch (e) { throw new Error(JSON.stringify({ code: "font_load_failed", message: "Failed to load requested font", details: { font_name } })); }
    }

    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { notFoundIds.push(id); continue; }
        if (node.locked) { lockedNodes.push(id); continue; }
        if (node.type !== 'TEXT') { nonTextNodes.push(id); continue; }

        // Ensure some font is loaded before setting style properties which may require it
        try {
          if (node.fontName !== figma.mixed) {
            await figma.loadFontAsync(node.fontName);
          } else if (requestedFont) {
            await figma.loadFontAsync(requestedFont);
            node.fontName = requestedFont;
          }
        } catch (_) {}

        if (requestedFont) {
          node.fontName = requestedFont;
        }
        if (typeof font_size === 'number') node.fontSize = font_size;
        if (typeof line_height_percent === 'number') node.lineHeight = { unit: 'PERCENT', value: line_height_percent };
        if (typeof letter_spacing_percent === 'number') node.letterSpacing = { unit: 'PERCENT', value: letter_spacing_percent };
        if (typeof text_align_horizontal === 'string') node.textAlignHorizontal = text_align_horizontal;
        if (typeof text_auto_resize === 'string') node.textAutoResize = text_auto_resize;
        if (typeof text_case === 'string') node.textCase = text_case;
        if (typeof text_decoration === 'string') node.textDecoration = text_decoration;

        modified.push(id);
      } catch (e) {
        notFoundIds.push(id);
      }
    }

    if (modified.length === 0) {
      const payload = { code: "set_text_style_failed", message: "No nodes were updated", details: { notFoundIds, lockedNodes, nonTextNodes } };
      logger.error("❌ set_text_style failed", payload);
      throw new Error(JSON.stringify(payload));
    }
    const summary = `Updated text style on ${modified.length} node(s)`;
    logger.info("✅ set_text_style succeeded", { modified_node_ids: modified });
    return { success: true, modified_node_ids: modified, summary };
  } catch (error) {
    try { const parsed = JSON.parse(error && error.message ? error.message : "{}"); if (parsed && parsed.code) throw error; } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "set_text_style" } };
    logger.error("❌ set_text_style failed", payload);
    throw new Error(JSON.stringify(payload));
  }
}


// ---------------------------------------------------------
// -------- Sub-Category 3.5: Hierarchy & Structure --------
// ---------------------------------------------------------


// -------- TOOL : clone_nodes --------
async function clone_nodes(params) {
  const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
  try {
    const { node_ids } = params || {};

    if (!Array.isArray(node_ids)) {
      const payload = { code: "invalid_parameter", message: "'node_ids' must be an array of strings", details: { node_ids } };
      logger.error("❌ clone_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const uniqueIds = Array.from(new Set(node_ids)).filter((id) => typeof id === "string" && id.length > 0);
    if (uniqueIds.length === 0) {
      const payload = { code: "missing_required_parameter", message: "Parameter 'node_ids' must include at least one ID.", details: { missing: ["node_ids"] } };
      logger.error("❌ clone_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const created_node_ids = [];
    const unresolved_node_ids = [];

    for (const nodeId of uniqueIds) {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node) { unresolved_node_ids.push(nodeId); continue; }
        if (!("clone" in node) || typeof node.clone !== "function") {
          const payload = { code: "node_not_supported", message: "Node does not support clone()", details: { nodeId, type: node.type } };
          logger.error("❌ clone_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
        let clone;
        try { clone = node.clone(); } catch (e) {
          const originalError = (e && e.message) || String(e);
          const payload = { code: "clone_failed", message: `Failed to clone node ${nodeId}`, details: { nodeId, originalError } };
          logger.error("❌ clone_nodes failed", { code: payload.code, originalError: payload.details.originalError, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
        // Place clone next to original when possible
        try {
          const parent = node.parent;
          if (parent && "insertChild" in parent && Array.isArray(parent.children)) {
            const index = parent.children.indexOf(node);
            const targetIndex = index >= 0 ? index + 1 : parent.children.length;
            parent.insertChild(targetIndex, clone);
          } else if (parent && "appendChild" in parent) {
            parent.appendChild(clone);
          } else {
            figma.currentPage.appendChild(clone);
          }
        } catch (_) {
          // best-effort placement
        }
        created_node_ids.push(clone.id);
      } catch (_) {
        if (!unresolved_node_ids.includes(nodeId)) unresolved_node_ids.push(nodeId);
      }
    }

    if (created_node_ids.length === 0) {
      const payload = { code: "no_nodes_cloned", message: "No nodes were cloned.", details: { node_ids: uniqueIds, unresolved_node_ids } };
      logger.error("❌ clone_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Cloned ${created_node_ids.length} node(s).`;
    logger.info("✅ clone_nodes succeeded", { created: created_node_ids.length, unresolved: unresolved_node_ids.length });
    return { success: true, created_node_ids, summary, unresolved_node_ids };
  } catch (error) {
    if (error && typeof error.message === "string") {
      try { JSON.parse(error.message); throw error; } catch (_) {}
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "clone_nodes" } };
    logger.error("❌ clone_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}


// -------- TOOL : reparent_nodes --------
async function reparent_nodes(params) {
  const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
  try {
    const { node_ids_to_move, new_parent_id } = params || {};
    if (!Array.isArray(node_ids_to_move) || node_ids_to_move.length === 0) {
      const payload = { code: "missing_required_parameter", message: "'node_ids_to_move' must be a non-empty array", details: { node_ids_to_move } };
      logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (typeof new_parent_id !== 'string' || new_parent_id.length === 0) {
      const payload = { code: "missing_required_parameter", message: "'new_parent_id' is required and must be a string", details: { new_parent_id } };
      logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const newParent = await figma.getNodeByIdAsync(new_parent_id);
    if (!newParent) {
      const payload = { code: "parent_not_found", message: "New parent node not found", details: { new_parent_id } };
      logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!("appendChild" in newParent)) {
      const payload = { code: "invalid_parent_container", message: "New parent is not a container", details: { new_parent_id, type: newParent.type } };
      logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const moved_node_ids = [];
    const unresolved_node_ids = [];
    for (const id of node_ids_to_move) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { unresolved_node_ids.push(id); continue; }
        try {
          // Best-effort remove/append
          if ("remove" in node && typeof newParent.appendChild === 'function') {
            newParent.appendChild(node);
          } else if ("parent" in node && node.parent) {
            // try simple move
            newParent.appendChild(node);
          }
          moved_node_ids.push(id);
        } catch (e) {
          const originalError = (e && e.message) || String(e);
          const payload = { code: "reparent_failed", message: `Failed to reparent node ${id}`, details: { nodeId: id, originalError } };
          logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.details.originalError, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
      } catch (_) {
        if (!unresolved_node_ids.includes(id)) unresolved_node_ids.push(id);
      }
    }

    if (moved_node_ids.length === 0) {
      const payload = { code: "no_nodes_moved", message: "No nodes were reparented.", details: { node_ids_to_move, unresolved_node_ids } };
      logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Reparented ${moved_node_ids.length} node(s) to ${new_parent_id}.`;
    logger.info("✅ reparent_nodes succeeded", { moved: moved_node_ids.length, unresolved: unresolved_node_ids.length });
    return { success: true, moved_node_ids, summary, unresolved_node_ids };
  } catch (error) {
    if (error && typeof error.message === "string") {
      try { JSON.parse(error.message); throw error; } catch (_) {}
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "reparent_nodes" } };
    logger.error("❌ reparent_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : reorder_nodes --------
async function reorder_nodes(params) {
  const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
  try {
    const { node_ids, mode } = params || {};
    const allowed = new Set(["BRING_FORWARD", "SEND_BACKWARD", "BRING_TO_FRONT", "SEND_TO_BACK"]);
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_required_parameter", message: "'node_ids' must be a non-empty array", details: { node_ids } };
      logger.error("❌ reorder_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (typeof mode !== "string" || !allowed.has(mode)) {
      const payload = { code: "invalid_parameter", message: "'mode' must be one of BRING_FORWARD|SEND_BACKWARD|BRING_TO_FRONT|SEND_TO_BACK", details: { mode } };
      logger.error("❌ reorder_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const modified_node_ids = [];
    const unresolved_node_ids = [];

    for (const id of node_ids) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) { unresolved_node_ids.push(id); continue; }
        try {
          switch (mode) {
            case "BRING_FORWARD":
              if ("bringForward" in node) node.bringForward();
              break;
            case "SEND_BACKWARD":
              if ("sendBackward" in node) node.sendBackward();
              break;
            case "BRING_TO_FRONT":
              if ("bringToFront" in node) node.bringToFront();
              break;
            case "SEND_TO_BACK":
              if ("sendToBack" in node) node.sendToBack();
              break;
          }
          modified_node_ids.push(id);
        } catch (e) {
          const originalError = (e && e.message) || String(e);
          const payload = { code: "reorder_failed", message: `Failed to reorder node ${id}`, details: { nodeId: id, mode, originalError } };
          logger.error("❌ reorder_nodes failed", { code: payload.code, originalError: payload.details.originalError, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
      } catch (_) {
        if (!unresolved_node_ids.includes(id)) unresolved_node_ids.push(id);
      }
    }

    if (modified_node_ids.length === 0) {
      const payload = { code: "no_nodes_modified", message: "No nodes were reordered.", details: { node_ids, unresolved_node_ids } };
      logger.error("❌ reorder_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Reordered ${modified_node_ids.length} node(s) with mode ${mode}.`;
    logger.info("✅ reorder_nodes succeeded", { modified: modified_node_ids.length, mode, unresolved: unresolved_node_ids.length });
    return { success: true, modified_node_ids, summary, unresolved_node_ids };
  } catch (error) {
    if (error && typeof error.message === "string") {
      try { JSON.parse(error.message); throw error; } catch (_) {}
    }
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: { command: "reorder_nodes" } };
    logger.error("❌ reorder_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}




// ----------------------------------------------------
// -------- Sub-Category Sub-Category 3.7: Components & Styles --------
// ----------------------------------------------------


// -------- TOOL : create_component_from_node --------
async function createComponentFromNode(params) {
  try {
    const { node_id, name } = params || {};
    if (!node_id || typeof node_id !== "string") {
      const payload = { code: "missing_parameter", message: "'node_id' is required and must be a string", details: { node_id } };
      logger.error("❌ create_component_from_node failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const node = await figma.getNodeByIdAsync(node_id);
  if (!node) {
      const payload = { code: "node_not_found", message: `Node not found: ${node_id}` , details: { node_id } };
      logger.error("❌ create_component_from_node failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Use Figma API to create a component directly from the node (per docs)
    let component;
    try {
      component = figma.createComponentFromNode(node);
      if (typeof name === "string" && name.trim().length > 0) {
        component.name = name;
      }
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      const payload = { code: "creation_failed", message: `Failed to create component from node: ${originalError}`, details: { node_id } };
      logger.error("❌ create_component_from_node failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const result = { success: true, summary: `Created component '${component.name}' from node ${node_id}` , created_component_id: component.id, modified_node_ids: [component.id] };
    logger.info("✅ create_component_from_node succeeded", { componentId: component.id, name: component.name });
    return result;
  } catch (error) {
    try {
      const maybe = JSON.parse((error && error.message) || String(error));
      if (maybe && maybe.code) {
        logger.error("❌ create_component_from_node failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ create_component_from_node failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : create_component_instance --------
async function createComponentInstance(params) {
  const { component_key, component_id, x = 0, y = 0, parent_id } = params || {};

  // Validate required parameter
  if ((!component_key || typeof component_key !== "string") && (!component_id || typeof component_id !== "string")) {
    logger.error("❌ create_component_instance failed", { code: "missing_parameter", originalError: "Provide component_key or component_id", details: { component_key, component_id } });
    throw new Error(JSON.stringify({ code: "missing_parameter", message: "Provide 'component_key' or 'component_id'", details: { component_key, component_id } }));
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
  if (parent_id !== undefined && typeof parent_id !== "string") {
    logger.error("❌ create_component_instance failed", { code: "invalid_parameter", originalError: "parent_id must be a string", details: { parent_id } });
    throw new Error(JSON.stringify({ code: "invalid_parameter", message: "'parent_id' must be a string", details: { parent_id } }));
  }

  try {
    logger.info("🧩 Creating component instance", { component_key, component_id, x, y, parent_id });

    // Resolve component by key or id
    let component;
    try {
      if (component_key) {
        component = await figma.importComponentByKeyAsync(component_key);
      } else {
        const byId = await figma.getNodeByIdAsync(component_id);
        if (!byId || (byId.type !== "COMPONENT" && byId.type !== "COMPONENT_SET")) {
          logger.error("❌ create_component_instance failed", { code: "component_not_found", originalError: "Component node not found by id", details: { component_id } });
          throw new Error(JSON.stringify({ code: "component_not_found", message: `Component not found: ${component_id}`, details: { component_id } }));
        }
        component = byId;
      }
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      const isPermission = /permission|access/i.test(originalError);
      const isMissing = /no published component|not found|404/i.test(originalError);
      const code = isMissing ? "component_not_found" : (isPermission ? "permission_denied" : "component_import_failed");
      logger.error("❌ create_component_instance failed", { code, originalError, details: { component_key, component_id } });
      throw new Error(JSON.stringify({ code, message: `Failed to resolve component: ${originalError}`, details: { component_key, component_id } }));
    }

    // Create instance
    let instance;
    try {
      instance = component.createInstance();
    } catch (e) {
      const originalError = (e && e.message) || String(e);
      logger.error("❌ create_component_instance failed", { code: "instance_creation_failed", originalError, details: { component_key, component_id } });
      throw new Error(JSON.stringify({ code: "instance_creation_failed", message: `Failed to create instance: ${originalError}`, details: { component_key, component_id } }));
    }

    // Initial positioning (may be ignored in auto-layout parents)
    try {
      instance.x = x;
      instance.y = y;
    } catch (_) {}

    // Parent placement
    if (parent_id) {
      const parentNode = await figma.getNodeByIdAsync(parent_id);
      if (!parentNode) {
        logger.error("❌ create_component_instance failed", { code: "parent_not_found", originalError: "Parent node not found", details: { parent_id } });
        throw new Error(JSON.stringify({ code: "parent_not_found", message: `Parent node not found with ID: ${parent_id}` , details: { parent_id } }));
      }
      if (!("appendChild" in parentNode)) {
        logger.error("❌ create_component_instance failed", { code: "invalid_parent", originalError: "Parent cannot accept children", details: { parent_id, parentType: parentNode.type } });
        throw new Error(JSON.stringify({ code: "invalid_parent", message: `Parent node does not support children`, details: { parent_id, parentType: parentNode.type } }));
      }
      try {
        parentNode.appendChild(instance);
      } catch (e) {
        const originalError = (e && e.message) || String(e);
        const isLocked = /lock/i.test(originalError);
        const code = isLocked ? "locked_parent" : "append_failed";
        logger.error("❌ create_component_instance failed", { code, originalError, details: { parent_id } });
        throw new Error(JSON.stringify({ code, message: `Failed to append instance to parent ${parent_id}: ${originalError}`, details: { parent_id } }));
      }
    } else {
      figma.currentPage.appendChild(instance);
    }

    const result = {
      success: true,
      summary: `Placed instance '${instance.name}' at (${"x" in instance ? instance.x : x}, ${"y" in instance ? instance.y : y})`,
      modified_node_ids: [instance.id],
      node: {
        id: instance.id,
        name: instance.name,
        x: "x" in instance ? instance.x : x,
        y: "y" in instance ? instance.y : y,
        width: "width" in instance ? instance.width : undefined,
        height: "height" in instance ? instance.height : undefined,
        component_id: instance.componentId,
        parent_id: instance.parent ? instance.parent.id : undefined,
      },
      created_node_id: instance.id,
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
    } catch (_) {}
    const originalError = (error && error.message) || String(error);
    logger.error("❌ create_component_instance failed", { code: "create_component_instance_failed", originalError, details: { component_key, component_id, x, y, parent_id } });
    throw new Error(JSON.stringify({ code: "create_component_instance_failed", message: `Error creating component instance: ${originalError}`, details: { component_key, component_id, x, y, parent_id } }));
  }
}

// -------- TOOL : set_instance_properties --------
async function setInstanceProperties(params) {
  try {
    const { node_ids, properties } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_parameter", message: "'node_ids' must be a non-empty array of strings", details: { node_ids } };
      logger.error("❌ set_instance_properties failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!properties || typeof properties !== "object") {
      const payload = { code: "missing_parameter", message: "'properties' must be provided as an object", details: {} };
      logger.error("❌ set_instance_properties failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const modified_node_ids = [];
    for (const id of node_ids) {
      try {
        const n = await figma.getNodeByIdAsync(id);
        if (!n || n.type !== "INSTANCE") continue;
        if (typeof n.setProperties === "function") {
          // Respect Figma API semantics; property keys should include '#id' where required
          n.setProperties(properties);
          modified_node_ids.push(id);
        }
      } catch (_) {}
    }

    if (modified_node_ids.length === 0) {
      const payload = { code: "no_instances_modified", message: "No instance nodes were modified", details: { node_ids } };
      logger.error("❌ set_instance_properties failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Updated properties on ${modified_node_ids.length} instance(s)`;
    logger.info("✅ set_instance_properties succeeded", { count: modified_node_ids.length });
    return { success: true, modified_node_ids, summary };
  } catch (error) {
    try {
      const maybe = JSON.parse((error && error.message) || String(error));
      if (maybe && maybe.code) {
        logger.error("❌ set_instance_properties failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ set_instance_properties failed", { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
}

// -------- TOOL : detach_instance --------
async function detachInstance(params) {
  try {
    const { node_ids } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: "missing_parameter", message: "'node_ids' must be a non-empty array of strings", details: { node_ids } };
      logger.error("❌ detach_instance failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const created_frame_ids = [];
    for (const id of node_ids) {
      try {
        const n = await figma.getNodeByIdAsync(id);
        if (!n || n.type !== "INSTANCE") continue;
        const frame = n.detachInstance();
        if (frame && frame.id) created_frame_ids.push(frame.id);
      } catch (_) {}
    }

    if (created_frame_ids.length === 0) {
      const payload = { code: "no_instances_detached", message: "No instances were detached", details: { node_ids } };
      logger.error("❌ detach_instance failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Detached ${created_frame_ids.length} instance(s)`;
    logger.info("✅ detach_instance succeeded", { count: created_frame_ids.length });
    return { success: true, created_frame_ids, summary };
  } catch (error) {
    try {
      const maybe = JSON.parse((error && error.message) || String(error));
      if (maybe && maybe.code) {
        logger.error("❌ detach_instance failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
    logger.error("❌ detach_instance failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : create_style --------
async function createStyle(params) {
  try {
    const { name, type, style_properties } = params || {};
    if (typeof name !== 'string' || name.trim().length === 0) {
      const payload = { code: 'missing_parameter', message: "'name' is required and must be a non-empty string", details: { name } };
      logger.error('❌ create_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const t = String(type || '').toUpperCase();
    if (!t || !['PAINT','TEXT','EFFECT','GRID'].includes(t)) {
      const payload = { code: 'invalid_parameter', message: "'type' must be one of PAINT|TEXT|EFFECT|GRID", details: { type } };
      logger.error('❌ create_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const sp = style_properties && typeof style_properties === 'object' ? style_properties : {};
    if (t === 'PAINT') {
      const paints = Array.isArray(sp.paints) ? sp.paints : null;
      if (!paints) {
        const payload = { code: 'invalid_parameter', message: "For PAINT, style_properties.paints must be an array", details: {} };
        logger.error('❌ create_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      const r = await createPaintStyle({ name, paints });
      return { success: true, summary: `Created paint style '${name}'`, created_style_id: r.created_style_id };
    }
    if (t === 'TEXT') {
      const style = typeof sp === 'object' ? sp : {};
      const r = await createTextStyle({ name, style });
      return { success: true, summary: `Created text style '${name}'`, created_style_id: r.created_style_id };
    }
    if (t === 'EFFECT') {
      const effects = Array.isArray(sp.effects) ? sp.effects : null;
      if (!effects) {
        const payload = { code: 'invalid_parameter', message: "For EFFECT, style_properties.effects must be an array", details: {} };
        logger.error('❌ create_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
      const r = await createEffectStyle({ name, effects });
      return { success: true, summary: `Created effect style '${name}'`, created_style_id: r.created_style_id };
    }
    // GRID
    const layoutGrids = Array.isArray(sp.layoutGrids) ? sp.layoutGrids : null;
    if (!layoutGrids) {
      const payload = { code: 'invalid_parameter', message: "For GRID, style_properties.layoutGrids must be an array", details: {} };
      logger.error('❌ create_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const r = await createGridStyle({ name, layoutGrids });
    return { success: true, summary: `Created grid style '${name}'`, created_style_id: r.created_style_id };
  } catch (error) {
    try {
      const maybe = JSON.parse((error && error.message) || String(error));
      if (maybe && maybe.code) {
        logger.error('❌ create_style failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ create_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

// -------- TOOL : apply_style --------
async function applyStyle(params) {
  try {
    const { node_ids, style_id, style_type } = params || {};
    if (!Array.isArray(node_ids) || node_ids.length === 0) {
      const payload = { code: 'missing_parameter', message: "'node_ids' must be a non-empty array of strings", details: { node_ids } };
      logger.error('❌ apply_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!style_id || typeof style_id !== 'string') {
      const payload = { code: 'missing_parameter', message: "'style_id' is required and must be a string", details: { style_id } };
      logger.error('❌ apply_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const t = String(style_type || '').toUpperCase();
    if (!['FILL','STROKE','TEXT','EFFECT','GRID'].includes(t)) {
      const payload = { code: 'invalid_parameter', message: "'style_type' must be one of FILL|STROKE|TEXT|EFFECT|GRID", details: { style_type } };
      logger.error('❌ apply_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const modified_node_ids = [];
    for (const id of node_ids) {
      try {
        const n = await figma.getNodeByIdAsync(id);
        if (!n) continue;

        // Prefer async setter methods when available (required for documentAccess: dynamic-page)
        try {
          if (t === 'FILL' && typeof n.setFillStyleIdAsync === 'function') { await n.setFillStyleIdAsync(style_id); modified_node_ids.push(id); continue; }
          if (t === 'STROKE' && typeof n.setStrokeStyleIdAsync === 'function') { await n.setStrokeStyleIdAsync(style_id); modified_node_ids.push(id); continue; }
          if (t === 'EFFECT' && typeof n.setEffectStyleIdAsync === 'function') { await n.setEffectStyleIdAsync(style_id); modified_node_ids.push(id); continue; }
          if (t === 'GRID' && typeof n.setGridStyleIdAsync === 'function') { await n.setGridStyleIdAsync(style_id); modified_node_ids.push(id); continue; }
          if (t === 'TEXT' && n.type === 'TEXT' && typeof n.setTextStyleIdAsync === 'function') { await n.setTextStyleIdAsync(style_id); modified_node_ids.push(id); continue; }
        } catch (_) {}

        // Fallback to direct property assignment for environments that support it
        try { if (t === 'FILL' && 'fillStyleId' in n) { n.fillStyleId = style_id; modified_node_ids.push(id); continue; } } catch (_) {}
        try { if (t === 'STROKE' && 'strokeStyleId' in n) { n.strokeStyleId = style_id; modified_node_ids.push(id); continue; } } catch (_) {}
        try { if (t === 'EFFECT' && 'effectStyleId' in n) { n.effectStyleId = style_id; modified_node_ids.push(id); continue; } } catch (_) {}
        try { if (t === 'GRID' && 'gridStyleId' in n) { n.gridStyleId = style_id; modified_node_ids.push(id); continue; } } catch (_) {}
        try { if (t === 'TEXT' && n.type === 'TEXT' && 'textStyleId' in n) { n.textStyleId = style_id; modified_node_ids.push(id); continue; } } catch (_) {}

      } catch (_) {}
    }

    if (modified_node_ids.length === 0) {
      const payload = { code: 'no_nodes_modified', message: 'No nodes were updated with the given style', details: { node_ids, style_id, style_type: t } };
      logger.error('❌ apply_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Applied ${t} style to ${modified_node_ids.length} node(s)`;
    logger.info('✅ apply_style succeeded', { count: modified_node_ids.length, style_type: t });
    return { success: true, modified_node_ids, summary };
  } catch (error) {
    try {
      const maybe = JSON.parse((error && error.message) || String(error));
      if (maybe && maybe.code) {
        logger.error('❌ apply_style failed', { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
        throw new Error(JSON.stringify(maybe));
      }
    } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || String(error), details: {} };
    logger.error('❌ apply_style failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}


// ----------------------------------------------------
// -------- Sub-Category 3.8: Variables --------
// ----------------------------------------------------


async function createVariableCollection(params) {
  try {
    const name = params && typeof params.name === 'string' ? params.name : null;
    const initialModeName = params && typeof params.initial_mode_name === 'string' ? params.initial_mode_name : null;

    if (!name || name.trim().length === 0) {
      const payload = { code: 'missing_parameter', message: "'name' is required and must be a non-empty string", details: { name } };
      logger.error('❌ create_variable_collection failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    if (!(figma && figma.variables && typeof figma.variables.createVariableCollection === 'function')) {
      const payload = { code: 'variables_api_unavailable', message: 'Variables API not available in this environment', details: { editorType: figma && figma.editorType } };
      logger.error('❌ create_variable_collection failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const collection = figma.variables.createVariableCollection(name);
    try {
      if (initialModeName && Array.isArray(collection.modes) && collection.modes.length > 0) {
        // Prefer official API if available
        if (typeof collection.renameMode === 'function') {
          try { collection.renameMode(collection.modes[0].modeId || collection.modes[0].id, initialModeName); } catch (_) {}
        } else if (collection.modes[0] && typeof collection.modes[0] === 'object') {
          try { collection.modes[0].name = initialModeName; } catch (_) {}
        }
      }
    } catch (_) { /* best-effort rename of initial mode */ }

    const initialModeId = (collection && Array.isArray(collection.modes) && collection.modes[0]) ? (collection.modes[0].modeId || collection.modes[0].id) : null;
    logger.info('✅ create_variable_collection succeeded', { collectionId: collection.id, name });
    return { success: true, summary: `Created variable collection '${name}'`, collection_id: collection.id, initial_mode_id: initialModeId };
  } catch (error) {
    try { const maybe = JSON.parse((error && error.message) || String(error)); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || 'Failed to create variable collection', details: {} };
    logger.error('❌ create_variable_collection failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

async function createVariable(params) {
  try {
    const name = params && typeof params.name === 'string' ? params.name : null;
    const collectionId = params && typeof params.collection_id === 'string' ? params.collection_id : null;
    const resolvedType = params && typeof params.resolved_type === 'string' ? params.resolved_type : null;

    if (!name || !collectionId || !resolvedType) {
      const payload = { code: 'missing_parameter', message: "'name', 'collection_id', and 'resolved_type' are required", details: { name, collection_id: collectionId, resolved_type: resolvedType } };
      logger.error('❌ create_variable failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const validTypes = new Set(['COLOR','FLOAT','STRING','BOOLEAN']);
    if (!validTypes.has(resolvedType)) {
      const payload = { code: 'invalid_parameter', message: "'resolved_type' must be one of COLOR|FLOAT|STRING|BOOLEAN", details: { resolved_type: resolvedType } };
      logger.error('❌ create_variable failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!(figma && figma.variables)) {
      const payload = { code: 'variables_api_unavailable', message: 'Variables API not available in this environment', details: { editorType: figma && figma.editorType } };
      logger.error('❌ create_variable failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (!collection) {
      const payload = { code: 'collection_not_found', message: `Variable collection not found: ${collectionId}` , details: { collection_id: collectionId } };
      logger.error('❌ create_variable failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    let variable = null;
    let creationError = null;
    try {
      variable = figma.variables.createVariable(name, collection, resolvedType);
    } catch (e1) {
      creationError = e1;
      try {
        variable = figma.variables.createVariable(name, collection.id || collectionId, resolvedType);
      } catch (e2) {
        const originalError = (e2 && e2.message) || (creationError && creationError.message) || String(e2 || creationError);
        const payload = { code: 'create_variable_failed', message: originalError, details: { name, collection_id: collectionId, resolved_type: resolvedType } };
        logger.error('❌ create_variable failed', { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    }

    logger.info('✅ create_variable succeeded', { variableId: variable.id, name, resolvedType });
    return { success: true, summary: `Created variable '${name}' in collection ${collectionId}` , variable_id: variable.id };
  } catch (error) {
    try { const maybe = JSON.parse((error && error.message) || String(error)); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || 'Failed to create variable', details: {} };
    logger.error('❌ create_variable failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

async function setVariableValue(params) {
  try {
    const variableId = params && typeof params.variable_id === 'string' ? params.variable_id : null;
    const modeId = params && typeof params.mode_id === 'string' ? params.mode_id : null;
    const value = params && 'value' in params ? params.value : undefined;

    if (!variableId || !modeId) {
      const payload = { code: 'missing_parameter', message: "'variable_id' and 'mode_id' are required", details: { variable_id: variableId, mode_id: modeId } };
      logger.error('❌ set_variable_value failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!(figma && figma.variables)) {
      const payload = { code: 'variables_api_unavailable', message: 'Variables API not available in this environment', details: { editorType: figma && figma.editorType } };
      logger.error('❌ set_variable_value failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      const payload = { code: 'variable_not_found', message: `Variable not found: ${variableId}`, details: { variable_id: variableId } };
      logger.error('❌ set_variable_value failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    try {
      variable.setValueForMode(modeId, value);
    } catch (e) {
      const payload = { code: 'set_value_failed', message: (e && e.message) || 'Failed to set variable value', details: { variable_id: variableId, mode_id: modeId } };
      logger.error('❌ set_variable_value failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    const summary = `Set variable '${variable.name}' value for mode ${modeId}`;
    logger.info('✅ set_variable_value succeeded', { variableId, modeId });
    return { success: true, modified_variable_id: variableId, summary };
  } catch (error) {
    try { const maybe = JSON.parse((error && error.message) || String(error)); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || 'Failed to set variable value', details: {} };
    logger.error('❌ set_variable_value failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}

async function bindVariableToProperty(params) {
  try {
    const nodeId = params && typeof params.node_id === 'string' ? params.node_id : null;
    const property = params && typeof params.property === 'string' ? params.property : null;
    const variableId = params && typeof params.variable_id === 'string' ? params.variable_id : null;

    if (!nodeId || !property || !variableId) {
      const payload = { code: 'missing_parameter', message: "'node_id', 'property', and 'variable_id' are required", details: { node_id: nodeId, property, variable_id: variableId } };
      logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: 'node_not_found', message: `Node not found: ${nodeId}`, details: { node_id: nodeId } };
      logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    if (!(figma && figma.variables)) {
      const payload = { code: 'variables_api_unavailable', message: 'Variables API not available in this environment', details: { editorType: figma && figma.editorType } };
      logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      const payload = { code: 'variable_not_found', message: `Variable not found: ${variableId}`, details: { variable_id: variableId } };
      logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Attempt generic API if available
    if ('setBoundVariable' in node && typeof node.setBoundVariable === 'function') {
      try {
        node.setBoundVariable(property, variable);
      } catch (e) {
        // Fallbacks for paint color bindings like fills[0].color
        const m = property.match(/^fills\[(\d+)\]\.color$/);
        const m2 = property.match(/^strokes\[(\d+)\]\.color$/);
        if (m || m2) {
          const index = parseInt((m ? m[1] : m2[1]), 10);
          const key = m ? 'fills' : 'strokes';
          if (Array.isArray(node[key])) {
            const paints = node[key].slice();
            if (index < 0 || index >= paints.length) {
              const payload = { code: 'index_out_of_range', message: `Index ${index} out of range for ${key}`, details: { length: paints.length } };
              logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
              throw new Error(JSON.stringify(payload));
            }
            const paint = Object.assign({}, paints[index]);
            const existingBV = (paint && typeof paint === 'object' && paint.boundVariables) ? paint.boundVariables : {};
            const newBV = Object.assign({}, existingBV, { color: variable });
            paint.boundVariables = newBV;
            paints[index] = paint;
            try { node[key] = paints; } catch (e2) {
              const payload = { code: 'bind_failed', message: (e2 && e2.message) || `Failed to bind variable to ${property}`, details: { property } };
              logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
              throw new Error(JSON.stringify(payload));
            }
          }
        } else {
          const payload = { code: 'bind_failed', message: (e && e.message) || `Failed to bind variable to ${property}`, details: { property } };
          logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
      }
    } else {
      // Directly manipulate paints for common cases when setBoundVariable is not available
      const m = property.match(/^fills\[(\d+)\]\.color$/);
      const m2 = property.match(/^strokes\[(\d+)\]\.color$/);
      if (m || m2) {
        const index = parseInt((m ? m[1] : m2[1]), 10);
        const key = m ? 'fills' : 'strokes';
        if (!Array.isArray(node[key])) {
          const payload = { code: 'invalid_property', message: `${key} is not an array on this node`, details: { nodeType: node.type } };
          logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
        const paints = node[key].slice();
        if (index < 0 || index >= paints.length) {
          const payload = { code: 'index_out_of_range', message: `Index ${index} out of range for ${key}`, details: { length: paints.length } };
          logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
        const paint = Object.assign({}, paints[index]);
        const existingBV = (paint && typeof paint === 'object' && paint.boundVariables) ? paint.boundVariables : {};
        const newBV = Object.assign({}, existingBV, { color: variable });
        paint.boundVariables = newBV;
        paints[index] = paint;
        try { node[key] = paints; } catch (e2) {
          const payload = { code: 'bind_failed', message: (e2 && e2.message) || `Failed to bind variable to ${property}`, details: { property } };
          logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
        }
      } else {
        const payload = { code: 'unsupported_property', message: `Unsupported property path for variable binding: ${property}`, details: { property } };
        logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    }

    logger.info('✅ bind_variable_to_property succeeded', { nodeId, property, variableId });
    return { success: true, modified_node_ids: [nodeId], summary: `Bound variable ${variableId} to ${property}` };
  } catch (error) {
    try { const maybe = JSON.parse((error && error.message) || String(error)); if (maybe && maybe.code) throw error; } catch (_) {}
    const payload = { code: 'unknown_plugin_error', message: (error && error.message) || 'Failed to bind variable to property', details: {} };
    logger.error('❌ bind_variable_to_property failed', { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
}


// ----------------------------------------------------
// -------- Sub-Category 3.9: Prototyping --------
// ----------------------------------------------------







// ============================================
// ======= Category 4: Meta & Utility =========
// ============================================

// -------- TOOL : scroll_and_zoom_into_view --------
async function scroll_and_zoom_into_view(params) {
  const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
  try {
      const { node_ids } = params || {};

      if (!Array.isArray(node_ids)) {
          const payload = { code: "invalid_node_ids", message: "Parameter 'node_ids' must be a non-empty string array.", details: { node_ids } };
          logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
      }

      const uniqueIds = Array.from(new Set(node_ids)).filter((id) => typeof id === "string" && id.length > 0);
      if (uniqueIds.length === 0) {
          const payload = { code: "missing_required_parameter", message: "Parameter 'node_ids' is required and must include at least one ID.", details: { missing: ["node_ids"] } };
          logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
      }

      const nodes = [];
      const resolved_node_ids = [];
      const unresolved_node_ids = [];
      for (const nodeId of uniqueIds) {
          try {
              const node = await figma.getNodeByIdAsync(nodeId);
              if (node) {
                  nodes.push(node);
                  resolved_node_ids.push(nodeId);
              } else {
                  unresolved_node_ids.push(nodeId);
              }
          } catch (_) {
              unresolved_node_ids.push(nodeId);
          }
      }

      if (nodes.length === 0) {
          const payload = { code: "nodes_not_found", message: "None of the provided nodes exist.", details: { node_ids: uniqueIds } };
          logger.error("❌ scroll_and_zoom_into_view failed", { code: payload.code, originalError: payload.message, details: payload.details });
          throw new Error(JSON.stringify(payload));
      }

      figma.viewport.scrollAndZoomIntoView(nodes);
      const result = {
          success: true,
          summary: `Brought ${nodes.length} node(s) into view.${unresolved_node_ids.length ? ` ${unresolved_node_ids.length} unresolved.` : ''}`,
          resolved_node_ids,
          unresolved_node_ids,
          zoom: figma.viewport.zoom,
          center: figma.viewport.center,
      };
      logger.info("✅ scroll_and_zoom_into_view succeeded", { resolved: resolved_node_ids.length, unresolved: unresolved_node_ids.length, zoom: result.zoom, center: result.center });
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

// -------- TOOL : delete_nodes --------
async function delete_nodes(params) {
const logger = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : console;
try {
  const { node_ids } = params || {};

  if (!Array.isArray(node_ids)) {
    const payload = { code: "invalid_node_ids", message: "Parameter 'node_ids' must be an array of strings.", details: { node_ids } };
    logger.error("❌ delete_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  const uniqueIds = Array.from(new Set(node_ids)).filter((id) => typeof id === "string" && id.length > 0);
  if (uniqueIds.length === 0) {
    const payload = { code: "missing_required_parameter", message: "Parameter 'node_ids' is required and must include at least one ID.", details: { missing: ["node_ids"] } };
    logger.error("❌ delete_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  const deleted_node_ids = [];
  const unresolved_node_ids = [];
  const locked_node_ids = [];
  const non_deletable_node_ids = [];

  for (const nodeId of uniqueIds) {
    try {
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) { unresolved_node_ids.push(nodeId); continue; }
      if (node.type === "DOCUMENT" || node.type === "PAGE") { non_deletable_node_ids.push(nodeId); continue; }
      if ("locked" in node && node.locked) { locked_node_ids.push(nodeId); continue; }
      try { node.remove(); deleted_node_ids.push(nodeId); } catch (e) {
        const originalError = (e && e.message) || String(e);
        const payload = { code: "delete_failed", message: `Failed to delete node ${nodeId}`, details: { nodeId, originalError } };
        logger.error("❌ delete_nodes failed", { code: payload.code, originalError: payload.details.originalError, details: payload.details });
        throw new Error(JSON.stringify(payload));
      }
    } catch (_) {
      if (!unresolved_node_ids.includes(nodeId)) unresolved_node_ids.push(nodeId);
    }
  }

  if (deleted_node_ids.length === 0) {
    const payload = { code: "no_nodes_deleted", message: "No nodes were deleted.", details: { node_ids: uniqueIds, unresolved_node_ids, locked_node_ids, non_deletable_node_ids } };
    logger.error("❌ delete_nodes failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }

  const parts = [];
  parts.push(`Deleted ${deleted_node_ids.length} node(s).`);
  if (locked_node_ids.length) parts.push(`${locked_node_ids.length} locked.`);
  if (unresolved_node_ids.length) parts.push(`${unresolved_node_ids.length} not found.`);
  if (non_deletable_node_ids.length) parts.push(`${non_deletable_node_ids.length} non-deletable.`);
  const summary = parts.join(' ');

  const result = { success: true, deleted_node_ids, summary, unresolved_node_ids, locked_node_ids, non_deletable_node_ids };
  logger.info("✅ delete_nodes succeeded", { deleted: deleted_node_ids.length, locked: locked_node_ids.length, unresolved: unresolved_node_ids.length, nonDeletable: non_deletable_node_ids.length });
  return result;
} catch (error) {
  if (error && typeof error.message === "string") {
    try { JSON.parse(error.message); throw error; } catch (_) {}
  }
  const payload = { code: "unknown_plugin_error", message: "Failed to delete nodes.", details: { originalError: String((error && error.message) || error) } };
  logger.error("❌ delete_nodes failed", { code: payload.code, originalError: payload.details.originalError });
  throw new Error(JSON.stringify(payload));
}
}

// -------- TOOL : show_notification --------
async function show_notification(params) {
try {
  const { message, is_error } = params || {};
  if (typeof message !== "string" || message.length === 0) {
    const payload = { code: "missing_parameter", message: "'message' must be a non-empty string", details: { message } };
    logger.error("❌ show_notification failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  try {
    if (typeof figma.notify === "function") {
      if (typeof is_error === "boolean") {
        figma.notify(message, { error: !!is_error });
      } else {
        figma.notify(message);
      }
    }
  } catch (e) {
    const originalError = (e && e.message) || String(e);
    const payload = { code: "figma_api_error", message: `Failed to show notification: ${originalError}`, details: {} };
    logger.error("❌ show_notification failed", { code: payload.code, originalError: payload.message, details: payload.details });
    throw new Error(JSON.stringify(payload));
  }
  logger.info("✅ show_notification succeeded", { message, is_error: !!is_error });
  return { success: true };
} catch (error) {
  try {
    const maybe = JSON.parse(error && error.message ? error.message : String(error));
    if (maybe && maybe.code) {
      logger.error("❌ show_notification failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
      throw new Error(JSON.stringify(maybe));
    }
  } catch (_) {}
  const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
  logger.error("❌ show_notification failed", { code: payload.code, originalError: payload.message, details: payload.details });
  throw new Error(JSON.stringify(payload));
}
}

// -------- TOOL : commit_undo_step --------
async function commit_undo_step() {
try {
  if (typeof figma.commitUndo === "function") {
    figma.commitUndo();
  }
  logger.info("✅ commit_undo_step succeeded");
  return { success: true };
} catch (error) {
  try {
    const maybe = JSON.parse(error && error.message ? error.message : String(error));
    if (maybe && maybe.code) {
      logger.error("❌ commit_undo_step failed", { code: maybe.code, originalError: (error && error.message) || String(error), details: maybe.details || {} });
      throw new Error(JSON.stringify(maybe));
    }
  } catch (_) {}
  const payload = { code: "unknown_plugin_error", message: (error && error.message) || String(error), details: {} };
  logger.error("❌ commit_undo_step failed", { code: payload.code, originalError: payload.message, details: payload.details });
  throw new Error(JSON.stringify(payload));
}
}





// -----------------------------------------------
// ---------------  HELPERS SECTION --------------
// ------------------------------------------------


// Helpers index (usage-oriented overview)
// - Canvas/Node summaries: _computeAbsoluteBoundingBox, _toBasicNodeSummary, _toRichNodeSummary
// - Node introspection: isInstanceNode, getTextNodeMeta, getComponentInfo, getAutoLayoutInfo, getStyleRefs
// - Node details export: rgbaToHex, filterFigmaNode, customBase64Encode, buildNodeDetailsInternal
// - Text helpers: setCharacters
// - Selection snapshot: selectionSummaryState, debounce, nodeHasVariants, collectNodeSummary, computeSelectionSignature, buildSelectionSummary, postDocumentInfo, handleSelectionChange
// - Elsewhere in file: style management commands (createEffectStyle, createGridStyle), and utility wrapper (withUndoGroup)



function _computeAbsoluteBoundingBox(node) {
  try {
    if ("absoluteRenderBounds" in node && node.absoluteRenderBounds) {
      const b = node.absoluteRenderBounds;
      return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    }
  } catch (_) {}
  try {
    const t = ("absoluteTransform" in node && Array.isArray(node.absoluteTransform)) ? node.absoluteTransform : [[1,0,0],[0,1,0]];
    const x = t[0][2];
    const y = t[1][2];
    const w = ("width" in node) ? node.width : 0;
    const h = ("height" in node) ? node.height : 0;
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
  } catch (_) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/**
 * Produce a minimal summary for any Figma node.
 * Includes id, name, type, and boolean flag for children presence.
 * Used for lightweight listings where geometry is not required.
 * @param {SceneNode} node
 * @returns {{id:string,name:string,type:string,has_children:boolean}}
 */
function _toBasicNodeSummary(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    has_children: Array.isArray(node.children) && node.children.length > 0,
  };
}

/**
 * Produce an enriched summary for a node including absolute bounding box
 * and auto layout mode where available.
 * @param {SceneNode} node
 * @returns {{id:string,name:string,type:string,absolute_bounding_box:{x:number,y:number,width:number,height:number},auto_layout_mode:("NONE"|"HORIZONTAL"|"VERTICAL"|null),has_children:boolean}}
 */
function _toRichNodeSummary(node) {
  const bbox = _computeAbsoluteBoundingBox(node);
  const autoLayoutMode = ("layoutMode" in node && node.layoutMode) ? node.layoutMode : null;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    absolute_bounding_box: bbox,
    auto_layout_mode: autoLayoutMode || null,
    has_children: Array.isArray(node.children) && node.children.length > 0,
  };
}

// ======================================================
// Section: Node Introspection Helpers (shared)
// ======================================================
/**
 * Returns true if the node is an INSTANCE.
 * @param {SceneNode} node
 * @returns {boolean}
 */
function isInstanceNode(node) {
  return node.type === "INSTANCE";
}

/**
 * Extract text content and typography metadata from a TEXT node.
 * Gracefully handles mixed/unavailable properties.
 * @param {TextNode} node
 * @returns {{textLength:number,text?:string,typography?:{fontFamily?:string,fontSize?:number,fontWeight?:string,lineHeightPx?:number,letterSpacing?:number}}|null}
 */
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

/**
 * Get component/instance metadata in a compact form.
 * @param {SceneNode} node
 * @returns {{role:string,isInstance:boolean,mainComponent?:{id:string,name:string}}}
 */
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

/**
 * Extract auto layout settings from FRAME/COMPONENT/COMPONENT_SET.
 * Returns undefined for nodes without auto layout.
 * @param {SceneNode} node
 * @returns {object|undefined}
 */
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

/**
 * Collect applied style references on a node (fill/stroke/effect/text style ids).
 * @param {SceneNode} node
 * @returns {{fillStyleId?:string,strokeStyleId?:string,effectStyleId?:string,textStyleId?:string}}
 */
function getStyleRefs(node) {
  const refs = {};
  if ("fillStyleId" in node) refs.fillStyleId = node.fillStyleId;
  if ("strokeStyleId" in node) refs.strokeStyleId = node.strokeStyleId;
  if ("effectStyleId" in node) refs.effectStyleId = node.effectStyleId;
  if (node.type === "TEXT" && "textStyleId" in node) refs.textStyleId = node.textStyleId;
  return refs;
}


// ======================================================
// Section: Node Details Builder
// ======================================================
// Node Details: color helper for JSON export
/**
 * Convert an RGBA color object to a hex string. When alpha is 1, returns #RRGGBB,
 * otherwise returns #RRGGBBAA.
 * @param {{r:number,g:number,b:number,a?:number}} color
 * @returns {string}
 */
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

// Internal: sanitize exported node JSON for node-details
/**
 * Sanitize a node payload produced by exportAsync({ format: "JSON_REST_V1" }) by
 * converting RGBA colors to hex and removing non-serializable/bound properties.
 * VECTOR nodes are skipped (null) to reduce payload size.
 * @param {any} node
 * @returns {any}
 */
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
        processedFill.gradient_stops = processedFill.gradientStops.map((stop) => {
          var processedStop = Object.assign({}, stop);
          if (processedStop.color) {
            processedStop.color = rgbaToHex(processedStop.color);
          }
          delete processedStop.boundVariables;
          return processedStop;
        });
        delete processedFill.gradientStops;
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      // Normalize fill keys to snake_case where reasonable
      if (processedFill.gradient_stops) {
        processedFill.gradient_stops = processedFill.gradient_stops;
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
    filtered.corner_radius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absolute_bounding_box = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      font_family: node.style.fontFamily,
      font_style: node.style.fontStyle,
      font_weight: node.style.fontWeight,
      font_size: node.style.fontSize,
      text_align_horizontal: node.style.textAlignHorizontal,
      letter_spacing: node.style.letterSpacing,
      line_height_px: node.style.lineHeightPx,
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
// Node Details: base64 helper for PNG export
/**
 * Efficiently encode a Uint8Array to base64. Avoids atob/btoa limitations in plugin runtime.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function customBase64Encode(bytes) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  for (let i = 0; i < mainLength; i = i + 3) {
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    a = (chunk & 16515072) >> 18;
    b = (chunk & 258048) >> 12;
    c = (chunk & 4032) >> 6;
    d = chunk & 63;
    base64 += chars[a] + chars[b] + chars[c] + chars[d];
  }

  if (byteRemainder === 1) {
    chunk = bytes[mainLength];
    a = (chunk & 252) >> 2;
    b = (chunk & 3) << 4;
    base64 += chars[a] + chars[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
    a = (chunk & 64512) >> 10;
    b = (chunk & 1008) >> 4;
    c = (chunk & 15) << 2;
    base64 += chars[a] + chars[b] + chars[c] + "=";
  }

  return base64;
}
async function buildNodeDetailsInternal(nodeId, highlight = false) {
  try {
    // Validate params
    if (!nodeId || typeof nodeId !== "string") {
      const payload = { code: "missing_parameter", message: "Parameter 'nodeId' is required and must be a string", details: { nodeId } };
      logger.error("❌ get_node_details failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Best-effort page preload (non-fatal if unavailable)
    try {
      if (typeof figma.loadAllPagesAsync === "function") {
        await figma.loadAllPagesAsync();
      }
      if (figma.currentPage && typeof figma.currentPage.loadAsync === "function") {
        await figma.currentPage.loadAsync();
      }
    } catch (e) {
      try {
        logger.error("⚠️ get_node_details page preload failed (continuing)", { code: "page_preload_failed", originalError: (e && e.message) || String(e), details: {} });
      } catch (_) {}
      // continue without throwing
    }

    // Resolve node
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) {
      const payload = { code: "node_not_found", message: `Node not found: ${nodeId}`, details: { nodeId } };
      logger.error("❌ get_node_details failed", { code: payload.code, originalError: payload.message, details: payload.details });
      throw new Error(JSON.stringify(payload));
    }

    // Parent context
    let parentContext = null;
    try {
      const parent = node.parent || null;
      if (parent) {
        parentContext = {
          id: parent.id,
          name: parent.name,
          type: parent.type,
          autoLayout: getAutoLayoutInfo(parent) || undefined,
        };
      }
    } catch (_) { parentContext = null; }

    // Children context (direct only)
    let childrenContext = [];
    try {
      if ("children" in node && Array.isArray(node.children)) {
        const parentChildren = node.children;
        childrenContext = parentChildren.map((child, index) => ({ id: child.id, name: child.name, type: child.type, index }));
      }
    } catch (_) { childrenContext = []; }

    // Export and sanitize node JSON
    let target_node = { id: node.id, name: node.name, type: node.type };
    try {
      const response = await node.exportAsync({ format: "JSON_REST_V1" });
      const filtered = filterFigmaNode(response.document);
      if (filtered && typeof filtered === "object") {
        target_node = Object.assign({}, filtered);
      }
    } catch (exportErr) {
      // Keep going; we'll still provide live properties below
      logger.error("❌ get_node_details JSON export failed", { code: "export_failed", originalError: (exportErr && exportErr.message) || String(exportErr), details: { nodeId } });
    }

    // Enrich with live properties to approach the Unified Node Data Model (snake_case)
    try {
      // Identity & hierarchy
      const parent = node.parent || null;
      const indexInParent = parent && parent.children ? parent.children.indexOf(node) : -1;
      target_node.parent_id = parent ? parent.id : figma.currentPage.id;
      target_node.index = indexInParent;

      // Core state & geometry
      target_node.visible = node.visible !== false;
      target_node.locked = !!node.locked;
      target_node.is_mask = ("isMask" in node) ? node.isMask : false;
      target_node.opacity = ("opacity" in node) ? node.opacity : 1;
      target_node.width = node.width;
      target_node.height = node.height;
      target_node.rotation = ("rotation" in node) ? node.rotation : 0;

      // Layout
      if (("clipsContent" in node)) target_node.clips_content = node.clipsContent;
      target_node.auto_layout = getAutoLayoutInfo(node) || target_node.auto_layout;
      if (("layoutSizingHorizontal" in node)) target_node.layout_sizing_horizontal = node.layoutSizingHorizontal;
      if (("layoutSizingVertical" in node)) target_node.layout_sizing_vertical = node.layoutSizingVertical;

      // Styling
      if (Array.isArray(node.strokes) && !target_node.strokes) target_node.strokes = node.strokes;
      if (("strokeWeight" in node)) target_node.stroke_weight = node.strokeWeight;
      if (("strokeAlign" in node)) target_node.stroke_align = node.strokeAlign;
      if (Array.isArray(node.effects) && !target_node.effects) target_node.effects = node.effects;

      // Design system & prototyping
      const styleRefs = getStyleRefs(node);
      Object.assign(target_node, styleRefs);
      if (Array.isArray(node.reactions)) target_node.reactions = node.reactions;
      if (node.boundVariables) target_node.bound_variables = node.boundVariables;

      // Type-specific
      if (node.type === "TEXT") {
        const textMeta = getTextNodeMeta(node);
        if (textMeta) target_node.text_meta = textMeta;
      }
      const compInfo = getComponentInfo(node);
      if (compInfo) target_node.component_meta = compInfo;
    } catch (_) { /* best-effort enrichment */ }

    // Export PNG 2x image preview of the target node
    let exported_image = null;
    try {
      if (("exportAsync" in node)) {
        const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 }, useAbsoluteBounds: true });
        exported_image = customBase64Encode(bytes);
      }
    } catch (_) { exported_image = null; }

    // Optional brief highlight on the target (post-export to avoid affecting image)
    if (highlight) {
      try {
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 }, opacity: 0.3 }];
        await delay(100);
        try { node.fills = originalFills; }
        catch (err) { logger.error("get_node_details highlight reset failed", { code: "highlight_reset_failed", originalError: (err && err.message) || String(err) }); }
      } catch (highlightErr) {
        logger.error("get_node_details highlight failed", { code: "highlight_failed", originalError: (highlightErr && highlightErr.message) || String(highlightErr) });
      }
    }

    const payload = { target_node, exported_image, parent_context: parentContext, children_context: childrenContext };
    logger.info("✅ build_node_details_internal succeeded", { nodeId: node.id, hasParent: !!parentContext, children: (childrenContext && childrenContext.length) || 0, hasImage: !!exported_image });
    return payload;
  } catch (error) {
    // If already structured JSON, rethrow; else normalize
    try {
      const parsed = JSON.parse(error && error.message ? error.message : "{}");
      if (parsed && parsed.code) {
        logger.error("❌ get_node_details failed", { code: parsed.code, originalError: (error && error.message) || String(error), details: parsed.details || {} });
        throw new Error(JSON.stringify(parsed));
      }
    } catch (_) {
      // fall-through
    }
    logger.error("❌ build_node_details_internal failed", { code: "unknown_plugin_error", originalError: (error && error.message) || String(error), details: {} });
    throw new Error(JSON.stringify({ code: "unknown_plugin_error", message: (error && error.message) || "Unknown error in build_node_details_internal", details: {} }));
  }
}


 
// ======================================================
// Section: Text Helpers (Font loading and character utilities)
// ======================================================
// Text Helpers: general utilities used by text font matching
/**
 * Return unique items from an array based on a predicate or key.
 * @template T
 * @param {T[]} arr
 * @param {(item:T)=>any | keyof T} predicate
 * @returns {T[]}
 */
/**
 * Safely set text characters on a TEXT node, attempting to preserve fonts for simple cases.
 * Mixed-font runs are not strictly preserved; the first character's font is used when mixed.
 * @param {TextNode} node
 * @param {string} characters
 * @param {{fallbackFont?:{family:string,style:string}}} [options]
 * @returns {Promise<boolean>}
 */
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      const firstCharFont = node.getRangeFontName(0, 1);
      await figma.loadFontAsync(firstCharFont);
      node.fontName = firstCharFont;
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `⚠️ Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font; replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`⚠️ Failed to set characters. Skipped.`, err);
    return false;
  }
};






// ======================================================
// Section: Selection Snapshot Utilities 
// ======================================================
// Selection: state and debounce utility
const selectionSummaryState = {
  lastSelectionSignature: "",
  lastDocumentInfo: null,
};


/**
 * Simple debounce utility used by selection change handler.
 * @template {Function} F
 * @param {F} fn
 * @param {number} wait
 * @returns {F}
 */
function debounce(fn, wait) {
  let t = null;
  return function() {
    const args = Array.prototype.slice.call(arguments);
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}


// Selection: variant helper
/**
 * Check whether a node participates in a variant system (component set or instance).
 * @param {SceneNode} node
 * @returns {boolean}
 */
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

 

// Selection: summary builders
/**
 * Build a minimal node summary for selection snapshots.
 * Only includes identity fields to keep payloads light.
 * @param {SceneNode} node
 * @returns {{id:string,name:string,type:string}}
 */
function collectNodeSummary(node) {
  return { id: node.id, name: node.name, type: node.type };
}

/**
 * Compute a stable signature string for the current selection set to detect changes.
 * Based on node identity, geometry and type.
 * @param {SceneNode[]} nodes
 * @returns {string}
 */
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

/**
 * Build a selection summary suitable for UI consumption.
 * Includes counts, hints and per-node summaries.
 * @param {SceneNode[]} selectedNodes
 * @returns {{selectionCount:number,typesCount:Record<string,number>,hints:object,nodes:object[]}}
 */
function buildSelectionSummary(selectedNodes) {
  const nodes = selectedNodes.map(collectNodeSummary);
  const types_count = {};
  let has_instances = false;
  let has_variants = false;
  let has_auto_layout = false;
  let sticky_note_count = 0;
  let total_text_chars = 0;
  for (const n of selectedNodes) {
    types_count[n.type] = (types_count[n.type] || 0) + 1;
    if (n.type === "INSTANCE") has_instances = true;
    if (nodeHasVariants(n)) has_variants = true;
    if (("layoutMode" in n) && n.layoutMode && n.layoutMode !== "NONE") has_auto_layout = true;
    if (n.type === "STICKY") sticky_note_count += 1;
    if (n.type === "TEXT") total_text_chars += (n.characters ? n.characters.length : 0);
  }
  return {
    selection_count: selectedNodes.length,
    types_count,
    hints: { has_instances, has_variants, has_auto_layout, sticky_note_count, total_text_chars },
    nodes,
  };
}

// Selection: document info dispatch
function postDocumentInfo() {
  const pageId = figma.currentPage.id;
  const pageName = figma.currentPage.name;
  selectionSummaryState.lastDocumentInfo = { pageId, pageName };
  figma.ui.postMessage({ type: "document_info", pageId, pageName });
}

// Selection: selection change handler (debounced)
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
      selection_signature: selectionSignature,
      selection_summary: selectionSummary,
    });
    // Emoji log per user preference
    console.log(`🧩 Selection summary sent (${selectionSummary.selection_count} nodes)`);
  } catch (e) {
    console.warn("Failed to build selection summary", e);
  }
}, 200);

// Selection: event wiring
figma.on("run", () => {
  postDocumentInfo();
  // On run, post document info and request UI auto-connect.
  // Selection summaries will be sent on selection/current page changes.
  try { figma.ui.postMessage({ type: "auto-connect" }); } catch (_) {}
});

// Re-enable lightweight selection summary broadcasting so UI can invalidate cache
figma.on("selectionchange", handleSelectionChange);
figma.on("currentpagechange", () => {
  try { postDocumentInfo(); } catch (_) {}
  try { handleSelectionChange(); } catch (_) {}
});

// ======================================================
// Section: UI Message Handling
// ======================================================
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
    
    
      
    case "request_selections_context":
      try {
        
        const selection = figma.currentPage.selection || [];
        const include_images = !!(selection && selection.length > 0); // only export when there is selection
        const snapshot = await getCanvasSnapshot({ include_images });
        figma.ui.postMessage({ type: 'selections_context', result: snapshot });
      } catch (e) {
        try {
          const payload = JSON.parse(e && e.message ? e.message : String(e));
          if (payload && payload.code) {
            logger.error("❌ request_selections_context failed", { code: payload.code, originalError: payload.message, details: payload.details || {} });
            figma.ui.postMessage({ type: 'selections_context_error', error: JSON.stringify(payload) });
            break;
          }
        } catch (_) {}
        const err = { code: 'unknown_plugin_error', message: (e && e.message) || String(e), details: {} };
        logger.error("❌ request_selections_context failed", { code: err.code, originalError: err.message, details: err.details });
        figma.ui.postMessage({ type: 'selections_context_error', error: JSON.stringify(err) });
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
    
    default:
      // ignore unknown UI messages
      break;
  }
};

 


// ======================================================
// Section: Styles Management Commands
// ======================================================
async function createPaintStyle(params) {
    try {
        const { name, paints, onConflict } = params || {};

        if (figma.editorType !== 'figma') {
            const payload = { code: "unsupported_editor_type", message: "Style APIs are only available in Figma Design", details: { editorType: figma.editorType } };
            logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
            throw new Error(JSON.stringify(payload));
        }
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
        const existing = await figma.getLocalPaintStylesAsync();
        const exact = existing.find(s => String(s.name) === name);
        if (exact) {
            if (conflictMode === 'skip') {
            logger.info("✅ create_paint_style skipped (name exists)", { styleId: exact.id, name: exact.name });
            return { success: true, summary: `Skipped: paint style '${name}' already exists`, modified_node_ids: [], created_style_id: exact.id, name: exact.name, type: 'paint', skipped: true };
            }
            if (conflictMode === 'error') {
                const payload = { code: "conflict_style_name", message: `A paint style named '${name}' already exists`, details: { name, existingStyleId: exact.id } };
                logger.error("❌ create_paint_style failed", { code: payload.code, originalError: payload.message, details: payload.details });
                throw new Error(JSON.stringify(payload));
            }
        }

        const paintStyle = figma.createPaintStyle();
        if (exact && conflictMode === 'suffix') {
            let i = 2; let candidate = `${name} (${i})`;
            const names = new Set(existing.map(s => String(s.name)));
            while (names.has(candidate)) { i += 1; candidate = `${name} (${i})`; }
            paintStyle.name = candidate;
        } else {
            paintStyle.name = name;
        }
        paintStyle.paints = paints;

        const result = { success: true, summary: `Created paint style '${paintStyle.name}'`, modified_node_ids: [], created_style_id: paintStyle.id, name: paintStyle.name, type: 'paint' };
        logger.info("✅ create_paint_style succeeded", { styleId: paintStyle.id, name: paintStyle.name });
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
        const s = (style && typeof style === 'object') ? style : {};

        const conflictMode = (onConflict === 'skip' || onConflict === 'suffix' || onConflict === 'error') ? onConflict : 'error';
        const existing = await figma.getLocalTextStylesAsync();
        const exact = existing.find(st => String(st.name) === name);
        if (exact) {
            if (conflictMode === 'skip') {
            logger.info("✅ create_text_style skipped (name exists)", { styleId: exact.id, name: exact.name });
            return { success: true, summary: `Skipped: text style '${name}' already exists`, modified_node_ids: [], created_style_id: exact.id, name: exact.name, type: 'text', skipped: true };
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
            const names = new Set(existing.map(st => String(st.name)));
            while (names.has(candidate)) { i += 1; candidate = `${name} (${i})`; }
            textStyle.name = candidate;
        } else {
            textStyle.name = name;
        }

        try {
            if (s.font_name && typeof s.font_name === 'object' && s.font_name.family && s.font_name.style) {
                try { await figma.loadFontAsync({ family: s.font_name.family, style: s.font_name.style }); } catch (_) {}
                try { textStyle.fontName = { family: s.font_name.family, style: s.font_name.style }; } catch (_) {}
            }
            if (typeof s.font_size === 'number') { try { textStyle.fontSize = s.font_size; } catch (_) {} }
            if (typeof s.text_case === 'string') { try { textStyle.textCase = s.text_case; } catch (_) {} }
            if (typeof s.text_decoration === 'string') { try { textStyle.textDecoration = s.text_decoration; } catch (_) {} }
            if (typeof s.letter_spacing_percent === 'number') { try { textStyle.letterSpacing = { unit: "PERCENT", value: s.letter_spacing_percent }; } catch (_) {} }
            if (typeof s.line_height_percent === 'number') { try { textStyle.lineHeight = { unit: "PERCENT", value: s.line_height_percent }; } catch (_) {} }
        } catch (_) {}

        const result = { success: true, summary: `Created text style '${textStyle.name}'`, modified_node_ids: [], created_style_id: textStyle.id, name: textStyle.name, type: 'text' };
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
            return { success: true, summary: `Skipped: effect style '${name}' already exists`, modified_node_ids: [], created_style_id: exact.id, name: exact.name, type: 'effect', skipped: true };
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

        const result = { success: true, summary: `Created effect style '${effectStyle.name}'`, modified_node_ids: [], created_style_id: effectStyle.id, name: effectStyle.name, type: 'effect' };
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
            return { success: true, summary: `Skipped: grid style '${name}' already exists`, modified_node_ids: [], created_style_id: exact.id, name: exact.name, type: 'grid', skipped: true };
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

        const result = { success: true, summary: `Created grid style '${gridStyle.name}'`, modified_node_ids: [], created_style_id: gridStyle.id, name: gridStyle.name, type: 'grid' };
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


 

// ======================================================
// Undo Group Wrapper: withUndoGroup(label, actions, options)
// - Ensures step-level logging
// - Optionally reveals affected nodes for UX via scrollAndZoomIntoView
// - Does NOT call figma.commitUndo() automatically (split only when intentional)
// ======================================================
async function withUndoGroup(label, actions, options) {
  const opts = options || {};
  const reveal = opts.autoReveal !== false;
  const log = (globalThis.logger && typeof globalThis.logger.info === 'function') ? globalThis.logger : logger;
  log.info(`▶️ Step start`, { label });
  try {
    const result = await actions();

    // Determine affected node ids, if any
    const affectedIds = new Set();
    if (result && typeof result === 'object') {
      if (Array.isArray(result.modified_node_ids)) {
        for (const id of result.modified_node_ids) if (typeof id === 'string' && id.length > 0) affectedIds.add(id);
      }
      if (result.node && result.node.id) affectedIds.add(result.node.id);
      if (result.node_id) affectedIds.add(result.node_id);
      if (result.created_node_id) affectedIds.add(result.created_node_id);
      if (Array.isArray(result.resolved_node_ids)) {
        for (const id of result.resolved_node_ids) if (typeof id === 'string' && id.length > 0) affectedIds.add(id);
      }
      // Heuristic: if search returned a single match, reveal it
      if (Array.isArray(result.matching_nodes) && result.matching_nodes.length === 1 && result.matching_nodes[0] && result.matching_nodes[0].id) {
        affectedIds.add(result.matching_nodes[0].id);
      }
    }
    if (opts && Array.isArray(opts.candidate_ids)) {
      for (const id of opts.candidate_ids) if (typeof id === 'string' && id.length > 0) affectedIds.add(id);
    }

    if (reveal && affectedIds.size > 0) {
      try {
        // Resolve nodes; limit to a reasonable number to avoid perf issues
        const MAX_NODES_TO_REVEAL = 50;
        const ids = Array.from(affectedIds).slice(0, MAX_NODES_TO_REVEAL);
        const nodes = [];
        for (const id of ids) {
          try { const n = await figma.getNodeByIdAsync(id); if (n) nodes.push(n); } catch (_) {}
        }
        if (nodes.length > 0) {
          const primary = nodes[0];
          // Switch to the page of the primary node
          let p = primary.parent;
          while (p && p.type !== 'PAGE') p = p.parent;
          if (p && p.id && figma.currentPage && p.id !== figma.currentPage.id) {
            try { figma.currentPage = p; } catch (_) {}
          }
          // Keep selection minimal to avoid disrupting user workflow
          try { figma.currentPage.selection = [primary]; } catch (_) {}
          // Only reveal nodes that are on the same page as the primary
          const pageId = (p && p.id) ? p.id : (figma.currentPage && figma.currentPage.id);
          const nodesOnPage = nodes.filter((n) => {
            let q = n.parent; let page = null;
            while (q && q.type !== 'PAGE') q = q.parent;
            page = q;
            return page && page.id === pageId;
          });
          try { figma.viewport.scrollAndZoomIntoView(nodesOnPage.length > 0 ? nodesOnPage : [primary]); } catch (_) {}
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
