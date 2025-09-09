import { serve, ServerWebSocket } from "bun";
import { appendFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// Bridge WebSocket server
// - Routes messages between the Figma plugin and an external agent
// - Validates incoming tool calls with zod schemas
// - Persists chat transcripts to logs.txt (JSONL)
// Sections: Types & Schemas, Config, Utilities, Handlers, Server bootstrap


export interface ScrollAndZoomIntoViewParams { node_ids: string[] }
export interface ScrollAndZoomIntoViewResult {
  success: true;
  summary: string;
  resolved_node_ids: string[];
  unresolved_node_ids: string[];
  zoom: number;
  center: { x: number; y: number };
}
export const ScrollAndZoomIntoViewParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty() }).strict();
export function isScrollAndZoomIntoViewParams(input: unknown): input is ScrollAndZoomIntoViewParams { try { ScrollAndZoomIntoViewParamsSchema.parse(input); return true; } catch { return false; } }
export function assertScrollAndZoomIntoViewParams(input: unknown): asserts input is ScrollAndZoomIntoViewParams { ScrollAndZoomIntoViewParamsSchema.parse(input); }

// === Types & Schemas ===
// Organized categories:
// 1) Scoping & Orientation
// 2) Observation & Inspection
// 3) Mutation & Creation
// 4) Meta & Utility
// Typed façade and schema for get_canvas_snapshot (read-only)


// === Tools: Category 1 - Scoping & Orientation ===
export interface GetCanvasSnapshotParams { include_images?: boolean }
export interface BasicNodeSummary { id: string; name: string; type: string; has_children: boolean }
export interface RichNodeSummary {
  id: string;
  name: string;
  type: string;
  absolute_bounding_box: { x: number; y: number; width: number; height: number };
  auto_layout_mode: string | null;
  has_children: boolean;
}
export interface SelectionSummary {
  selection_count: number;
  types_count: Record<string, number>;
  hints: {
    has_instances: boolean;
    has_variants: boolean;
    has_auto_layout: boolean;
    sticky_note_count: number;
    total_text_chars: number;
  };
  nodes: Array<{ id: string; name: string; type: string }>;
}
export interface GetCanvasSnapshotResult {
  page: { id: string; name: string };
  // Canonical snapshot per `plugin/new-tools.md`: page, selection, root_nodes_on_page
  selection: RichNodeSummary[];
  root_nodes_on_page: BasicNodeSummary[];
  // Optional helpful metadata returned by the plugin
  selection_signature?: string;
  selection_summary?: SelectionSummary;
}
export const GetCanvasSnapshotParamsSchema = z.object({ include_images: z.boolean().optional() }).strict();

export function isGetCanvasSnapshotParams(input: unknown): input is GetCanvasSnapshotParams { try { GetCanvasSnapshotParamsSchema.parse(input); return true; } catch { return false; } }
export function assertGetCanvasSnapshotParams(input: unknown): asserts input is GetCanvasSnapshotParams { GetCanvasSnapshotParamsSchema.parse(input); }

// === Tools: Category 2 - Observation & Inspection ===
export interface FindNodesFilters {
  name_regex?: string;
  text_regex?: string;
  node_types?: string[];
  main_component_id?: string;
  style_id?: string;
}
export interface FindNodesParams { filters: FindNodesFilters; scope_node_id?: string | null; highlight_results?: boolean }
export interface FindNodesResult { matching_nodes: Array<{ id: string; name: string; type: string; has_children: boolean; absolute_bounding_box: { x: number; y: number; width: number; height: number }; auto_layout_mode: string | null }> }
export const FindNodesParamsSchema = z.object({
  filters: z.object({
    name_regex: z.string().optional(),
    text_regex: z.string().optional(),
    node_types: z.array(z.string()).nonempty().optional(),
    main_component_id: z.string().optional(),
    style_id: z.string().optional(),
  }).strict(),
  scope_node_id: z.union([z.string(), z.null()]).optional(),
  highlight_results: z.boolean().optional(),
}).strict();

export interface GetNodeDetailsParams { node_ids: string[] }
export interface GetNodeDetailsResult { details: Record<string, { target_node: any; parent_summary: any | null; children_summaries: any[] }> }
export const GetNodeDetailsParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty() }).strict();

export interface GetImageOfNodeParams {
  node_ids: string[];
  export_settings?: {
    format?: string;
    constraint?: { type?: "SCALE" | "WIDTH" | "HEIGHT"; value?: number };
    // Enforce snake_case keys at the bridge boundary
    use_absolute_bounds?: boolean;
    [key: string]: any;
  };
}
export interface GetImageOfNodeResult { images: Record<string, string | null> }
export const GetImageOfNodeParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  export_settings: z.object({
    format: z.string().optional(),
    constraint: z.object({ type: z.enum(["SCALE","WIDTH","HEIGHT"]).optional(), value: z.number().optional() }).optional(),
    use_absolute_bounds: z.boolean().optional(),
  }).optional(),
}).strict();

export interface GetNodeAncestryParams { node_id: string }
export interface GetNodeAncestryResult { ancestors: Array<{ id: string; name: string; type: string; has_children: boolean }> }
export const GetNodeAncestryParamsSchema = z.object({ node_id: z.string() }).strict();

export interface GetNodeHierarchyParams { node_id: string }
export interface GetNodeHierarchyResult { parent_summary: any | null; children: Array<{ id: string; name: string; type: string; has_children: boolean }> }
export const GetNodeHierarchyParamsSchema = z.object({ node_id: z.string() }).strict();

export interface GetDocumentStylesParams { style_types?: Array<"PAINT"|"TEXT"|"EFFECT"|"GRID"> | null }
export interface GetDocumentStylesResult { styles: Array<{ id: string; name: string; type: string }> }
export const GetDocumentStylesParamsSchema = z.object({ style_types: z.array(z.enum(["PAINT","TEXT","EFFECT","GRID"]) ).optional().nullable() }).strict();

export interface GetStyleConsumersParams { style_id: string }
export interface GetStyleConsumersResult { consuming_nodes: Array<{ node: any; fields: string[] }> }
export const GetStyleConsumersParamsSchema = z.object({ style_id: z.string() }).strict();

// Observation: Components & Prototyping
export type PublishedFilter = "all" | "published_only" | "unpublished_only";
export interface GetDocumentComponentsParams { published_filter?: PublishedFilter }
export interface GetDocumentComponentsResult { components: Array<{ id: string; component_key: string | null; name: string; type: string; is_published: boolean }> }
export const GetDocumentComponentsParamsSchema = z.object({
  published_filter: z.enum(["all","published_only","unpublished_only"]).optional(),
}).strict();


export interface CreateComponentFromNodeParams { node_id: string; name: string }
export interface CreateComponentFromNodeResult {
  success: true;
  summary: string;
  created_component_id: string;
  modified_node_ids?: string[];
}
export const CreateComponentFromNodeParamsSchema = z.object({ node_id: z.string().min(1), name: z.string().min(1) }).strict();

