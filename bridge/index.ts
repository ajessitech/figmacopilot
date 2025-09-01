import { serve, ServerWebSocket } from "bun";
import { z } from "zod";

// Shared schema fragments
const RGBASchema = z
  .object({ r: z.number().min(0).max(1), g: z.number().min(0).max(1), b: z.number().min(0).max(1), a: z.number().min(0).max(1).optional() })
  .strict();

// Gradient paint fragments
const GradientStopSchema = z.object({ position: z.number().min(0).max(1), color: RGBASchema }).strict();
const GradientTransformSchema = z.tuple([
  z.tuple([z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()])
]);
const GradientTypeSchema = z.enum(["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"]);

// Viewport tool schemas and typed façades
export interface ZoomParams { zoomLevel: number; center?: { x: number; y: number } }
export interface ZoomResult { success: true; summary: string; modifiedNodeIds: string[]; zoom: number; center: { x: number; y: number } }
export const ZoomParamsSchema = z
  .object({
    zoomLevel: z.number().positive(),
    center: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  })
  .strict();
export function isZoomParams(input: unknown): input is ZoomParams { try { ZoomParamsSchema.parse(input); return true; } catch { return false; } }
export function assertZoomParams(input: unknown): asserts input is ZoomParams { ZoomParamsSchema.parse(input); }

export interface CenterParams { x: number; y: number }
export interface CenterResult { success: true; summary: string; modifiedNodeIds: string[]; center: { x: number; y: number } }
export const CenterParamsSchema = z.object({ x: z.number(), y: z.number() }).strict();
export function isCenterParams(input: unknown): input is CenterParams { try { CenterParamsSchema.parse(input); return true; } catch { return false; } }
export function assertCenterParams(input: unknown): asserts input is CenterParams { CenterParamsSchema.parse(input); }

export interface ScrollAndZoomIntoViewParams { nodeIds: string[] }
export interface ScrollAndZoomIntoViewResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  resolvedNodeIds: string[];
  unresolvedNodeIds: string[];
  zoom: number;
  center: { x: number; y: number };
}
export const ScrollAndZoomIntoViewParamsSchema = z.object({ nodeIds: z.array(z.string()).nonempty() }).strict();
export function isScrollAndZoomIntoViewParams(input: unknown): input is ScrollAndZoomIntoViewParams { try { ScrollAndZoomIntoViewParamsSchema.parse(input); return true; } catch { return false; } }
export function assertScrollAndZoomIntoViewParams(input: unknown): asserts input is ScrollAndZoomIntoViewParams { ScrollAndZoomIntoViewParamsSchema.parse(input); }

// Typed façade and schema for get_document_info
export type GetDocumentInfoParams = Record<string, never>;
export interface GetDocumentInfoResult {
  name: string;
  id: string;
  type: string;
  children: Array<{ id: string; name: string; type: string }>;
  currentPage: { id: string; name: string; childCount: number };
  pages: Array<{ id: string; name: string; childCount: number }>;
}
export const GetDocumentInfoParamsSchema = z.object({}).strict();

