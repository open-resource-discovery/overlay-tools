export { applyOverlayToDocument } from "./merge/merge";
export { applyOverlayToEdmxDocument } from "./merge/edmx";
export { resolveSelector } from "./merge/selectors";
export type { NodeReference } from "./merge/selectors";
export {
	type ApplyOverlayOptions,
	type JSONValue,
	type JSONObject,
	type JSONArray,
	type JSONPrimitive,
	type OverlayMergeContext,
	OverlayMergeError,
	isJSONObject,
	cloneJSONValue,
	matchesOverlayTarget,
} from "./merge/types";
export {
	validateOverlayInput,
	validateOverlaySchema,
	validateOverlaySemantics,
	validateTargetDocumentForDefinitionType,
	emitOverlayValidationWarnings,
	throwOnOverlayValidationErrors,
	formatOverlayValidationErrors,
	validateOverlay,
	validateOverlayWithTarget,
	validateOverlayWithEdmxTarget,
	type OverlayValidationIssue,
	type OverlayValidationResult,
	type OverlayFullValidationResult,
	type PatchValidationSummary,
	type ValidateOverlayOptions,
	type ValidateOverlayWithTargetOptions,
} from "./merge/validation";

export {
	convertOpenApiOverlayToOrd,
	convertODataV2EnrichmentToOrd,
	convertODataV4EnrichmentToOrd,
} from "./convert/index";
export type {
	ConversionResult,
	ConversionWarning,
	ConversionWarningType,
	ConvertOptions,
	ODataV2Enrichment,
	ODataV4Enrichment,
	OpenApiOverlay,
} from "./convert/types";

// Re-export ORD Overlay spec types for consumers
// TODO: Replace with re-export from @open-resource-discovery/specification once published
export type * from "./spec";