export interface SetInstancePropertiesParams { node_ids: string[]; properties: Record<string, any> }
export interface SetInstancePropertiesResult { success: true; modified_node_ids: string[]; summary: string }
export const SetInstancePropertiesParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty(), properties: z.record(z.any()) }).strict();

export interface DetachInstanceParams { node_ids: string[] }
export interface DetachInstanceResult { success: true; created_frame_ids: string[]; summary: string }
export const DetachInstanceParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty() }).strict();

export type CreateStyleType = "PAINT" | "TEXT" | "EFFECT" | "GRID";
export interface CreateStyleParams { name: string; type: CreateStyleType; style_properties: Record<string, any> }
export interface CreateStyleResult { success: true; summary: string; created_style_id: string }
export const CreateStyleParamsSchema = z.object({ name: z.string().min(1), type: z.enum(["PAINT","TEXT","EFFECT","GRID"]), style_properties: z.record(z.any()) }).strict();

export type ApplyStyleKind = "FILL" | "STROKE" | "TEXT" | "EFFECT" | "GRID";
export interface ApplyStyleParams { node_ids: string[]; style_id: string; style_type: ApplyStyleKind }
export interface ApplyStyleResult { success: true; modified_node_ids: string[]; summary: string }
export const ApplyStyleParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty(), style_id: z.string().min(1), style_type: z.enum(["FILL","STROKE","TEXT","EFFECT","GRID"]) }).strict();

export type VariableResolvedType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
export interface CreateVariableCollectionParams { name: string; initial_mode_name?: string }
export interface CreateVariableCollectionResult { success: true; summary: string; collection_id: string; initial_mode_id?: string | null }
export const CreateVariableCollectionParamsSchema = z.object({
  name: z.string().min(1),
  initial_mode_name: z.string().min(1).optional(),
}).strict();

export interface CreateVariableParams { name: string; collection_id: string; resolved_type: VariableResolvedType }
export interface CreateVariableResult { success: true; summary: string; variable_id: string }
export const CreateVariableParamsSchema = z.object({
  name: z.string().min(1),
  collection_id: z.string().min(1),
  resolved_type: z.enum(["COLOR","FLOAT","STRING","BOOLEAN"]),
}).strict();

export interface SetVariableValueParams { variable_id: string; mode_id: string; value: string | number | boolean | Record<string, any> }
export interface SetVariableValueResult { success: true; modified_variable_id: string; summary: string }
export const SetVariableValueParamsSchema = z.object({
  variable_id: z.string().min(1),
  mode_id: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.any())]),
}).strict();

export interface BindVariableToPropertyParams { node_id: string; property: string; variable_id: string }
export interface BindVariableToPropertyResult { success: true; modified_node_ids: string[]; summary: string }
export const BindVariableToPropertyParamsSchema = z.object({
  node_id: z.string().min(1),
  property: z.string().min(1),
  variable_id: z.string().min(1),
}).strict();

// === Tools: Category 3 - Mutation & Creation ===
// --- Subcategory 3.2: Modify (General Properties) ---
export interface SetFillsParams { node_ids: string[]; paints: any[] }
// Canonical success envelope for mutating tools
export interface MutateSuccessResult {
  success: true;
  summary: string;
  modified_node_ids?: string[];
  unresolved_node_ids?: string[];
  details?: Record<string, any>;
}
export const SetFillsParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty(), paints: z.array(z.any()) }).strict();
export function isSetFillsParams(input: unknown): input is SetFillsParams { try { SetFillsParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetFillsParams(input: unknown): asserts input is SetFillsParams { SetFillsParamsSchema.parse(input); }

export interface SetStrokesParams { node_ids: string[]; paints: any[]; stroke_weight?: number; stroke_align?: "INSIDE"|"OUTSIDE"|"CENTER"; dash_pattern?: number[] }
export const SetStrokesParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  paints: z.array(z.any()),
  stroke_weight: z.number().optional(),
  stroke_align: z.enum(["INSIDE","OUTSIDE","CENTER"]).optional(),
  dash_pattern: z.array(z.number()).optional(),
}).strict();
export function isSetStrokesParams(input: unknown): input is SetStrokesParams { try { SetStrokesParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetStrokesParams(input: unknown): asserts input is SetStrokesParams { SetStrokesParamsSchema.parse(input); }

export interface SetCornerRadiusParams { node_ids: string[]; uniform_radius?: number; top_left?: number; top_right?: number; bottom_left?: number; bottom_right?: number }
export const SetCornerRadiusParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  uniform_radius: z.number().min(0).optional(),
  top_left: z.number().min(0).optional(),
  top_right: z.number().min(0).optional(),
  bottom_left: z.number().min(0).optional(),
  bottom_right: z.number().min(0).optional(),
}).strict().refine((d: SetCornerRadiusParams) => {
  return d.uniform_radius !== undefined || d.top_left !== undefined || d.top_right !== undefined || d.bottom_left !== undefined || d.bottom_right !== undefined;
}, { message: "Provide uniform_radius or at least one corner value" });
export function isSetCornerRadiusParams(input: unknown): input is SetCornerRadiusParams { try { SetCornerRadiusParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetCornerRadiusParams(input: unknown): asserts input is SetCornerRadiusParams { SetCornerRadiusParamsSchema.parse(input); }

export interface SetSizeParams { node_ids: string[]; width?: number; height?: number }
export const SetSizeParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty(), width: z.number().optional(), height: z.number().optional() }).strict().refine((d: SetSizeParams) => d.width !== undefined || d.height !== undefined, { message: "Provide width and/or height" });
export function isSetSizeParams(input: unknown): input is SetSizeParams { try { SetSizeParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetSizeParams(input: unknown): asserts input is SetSizeParams { SetSizeParamsSchema.parse(input); }

export interface SetPositionParams { node_ids: string[]; x: number; y: number }
export const SetPositionParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty(), x: z.number(), y: z.number() }).strict();
export function isSetPositionParams(input: unknown): input is SetPositionParams { try { SetPositionParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetPositionParams(input: unknown): asserts input is SetPositionParams { SetPositionParamsSchema.parse(input); }

export interface SetChildIndexParams { node_id: string; new_index: number }
export const SetChildIndexParamsSchema = z.object({ node_id: z.string().min(1), new_index: z.number().int().min(0) }).strict();


export interface SetLayerPropertiesParams { node_ids: string[]; name?: string; opacity?: number; visible?: boolean; locked?: boolean; blend_mode?: "NORMAL"|"DARKEN"|"MULTIPLY"|"COLOR_BURN"|"LIGHTEN"|"SCREEN"|"COLOR_DODGE"|"OVERLAY"|"SOFT_LIGHT"|"HARD_LIGHT"|"DIFFERENCE"|"EXCLUSION"|"HUE"|"SATURATION"|"COLOR"|"LUMINOSITY" }
export const SetLayerPropertiesParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  name: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  blend_mode: z.enum(["NORMAL","DARKEN","MULTIPLY","COLOR_BURN","LIGHTEN","SCREEN","COLOR_DODGE","OVERLAY","SOFT_LIGHT","HARD_LIGHT","DIFFERENCE","EXCLUSION","HUE","SATURATION","COLOR","LUMINOSITY"]).optional(),
}).strict();
export function isSetLayerPropertiesParams(input: unknown): input is SetLayerPropertiesParams { try { SetLayerPropertiesParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetLayerPropertiesParams(input: unknown): asserts input is SetLayerPropertiesParams { SetLayerPropertiesParamsSchema.parse(input); }

export interface SetEffectsParams { node_ids: string[]; effects: any[] }
export const SetEffectsParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty(), effects: z.array(z.any()) }).strict();
export function isSetEffectsParams(input: unknown): input is SetEffectsParams { try { SetEffectsParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetEffectsParams(input: unknown): asserts input is SetEffectsParams { SetEffectsParamsSchema.parse(input); }

// --- Subcategory 3.4: Modify (Text) ---
export interface SetTextCharactersParams { node_id: string; new_characters: string }
export const SetTextCharactersParamsSchema = z.object({ node_id: z.string().min(1), new_characters: z.string() }).strict();

export interface FontName { family: string; style: string }
export interface SetTextStyleParams {
  node_ids: string[];
  font_size?: number;
  font_name?: FontName;
  text_align_horizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  text_auto_resize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT";
  line_height_percent?: number;
  letter_spacing_percent?: number;
  text_case?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  text_decoration?: "NONE" | "STRIKETHROUGH" | "UNDERLINE";
}
export const SetTextStyleParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  font_size: z.number().optional(),
  font_name: z.object({ family: z.string(), style: z.string() }).strict().optional(),
  text_align_horizontal: z.enum(["LEFT","CENTER","RIGHT","JUSTIFIED"]).optional(),
  text_auto_resize: z.enum(["NONE","WIDTH_AND_HEIGHT","HEIGHT"]).optional(),
  line_height_percent: z.number().optional(),
  letter_spacing_percent: z.number().optional(),
  text_case: z.enum(["ORIGINAL","UPPER","LOWER","TITLE"]).optional(),
  text_decoration: z.enum(["NONE","STRIKETHROUGH","UNDERLINE"]).optional(),
}).strict().refine((d: SetTextStyleParams) => {
  return d.font_size !== undefined || d.font_name !== undefined || d.text_align_horizontal !== undefined || d.text_auto_resize !== undefined || d.line_height_percent !== undefined || d.letter_spacing_percent !== undefined || d.text_case !== undefined || d.text_decoration !== undefined;
}, { message: "Provide at least one style property to apply" });