export function isGetDocumentInfoParams(input: unknown): input is GetDocumentInfoParams {
  try {
    GetDocumentInfoParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}

export function assertGetDocumentInfoParams(input: unknown): asserts input is GetDocumentInfoParams {
  GetDocumentInfoParamsSchema.parse(input);
}

// Typed façade and schema for get_selection
export type GetSelectionParams = Record<string, never>;
export interface GetSelectionResult {
  selectionCount: number;
  selection: Array<{ id: string; name: string; type: string; visible: boolean }>;
}
export const GetSelectionParamsSchema = z.object({}).strict();

// get_comments (read-only)
export interface GetCommentsParams {}
export interface FigmaComment { id: string; message: string; clientMeta: unknown; createdAt: string; resolvedAt?: string | null; user: unknown }
export type GetCommentsResult = FigmaComment[];
export const GetCommentsParamsSchema = z.object({}).strict();
export function isGetCommentsParams(input: unknown): input is GetCommentsParams { try { GetCommentsParamsSchema.parse(input); return true; } catch { return false; } }

export function isGetSelectionParams(input: unknown): input is GetSelectionParams {
  try {
    GetSelectionParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}

export function assertGetSelectionParams(input: unknown): asserts input is GetSelectionParams {
  GetSelectionParamsSchema.parse(input);
}

// Typed façade and schema for selections_context (read-only)
export type SelectionsContextMode = "snapshot" | "complete";
export interface SelectionsContextParams { mode?: SelectionsContextMode; includeComments?: boolean; force?: boolean }
export const SelectionsContextParamsSchema = z
  .object({
    mode: z.enum(["snapshot", "complete"]).optional(),
    includeComments: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();
export function isSelectionsContextParams(input: unknown): input is SelectionsContextParams { try { SelectionsContextParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSelectionsContextParams(input: unknown): asserts input is SelectionsContextParams { SelectionsContextParamsSchema.parse(input); }

export interface SelectionSummaryHints { hasInstances: boolean; hasVariants: boolean; hasAutoLayout: boolean; stickyNoteCount: number; totalTextChars: number }
export interface SelectionSummary { selectionCount: number; typesCount: Record<string, number>; hints: SelectionSummaryHints; nodes: any[] }
export interface SelectionsContextSnapshotResult {
  document: { pageId: string; pageName: string };
  selectionSignature: string;
  selectionSummary: SelectionSummary;
  gatheredAt: number;
}
export interface SelectionsContextCompleteResult {
  document: { pageId: string; pageName: string };
  selectionCount: number;
  selectedNodeIds: string[];
  gatheredAt: number;
  selectionSignature: string;
  nodes: any[];
  comments?: any[];
}
export type SelectionsContextResult = SelectionsContextSnapshotResult | SelectionsContextCompleteResult;

// Typed façade and schema for export_node_as_image
export interface ExportNodeAsImageParams {
  nodeId: string;
  format?: "PNG" | "JPG" | "SVG" | "SVG_STRING" | "PDF" | "JSON_REST_V1";
  scale?: number;
  width?: number;
  height?: number;
  contentsOnly?: boolean;
  useAbsoluteBounds?: boolean;
  suffix?: string;
  colorProfile?: "DOCUMENT" | "SRGB" | "DISPLAY_P3_V4";
  svgOutlineText?: boolean;
  svgIdAttribute?: boolean;
  svgSimplifyStroke?: boolean;
}

export interface ExportNodeAsImageResult {
  nodeId: string;
  format: string;
  mimeType: string;
  imageData?: string; // base64 for image formats
  data?: any; // for SVG_STRING and JSON_REST_V1
  settings: Record<string, any>;
}

export const ExportNodeAsImageParamsSchema = z.object({
  nodeId: z.string().min(1, "nodeId cannot be empty"),
  format: z.enum(["PNG", "JPG", "SVG", "SVG_STRING", "PDF", "JSON_REST_V1"]).optional(),
  scale: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  contentsOnly: z.boolean().optional(),
  useAbsoluteBounds: z.boolean().optional(),
  suffix: z.string().optional(),
  colorProfile: z.enum(["DOCUMENT", "SRGB", "DISPLAY_P3_V4"]).optional(),
  svgOutlineText: z.boolean().optional(),
  svgIdAttribute: z.boolean().optional(),
  svgSimplifyStroke: z.boolean().optional(),
}).strict().refine(
  (data: ExportNodeAsImageParams) => {
    // Only one constraint type allowed at a time
    const constraints = [data.scale, data.width, data.height].filter(x => x !== undefined);
    return constraints.length <= 1;
  },
  {
    message: "Only one of scale, width, or height can be specified",
    path: ["constraint"]
  }
);

export function isExportNodeAsImageParams(input: unknown): input is ExportNodeAsImageParams {
  try {
    ExportNodeAsImageParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}

export function assertExportNodeAsImageParams(input: unknown): asserts input is ExportNodeAsImageParams {
  ExportNodeAsImageParamsSchema.parse(input);
}

// Typed façade and schema for get_local_components
export interface GetLocalComponentsParams {
  includeComponentSets?: boolean;
  nameContains?: string;
  onlyPublishable?: boolean;
}
export interface GetLocalComponentSummary { id: string; name: string; key: string | null; type: "COMPONENT" | "COMPONENT_SET" }
export interface GetLocalComponentsResult { count: number; components: GetLocalComponentSummary[] }
export const GetLocalComponentsParamsSchema = z.object({
  includeComponentSets: z.boolean().optional(),
  nameContains: z.string().min(1).optional(),
  onlyPublishable: z.boolean().optional(),
}).strict();
export function isGetLocalComponentsParams(input: unknown): input is GetLocalComponentsParams {
  try {
    GetLocalComponentsParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertGetLocalComponentsParams(input: unknown): asserts input is GetLocalComponentsParams {
  GetLocalComponentsParamsSchema.parse(input);
}

// Typed façade and schema for list_available_fonts
export interface ListAvailableFont { family: string; style: string; postScriptName?: string }
export interface ListAvailableFontsParams {
  family?: string | string[];
  style?: string | string[];
  query?: string;
  limit?: number;
  includePostScriptName?: boolean;
}
export type ListAvailableFontsResult = Array<ListAvailableFont>;
export const ListAvailableFontsParamsSchema = z
  .object({
    family: z.union([z.string(), z.array(z.string()).nonempty()]).optional(),
    style: z.union([z.string(), z.array(z.string()).nonempty()]).optional(),
    query: z.string().min(1).optional(),
    limit: z.number().int().min(1).optional(),
    includePostScriptName: z.boolean().optional(),
  })
  .strict();
export function isListAvailableFontsParams(input: unknown): input is ListAvailableFontsParams {
  try {
    ListAvailableFontsParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertListAvailableFontsParams(input: unknown): asserts input is ListAvailableFontsParams {
  ListAvailableFontsParamsSchema.parse(input);
}

// Typed façade and schema for get_styles
export type StyleKind = "paint" | "text" | "effect" | "grid";
export interface PaintStyleSummary { id: string; name: string; key: string | null; paints: any[] }
export interface TextStyleSummary { id: string; name: string; key: string | null; fontSize: number; fontName: any }
export interface EffectStyleSummary { id: string; name: string; key: string | null }
export interface GridStyleSummary { id: string; name: string; key: string | null }
export interface GetStylesResult {
  colors: PaintStyleSummary[];
  texts: TextStyleSummary[];
  effects: EffectStyleSummary[];
  grids: GridStyleSummary[];
}
export interface GetStylesParams {
  kinds?: StyleKind[];
  name?: string;
  caseSensitive?: boolean;
  includeAllPaints?: boolean;
  sortBy?: "name";
  sortDirection?: "asc" | "desc";
}
export const GetStylesParamsSchema = z.object({
  kinds: z.array(z.enum(["paint","text","effect","grid"]).readonly()).nonempty().optional(),
  name: z.string().min(1).optional(),
  caseSensitive: z.boolean().optional(),
  includeAllPaints: z.boolean().optional(),
  sortBy: z.literal("name").optional(),
  sortDirection: z.enum(["asc","desc"]).optional(),
}).strict();
export function isGetStylesParams(input: unknown): input is GetStylesParams {
  try {
    GetStylesParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertGetStylesParams(input: unknown): asserts input is GetStylesParams {
  GetStylesParamsSchema.parse(input);
}

// Typed façades and schemas for style creation
export type OnConflictMode = "error" | "skip" | "suffix";

export interface CreatePaintStyleParams { name: string; paints: any[]; onConflict?: OnConflictMode }
export interface CreateTextStyleParams { name: string; style: Record<string, any>; onConflict?: OnConflictMode }
export interface CreateEffectStyleParams { name: string; effects: any[]; onConflict?: OnConflictMode }
export interface CreateGridStyleParams { name: string; layoutGrids: any[]; onConflict?: OnConflictMode }

export interface CreateStyleResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  createdStyleId: string;
  name: string;
  type: "paint" | "text" | "effect" | "grid";
  skipped?: boolean;
}

export const CreatePaintStyleParamsSchema = z.object({
  name: z.string().min(1),
  paints: z.array(z.any()).nonempty(),
  onConflict: z.enum(["error","skip","suffix"]).optional(),
}).strict();
export const CreateTextStyleParamsSchema = z.object({
  name: z.string().min(1),
  style: z.record(z.any()),
  onConflict: z.enum(["error","skip","suffix"]).optional(),
}).strict();
export const CreateEffectStyleParamsSchema = z.object({
  name: z.string().min(1),
  effects: z.array(z.any()).nonempty(),
  onConflict: z.enum(["error","skip","suffix"]).optional(),
}).strict();
export const CreateGridStyleParamsSchema = z.object({
  name: z.string().min(1),
  layoutGrids: z.array(z.any()).nonempty(),
  onConflict: z.enum(["error","skip","suffix"]).optional(),
}).strict();
export function isCreatePaintStyleParams(input: unknown): input is CreatePaintStyleParams { try { CreatePaintStyleParamsSchema.parse(input); return true; } catch { return false; } }
export function assertCreatePaintStyleParams(input: unknown): asserts input is CreatePaintStyleParams { CreatePaintStyleParamsSchema.parse(input); }
export function isCreateTextStyleParams(input: unknown): input is CreateTextStyleParams { try { CreateTextStyleParamsSchema.parse(input); return true; } catch { return false; } }
export function assertCreateTextStyleParams(input: unknown): asserts input is CreateTextStyleParams { CreateTextStyleParamsSchema.parse(input); }
export function isCreateEffectStyleParams(input: unknown): input is CreateEffectStyleParams { try { CreateEffectStyleParamsSchema.parse(input); return true; } catch { return false; } }
export function assertCreateEffectStyleParams(input: unknown): asserts input is CreateEffectStyleParams { CreateEffectStyleParamsSchema.parse(input); }
export function isCreateGridStyleParams(input: unknown): input is CreateGridStyleParams { try { CreateGridStyleParamsSchema.parse(input); return true; } catch { return false; } }
export function assertCreateGridStyleParams(input: unknown): asserts input is CreateGridStyleParams { CreateGridStyleParamsSchema.parse(input); }

// Typed façade and schema for get_node_info
export interface GetNodeInfoParams { nodeId: string }
export interface FilteredTextStyle {
  fontFamily?: string;
  fontStyle?: string;
  fontWeight?: number;
  fontSize?: number;
  textAlignHorizontal?: string;
  letterSpacing?: number | string;
  lineHeightPx?: number;
}
export interface AbsoluteBoundingBox { x: number; y: number; width: number; height: number }
export interface FilteredNodeDocument {
  id: string;
  name: string;
  type: string;
  fills?: Array<any>;
  strokes?: Array<any>;
  cornerRadius?: number;
  absoluteBoundingBox?: AbsoluteBoundingBox;
  characters?: string;
  style?: FilteredTextStyle;
  children?: Array<FilteredNodeDocument> | null;
}
export type GetNodeInfoResult = FilteredNodeDocument | null;
export const GetNodeInfoParamsSchema = z.object({ nodeId: z.string() }).strict();
export function isGetNodeInfoParams(input: unknown): input is GetNodeInfoParams {
  try {
    GetNodeInfoParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertGetNodeInfoParams(input: unknown): asserts input is GetNodeInfoParams {
  GetNodeInfoParamsSchema.parse(input);
}

// Layout tools schemas and typed façades

// Typed façade and schema for set_layout_mode
export interface SetLayoutModeParams {
  nodeId: string;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  layoutWrap?: "NO_WRAP" | "WRAP";
}
export interface SetLayoutModeResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: { id: string; name: string; layoutMode: "NONE"|"HORIZONTAL"|"VERTICAL"|"GRID"; layoutWrap?: "NO_WRAP"|"WRAP" };
}
export const SetLayoutModeParamsSchema = z.object({
  nodeId: z.string().min(1),
  layoutMode: z.enum(["NONE","HORIZONTAL","VERTICAL","GRID"]).optional(),
  layoutWrap: z.enum(["NO_WRAP","WRAP"]).optional(),
}).strict();
export function isSetLayoutModeParams(input: unknown): input is SetLayoutModeParams { try { SetLayoutModeParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetLayoutModeParams(input: unknown): asserts input is SetLayoutModeParams { SetLayoutModeParamsSchema.parse(input); }

// Typed façade and schema for set_padding
export interface SetPaddingParams {
  nodeId: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}
export interface SetPaddingResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: { id: string; name: string; paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number };
}
export const SetPaddingParamsSchema = z.object({
  nodeId: z.string().min(1),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
}).strict().refine((d: SetPaddingParams) => [d.paddingTop,d.paddingRight,d.paddingBottom,d.paddingLeft].some(v => v !== undefined), {
  message: "At least one padding value must be provided"
});
export function isSetPaddingParams(input: unknown): input is SetPaddingParams { try { SetPaddingParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetPaddingParams(input: unknown): asserts input is SetPaddingParams { SetPaddingParamsSchema.parse(input); }

// Typed façade and schema for set_axis_align
export interface SetAxisAlignParams {
  nodeId: string;
  primaryAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "BASELINE";
}
export interface SetAxisAlignResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: { id: string; name: string; layoutMode: string; primaryAxisAlignItems?: string; counterAxisAlignItems?: string };
}
export const SetAxisAlignParamsSchema = z.object({
  nodeId: z.string().min(1),
  primaryAxisAlignItems: z.enum(["MIN","MAX","CENTER","SPACE_BETWEEN"]).optional(),
  counterAxisAlignItems: z.enum(["MIN","MAX","CENTER","BASELINE"]).optional(),
}).strict().refine((d: SetAxisAlignParams) => d.primaryAxisAlignItems !== undefined || d.counterAxisAlignItems !== undefined, {
  message: "Provide primaryAxisAlignItems and/or counterAxisAlignItems"
});
export function isSetAxisAlignParams(input: unknown): input is SetAxisAlignParams { try { SetAxisAlignParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetAxisAlignParams(input: unknown): asserts input is SetAxisAlignParams { SetAxisAlignParamsSchema.parse(input); }

// Typed façade and schema for set_layout_sizing
export interface SetLayoutSizingParams {
  nodeId: string;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}
export interface SetLayoutSizingResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: { id: string; name: string; layoutMode?: string; layoutSizingHorizontal?: string; layoutSizingVertical?: string };
}
export const SetLayoutSizingParamsSchema = z.object({
  nodeId: z.string().min(1),
  layoutSizingHorizontal: z.enum(["FIXED","HUG","FILL"]).optional(),
  layoutSizingVertical: z.enum(["FIXED","HUG","FILL"]).optional(),
}).strict().refine((d: SetLayoutSizingParams) => d.layoutSizingHorizontal !== undefined || d.layoutSizingVertical !== undefined, {
  message: "Provide layoutSizingHorizontal and/or layoutSizingVertical"
});
export function isSetLayoutSizingParams(input: unknown): input is SetLayoutSizingParams { try { SetLayoutSizingParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetLayoutSizingParams(input: unknown): asserts input is SetLayoutSizingParams { SetLayoutSizingParamsSchema.parse(input); }

// Typed façade and schema for set_item_spacing
export interface SetItemSpacingParams {
  nodeId: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
}
export interface SetItemSpacingResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: { id: string; name: string; layoutMode: string; layoutWrap?: string; itemSpacing?: number; counterAxisSpacing?: number };
}
export const SetItemSpacingParamsSchema = z.object({
  nodeId: z.string().min(1),
  itemSpacing: z.number().optional(),
  counterAxisSpacing: z.number().optional(),
}).strict().refine((d: SetItemSpacingParams) => d.itemSpacing !== undefined || d.counterAxisSpacing !== undefined, {
  message: "Provide itemSpacing and/or counterAxisSpacing"
});
export function isSetItemSpacingParams(input: unknown): input is SetItemSpacingParams { try { SetItemSpacingParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetItemSpacingParams(input: unknown): asserts input is SetItemSpacingParams { SetItemSpacingParamsSchema.parse(input); }

// Typed façade and schema for get_nodes_info
export interface GetNodesInfoParams { nodeIds: string[] }
export interface NodeInfoEntryError { code: string; message?: string }
export interface NodeInfoEntry { nodeId: string; document: FilteredNodeDocument | null; error?: NodeInfoEntryError }
export type GetNodesInfoResult = Array<NodeInfoEntry>
export const GetNodesInfoParamsSchema = z.object({ nodeIds: z.array(z.string()).nonempty() }).strict();
export function isGetNodesInfoParams(input: unknown): input is GetNodesInfoParams {
  try {
    GetNodesInfoParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertGetNodesInfoParams(input: unknown): asserts input is GetNodesInfoParams {
  GetNodesInfoParamsSchema.parse(input);
}

// Typed façade and schema for get_reactions
export interface GetReactionsParams { nodeIds: string[]; silent?: boolean }
export interface ReactionNode { id: string; name: string; type: string; depth: number; hasReactions: true; reactions: any[]; path: string }
export interface GetReactionsResult { nodesCount: number; nodesWithReactions: number; nodes: ReactionNode[] }
export const GetReactionsParamsSchema = z.object({ nodeIds: z.array(z.string()).nonempty(), silent: z.boolean().optional() }).strict();
export function isGetReactionsParams(input: unknown): input is GetReactionsParams {
  try {
    GetReactionsParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertGetReactionsParams(input: unknown): asserts input is GetReactionsParams {
  GetReactionsParamsSchema.parse(input);
}

// Typed façade and schema for read_my_design
export type ReadMyDesignParams = Record<string, never>;
export type ReadMyDesignResult = Array<NodeInfoEntry>;
export const ReadMyDesignParamsSchema = z.object({}).strict();
export function isReadMyDesignParams(input: unknown): input is ReadMyDesignParams {
  try {
    ReadMyDesignParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertReadMyDesignParams(input: unknown): asserts input is ReadMyDesignParams {
  ReadMyDesignParamsSchema.parse(input);
}

// Typed façade and schema for scan_text_nodes
export interface ScanTextNodeEntry {
  id: string;
  name: string;
  type: string; // "TEXT"
  characters?: string;
  fontSize: number;
  fontFamily?: string;
  fontStyle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  path: string;
  depth: number;
}
export interface ScanTextNodesParams {
  nodeId: string;
  useChunking?: boolean;
  chunkSize?: number;
  includeInvisible?: boolean;
  highlight?: boolean;
  maxDepth?: number;
  textFilter?: string;
  caseSensitive?: boolean;
  includeCharacters?: boolean;
}
export interface ScanTextNodesResult { nodesCount: number; textNodes: ScanTextNodeEntry[]; commandId: string }
export const ScanTextNodesParamsSchema = z.object({
  nodeId: z.string(),
  useChunking: z.boolean().optional(),
  chunkSize: z.number().positive().optional(),
  includeInvisible: z.boolean().optional(),
  highlight: z.boolean().optional(),
  maxDepth: z.number().int().min(0).optional(),
  textFilter: z.string().optional(),
  caseSensitive: z.boolean().optional(),
  includeCharacters: z.boolean().optional(),
}).strict();
export function isScanTextNodesParams(input: unknown): input is ScanTextNodesParams { try { ScanTextNodesParamsSchema.parse(input); return true; } catch { return false; } }
export function assertScanTextNodesParams(input: unknown): asserts input is ScanTextNodesParams { ScanTextNodesParamsSchema.parse(input); }

// Typed façade and schema for scan_nodes_by_types
export interface ScanNodesByTypesParams { nodeId: string; types: string[] }
export interface ScanNodesByTypesNodeBBox { x: number; y: number; width: number; height: number }
export interface ScanNodesByTypesNode { id: string; name: string; type: string; bbox: ScanNodesByTypesNodeBBox }
export interface ScanNodesByTypesResult { nodesCount: number; matchingNodes: ScanNodesByTypesNode[]; searchedTypes: string[]; commandId: string }
export const ScanNodesByTypesParamsSchema = z.object({ nodeId: z.string(), types: z.array(z.string()).nonempty() }).strict();
export function isScanNodesByTypesParams(input: unknown): input is ScanNodesByTypesParams { try { ScanNodesByTypesParamsSchema.parse(input); return true; } catch { return false; } }
export function assertScanNodesByTypesParams(input: unknown): asserts input is ScanNodesByTypesParams { ScanNodesByTypesParamsSchema.parse(input); }

// Typed façade and schema for set_multiple_text_contents
export interface SetMultipleTextReplacement { nodeId: string; text: string }
export interface SetMultipleTextContentsParams {
  nodeId: string;
  text: SetMultipleTextReplacement[];
  smartStrategy?: "prevail" | "strict" | "experimental";
  fallbackFont?: { family: string; style: string };
  select?: boolean;
  chunkSize?: number;
  delayMsBetweenChunks?: number;
  highlight?: boolean;
  skipLocked?: boolean;
  stopOnFailure?: boolean;
  ignoreMissing?: boolean;
  previewOnly?: boolean;
}
export interface SetMultipleTextContentsResultEntry {
  success: boolean;
  nodeId: string;
  originalText?: string;
  translatedText?: string;
  errorCode?: string;
  errorMessage?: string;
  preview?: boolean;
}
export interface SetMultipleTextContentsResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  nodeId: string;
  replacementsApplied: number;
  replacementsFailed: number;
  totalReplacements: number;
  results: SetMultipleTextContentsResultEntry[];
  completedInChunks: number;
  stoppedEarly?: boolean;
  preview?: boolean;
  commandId: string;
}
export const SetMultipleTextReplacementSchema = z.object({ nodeId: z.string(), text: z.string() }).strict();
export const SetMultipleTextContentsParamsSchema = z.object({
  nodeId: z.string(),
  text: z.array(SetMultipleTextReplacementSchema),
  smartStrategy: z.enum(["prevail","strict","experimental"]).optional(),
  fallbackFont: z.object({ family: z.string(), style: z.string() }).strict().optional(),
  select: z.boolean().optional(),
  chunkSize: z.number().int().min(1).max(50).optional(),
  delayMsBetweenChunks: z.number().int().min(0).optional(),
  highlight: z.boolean().optional(),
  skipLocked: z.boolean().optional(),
  stopOnFailure: z.boolean().optional(),
  ignoreMissing: z.boolean().optional(),
  previewOnly: z.boolean().optional(),
}).strict();
export function isSetMultipleTextContentsParams(input: unknown): input is SetMultipleTextContentsParams { try { SetMultipleTextContentsParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetMultipleTextContentsParams(input: unknown): asserts input is SetMultipleTextContentsParams { SetMultipleTextContentsParamsSchema.parse(input); }

// Typed façade and schema for set_range_text_style
export interface SetRangeTextStyleParams { nodeId: string; start: number; end: number; textStyleId: string; autoClamp?: boolean }
export interface SetRangeTextStyleResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  nodeId: string;
  start: number;
  end: number;
  textStyleId: string;
  clamped?: boolean;
  originalStart?: number;
  originalEnd?: number;
}
export const SetRangeTextStyleParamsSchema = z.object({
  nodeId: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  textStyleId: z.string(),
  autoClamp: z.boolean().optional(),
}).strict();
export function isSetRangeTextStyleParams(input: unknown): input is SetRangeTextStyleParams {
  try {
    SetRangeTextStyleParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertSetRangeTextStyleParams(input: unknown): asserts input is SetRangeTextStyleParams {
  SetRangeTextStyleParamsSchema.parse(input);
}

// Typed façade and schema for set_text_content
export interface SetTextContentParams {
  nodeId: string;
  text: string;
  smartStrategy?: "prevail" | "strict" | "experimental";
  fallbackFont?: { family: string; style: string };
  select?: boolean;
}
export interface SetTextContentResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  nodeId: string;
  name: string;
  characters: string;
  fontName: any;
  smartStrategy?: string | null;
}
export const SetTextContentParamsSchema = z
  .object({
    nodeId: z.string(),
    text: z.string(),
    smartStrategy: z.enum(["prevail","strict","experimental"]).optional(),
    fallbackFont: z.object({ family: z.string(), style: z.string() }).strict().optional(),
    select: z.boolean().optional(),
  })
  .strict();
export function isSetTextContentParams(input: unknown): input is SetTextContentParams {
  try { SetTextContentParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertSetTextContentParams(input: unknown): asserts input is SetTextContentParams {
  SetTextContentParamsSchema.parse(input);
}

// Typed façade and schema for create_text
export interface CreateTextParams {
  x?: number;
  y?: number;
  text?: string;
  fontSize?: number;
  fontWeight?: number; // 100..900
  fontColor?: RGBA;
  name?: string;
  parentId?: string;
}
export interface CreateTextResultNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  characters: string;
  fontSize: number;
  fontWeight: number;
  fontName: any; // FontName | 'MIXED'
  fills: any[];
  parentId?: string;
}
export interface CreateTextResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: CreateTextResultNode;
}
export const CreateTextParamsSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  fontColor: RGBASchema.optional(),
  name: z.string().optional(),
  parentId: z.string().optional(),
}).strict();
export function isCreateTextParams(input: unknown): input is CreateTextParams {
  try {
    CreateTextParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertCreateTextParams(input: unknown): asserts input is CreateTextParams {
  CreateTextParamsSchema.parse(input);
}

// Typed façade and schema for create_frame
export type LayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";
export type LayoutWrap = "NO_WRAP" | "WRAP";
export type PrimaryAxisAlignItems = "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
export type CounterAxisAlignItems = "MIN" | "MAX" | "CENTER" | "BASELINE";
export type LayoutSizing = "FIXED" | "HUG" | "FILL";

// Typed façade and schema for create_rectangle
export interface RGBA { r: number; g: number; b: number; a?: number }
export interface ConstraintsKV { horizontal: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE"; vertical: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE" }
export interface CreateRectangleParams {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  parentId?: string;
  fill?: RGBA;
  stroke?: RGBA;
  strokeWeight?: number;
  strokeAlign?: "CENTER" | "INSIDE" | "OUTSIDE";
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  layoutAlign?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
  constraints?: ConstraintsKV;
  select?: boolean;
}
export interface CreateRectangleResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: { id: string; name: string; x: number; y: number; width: number; height: number; parentId?: string };
}
export const CreateRectangleParamsSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  name: z.string().optional(),
  parentId: z.string().optional(),
  fill: RGBASchema.optional(),
  stroke: RGBASchema.optional(),
  strokeWeight: z.number().min(0).optional(),
  strokeAlign: z.enum(["CENTER", "INSIDE", "OUTSIDE"]).optional(),
  cornerRadius: z.number().min(0).optional(),
  topLeftRadius: z.number().min(0).optional(),
  topRightRadius: z.number().min(0).optional(),
  bottomLeftRadius: z.number().min(0).optional(),
  bottomRightRadius: z.number().min(0).optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  layoutAlign: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"]).optional(),
  constraints: z.object({ horizontal: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]), vertical: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]) }).strict().optional(),
  select: z.boolean().optional(),
}).strict();
export function isCreateRectangleParams(input: unknown): input is CreateRectangleParams {
  try {
    CreateRectangleParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertCreateRectangleParams(input: unknown): asserts input is CreateRectangleParams {
  CreateRectangleParamsSchema.parse(input);
}

// Typed façade and schema for create_frame
export interface CreateFrameParams {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  parentId?: string;
  fillColor?: RGBA;
  strokeColor?: RGBA;
  strokeWeight?: number;
  layoutMode?: LayoutMode;
  layoutWrap?: LayoutWrap;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  layoutSizingHorizontal?: LayoutSizing;
  layoutSizingVertical?: LayoutSizing;
  itemSpacing?: number;
}
export interface CreatedFrameNodeSummary {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: any[];
  strokes?: any[];
  strokeWeight?: number;
  layoutMode?: string;
  layoutWrap?: string;
  parentId?: string;
}
export interface CreateFrameResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: CreatedFrameNodeSummary;
}
export const CreateFrameParamsSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  name: z.string().optional(),
  parentId: z.string().optional(),
  fillColor: RGBASchema.optional(),
  strokeColor: RGBASchema.optional(),
  strokeWeight: z.number().optional(),
  layoutMode: z.enum(["NONE","HORIZONTAL","VERTICAL"]).optional(),
  layoutWrap: z.enum(["NO_WRAP","WRAP"]).optional(),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
  primaryAxisAlignItems: z.enum(["MIN","MAX","CENTER","SPACE_BETWEEN"]).optional(),
  counterAxisAlignItems: z.enum(["MIN","MAX","CENTER","BASELINE"]).optional(),
  layoutSizingHorizontal: z.enum(["FIXED","HUG","FILL"]).optional(),
  layoutSizingVertical: z.enum(["FIXED","HUG","FILL"]).optional(),
  itemSpacing: z.number().optional(),
}).strict();
export function isCreateFrameParams(input: unknown): input is CreateFrameParams {
  try {
    CreateFrameParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertCreateFrameParams(input: unknown): asserts input is CreateFrameParams {
  CreateFrameParamsSchema.parse(input);
}

// Typed façade and schema for create_component_instance
export interface CreateComponentInstanceParams {
  componentKey: string;
  x?: number;
  y?: number;
  parentId?: string;
}
export interface CreateComponentInstanceResultNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  componentId: string;
  parentId?: string;
}
export interface CreateComponentInstanceResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: CreateComponentInstanceResultNode;
}
export const CreateComponentInstanceParamsSchema = z.object({
  componentKey: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  parentId: z.string().optional(),
}).strict();
export function isCreateComponentInstanceParams(input: unknown): input is CreateComponentInstanceParams {
  try { CreateComponentInstanceParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertCreateComponentInstanceParams(input: unknown): asserts input is CreateComponentInstanceParams {
  CreateComponentInstanceParamsSchema.parse(input);
}

// Typed façade and schema for create_component
export interface CreateComponentParams { nodeId: string }
export interface CreateComponentResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  componentId: string;
  instanceId: string;
  name: string;
}
export const CreateComponentParamsSchema = z.object({ nodeId: z.string() }).strict();
export function isCreateComponentParams(input: unknown): input is CreateComponentParams {
  try { CreateComponentParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertCreateComponentParams(input: unknown): asserts input is CreateComponentParams {
  CreateComponentParamsSchema.parse(input);
}

// Typed façade and schema for publish_components
export interface PublishComponentsParams {
  description?: string;
  cancelIfNoChanges?: boolean;
  timeoutMs?: number;
  includeComponents?: boolean;
  includeComponentSets?: boolean;
  includeStylesPaint?: boolean;
  includeStylesText?: boolean;
  includeStylesEffect?: boolean;
  includeStylesGrid?: boolean;
}
export interface PublishComponentsResultCounts { components: number; componentSets: number; styles: number }
export interface PublishComponentsResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  publishedComponentIds: string[];
  publishedComponentSetIds: string[];
  publishedStyleIds: string[];
  counts: PublishComponentsResultCounts;
}
export const PublishComponentsParamsSchema = z.object({
  description: z.string().optional(),
  cancelIfNoChanges: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).optional(),
  includeComponents: z.boolean().optional(),
  includeComponentSets: z.boolean().optional(),
  includeStylesPaint: z.boolean().optional(),
  includeStylesText: z.boolean().optional(),
  includeStylesEffect: z.boolean().optional(),
  includeStylesGrid: z.boolean().optional(),
}).strict();
export function isPublishComponentsParams(input: unknown): input is PublishComponentsParams {
  try { PublishComponentsParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertPublishComponentsParams(input: unknown): asserts input is PublishComponentsParams {
  PublishComponentsParamsSchema.parse(input);
}

// Typed façade and schema for get_instance_overrides
export interface GetInstanceOverridesParams { instanceNodeId?: string }
export const GetInstanceOverridesParamsSchema = z.object({ instanceNodeId: z.string().optional() }).strict();
export function isGetInstanceOverridesParams(input: unknown): input is GetInstanceOverridesParams { try { GetInstanceOverridesParamsSchema.parse(input); return true; } catch { return false; } }
export function assertGetInstanceOverridesParams(input: unknown): asserts input is GetInstanceOverridesParams { GetInstanceOverridesParamsSchema.parse(input); }

// Typed façade and schema for set_instance_overrides
export interface SetInstanceOverridesParams {
  targetNodeIds: string[];
  sourceInstanceId: string;
  swapComponent?: boolean;
  includeFields?: string[];
  excludeFields?: string[];
  previewOnly?: boolean;
  stopOnFirstError?: boolean;
}
export interface SetInstanceOverridesResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  sourceInstanceId: string;
  mainComponentId: string;
  targetInstanceIds: string[];
  totalOverridesApplied: number;
  results: Array<{ success: boolean; instanceId: string; instanceName: string; appliedCount?: number; message?: string; code?: string }>;
  preview?: boolean;
}
export const SetInstanceOverridesParamsSchema = z.object({
  targetNodeIds: z.array(z.string()).nonempty(),
  sourceInstanceId: z.string(),
  swapComponent: z.boolean().optional(),
  includeFields: z.array(z.string()).nonempty().optional(),
  excludeFields: z.array(z.string()).nonempty().optional(),
  previewOnly: z.boolean().optional(),
  stopOnFirstError: z.boolean().optional(),
}).strict();
export function isSetInstanceOverridesParams(input: unknown): input is SetInstanceOverridesParams { try { SetInstanceOverridesParamsSchema.parse(input); return true; } catch { return false; } }
export function assertSetInstanceOverridesParams(input: unknown): asserts input is SetInstanceOverridesParams { SetInstanceOverridesParamsSchema.parse(input); }

// Typed façade and schema for set_fill_color
export interface SetFillColorParams {
  nodeId?: string;
  nodeIds?: string[];
  color?: RGBA;
  styleId?: string;
  replace?: boolean;
}
export interface SetFillColorResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  mode: "color" | "style";
  replaced: boolean;
}
export const SetFillColorParamsSchema = z
  .object({
    nodeId: z.string().optional(),
    nodeIds: z.array(z.string()).nonempty().optional(),
    color: RGBASchema.optional(),
    styleId: z.string().optional(),
    replace: z.boolean().optional(),
  })
  .strict()
  .refine(
    (val: any) => (!!val.nodeId || !!val.nodeIds) && (!!val.color || typeof val.styleId === "string"),
    { message: "Must provide nodeId or nodeIds, and either color or styleId" }
  );
export function isSetFillColorParams(input: unknown): input is SetFillColorParams {
  try {
    SetFillColorParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertSetFillColorParams(input: unknown): asserts input is SetFillColorParams {
  SetFillColorParamsSchema.parse(input);
}

// Typed façade and schema for set_stroke_color
export interface SetStrokeColorParams {
  nodeId: string;
  color: RGBA;
  weight?: number;
}
export interface SetStrokeColorResultNode {
  id: string;
  name: string;
  strokes: any[];
  strokeWeight?: number;
}
export interface SetStrokeColorResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: SetStrokeColorResultNode;
}
export const SetStrokeColorParamsSchema = z
  .object({ nodeId: z.string(), color: RGBASchema, weight: z.number().min(0).optional() })
  .strict();
export function isSetStrokeColorParams(input: unknown): input is SetStrokeColorParams {
  try {
    SetStrokeColorParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertSetStrokeColorParams(input: unknown): asserts input is SetStrokeColorParams {
  SetStrokeColorParamsSchema.parse(input);
}

// Typed façade and schema for set_corner_radius
export interface SetCornerRadiusParams {
  nodeId: string;
  radius: number;
  corners?: [boolean, boolean, boolean, boolean];
}
export interface SetCornerRadiusResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  id: string;
  name: string;
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
}
export const SetCornerRadiusParamsSchema = z
  .object({
    nodeId: z.string(),
    radius: z.number().min(0),
    corners: z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean()]).optional()
  })
  .strict();
export function isSetCornerRadiusParams(input: unknown): input is SetCornerRadiusParams {
  try {
    SetCornerRadiusParamsSchema.parse(input);
    return true;
  } catch {
    return false;
  }
}
export function assertSetCornerRadiusParams(input: unknown): asserts input is SetCornerRadiusParams {
  SetCornerRadiusParamsSchema.parse(input);
}

// Typed façade and schema for set_gradient_fill
export interface GradientStop { position: number; color: RGBA }
export type GradientType = "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
export interface GradientPaint {
  type: GradientType;
  gradientStops: GradientStop[];
  gradientTransform: [[number, number, number], [number, number, number]];
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}
export interface SetGradientFillParams { nodeId: string; gradient: GradientPaint }
export interface SetGradientFillResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  nodeId: string;
  fills: any[];
  gradientType: GradientType;
}
export const SetGradientFillParamsSchema = z
  .object({
    nodeId: z.string(),
    gradient: z.object({
      type: GradientTypeSchema,
      gradientStops: z.array(GradientStopSchema).min(2),
      gradientTransform: GradientTransformSchema,
      opacity: z.number().min(0).max(1).optional(),
      visible: z.boolean().optional(),
      blendMode: z.string().optional(),
    }).strict(),
  })
  .strict();
export function isSetGradientFillParams(input: unknown): input is SetGradientFillParams {
  try { SetGradientFillParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertSetGradientFillParams(input: unknown): asserts input is SetGradientFillParams {
  SetGradientFillParamsSchema.parse(input);
}

// Typed façade and schema for move_node
export interface MoveNodeParams { nodeId: string; x: number; y: number }
export interface MoveNodeResultNode { id: string; name: string; x: number; y: number }
export interface MoveNodeResult { success: true; summary: string; modifiedNodeIds: string[]; node: MoveNodeResultNode }
export const MoveNodeParamsSchema = z.object({ nodeId: z.string(), x: z.number(), y: z.number() }).strict();
export function isMoveNodeParams(input: unknown): input is MoveNodeParams {
  try { MoveNodeParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertMoveNodeParams(input: unknown): asserts input is MoveNodeParams {
  MoveNodeParamsSchema.parse(input);
}

// Typed façade and schema for resize_node
export interface ResizeNodeParams { nodeId: string; width: number; height: number }
export interface ResizeNodeResultNode { id: string; name: string; width: number; height: number }
export interface ResizeNodeResult { success: true; summary: string; modifiedNodeIds: string[]; node: ResizeNodeResultNode }
export const ResizeNodeParamsSchema = z.object({ nodeId: z.string(), width: z.number(), height: z.number() }).strict();
export function isResizeNodeParams(input: unknown): input is ResizeNodeParams {
  try { ResizeNodeParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertResizeNodeParams(input: unknown): asserts input is ResizeNodeParams {
  ResizeNodeParamsSchema.parse(input);
}

// Typed façade and schema for clone_node
export interface CloneNodeParams {
  nodeId: string;
  x?: number;
  y?: number;
  offsetX?: number;
  offsetY?: number;
  parentId?: string;
  insertIndex?: number;
  select?: boolean;
  name?: string;
  locked?: boolean;
  visible?: boolean;
}
export interface CloneNodeResultNode {
  id: string;
  name: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentId?: string;
}
export interface CloneNodeResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  node: CloneNodeResultNode;
  originalNodeId: string;
  parentId?: string;
}
export const CloneNodeParamsSchema = z.object({
  nodeId: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  parentId: z.string().optional(),
  insertIndex: z.number().int().min(0).optional(),
  select: z.boolean().optional(),
  name: z.string().optional(),
  locked: z.boolean().optional(),
  visible: z.boolean().optional(),
}).strict();
export function isCloneNodeParams(input: unknown): input is CloneNodeParams {
  try { CloneNodeParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertCloneNodeParams(input: unknown): asserts input is CloneNodeParams {
  CloneNodeParamsSchema.parse(input);
}

// Typed façade and schema for delete_node
export interface DeleteNodeParams { nodeId: string; force?: boolean; selectParent?: boolean }
export interface DeleteNodeResultNode { id: string; name: string; type: string }
export interface DeleteNodeResult { success: true; summary: string; modifiedNodeIds: string[]; node: DeleteNodeResultNode; parentId?: string }
export const DeleteNodeParamsSchema = z.object({ nodeId: z.string(), force: z.boolean().optional(), selectParent: z.boolean().optional() }).strict();
export function isDeleteNodeParams(input: unknown): input is DeleteNodeParams {
  try { DeleteNodeParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertDeleteNodeParams(input: unknown): asserts input is DeleteNodeParams {
  DeleteNodeParamsSchema.parse(input);
}

// Typed façade and schema for delete_multiple_nodes
export interface DeleteMultipleNodesParams {
  nodeIds: string[];
  chunkSize?: number;
  delayMsBetweenChunks?: number;
  skipLocked?: boolean;
  stopOnFailure?: boolean;
  previewOnly?: boolean;
}
export interface DeleteMultipleNodesResultItem {
  success: boolean;
  nodeId: string;
  nodeInfo?: { id: string; name: string; type: string };
  error?: string;
  code?: string;
  preview?: boolean;
  wouldDelete?: boolean;
}
export interface DeleteMultipleNodesResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  nodesDeleted: number;
  nodesFailed: number;
  totalNodes: number;
  results: DeleteMultipleNodesResultItem[];
  completedInChunks: number;
  stoppedEarly?: boolean;
  preview?: boolean;
  commandId: string;
}
export const DeleteMultipleNodesParamsSchema = z.object({
  nodeIds: z.array(z.string()).min(1),
  chunkSize: z.number().int().min(1).max(50).optional(),
  delayMsBetweenChunks: z.number().int().min(0).optional(),
  skipLocked: z.boolean().optional(),
  stopOnFailure: z.boolean().optional(),
  previewOnly: z.boolean().optional(),
}).strict();
export function isDeleteMultipleNodesParams(input: unknown): input is DeleteMultipleNodesParams {
  try { DeleteMultipleNodesParamsSchema.parse(input); return true; } catch { return false; }
}
export function assertDeleteMultipleNodesParams(input: unknown): asserts input is DeleteMultipleNodesParams {
  DeleteMultipleNodesParamsSchema.parse(input);
}

// Grouping / parenting schemas and typed façades
export interface GroupParams { nodeIds: string[]; parentId?: string; name?: string; index?: number }
export interface GroupResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  groupId: string;
  name: string;
  parentId: string;
  index: number;
  children: string[];
}
export const GroupParamsSchema = z.object({
  nodeIds: z.array(z.string()).nonempty(),
  parentId: z.string().optional(),
  name: z.string().optional(),
  index: z.number().int().min(0).optional(),
}).strict();
export function isGroupParams(input: unknown): input is GroupParams { try { GroupParamsSchema.parse(input); return true; } catch { return false; } }
export function assertGroupParams(input: unknown): asserts input is GroupParams { GroupParamsSchema.parse(input); }

export interface UngroupParams { nodeId: string }
export interface UngroupResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  childrenIds: string[];
  parentId: string;
  removedGroupId: string;
}
export const UngroupParamsSchema = z.object({ nodeId: z.string() }).strict();
export function isUngroupParams(input: unknown): input is UngroupParams { try { UngroupParamsSchema.parse(input); return true; } catch { return false; } }
export function assertUngroupParams(input: unknown): asserts input is UngroupParams { UngroupParamsSchema.parse(input); }

export interface ReparentParams { nodeIds: string[]; newParentId: string; index?: number }
export interface ReparentResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  parentId: string;
  insertIndex?: number;
  movedNodeIds: string[];
  unresolvedNodeIds?: string[];
}
export const ReparentParamsSchema = z.object({
  nodeIds: z.array(z.string()).nonempty(),
  newParentId: z.string(),
  index: z.number().int().min(0).optional(),
}).strict();
export function isReparentParams(input: unknown): input is ReparentParams { try { ReparentParamsSchema.parse(input); return true; } catch { return false; } }
export function assertReparentParams(input: unknown): asserts input is ReparentParams { ReparentParamsSchema.parse(input); }

export interface InsertChildParams { parentId: string; childId: string; index: number }
export interface InsertChildResult {
  success: true;
  summary: string;
  modifiedNodeIds: string[];
  parentId: string;
  childId: string;
  index: number;
}
export const InsertChildParamsSchema = z.object({
  parentId: z.string(),
  childId: z.string(),
  index: z.number().int().min(0),
}).strict();
export function isInsertChildParams(input: unknown): input is InsertChildParams { try { InsertChildParamsSchema.parse(input); return true; } catch { return false; } }
export function assertInsertChildParams(input: unknown): asserts input is InsertChildParams { InsertChildParamsSchema.parse(input); }

const PORT = 3055;

// Channel management
interface ChannelMembers {
  plugin?: ServerWebSocket<unknown>;
  agent?: ServerWebSocket<unknown>;
}

const channels = new Map<string, ChannelMembers>();


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
  error?: string;
}
// Progress updates from plugin UI to be forwarded to agent
interface ProgressUpdateMessage {
  type: "progress_update";
  id?: string;
  channel?: string;
  message?: any;
}

type Message = JoinMessage | NewChatMessage | UserPromptMessage | AgentResponseMessage | AgentResponseChunkMessage | SystemMessage | ErrorMessage | PingMessage | PongMessage | ToolCallMessage | ToolResponseMessage | ProgressUpdateMessage;

function log(level: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [bridge] [${level}] ${message}`, data ? JSON.stringify(data) : "");
}

function sendMessage(ws: ServerWebSocket<unknown>, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

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
      if (!(typeof data.id === "string" && typeof data.command === "string" && data.params !== undefined)) {
        return false;
      }
      // Per-command params validation
      if (data.command === "get_document_info") {
        try {
          GetDocumentInfoParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_document_info", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_selection") {
        try {
          GetSelectionParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_selection", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_node_info") {
        try {
          GetNodeInfoParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_node_info", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_nodes_info") {
        try {
          GetNodesInfoParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_nodes_info", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "scan_text_nodes") {
        try {
          ScanTextNodesParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for scan_text_nodes", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "scan_nodes_by_types") {
        try {
          ScanNodesByTypesParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for scan_nodes_by_types", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_multiple_text_contents") {
        try {
          SetMultipleTextContentsParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_multiple_text_contents", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_local_components") {
        try {
          GetLocalComponentsParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_local_components", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "list_available_fonts") {
        try {
          ListAvailableFontsParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for list_available_fonts", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_styles") {
        try {
          GetStylesParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_styles", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_reactions") {
        try {
          GetReactionsParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_reactions", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "read_my_design") {
        try {
          ReadMyDesignParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for read_my_design", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_rectangle") {
        try {
          CreateRectangleParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_rectangle", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_text") {
        try {
          CreateTextParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_text", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_text_content") {
        try {
          SetTextContentParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_text_content", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_frame") {
        try {
          CreateFrameParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_frame", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_component_instance") {
        try {
          CreateComponentInstanceParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_component_instance", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_fill_color") {
        try {
          SetFillColorParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_fill_color", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_stroke_color") {
        try {
          SetStrokeColorParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_stroke_color", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_corner_radius") {
        try {
          SetCornerRadiusParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_corner_radius", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_gradient_fill") {
        try {
          SetGradientFillParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_gradient_fill", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "move_node") {
        try {
          MoveNodeParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for move_node", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "resize_node") {
        try {
          ResizeNodeParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for resize_node", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_component") {
        try {
          CreateComponentParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_component", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "publish_components") {
        try {
          PublishComponentsParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for publish_components", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_instance_overrides") {
        try {
          GetInstanceOverridesParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_instance_overrides", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "set_instance_overrides") {
        try {
          SetInstanceOverridesParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for set_instance_overrides", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "delete_multiple_nodes") {
        try {
          DeleteMultipleNodesParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for delete_multiple_nodes", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "group") {
        try {
          GroupParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for group", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "ungroup") {
        try {
          UngroupParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for ungroup", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "reparent") {
        try {
          ReparentParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for reparent", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "insert_child") {
        try {
          InsertChildParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for insert_child", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "zoom") {
        try {
          ZoomParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for zoom", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "center") {
        try {
          CenterParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for center", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "scroll_and_zoom_into_view") {
        try {
          ScrollAndZoomIntoViewParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for scroll_and_zoom_into_view", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "get_comments") {
        try {
          GetCommentsParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for get_comments", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_paint_style") {
        try {
          CreatePaintStyleParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_paint_style", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_text_style") {
        try {
          CreateTextStyleParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_text_style", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_effect_style") {
        try {
          CreateEffectStyleParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_effect_style", { error: (e as Error).message });
          return false;
        }
      } else if (data.command === "create_grid_style") {
        try {
          CreateGridStyleParamsSchema.parse(data.params);
        } catch (e) {
          log("warn", "Invalid params for create_grid_style", { error: (e as Error).message });
          return false;
        }
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
  // Find which channel this socket belongs to
  let senderRole: "plugin" | "agent" | null = null;
  let senderChannel: string | null = null;
  
  for (const [channelId, members] of channels.entries()) {
    if (members.plugin === ws) {
      senderRole = "plugin";
      senderChannel = channelId;
      break;
    }
    if (members.agent === ws) {
      senderRole = "agent";
      senderChannel = channelId;
      break;
    }
  }
  
  if (!senderRole || !senderChannel) {
    const errorMsg: ErrorMessage = {
      type: "error",
      message: "Socket not joined to any channel"
    };
    sendMessage(ws, errorMsg);
    log("warn", "Message from non-joined socket");
    return;
  }
  
  const channelMembers = channels.get(senderChannel);
  if (!channelMembers) {
    log("error", "Channel not found", { channel: senderChannel });
    return;
  }
  
  // Forward to the other role in the same channel
  const targetRole = senderRole === "plugin" ? "agent" : "plugin";
  const targetSocket = channelMembers[targetRole];
  
  if (targetSocket) {
    sendMessage(targetSocket, message);
    log("info", "Message forwarded", { 
      from: senderRole, 
      to: targetRole, 
      channel: senderChannel,
      type: message.type,
      id: (message as any).id || "no-id"
    });
  } else {
    log("warn", "No target socket for message", { 
      senderRole, 
      targetRole, 
      channel: senderChannel 
    });
  }
}

// (Idle channel cleanup removed)

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
    
    if (disconnectedRole) {
      log("info", "Socket disconnected", { role: disconnectedRole, channel: channelId });
      
      // Notify the remaining participant
      const remainingRole = disconnectedRole === "plugin" ? "agent" : "plugin";
      const remainingSocket = members[remainingRole];
      if (remainingSocket) {
        const leaveMessage = {
          type: "system",
          message: `The ${disconnectedRole} has disconnected`,
          channel: channelId
        };
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
}

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