// --- Subcategory 3.3: Modify (Layout) ---
export interface SetAutoLayoutParams {
  node_ids: string[];
  layout_mode?: "HORIZONTAL" | "VERTICAL" | "NONE" | "GRID";
  padding_left?: number;
  padding_right?: number;
  padding_top?: number;
  padding_bottom?: number;
  item_spacing?: number;
  primary_axis_align_items?: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
  counter_axis_align_items?: "MIN" | "MAX" | "CENTER";
  primary_axis_sizing_mode?: "FIXED" | "AUTO";
  counter_axis_sizing_mode?: "FIXED" | "AUTO";
}
export const SetAutoLayoutParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  layout_mode: z.enum(["HORIZONTAL","VERTICAL","NONE","GRID"]).optional(),
  padding_left: z.number().optional(),
  padding_right: z.number().optional(),
  padding_top: z.number().optional(),
  padding_bottom: z.number().optional(),
  item_spacing: z.number().optional(),
  primary_axis_align_items: z.enum(["MIN","MAX","CENTER","SPACE_BETWEEN"]).optional(),
  counter_axis_align_items: z.enum(["MIN","MAX","CENTER"]).optional(),
  primary_axis_sizing_mode: z.enum(["FIXED","AUTO"]).optional(),
  counter_axis_sizing_mode: z.enum(["FIXED","AUTO"]).optional(),
}).strict();

export interface SetAutoLayoutChildParams {
  node_ids: string[];
  layout_align?: "STRETCH" | "INHERIT" | "MIN" | "CENTER" | "MAX";
  layout_grow?: 0 | 1;
  layout_positioning?: "AUTO" | "ABSOLUTE";
}
export const SetAutoLayoutChildParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  layout_align: z.enum(["STRETCH","INHERIT","MIN","CENTER","MAX"]).optional(),
  layout_grow: z.union([z.literal(0), z.literal(1)]).optional(),
  layout_positioning: z.enum(["AUTO","ABSOLUTE"]).optional(),
}).strict();

export interface SetConstraintsParams { node_ids: string[]; horizontal: "MIN"|"MAX"|"CENTER"|"STRETCH"|"SCALE"; vertical: "MIN"|"MAX"|"CENTER"|"STRETCH"|"SCALE" }
export const SetConstraintsParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  horizontal: z.enum(["MIN","MAX","CENTER","STRETCH","SCALE"]),
  vertical: z.enum(["MIN","MAX","CENTER","STRETCH","SCALE"]),
}).strict();

 


 
 
 
// --- Subcategory 3.1: Create Tools ---
export interface CreateFrameParams { name: string; parent_id?: string; width?: number; height?: number; x?: number; y?: number }
export const CreateFrameParamsSchema = z.object({
  name: z.string().min(1),
  parent_id: z.string().min(1).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
}).passthrough();

// Reusable params schema for create_text (previously inline in validation)
export const CreateTextParamsSchema = z
  .object({
    characters: z.string(),
    parent_id: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    name: z.string().optional(),
    // Optional text styling overrides supported by the plugin
    font_size: z.number().optional(),
    font_weight: z.union([z.number(), z.string()]).optional(),
    font_color: z
      .object({
        r: z.number().optional(),
        g: z.number().optional(),
        b: z.number().optional(),
        a: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Typed façade and schema for create_frame
export type LayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
export type LayoutWrap = "NO_WRAP" | "WRAP";
export type PrimaryAxisAlignItems = "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
export type CounterAxisAlignItems = "MIN" | "MAX" | "CENTER" | "BASELINE";
export type LayoutSizing = "FIXED" | "HUG" | "FILL";


// Typed façade and schema for create_component_instance
export interface CreateComponentInstanceParams {
  // Canonical keys are snake_case. Backends expect `component_key` or
  // `component_id` and `parent_id` in the payload.
  component_key?: string;
  component_id?: string;
  x?: number;
  y?: number;
  parent_id?: string;
}
export interface CreateComponentInstanceResultNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  // Canonicalized fields in snake_case to match backend expectations.
  component_id: string;
  parent_id?: string;
}
export interface CreateComponentInstanceResult {
  success: true;
  summary: string;
  modified_node_ids: string[];
  node: CreateComponentInstanceResultNode;
}
export const CreateComponentInstanceParamsSchema = z
  .object({
    component_key: z.string().optional(),
    component_id: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    parent_id: z.string().optional(),
  })
  .strict()
  .refine((d: any) => {
    return !!(d.component_key || d.component_id);
  }, { message: "Provide component_key or component_id" });
export function isCreateComponentInstanceParams(input: unknown): input is CreateComponentInstanceParams {
  try { CreateComponentInstanceParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertCreateComponentInstanceParams(input: unknown): asserts input is CreateComponentInstanceParams {
  CreateComponentInstanceParamsSchema.parse(input);
}

 

 

 

 








// === Category 4 — Meta & Utility ===
export interface DeleteNodesParams { node_ids: string[] }
export const DeleteNodesParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty() }).strict();
export function isDeleteNodesParams(input: unknown): input is DeleteNodesParams {
  try { DeleteNodesParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertDeleteNodesParams(input: unknown): asserts input is DeleteNodesParams {
  DeleteNodesParamsSchema.parse(input);
}

// Additional small, reusable schemas to avoid inline duplication
export const ShowNotificationParamsSchema = z
  .object({ message: z.string(), is_error: z.boolean().optional() })
  .strict();

export const CommitUndoStepParamsSchema = z.object({}).strict();

 


export type ReorderMode = "BRING_FORWARD" | "SEND_BACKWARD" | "BRING_TO_FRONT" | "SEND_TO_BACK";
export interface ReorderNodesParams { node_ids: string[]; mode: ReorderMode }
export const ReorderNodesParamsSchema = z.object({
  node_ids: z.array(z.string()).nonempty(),
  mode: z.enum(["BRING_FORWARD","SEND_BACKWARD","BRING_TO_FRONT","SEND_TO_BACK"]),
}).strict();

// Additional schema per new-tools.md for clone_nodes
export interface CloneNodesParams { node_ids: string[] }
export const CloneNodesParamsSchema = z.object({ node_ids: z.array(z.string()).nonempty() }).strict();

// Hierarchy & structure: reparent_nodes
export interface ReparentNodesParams { node_ids_to_move: string[]; new_parent_id: string }
export const ReparentNodesParamsSchema = z.object({
  node_ids_to_move: z.array(z.string()).nonempty(),
  new_parent_id: z.string().min(1),
}).strict();


// === Config & Constants ===
const PORT = 3055;

// === Channel Management ===
// Channel management
interface ChannelMembers {
  plugin?: ServerWebSocket<unknown>;
  agent?: ServerWebSocket<unknown>;
}

const channels = new Map<string, ChannelMembers>();


// === Message Types ===
// Message types
interface JoinMessage {
  type: "join";
  role: "plugin" | "agent";
  channel: string;
}

interface NewChatMessage {
  type: "new_chat";
}

interface UserPromptMessage {
  type: "user_prompt";
  prompt: string;
}

interface AgentResponseMessage {
  type: "agent_response";
  prompt: string;
  is_final?: boolean;
}

interface AgentResponseChunkMessage {
  type: "agent_response_chunk";
  chunk: string;
  is_partial: boolean;
}

interface SystemMessage {
  type: "system";
  message: string | { result: boolean };
  channel: string;
}

interface ErrorMessage {
  type: "error";
  message: string;
  channel?: string;
}

interface PingMessage {
  type: "ping";
}

interface PongMessage {
  type: "pong";
}

// Tool execution messages
interface ToolCallMessage {
  type: "tool_call";
  id: string;
  command: string;
  params: any;
}

interface ToolResponseMessage {
  type: "tool_response";
  id: string;
  result?: any;
  // `error` may be a string (legacy) or an object (structured). We also
  // provide `error_structured` for explicit structured errors.
  error?: any;
  error_structured?: any;
}
// Progress updates from plugin UI to be forwarded to agent
interface ProgressUpdateMessage {
  type: "progress_update";
  id?: string;
  channel?: string;
  message?: any;
}

type Message = JoinMessage | NewChatMessage | UserPromptMessage | AgentResponseMessage | AgentResponseChunkMessage | SystemMessage | ErrorMessage | PingMessage | PongMessage | ToolCallMessage | ToolResponseMessage | ProgressUpdateMessage;

// === Helpers: logging, file I/O, and message utilities ===
// === Logging & File I/O ===

function log(level: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [bridge] [${level}] ${message}`, data ? JSON.stringify(data) : "");
}

// File logging (JSONL) for full session transcripts
const BRIDGE_DIR = fileURLToPath(new URL("./", import.meta.url));
const ENV_LOG = (typeof process !== "undefined" && process.env && process.env.LOG_FILE) ? String(process.env.LOG_FILE) : null;
const LOG_CANDIDATES = [
  ...(ENV_LOG ? [ENV_LOG] : []),
  // Prefer repo root logs.txt (../logs.txt) if writable
  path.resolve(BRIDGE_DIR, "../logs.txt"),
  // Fallback to bridge-local logs.txt
  path.resolve(BRIDGE_DIR, "logs.txt"),
  // Last-resort: cwd
  path.resolve(process.cwd(), "logs.txt"),
];

let SELECTED_LOG_PATH: string | null = null;

// === Token logging candidates & state ===
const TOKEN_LOG_CANDIDATES = [
  ...(ENV_LOG ? [ENV_LOG.replace(/\.txt$|\.jsonl?$/i, ".tokens.jsonl")] : []),
  path.resolve(BRIDGE_DIR, "../token_logs.jsonl"),
  path.resolve(BRIDGE_DIR, "token_logs.jsonl"),
  path.resolve(process.cwd(), "token_logs.jsonl"),
];

let SELECTED_TOKEN_LOG_PATH: string | null = null;

// Tracker to maintain cumulative token summaries per channel
const TOKEN_SUMMARY_TRACKER = new Map<string, { requests: number; input_tokens: number; output_tokens: number; total_tokens: number }>();

function tryAppendTo(filePath: string, line: string): boolean {
  try {
    const dir = path.dirname(filePath);
    mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, line, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

// Try appending a line to the currently selected log path or the first
// writable candidate. Returns true on success and sets SELECTED_LOG_PATH.
function appendLineToBestCandidate(line: string): boolean {
  if (SELECTED_LOG_PATH) {
    if (tryAppendTo(SELECTED_LOG_PATH, line)) return true;
    SELECTED_LOG_PATH = null; // reset and try candidates
  }

  for (const candidate of LOG_CANDIDATES) {
    if (tryAppendTo(candidate, line)) {
      SELECTED_LOG_PATH = candidate;
      log("info", "📝 Using logs file", { path: SELECTED_LOG_PATH });
      return true;
    }
  }

  return false;
}

function logToFile(entry: {
  timestamp?: string;
  channel: string;
  from: "plugin" | "agent";
  type: string;
  text?: string;
  meta?: Record<string, any>;
}) {
  const payload = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    channel: entry.channel,
    from: entry.from,
    type: entry.type,
    text: entry.text,
    meta: entry.meta,
  };

  const line = JSON.stringify(payload) + "\n";

  if (appendLineToBestCandidate(line)) return;

  // Fall back to console on file write errors
  log("error", "Failed writing to logs.txt", { tried: LOG_CANDIDATES });
}

// Track outstanding tool calls to compute durations and correlate responses
const TOOL_CALL_TRACKER = new Map<string, { command: string; params: any; start_ts: number }>();

// Persist only tool events (tool_call, tool_response) to logs.txt as JSONL
function persistToolEventIfNeeded(message: any, senderChannel: string, senderRole: "plugin" | "agent") {
  try {
    if (message.type === "tool_call") {
      const m = message as any;
      const id = m.id;
      const command = m.command;
      const params = m.params;

      TOOL_CALL_TRACKER.set(id, { command, params, start_ts: Date.now() });

      logToFile({
        channel: senderChannel,
        from: senderRole,
        type: "tool_call",
        text: command,
        meta: { id, tool: command, params }
      });
    } else if (message.type === "tool_response") {
      const m = message as any;
      const id = m.id;
      const tracked = TOOL_CALL_TRACKER.get(id);
      const now = Date.now();
      const duration_ms = tracked ? now - tracked.start_ts : undefined;
      const tool = tracked ? tracked.command : undefined;
      const params = tracked ? tracked.params : undefined;

      // Prefer an explicit structured error, but tolerate legacy shapes
      const error_structured = m.error_structured || (typeof m.error === "object" ? m.error : undefined) || undefined;
      const ok = !error_structured;

      // Once logged, drop tracker entry
      if (tracked) TOOL_CALL_TRACKER.delete(id);

      // Build verbose metadata for errors to aid debugging (includes raw payload,
      // plugin-provided details, tracked params, duration and command name).
      const verbose_meta: Record<string, any> = {
        id,
        tool,
        ok,
        status: ok ? "success" : "error",
        duration_ms,
        params,
      };

      if (ok) {
        verbose_meta.result = m.result;
      } else {
        // Capture multiple layers of error information if available
        verbose_meta.error_structured = error_structured || undefined;
        // Preserve any raw stringified error the plugin returned
        verbose_meta.error_raw = m.error_raw ?? (typeof m.error === "string" ? m.error : undefined);
        // Keep the raw `error` field too for maximum fidelity
        verbose_meta.error_field = m.error;
        // Plugin may attach implementation-specific details under `error.details`
        verbose_meta.plugin_details = (m.error && typeof m.error === "object" && m.error.details) ? m.error.details : undefined;
        // If the parser added a normalized `details` inside structured error, include it
        if (error_structured && error_structured.details) verbose_meta.error_structured_details = error_structured.details;

        // Add a lightweight pointer to the tool schema presence so engineers know
        // which tool validation applies (useful when cross-referencing docs).
        verbose_meta.schema_present = !!(tool && TOOL_SCHEMAS[tool]);

        // Surface a console-level error for immediate visibility when running the bridge
        log("error", "Tool call resulted in error", { id, tool, duration_ms, params, error: error_structured || m.error });
      }

      // Persist the verbose meta for both success and error cases (errors have
      // extra fields populated above). This ensures logs.txt contains the full
      // payload needed to debug against the Figma Plugin API docs.
      logToFile({
        channel: senderChannel,
        from: senderRole,
        type: "tool_response",
        text: tool || "<unknown_tool>",
        meta: verbose_meta
      });
    }
  } catch (e) {
    log("warn", "persistToolEventIfNeeded failed", { error: (e as Error).message });
  }
}

// Persist token usage events to a separate token log JSONL file. Accepts a
// variety of usage shapes commonly emitted by LLM providers or agent layers.
function tokenLogToFile(entry: any) {
  const line = JSON.stringify(entry) + "\n";

  if (SELECTED_TOKEN_LOG_PATH) {
    try {
      const dir = path.dirname(SELECTED_TOKEN_LOG_PATH);
      mkdirSync(dir, { recursive: true });
      appendFileSync(SELECTED_TOKEN_LOG_PATH, line, { encoding: "utf8" });
      return;
    } catch {
      SELECTED_TOKEN_LOG_PATH = null;
    }
  }

  for (const candidate of TOKEN_LOG_CANDIDATES) {
    try {
      const dir = path.dirname(candidate);
      mkdirSync(dir, { recursive: true });
      appendFileSync(candidate, line, { encoding: "utf8" });
      SELECTED_TOKEN_LOG_PATH = candidate;
      log("info", "📝 Using token logs file", { path: SELECTED_TOKEN_LOG_PATH });
      return;
    } catch {
      // try next candidate
    }
  }

  // Fall back to console if file writes fail
  log("warn", "Failed writing to token logs file", { tried: TOKEN_LOG_CANDIDATES });
}

// Attempt to extract usage/token info from a variety of message shapes.
function extractUsageFromMessage(m: any) {
  if (!m || typeof m !== "object") return null;

  // Common places: m.usage, m.meta?.usage, m.result?.usage, m.token_usage
  const candidates = [
    m.usage,
    m.meta && m.meta.usage,
    m.result && m.result.usage,
    m.token_usage,
    m.usage_snapshot,
    m.message && m.message.usage,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object") return c;
  }

  // Some layers provide explicit numeric fields
  if (typeof m.input_tokens === "number" || typeof m.output_tokens === "number" || typeof m.total_tokens === "number") {
    return { requests: m.requests || 0, input_tokens: m.input_tokens || 0, output_tokens: m.output_tokens || 0, total_tokens: m.total_tokens || 0 };
  }

  return null;
}

// Persist token event and update running summary per channel
function persistTokenEventIfNeeded(message: any, senderChannel: string, senderRole: "plugin" | "agent") {
  try {
    const usage = extractUsageFromMessage(message);
    if (!usage) return;

    const requests = Number(usage.requests || usage.request_count || 0) || 0;
    let input_tokens = Number(usage.input_tokens || usage.prompt_tokens || usage.input || 0) || 0;
    let output_tokens = Number(usage.output_tokens || usage.completion_tokens || usage.output || 0) || 0;
    let total_tokens = Number(usage.total_tokens || (input_tokens + output_tokens) || 0) || 0;
    const meta_scope = (message && (message.scope || (message.message && (message.message.scope || message.message.kind)))) || undefined;
    const meta_turn_id = (message && (message.turn_id || (message.message && message.message.turn_id))) || undefined;
    const meta_session_id = (message && (message.session_id || (message.message && message.message.session_id))) || undefined;
    const meta_tool = (message && (message.tool || (message.message && message.message.tool))) || undefined;
    const meta_breakdown = (usage && (usage.breakdown || usage.details || undefined)) || undefined;

    const individual: any = {
      timestamp: new Date().toISOString(),
      channel: senderChannel,
      from: senderRole,
      type: "token_usage",
      requests,
      input_tokens,
      output_tokens,
      total_tokens,
      raw: usage,
    };

    if (meta_scope) individual.scope = meta_scope;
    if (meta_turn_id) individual.turn_id = meta_turn_id;
    if (meta_session_id) individual.session_id = meta_session_id;
    if (meta_tool) individual.tool = meta_tool;
    if (meta_breakdown) individual.breakdown = meta_breakdown;

    // Decide how to treat this event for cumulative totals
    // - Only accumulate "turn_summary" scope to avoid double-counting.
    // - Treat tool_output tokens as INPUT-side attribution (even if a sender misclassifies).
    // - Ignore tool_input and input_breakdown in cumulative totals.
    let includeInCumulative = false;
    if (meta_scope === "turn_summary") includeInCumulative = true;

    // Normalize tool_output attribution to input side for per-tool rollup
    let toolOutputTokensForRollup = 0;
    if (meta_scope === "tool_output") {
      if (output_tokens > 0 && input_tokens === 0) {
        input_tokens = output_tokens;
        total_tokens = input_tokens; // single-scope event
        output_tokens = 0;
        individual.input_tokens = input_tokens;
        individual.output_tokens = 0;
        individual.total_tokens = total_tokens;
      }
      toolOutputTokensForRollup = input_tokens;
    }

    // Update cumulative summary per channel (turn_summary only)
    const prev: any = TOKEN_SUMMARY_TRACKER.get(senderChannel) || { requests: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, per_tool_output_tokens: {} };
    const updated: any = includeInCumulative ? {
      requests: prev.requests + requests,
      input_tokens: prev.input_tokens + input_tokens,
      output_tokens: prev.output_tokens + output_tokens,
      total_tokens: prev.total_tokens + total_tokens,
      per_tool_output_tokens: { ...(prev.per_tool_output_tokens || {}) }
    } : {
      ...prev,
      per_tool_output_tokens: { ...(prev.per_tool_output_tokens || {}) }
    };

    // Per-tool rollup (applies to tool_output scope; independent of cumulative inclusion)
    try {
      if (meta_scope === "tool_output" && meta_tool && toolOutputTokensForRollup > 0) {
        const toolName = String(meta_tool.command || meta_tool.name || "<unknown>");
        updated.per_tool_output_tokens[toolName] = (updated.per_tool_output_tokens[toolName] || 0) + toolOutputTokensForRollup;
      }
    } catch {}

    TOKEN_SUMMARY_TRACKER.set(senderChannel, updated);

    // Always write the individual entry
    tokenLogToFile(individual);
    // Write a summary snapshot only when we actually updated cumulative totals (turn_summary)
    if (includeInCumulative) {
      const summary = {
        timestamp: new Date().toISOString(),
        channel: senderChannel,
        from: senderRole,
        type: "token_summary",
        cumulative: updated
      };
      tokenLogToFile(summary);
    }
  } catch (e) {
    log("warn", "persistTokenEventIfNeeded failed", { error: (e as Error).message });
  }
}

// === WebSocket Utilities ===
function sendMessage(ws: ServerWebSocket<unknown>, message: any) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (e) {
    // Non-fatal: log send failures for diagnostics
    log("warn", "Failed to send websocket message", { error: (e as Error).message });
  }
}

// === Param Normalization Utilities ===
function normalizeParamsToSnakeCase(_params: any): void {
  // Recursively convert object keys from camelCase to snake_case in-place.
  function toSnakeCase(s: string): string {
    return s.replace(/([A-Z])/g, "_$1").replace(/\-+/g, "_").toLowerCase();
  }

  function transform(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(transform);
    if (typeof obj !== "object") return obj;

    const entries = Object.entries(obj);
    for (const [key, value] of entries) {
      const newKey = toSnakeCase(key);
      const transformed = transform(value);
      if (newKey !== key) {
        // assign new key and delete old key
        (obj as any)[newKey] = transformed;
        delete (obj as any)[key];
      } else {
        (obj as any)[key] = transformed;
      }
    }
    return obj;
  }

  try {
    transform(_params);
  } catch (e) {
    log("warn", "normalizeParamsToSnakeCase failed", { error: (e as Error).message });
  }
}

// Normalize common human synonyms to Figma Plugin API enums for constraints
function normalizeConstraintEnum(value: any, axis: "horizontal" | "vertical"): any {
  try {
    if (typeof value !== "string") return value;
    const raw = value.trim().toUpperCase();
    const direct = ["MIN", "MAX", "CENTER", "STRETCH", "SCALE"];
    if (direct.includes(raw)) return raw;
    if (axis === "vertical") {
      if (raw === "TOP") return "MIN";
      if (raw === "BOTTOM") return "MAX";
    }
    if (axis === "horizontal") {
      if (raw === "LEFT") return "MIN";
      if (raw === "RIGHT") return "MAX";
    }
    return value;
  } catch {
    return value;
  }
}

// === Schema Registry ===
// Central tool schemas map (single source of truth for validation)
// Centralized schema registry used for runtime validation of incoming tool calls
// Keep the typing permissive to avoid cross-version zod type export issues
const TOOL_SCHEMAS: Record<string, any> = {
  // Category 1: Scoping & Orientation
  get_canvas_snapshot: GetCanvasSnapshotParamsSchema,

  // Category 2: Observation & Inspection
  find_nodes: FindNodesParamsSchema,
  get_node_details: GetNodeDetailsParamsSchema,
  get_image_of_node: GetImageOfNodeParamsSchema,
  get_node_ancestry: GetNodeAncestryParamsSchema,
  get_node_hierarchy: GetNodeHierarchyParamsSchema,
  get_document_styles: GetDocumentStylesParamsSchema,
  get_style_consumers: GetStyleConsumersParamsSchema,
  get_document_components: GetDocumentComponentsParamsSchema,

  // Category 3: Mutation & Creation
  // Subcategory 3.1: Create Tools
  create_frame: CreateFrameParamsSchema,
  create_text: CreateTextParamsSchema,

  // Subcategory 3.2: Modify (General Properties)
  set_fills: SetFillsParamsSchema,
  set_strokes: SetStrokesParamsSchema,
  set_corner_radius: SetCornerRadiusParamsSchema,
  set_size: SetSizeParamsSchema,
  set_position: SetPositionParamsSchema,
  set_layer_properties: SetLayerPropertiesParamsSchema,
  set_effects: SetEffectsParamsSchema,

  // Subcategory 3.3: Modify (Layout)
  set_auto_layout: SetAutoLayoutParamsSchema,
  set_auto_layout_child: SetAutoLayoutChildParamsSchema,
  set_constraints: SetConstraintsParamsSchema,
  set_child_index: SetChildIndexParamsSchema,

  // Subcategory 3.4: Modify (Text)
  set_text_characters: SetTextCharactersParamsSchema,
  set_text_style: SetTextStyleParamsSchema,

  // Subcategory 3.5: Hierarchy & Structure
  clone_nodes: CloneNodesParamsSchema,
  reparent_nodes: ReparentNodesParamsSchema,
  reorder_nodes: ReorderNodesParamsSchema,

  // Subcategory 3.6: Vector & Boolean
  

  // Subcategory 3.7: Components & Styles
  create_component_from_node: CreateComponentFromNodeParamsSchema,
  create_component_instance: CreateComponentInstanceParamsSchema,
  set_instance_properties: SetInstancePropertiesParamsSchema,
  detach_instance: DetachInstanceParamsSchema,
  create_style: CreateStyleParamsSchema,
  apply_style: ApplyStyleParamsSchema,

  // Subcategory 3.8: Variables
  create_variable_collection: CreateVariableCollectionParamsSchema,
  create_variable: CreateVariableParamsSchema,
  set_variable_value: SetVariableValueParamsSchema,
  bind_variable_to_property: BindVariableToPropertyParamsSchema,

  // Subcategory 3.9: Prototyping
  

  // Category 4: Meta & Utility
  scroll_and_zoom_into_view: ScrollAndZoomIntoViewParamsSchema,
  delete_nodes: DeleteNodesParamsSchema,
  show_notification: ShowNotificationParamsSchema,
  commit_undo_step: CommitUndoStepParamsSchema,
};

function validateMessage(data: any): data is Message {
  if (!data || typeof data !== "object" || !data.type) {
    return false;
  }
  
  switch (data.type) {
    case "join":
      return typeof data.role === "string" && 
             (data.role === "plugin" || data.role === "agent") &&
             typeof data.channel === "string";
    case "new_chat":
      return true;
    case "user_prompt":
    case "agent_response":
      return typeof data.prompt === "string";
    case "agent_response_chunk":
      return typeof data.chunk === "string" && typeof data.is_partial === "boolean";
    case "tool_call":
      normalizeParamsToSnakeCase(data.params);

      // Backwards-compatibility shim: accept legacy `filters.name` and map to
      // the canonical `filters.name_regex` expected by the current schema.
      // This allows older agents or model-generated calls to continue working
      // without failing strict validation.
      try {
        if (data.command === "find_nodes" && data.params && typeof data.params === "object") {
          const filters = (data.params as any).filters;
          if (filters && typeof filters === "object" && Object.prototype.hasOwnProperty.call(filters, "name") && !Object.prototype.hasOwnProperty.call(filters, "name_regex")) {
            const nameVal = String(filters.name);
            // Escape regex special chars so a literal name becomes a safe exact-match regex
            const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filters.name_regex = `^${escapeRegExp(nameVal)}$`;
            delete filters.name;
          }
        }
      } catch (_) {
        // Non-fatal; continue to validation which will catch remaining issues
      }

      if (!(typeof data.id === "string" && typeof data.command === "string" && data.params !== undefined)) {
        return false;
      }
      // Backwards-compatibility shims and human-synonym normalization
      try {
        if (data.command === "set_constraints" && data.params && typeof data.params === "object") {
          const original = { horizontal: (data.params as any).horizontal, vertical: (data.params as any).vertical };
          (data.params as any).horizontal = normalizeConstraintEnum((data.params as any).horizontal, "horizontal");
          (data.params as any).vertical = normalizeConstraintEnum((data.params as any).vertical, "vertical");
          const normalized = { horizontal: (data.params as any).horizontal, vertical: (data.params as any).vertical };
          if (original.horizontal !== normalized.horizontal || original.vertical !== normalized.vertical) {
            log("info", "🔁 Normalized set_constraints enums", { original, normalized });
          }
        }
      } catch (_) {}

      const schema = TOOL_SCHEMAS[data.command];
      if (schema) {
        try { schema.parse(data.params); }
        catch (e) { log("warn", `Invalid params for ${data.command}`, { error: (e as Error).message }); return false; }
      }
      return true;
    case "tool_response":
      return typeof data.id === "string" &&
             (data.result !== undefined || data.error !== undefined);
    case "progress_update":
      // Allow pass-through progress updates without strict validation
      return true;
    case "ping":
    case "pong":
      return true;
    default:
      return false;
  }
}

// === Channel Management & Handlers ===

// Return the membership (role + channelId) for a websocket, or null
function findSocketMembership(ws: ServerWebSocket<unknown>): { role: "plugin" | "agent"; channel: string } | null {
  for (const [channelId, members] of channels.entries()) {
    if (members.plugin === ws) return { role: "plugin", channel: channelId };
    if (members.agent === ws) return { role: "agent", channel: channelId };
  }
  return null;
}

// If a tool_response contains a JSON-stringified `error`, parse it and attach
// `error_structured` for downstream consumers. Mutates message in-place.
function parseStructuredToolError(msg: any): void {
  try {
    if (!msg || msg.type !== "tool_response") return;

    // If already provided as structured, ensure both fields are present and logged
    if (msg.error_structured && typeof msg.error_structured === "object" && msg.error_structured.code) {
      // Mirror into `error` for backward compatibility
      msg.error = msg.error_structured;
      log("error", "Plugin returned structured error", { code: msg.error_structured.code, message: msg.error_structured.message, details: msg.error_structured.details || {} });
      return;
    }

    // If `error` is a string, attempt to parse JSON and normalize
    if (typeof msg.error === "string") {
      try {
        const parsed = JSON.parse(msg.error);
        if (parsed && typeof parsed === "object" && parsed.code) {
          msg.error_structured = parsed;
          msg.error = parsed;
          log("error", "Plugin returned structured error", { code: parsed.code, message: parsed.message, details: parsed.details || {} });
        } else {
          // Parsed JSON but not structured; normalize into a structured envelope
          const normalized = { code: "unknown_plugin_error", message: String(msg.error), details: { raw_payload: parsed } };
          msg.error_structured = normalized;
          msg.error = normalized;
          msg.error_raw = String(msg.error);
          log("warn", "Plugin returned non-structured JSON error; normalized", { details: normalized.details });
        }
      } catch (err) {
        // Not JSON - wrap the raw string into a structured error
        const normalized = { code: "unknown_plugin_error", message: String(msg.error), details: { raw_payload: msg.error } };
        msg.error_structured = normalized;
        msg.error = normalized;
        msg.error_raw = String(msg.error);
        log("warn", "Plugin returned non-JSON error string; normalized", { raw: msg.error });
      }
      return;
    }

    // If `error` is already an object but lacks `code`, normalize it
    if (msg.error && typeof msg.error === "object") {
      const errObj = msg.error;
      if (errObj.code) {
        msg.error_structured = errObj;
        msg.error = errObj;
        log("error", "Plugin returned structured error object", { code: errObj.code, message: errObj.message, details: errObj.details || {} });
      } else {
        const normalized = { code: "unknown_plugin_error", message: String(errObj.message || JSON.stringify(errObj)), details: { raw_payload: errObj } };
        msg.error_structured = normalized;
        msg.error = normalized;
        msg.error_raw = errObj;
        log("warn", "Plugin returned error object without code; normalized", { details: normalized.details });
      }
      return;
    }

  } catch (e) {
    log("warn", "parseStructuredToolError failed", { error: (e as Error).message });
  }
}

// Persist chat-related messages to the JSONL log file when relevant.
function persistChatIfNeeded(message: any, senderChannel: string, senderRole: "plugin" | "agent") {
  try {
    if (message.type === "user_prompt") {
      const m = message as any;
      const snapshot = m.snapshot;
      const snap_sig = snapshot ? (snapshot.selection_signature || null) : null;
      logToFile({ channel: senderChannel, from: senderRole, type: message.type, text: m.prompt, meta: snapshot ? { snapshot_signature: snap_sig, snapshot } : undefined });
    } else if (message.type === "agent_response") {
      logToFile({ channel: senderChannel, from: senderRole, type: message.type, text: (message as AgentResponseMessage).prompt });
    } else if (message.type === "agent_response_chunk") {
      logToFile({ channel: senderChannel, from: senderRole, type: message.type, text: (message as AgentResponseChunkMessage).chunk, meta: { is_partial: (message as AgentResponseChunkMessage).is_partial } });
    } else if (message.type === "new_chat") {
      logToFile({ channel: senderChannel, from: senderRole, type: message.type, text: "<new_chat>" });
    } else if (message.type === "progress_update") {
      const m = message as any;
      const inner = m.message;
      if (inner && typeof inner === "object" && (inner.kind === "full_prompt" || inner.type === "full_prompt")) {
        const sig = inner.selection_signature || null;
        logToFile({ channel: senderChannel, from: senderRole, type: "full_prompt", text: inner.prompt, meta: { instructions: inner.instructions, selection_signature: sig } });
      }
    }
  } catch (e) {
    log("warn", "persistChatIfNeeded failed", { error: (e as Error).message });
  }
}

function handleJoin(ws: ServerWebSocket<unknown>, message: JoinMessage) {
  const { role, channel } = message;
  
  log("info", `Join attempt`, { role, channel });
  
  // Get or create channel
  let channelMembers = channels.get(channel);
  if (!channelMembers) {
    channelMembers = {};
    channels.set(channel, channelMembers);
  }
  
  
  // Check for duplicate role
  if (channelMembers[role]) {
    const errorMsg: ErrorMessage = {
      type: "error",
      message: `A ${role} is already connected to channel ${channel}`,
      channel
    };
    sendMessage(ws, errorMsg);
    log("warn", `Duplicate role join rejected`, { role, channel });
    return;
  }
  
  // Add to channel
  channelMembers[role] = ws;
  
  // Send success acknowledgment
  const ackMessage: SystemMessage = {
    type: "system",
    message: { result: true },
    channel
  };
  sendMessage(ws, ackMessage);
  
  log("info", `Join successful`, { role, channel, 
    pluginConnected: !!channelMembers.plugin,
    agentConnected: !!channelMembers.agent 
  });
}

function handleMessage(ws: ServerWebSocket<unknown>, message: NewChatMessage | UserPromptMessage | AgentResponseMessage | AgentResponseChunkMessage | ToolCallMessage | ToolResponseMessage | ProgressUpdateMessage) {
  const membership = findSocketMembership(ws);
  if (!membership) {
    const errorMsg: ErrorMessage = { type: "error", message: "Socket not joined to any channel" };
    sendMessage(ws, errorMsg);
    log("warn", "Message from non-joined socket");
    return;
  }

  const { role: senderRole, channel: senderChannel } = membership;
  const channelMembers = channels.get(senderChannel);
  if (!channelMembers) {
    log("error", "Channel not found", { channel: senderChannel });
    return;
  }

  const targetRole = senderRole === "plugin" ? "agent" : "plugin";
  const targetSocket = channelMembers[targetRole];

  // Try to parse structured errors early
  parseStructuredToolError(message);

  if (!targetSocket) {
    log("warn", "No target socket for message", { senderRole, targetRole, channel: senderChannel });
    return;
  }


  // Forward message and persist tool events (only)
  sendMessage(targetSocket, message);
  log("info", "Message forwarded", { from: senderRole, to: targetRole, channel: senderChannel, type: message.type, id: (message as any).id || "no-id" });
  persistToolEventIfNeeded(message, senderChannel, senderRole);
  // Also persist any token/usage info if present in the message to a
  // dedicated token log for cost estimation and rollups.
  persistTokenEventIfNeeded(message, senderChannel, senderRole);
}

 

function handleDisconnection(ws: ServerWebSocket<unknown>) {
  // Find and remove this socket from all channels
  for (const [channelId, members] of channels.entries()) {
    let disconnectedRole: "plugin" | "agent" | null = null;

    if (members.plugin === ws) {
      disconnectedRole = "plugin";
      delete members.plugin;
    } else if (members.agent === ws) {
      disconnectedRole = "agent";
      delete members.agent;
    }

    if (!disconnectedRole) continue;

    log("info", "Socket disconnected", { role: disconnectedRole, channel: channelId });

    // Notify the remaining participant
    const remainingRole = disconnectedRole === "plugin" ? "agent" : "plugin";
    const remainingSocket = members[remainingRole];
    if (remainingSocket) {
      const leaveMessage = { type: "system", message: `The ${disconnectedRole} has disconnected`, channel: channelId };
      sendMessage(remainingSocket, leaveMessage);
    }

    // Clean up empty channels
    if (!members.plugin && !members.agent) {
      channels.delete(channelId);
      log("info", "Channel cleaned up", { channel: channelId });
    }

    break;
  }
}

// === Server bootstrap ===
serve({
  fetch(req, server) {
    // Upgrade to WebSocket if possible
    if (server.upgrade(req)) return;
    return new Response("Figma Bridge WebSocket", { status: 200 });
  },
  websocket: {
    open(ws) {
      log("info", "Client connected");
    },
    message(ws, rawMessage) {
      try {
        const data = JSON.parse(rawMessage as string);
        
        if (!validateMessage(data)) {
          const errorMsg: ErrorMessage = {
            type: "error",
            message: "Invalid message format"
          };
          sendMessage(ws, errorMsg);
          log("warn", "Invalid message received", { rawMessage });
          return;
        }
        
        if (data.type === "join") {
          handleJoin(ws, data);
        } else if (data.type === "user_prompt" || data.type === "agent_response" || data.type === "agent_response_chunk" || data.type === "tool_call" || data.type === "tool_response" || data.type === "progress_update" || data.type === "new_chat") {
          handleMessage(ws, data);
        } else if (data.type === "ping") {
          // Respond to ping with pong
          const pongMessage: PongMessage = { type: "pong" };
          sendMessage(ws, pongMessage);
        }
      } catch (error) {
        const errorMsg: ErrorMessage = {
          type: "error",
          message: "Failed to parse message"
        };
        sendMessage(ws, errorMsg);
        log("error", "Message parsing failed", { error: (error as Error).message, rawMessage });
      }
    },
    close(ws) {
      handleDisconnection(ws);
    }
  },
  port: PORT
});

log("info", `Listening on ws://localhost:${PORT}`);
