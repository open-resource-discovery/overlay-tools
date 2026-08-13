/*
 * Validation coverage in this module:
 * - JSON Schema validation for ORD Overlay input via OrdOverlay.schema.json
 * - semantic validation for documented MUST and SHOULD requirements
 * - selector validation against known definitionType support
 * - basic target-document shape validation for supported JSON-based formats
 *
 * Current gaps / known limitations:
 * - target-format validation is heuristic and not a full spec validator for OpenAPI, AsyncAPI, etc.
 * - YAML parsing/serialization is handled outside this module and is not supported by the current CLI flow
 * - no remote resolution, dereferencing, or validation of target.url contents
 */
import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { ordOverlaySchema } from "../spec";
import type { ORDOverlay } from "../spec";
import {
	cloneJSONValue,
	isJSONObject,
	type JSONValue,
	type OverlayMergeContext,
	OverlayMergeError,
} from "./types";
import {
	isOpenApiDefinitionType,
	isSpecificationId,
	resolveSelector,
	type NodeReference,
} from "./selectors";
import { applyOverlayToEdmxDocument } from "./edmx";

const jsonpath = require("jsonpath") as {
	nodes: (
		input: unknown,
		expression: string,
	) => Array<{ path: Array<string | number>; value: unknown }>;
};
export interface OverlayValidationIssue {
	level: "error" | "warning";
	path: string;
	message: string;
}

export interface OverlayValidationResult {
	errors: OverlayValidationIssue[];
	warnings: OverlayValidationIssue[];
}

interface ValidateOverlaySemanticsOptions {
	context?: OverlayMergeContext | undefined;
}

const KNOWN_NON_JSON_OR_YAML_DEFINITION_TYPES = new Set([
	"edmx",
	"graphql-sdl",
	"wsdl-v1",
	"wsdl-v2",
]);
const ajv = new Ajv({
	allErrors: true,
	allowUnionTypes: true,
	strict: false,
});

addFormats(ajv);

const validateOverlaySchemaWithAjv = ajv.compile(
	ordOverlaySchema as unknown as Record<string, unknown>,
);

export function validateOverlayInput(
	input: unknown,
	options: ValidateOverlaySemanticsOptions = {},
): OverlayValidationResult {
	const errors = validateOverlaySchema(input);
	if (errors.length > 0) {
		return { errors, warnings: [] };
	}

	return validateOverlaySemantics(input as ORDOverlay, options);
}

export function validateOverlaySchema(
	input: unknown,
): OverlayValidationIssue[] {
	if (validateOverlaySchemaWithAjv(input)) {
		return [];
	}

	return (validateOverlaySchemaWithAjv.errors ?? []).map((error) =>
		createIssue(
			"error",
			toDisplayPath(error.instancePath),
			formatAjvError(error),
		),
	);
}

export function validateOverlaySemantics(
	overlay: ORDOverlay,
	options: ValidateOverlaySemanticsOptions = {},
): OverlayValidationResult {
	const errors: OverlayValidationIssue[] = [];
	const warnings: OverlayValidationIssue[] = [];
	const definitionType = resolveDefinitionType(overlay, options.context);

	if (
		overlay.target !== undefined &&
		overlay.target.ordId === undefined &&
		overlay.target.url === undefined &&
		overlay.target.correlationIds === undefined &&
		overlay.target.definitionType === undefined
	) {
		errors.push(
			createIssue(
				"error",
				"$.target",
				"target MUST contain at least one of ordId, url, correlationIds, or definitionType when present.",
			),
		);
	}

	if (overlay.target?.definitionType === "custom") {
		errors.push(
			createIssue(
				"error",
				"$.target.definitionType",
				'target.definitionType MUST NOT use the deprecated literal "custom". Use a concrete Specification ID instead.',
			),
		);
	}

	// TODO: ordId selector temporarily removed from spec — when restored, replace `true` with:
	// overlay.patches.some((patch) => getSelectorKind(patch.selector) !== "ordId")
	const hasMetadataDefinitionSelectors = overlay.patches.length > 0;
	if (
		hasMetadataDefinitionSelectors &&
		overlay.target?.definitionType === undefined &&
		options.context?.definitionType === undefined
	) {
		warnings.push(
			createIssue(
				"warning",
				"$.target.definitionType",
				"target.definitionType is RECOMMENDED when patching metadata definition files so selector support and target format can be validated explicitly.",
			),
		);
	}

	if (
		overlay.target?.ordId !== undefined &&
		hasMetadataDefinitionSelectors &&
		overlay.target.url === undefined &&
		overlay.target.definitionType === undefined
	) {
		warnings.push(
			createIssue(
				"warning",
				"$.target",
				"target.ordId alone can be ambiguous for metadata definition patches. Provide target.definitionType and/or target.url to identify the concrete file.",
			),
		);
	}

	addPerspectiveWarnings(overlay, warnings);

	overlay.patches.forEach((patch, patchIndex) => {
		const patchPath = `$.patches[${patchIndex}]`;
		const selectorKind = getSelectorKind(patch.selector);

		validatePatchData(patch, patchPath, errors);
		validateSelectorSemantics(
			selectorKind,
			patch.selector,
			patchPath,
			definitionType,
			errors,
			warnings,
		);
		validateODataPatchData(
			patch,
			patchPath,
			selectorKind,
			definitionType,
			warnings,
		);
	});

	return { errors, warnings };
}

export function validateTargetDocumentForDefinitionType(
	targetDocument: JSONValue,
	definitionType: string | undefined,
	overlay?: ORDOverlay,
): OverlayValidationIssue[] {
	if (definitionType === undefined) {
		return [];
	}

	if (KNOWN_NON_JSON_OR_YAML_DEFINITION_TYPES.has(definitionType)) {
		return [
			createIssue(
				"error",
				"$",
				`definitionType "${definitionType}" is not JSON/YAML-based and is not supported by this merge script.`,
			),
		];
	}

	if (!isJSONObject(targetDocument)) {
		return [
			createIssue(
				"error",
				"$",
				`Target document for definitionType "${definitionType}" must be a JSON object after parsing.`,
			),
		];
	}

	if (definitionType === "openapi-v2") {
		return validateExactVersionPrefix(
			targetDocument.swagger,
			"2.",
			"$.swagger",
			"openapi-v2",
		);
	}

	if (definitionType === "openapi-v3") {
		return validateOpenApiVersion(targetDocument.openapi, "openapi-v3");
	}

	if (definitionType === "openapi-v3.1+") {
		return validateOpenApiVersion(targetDocument.openapi, "openapi-v3.1+");
	}

	if (definitionType === "a2a-agent-card") {
		return Array.isArray(targetDocument.skills)
			? []
			: [
					createIssue(
						"error",
						"$.skills",
						'A2A Agent Card targets must contain a top-level "skills" array.',
					),
				];
	}

	if (definitionType === "csdl-json") {
		return typeof targetDocument.$Version === "string"
			? []
			: [
					createIssue(
						"error",
						"$.$Version",
						'CSDL JSON targets must contain a top-level "$Version" string.',
					),
				];
	}

	if (definitionType === "asyncapi-v2") {
		return validateExactVersionPrefix(
			targetDocument.asyncapi,
			"2.",
			"$.asyncapi",
			"asyncapi-v2",
		);
	}

	if (definitionType === "ord:overlay:v1") {
		return targetDocument.ordOverlay === "0.1"
			? []
			: [
					createIssue(
						"error",
						"$.ordOverlay",
						'ORD Overlay targets must contain ordOverlay: "0.1".',
					),
				];
	}

	if (
		isSpecificationId(definitionType) &&
		overlay?.patches.some(
			(patch) => getSelectorKind(patch.selector) === "operation",
		)
	) {
		return Array.isArray(targetDocument.tools)
			? []
			: [
					createIssue(
						"error",
						"$.tools",
						'Specification ID targets using the "operation" selector must expose a top-level "tools" array.',
					),
				];
	}

	return [];
}

export function emitOverlayValidationWarnings(
	warnings: OverlayValidationIssue[],
	emit: (message: string) => void = console.warn,
): void {
	warnings.forEach((warning) => {
		emit(`[overlay-merge] Warning at ${warning.path}: ${warning.message}`);
	});
}

export function throwOnOverlayValidationErrors(
	errors: OverlayValidationIssue[],
): void {
	if (errors.length === 0) {
		return;
	}

	throw new OverlayMergeError(formatOverlayValidationErrors(errors));
}

export function formatOverlayValidationErrors(
	errors: OverlayValidationIssue[],
): string {
	return `Overlay validation failed:\n${errors.map((error) => `- ${error.path}: ${error.message}`).join("\n")}`;
}

function addPerspectiveWarnings(
	overlay: ORDOverlay,
	warnings: OverlayValidationIssue[],
): void {
	if (
		overlay.perspective === "system-type" &&
		overlay.describedSystemType === undefined
	) {
		warnings.push(
			createIssue(
				"warning",
				"$.describedSystemType",
				'perspective "system-type" indicates describedSystemType SHOULD be provided as identifying context.',
			),
		);
	}

	if (overlay.perspective === "system-version") {
		if (overlay.describedSystemVersion === undefined) {
			warnings.push(
				createIssue(
					"warning",
					"$.describedSystemVersion",
					'perspective "system-version" indicates describedSystemVersion SHOULD be provided.',
				),
			);
		}

		if (overlay.describedSystemType === undefined) {
			warnings.push(
				createIssue(
					"warning",
					"$.describedSystemType",
					'perspective "system-version" indicates describedSystemType SHOULD also be provided as parent context.',
				),
			);
		}
	}

	if (
		overlay.perspective === "system-instance" &&
		overlay.describedSystemInstance === undefined
	) {
		warnings.push(
			createIssue(
				"warning",
				"$.describedSystemInstance",
				'perspective "system-instance" indicates describedSystemInstance SHOULD be provided.',
			),
		);
	}
}

function isODataDefinitionType(definitionType: string): boolean {
	return definitionType === "csdl-json" || definitionType === "edmx";
}

function isODataSelector(selectorKind: SelectorKind): boolean {
	return (
		selectorKind === "entityType" ||
		selectorKind === "complexType" ||
		selectorKind === "enumType" ||
		selectorKind === "propertyType" ||
		selectorKind === "entitySet" ||
		selectorKind === "namespace" ||
		selectorKind === "parameter" ||
		selectorKind === "returnType"
	);
}

function validateODataPatchData(
	patch: ORDOverlay["patches"][number],
	patchPath: string,
	selectorKind: SelectorKind,
	definitionType: string | undefined,
	warnings: OverlayValidationIssue[],
): void {
	if (definitionType === undefined || !isODataDefinitionType(definitionType)) {
		return;
	}

	if (!isODataSelector(selectorKind)) {
		return;
	}

	if (patch.data === undefined || patch.action === "remove") {
		return;
	}

	if (!isJSONObject(patch.data)) {
		warnings.push(
			createIssue(
				"warning",
				`${patchPath}.data`,
				`OData patch data for "${definitionType}" targets MUST be an object with @-prefixed annotation keys (CSDL JSON format).`,
			),
		);
		return;
	}

	const invalidKeys = Object.entries(patch.data)
		.filter(([key, value]) => !key.startsWith("@") && !isJSONObject(value))
		.map(([key]) => key);

	if (invalidKeys.length > 0) {
		warnings.push(
			createIssue(
				"warning",
				`${patchPath}.data`,
				`OData patch data for "${definitionType}" targets MUST use @-prefixed annotation keys (CSDL JSON format). ` +
					`Non-annotation keys found: ${invalidKeys.join(", ")}. ` +
					`These keys will be ignored by the EDMX merge path.`,
			),
		);
	}
}

function validatePatchData(
	patch: ORDOverlay["patches"][number],
	patchPath: string,
	errors: OverlayValidationIssue[],
): void {
	// update and merge require data
	if (
		(patch.action === "update" || patch.action === "merge") &&
		patch.data === undefined
	) {
		errors.push(
			createIssue(
				"error",
				`${patchPath}.data`,
				`Patch action "${patch.action}" requires data.`,
			),
		);
	}

	if (patch.action === "remove" && patch.data !== undefined) {
		if (patch.data === null) {
			errors.push(
				createIssue(
					"error",
					`${patchPath}.data`,
					`Patch action "remove" omits data to remove the selected element entirely; data must be a non-empty removal mask when provided.`,
				),
			);
			return;
		}

		if (
			(Array.isArray(patch.data) && patch.data.length === 0) ||
			(isJSONObject(patch.data) && Object.keys(patch.data).length === 0)
		) {
			errors.push(
				createIssue(
					"error",
					`${patchPath}.data`,
					`Patch action "remove" omits data to remove the selected element entirely; empty data is not allowed.`,
				),
			);
		}
	}
}

function validateSelectorSemantics(
	selectorKind: SelectorKind,
	selector: ORDOverlay["patches"][number]["selector"],
	patchPath: string,
	definitionType: string | undefined,
	errors: OverlayValidationIssue[],
	warnings: OverlayValidationIssue[],
): void {
	const selectorPath = `${patchPath}.selector`;

	if (selectorKind === "jsonPath") {
		const expression = (selector as { jsonPath: string }).jsonPath;
		validateJsonPathExpression(expression, `${selectorPath}.jsonPath`, errors);

		if (
			definitionType !== undefined &&
			KNOWN_NON_JSON_OR_YAML_DEFINITION_TYPES.has(definitionType)
		) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "jsonPath" selector is only defined for JSON/YAML-based target formats, but definitionType "${definitionType}" is not JSON/YAML-based.`,
				),
			);
		}

		return;
	}

	if (selectorKind === "operation") {
		if (definitionType === undefined) {
			warnings.push(
				createIssue(
					"warning",
					selectorPath,
					'The "operation" selector works best with target.definitionType. Without it, the resolver falls back to OpenAPI -> MCP -> A2A detection order.',
				),
			);
			return;
		}

		if (!supportsOperationSelector(definitionType)) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "operation" selector is not supported for definitionType "${definitionType}". Supported values are openapi-v2, openapi-v3, openapi-v3.1+, a2a-agent-card, csdl-json, edmx, and Specification IDs used for MCP-style targets.`,
				),
			);
		}

		return;
	}

	if (
		selectorKind === "entityType" ||
		selectorKind === "complexType" ||
		selectorKind === "enumType" ||
		selectorKind === "propertyType"
	) {
		if (selectorKind === "propertyType") {
			const parentCount = [
				"entityType" in selector,
				"complexType" in selector,
				"enumType" in selector,
			].filter(Boolean).length;

			if (parentCount === 0) {
				errors.push(
					createIssue(
						"error",
						selectorPath,
						'propertyType selectors MUST provide exactly one of "entityType", "complexType", or "enumType" to disambiguate the target property.',
					),
				);
			} else if (parentCount > 1) {
				errors.push(
					createIssue(
						"error",
						selectorPath,
						'propertyType selectors MUST provide exactly one of "entityType", "complexType", or "enumType", but multiple were provided.',
					),
				);
			}
		}

		if (
			definitionType !== undefined &&
			!supportsEntityTypeSelector(definitionType)
		) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "${selectorKind}" selector is only supported for OData metadata (edmx, csdl-json) and CSN Interop (sap-csn-interop-effective-v1) targets, not for definitionType "${definitionType}".`,
				),
			);
		} else {
			warnOnUnqualifiedTypeName(
				selector,
				selectorPath,
				definitionType,
				warnings,
			);
		}

		return;
	}

	if (selectorKind === "entitySet") {
		if (
			definitionType !== undefined &&
			!supportsEntitySetSelector(definitionType)
		) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "entitySet" selector is only supported for OData metadata (edmx, csdl-json) targets, not for definitionType "${definitionType}".`,
				),
			);
		}

		return;
	}

	if (selectorKind === "namespace") {
		if (
			definitionType !== undefined &&
			!supportsNamespaceSelector(definitionType)
		) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "namespace" selector is only supported for OData metadata (edmx, csdl-json) targets, not for definitionType "${definitionType}".`,
				),
			);
		}

		return;
	}

	if (selectorKind === "parameter") {
		if (
			definitionType !== undefined &&
			!supportsParameterSelector(definitionType)
		) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "parameter" selector is only supported for OpenAPI and OData metadata (edmx, csdl-json) targets, not for definitionType "${definitionType}".`,
				),
			);
		}

		return;
	}

	if (selectorKind === "returnType") {
		if (
			definitionType !== undefined &&
			!supportsReturnTypeSelector(definitionType)
		) {
			errors.push(
				createIssue(
					"error",
					selectorPath,
					`The "returnType" selector is only supported for OData metadata (edmx, csdl-json) targets, not for definitionType "${definitionType}".`,
				),
			);
		}

		return;
	}
}

function validateJsonPathExpression(
	expression: string,
	path: string,
	errors: OverlayValidationIssue[],
): void {
	try {
		jsonpath.nodes({}, expression);
	} catch (error: unknown) {
		const reason = error instanceof Error ? error.message : String(error);
		errors.push(
			createIssue("error", path, `Invalid JSONPath expression: ${reason}`),
		);
	}
}

function validateOpenApiVersion(
	value: unknown,
	definitionType: "openapi-v3" | "openapi-v3.1+",
): OverlayValidationIssue[] {
	if (typeof value !== "string") {
		return [
			createIssue(
				"error",
				"$.openapi",
				`OpenAPI targets for "${definitionType}" must contain a top-level "openapi" version string.`,
			),
		];
	}

	const match = /^(\d+)\.(\d+)(?:[.].*)?$/.exec(value);
	if (match === null) {
		return [
			createIssue(
				"error",
				"$.openapi",
				`OpenAPI version "${value}" is not in a recognised semantic version format.`,
			),
		];
	}

	const major = Number(match[1]);
	const minor = Number(match[2]);

	if (definitionType === "openapi-v3" && major === 3 && minor === 0) {
		return [];
	}

	if (definitionType === "openapi-v3.1+" && major === 3 && minor >= 1) {
		return [];
	}

	return [
		createIssue(
			"error",
			"$.openapi",
			`Target document version "${value}" does not match definitionType "${definitionType}".`,
		),
	];
}

function validateExactVersionPrefix(
	value: unknown,
	expectedPrefix: string,
	path: string,
	definitionType: string,
): OverlayValidationIssue[] {
	return typeof value === "string" && value.startsWith(expectedPrefix)
		? []
		: [
				createIssue(
					"error",
					path,
					`Target document does not match definitionType "${definitionType}".`,
				),
			];
}

function resolveDefinitionType(
	overlay: ORDOverlay,
	context: OverlayMergeContext | undefined,
): string | undefined {
	if (typeof context?.definitionType === "string") {
		return context.definitionType;
	}

	return typeof overlay.target?.definitionType === "string"
		? overlay.target.definitionType
		: undefined;
}

function supportsOperationSelector(definitionType: string): boolean {
	return (
		isOpenApiDefinitionType(definitionType) ||
		definitionType === "a2a-agent-card" ||
		definitionType === "csdl-json" ||
		definitionType === "edmx" ||
		isSpecificationId(definitionType)
	);
}

function supportsEntityTypeSelector(definitionType: string): boolean {
	return (
		definitionType === "edmx" ||
		definitionType === "csdl-json" ||
		definitionType === "sap-csn-interop-effective-v1"
	);
}

function supportsEntitySetSelector(definitionType: string): boolean {
	return definitionType === "edmx" || definitionType === "csdl-json";
}

function supportsNamespaceSelector(definitionType: string): boolean {
	return definitionType === "edmx" || definitionType === "csdl-json";
}

function supportsParameterSelector(definitionType: string): boolean {
	return (
		isOpenApiDefinitionType(definitionType) ||
		definitionType === "edmx" ||
		definitionType === "csdl-json"
	);
}

function supportsReturnTypeSelector(definitionType: string): boolean {
	return definitionType === "edmx" || definitionType === "csdl-json";
}

type SelectorKind =
	| "jsonPath"
	// | "ordId" // TODO: ordId selector temporarily removed from spec
	| "operation"
	| "entityType"
	| "complexType"
	| "enumType"
	| "propertyType"
	| "entitySet"
	| "namespace"
	| "parameter"
	| "returnType"
	| "unknown";

function getSelectorKind(
	selector: ORDOverlay["patches"][number]["selector"],
): SelectorKind {
	if (isJSONObject(selector) && typeof selector.jsonPath === "string") {
		return "jsonPath";
	}

	// TODO: ordId selector temporarily removed from spec — re-enable when restored
	// if (isJSONObject(selector) && typeof selector.ordId === "string") {
	// 	return "ordId";
	// }

	if (
		isJSONObject(selector) &&
		typeof selector.operation === "string" &&
		!("parameter" in selector) &&
		!("returnType" in selector)
	) {
		return "operation";
	}

	if (
		isJSONObject(selector) &&
		typeof selector.operation === "string" &&
		typeof (selector as Record<string, unknown>).parameter === "string"
	) {
		return "parameter";
	}

	if (
		isJSONObject(selector) &&
		typeof selector.operation === "string" &&
		(selector as Record<string, unknown>).returnType === true
	) {
		return "returnType";
	}

	if (
		isJSONObject(selector) &&
		typeof selector.entityType === "string" &&
		!("propertyType" in selector)
	) {
		return "entityType";
	}

	if (
		isJSONObject(selector) &&
		typeof selector.complexType === "string" &&
		!("propertyType" in selector)
	) {
		return "complexType";
	}

	if (
		isJSONObject(selector) &&
		typeof selector.enumType === "string" &&
		!("propertyType" in selector)
	) {
		return "enumType";
	}

	if (isJSONObject(selector) && typeof selector.propertyType === "string") {
		return "propertyType";
	}

	if (isJSONObject(selector) && typeof selector.entitySet === "string") {
		return "entitySet";
	}

	if (isJSONObject(selector) && typeof selector.namespace === "string") {
		return "namespace";
	}

	return "unknown";
}

function warnOnUnqualifiedTypeName(
	selector: ORDOverlay["patches"][number]["selector"],
	selectorPath: string,
	definitionType: string | undefined,
	warnings: OverlayValidationIssue[],
): void {
	if (
		!definitionType ||
		(!isODataDefinitionType(definitionType) &&
			definitionType !== "sap-csn-interop-effective-v1")
	) {
		return;
	}

	const obj = selector as unknown as Record<string, unknown>;
	for (const key of ["entityType", "complexType", "enumType"] as const) {
		const value = obj[key];
		if (typeof value === "string" && value.length > 0 && !value.includes(".")) {
			warnings.push(
				createIssue(
					"warning",
					`${selectorPath}.${key}`,
					`Unqualified type name "${value}" used in "${key}" selector. ` +
						`The ORD Overlay specification requires namespace-qualified names (e.g. "MyNamespace.${value}") ` +
						`for unambiguous resolution. Unqualified names may match incorrectly if the target has multiple schemas.`,
				),
			);
		}
	}
}

const SELECTOR_PROPERTY_HINTS: Record<string, string> = {
	action: 'Use { "operation": "<actionName>" } to target an OData action.',
	function:
		'Use { "operation": "<functionName>" } to target an OData function.',
	entity:
		'Use { "entityType": "<Namespace.EntityName>" } to target an entity type.',
	property:
		'Use { "propertyType": "<propertyName>", "entityType": "<Namespace.EntityName>" } to target a property.',
};

function formatAjvError(error: ErrorObject): string {
	if (
		error.keyword === "required" &&
		typeof error.params.missingProperty === "string"
	) {
		return `Missing required property "${error.params.missingProperty}".`;
	}

	if (
		error.keyword === "additionalProperties" &&
		typeof error.params.additionalProperty === "string"
	) {
		const prop = error.params.additionalProperty;
		const hint = SELECTOR_PROPERTY_HINTS[prop];
		if (hint) {
			return `Unexpected property "${prop}". ${hint}`;
		}
		return `Unexpected property "${prop}".`;
	}

	return (
		error.message ?? `Schema validation failed for keyword "${error.keyword}".`
	);
}

function toDisplayPath(instancePath: string): string {
	if (instancePath.length === 0) {
		return "$";
	}

	return `$${instancePath.replace(/\/(\d+)/g, "[$1]").replace(/\/([^/]+)/g, ".$1")}`;
}

function createIssue(
	level: "error" | "warning",
	path: string,
	message: string,
): OverlayValidationIssue {
	return { level, path, message };
}

// ---------------------------------------------------------------------------
// Full validation API (overlay-only and overlay + target)
// ---------------------------------------------------------------------------

/**
 * Summary of validation result for a single patch.
 */
export interface PatchValidationSummary {
	patchIndex: number;
	selector: unknown;
	/** Number of elements matched by the selector (-1 if not determinable) */
	matchCount: number;
	redundant: boolean;
	redundantDetails?: string | undefined;
}

/**
 * Result of overlay validation including optional per-patch summaries.
 */
export interface OverlayFullValidationResult {
	valid: boolean;
	errors: OverlayValidationIssue[];
	warnings: OverlayValidationIssue[];
	patchSummary?: PatchValidationSummary[] | undefined;
}

export interface ValidateOverlayOptions {
	context?: OverlayMergeContext;
}

export interface ValidateOverlayWithTargetOptions
	extends ValidateOverlayOptions {
	definitionType?: string | undefined;
}

/**
 * Validates an ORD Overlay for schema conformance and semantic correctness.
 */
export function validateOverlay(
	overlay: ORDOverlay,
	options: ValidateOverlayOptions = {},
): OverlayFullValidationResult {
	const validation = validateOverlayInput(overlay, {
		context: options.context,
	});
	const result: OverlayFullValidationResult = {
		valid: validation.errors.length === 0,
		errors: validation.errors,
		warnings: validation.warnings,
	};
	if (result.valid) {
		checkEmptyDataValues(overlay, result);
		checkDuplicatePatches(overlay, result);
	}
	return result;
}

/**
 * Validates an ORD Overlay against a target JSON document.
 * Also validates selector matching and detects redundant patches.
 */
export function validateOverlayWithTarget(
	overlay: ORDOverlay,
	targetDocument: JSONValue,
	options: ValidateOverlayWithTargetOptions = {},
): OverlayFullValidationResult {
	const result = validateOverlay(overlay, options);

	const definitionType =
		options.definitionType ??
		(typeof overlay.target?.definitionType === "string"
			? overlay.target.definitionType
			: undefined);

	const targetValidation = validateTargetDocumentForDefinitionType(
		targetDocument,
		definitionType,
		overlay,
	);
	result.errors.push(...targetValidation);
	if (targetValidation.length > 0) {
		result.valid = false;
	}

	if (result.errors.length === 0) {
		result.patchSummary = validatePatches(
			overlay,
			targetDocument,
			definitionType,
			result,
		);
	}

	return result;
}

/**
 * Validates an ORD Overlay against an EDMX/XML target via dry-run merge.
 */
export function validateOverlayWithEdmxTarget(
	overlay: ORDOverlay,
	edmxContent: string,
	options: ValidateOverlayOptions = {},
): OverlayFullValidationResult {
	const result = validateOverlay(overlay, options);

	try {
		const capture = captureEdmxValidationIssues(edmxContent, overlay);
		result.errors.push(...capture.errors);
		result.warnings.push(...capture.warnings);
		if (capture.errors.length > 0) {
			result.valid = false;
		}

		result.patchSummary = overlay.patches.map((patch, index) => ({
			patchIndex: index,
			selector: patch.selector,
			matchCount: -1,
			redundant: false,
		}));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result.errors.push({
			level: "error",
			path: "$",
			message: `EDMX validation failed: ${message}`,
		});
		result.valid = false;
	}

	return result;
}

function validatePatches(
	overlay: ORDOverlay,
	targetDocument: JSONValue,
	definitionType: string | undefined,
	result: OverlayFullValidationResult,
): PatchValidationSummary[] {
	const summaries: PatchValidationSummary[] = [];

	overlay.patches.forEach((patch, patchIndex) => {
		const summary: PatchValidationSummary = {
			patchIndex,
			selector: patch.selector,
			matchCount: 0,
			redundant: false,
		};

		try {
			const matches = resolveSelector(
				targetDocument,
				patch.selector,
				definitionType,
			);
			summary.matchCount = matches.length;

			if (matches.length === 0) {
				result.errors.push({
					level: "error",
					path: `$.patches[${patchIndex}].selector`,
					message:
						"Selector does not match any element in the target document.",
				});
				result.valid = false;
			} else {
				const redundancyCheck = checkPatchRedundancy(patch, matches);
				if (redundancyCheck.redundant) {
					summary.redundant = true;
					summary.redundantDetails = redundancyCheck.details;
					result.warnings.push({
						level: "warning",
						path: `$.patches[${patchIndex}]`,
						message: `Redundant patch: ${redundancyCheck.details}`,
					});
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result.errors.push({
				level: "error",
				path: `$.patches[${patchIndex}].selector`,
				message: `Selector resolution failed: ${message}`,
			});
			result.valid = false;
		}

		summaries.push(summary);
	});

	return summaries;
}

interface RedundancyCheckResult {
	redundant: boolean;
	details?: string | undefined;
}

function checkPatchRedundancy(
	patch: ORDOverlay["patches"][number],
	matches: NodeReference[],
): RedundancyCheckResult {
	if (patch.data === undefined || patch.action === "remove") {
		return { redundant: false };
	}

	const patchData = patch.data as unknown as JSONValue;

	if (patch.action === "update") {
		const allIdentical = matches.every((match) =>
			areValuesEqual(match.value, patchData),
		);
		if (allIdentical) {
			return {
				redundant: true,
				details: `Update value is identical to existing value${matches.length > 1 ? " for all matches" : ""}.`,
			};
		}
		return { redundant: false };
	}

	if (patch.action === "merge") {
		const allUnchanged = matches.every((match) => {
			const merged = simulateMerge(match.value, patchData);
			return areValuesEqual(match.value, merged);
		});
		if (allUnchanged) {
			return {
				redundant: true,
				details: `Merge would not change the target value${matches.length > 1 ? " for any match" : ""}.`,
			};
		}
	}

	return { redundant: false };
}

function simulateMerge(base: JSONValue, incoming: JSONValue): JSONValue {
	if (Array.isArray(base) && Array.isArray(incoming)) {
		return [...base, ...cloneJSONValue(incoming)];
	}

	if (isJSONObject(base) && isJSONObject(incoming)) {
		const result: Record<string, JSONValue> = { ...base };
		Object.entries(incoming).forEach(([key, incomingValue]) => {
			const baseValue = result[key];
			if (baseValue === undefined) {
				result[key] = cloneJSONValue(incomingValue);
				return;
			}
			result[key] = simulateMerge(baseValue, incomingValue);
		});
		return result;
	}

	return cloneJSONValue(incoming);
}

function areValuesEqual(a: JSONValue, b: JSONValue): boolean {
	if (a === null && b === null) {
		return true;
	}
	if (a === null || b === null) {
		return false;
	}
	if (typeof a !== "object" || typeof b !== "object") {
		return a === b;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => areValuesEqual(item, b[index]));
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		return false;
	}
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	return aKeys.every((key) => {
		if (!(key in b)) {
			return false;
		}
		return areValuesEqual(
			a[key as keyof typeof a] as JSONValue,
			b[key as keyof typeof b] as JSONValue,
		);
	});
}

function captureEdmxValidationIssues(
	edmxContent: string,
	overlay: ORDOverlay,
): { errors: OverlayValidationIssue[]; warnings: OverlayValidationIssue[] } {
	const errors: OverlayValidationIssue[] = [];
	const warnings: OverlayValidationIssue[] = [];
	const mergeWarnings: string[] = [];

	const originalWarn = console.warn;
	console.warn = (message?: unknown): void => {
		mergeWarnings.push(String(message));
	};

	try {
		applyOverlayToEdmxDocument(edmxContent, overlay, {
			noMatchBehavior: "ignore",
			validateOverlaySemantics: false,
			onPatchResult: (patchIndex, matched) => {
				if (!matched) {
					errors.push({
						level: "error",
						path: `$.patches[${patchIndex}].selector`,
						message:
							"Selector does not match any element in the target EDMX document.",
					});
				}
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		errors.push({ level: "error", path: "$", message });
	} finally {
		console.warn = originalWarn;
	}

	for (const msg of mergeWarnings) {
		const keyMatch = msg.match(
			/EDMX patch key "([^"]+)" does not match any child Property/,
		);
		if (keyMatch !== null) {
			const key = keyMatch[1];
			const base = `Key "${key}" does not match any Property, NavigationProperty, or Member in the target element.`;
			warnings.push({
				level: "warning",
				path: "$.patches[*].data",
				message:
					key === "properties"
						? `${base} Hint: EDMX overlays use inline property names directly in "data" (e.g. { "MyProperty": { "@Core.Description": "..." } }), not wrapped in a "properties" key. See the ORD Overlay specification for the correct pattern.`
						: base,
			});
		} else {
			warnings.push({
				level: "warning",
				path: "$",
				message: msg.replace(/^\[overlay-merge\]\s*/, ""),
			});
		}
	}

	return { errors, warnings };
}

function checkEmptyDataValues(
	overlay: ORDOverlay,
	result: OverlayFullValidationResult,
): void {
	overlay.patches.forEach((patch, patchIndex) => {
		if (patch.data === undefined) {
			return;
		}
		const emptyFields = findEmptyStringFields(
			patch.data as unknown as JSONValue,
		);
		if (emptyFields.length > 0) {
			result.warnings.push({
				level: "warning",
				path: `$.patches[${patchIndex}].data`,
				message: `Patch data contains empty string value(s) for: ${emptyFields.join(", ")}. This may be unintentional.`,
			});
		}
	});
}

function findEmptyStringFields(data: JSONValue, prefix = ""): string[] {
	const emptyFields: string[] = [];
	if (!isJSONObject(data)) {
		return emptyFields;
	}
	for (const [key, value] of Object.entries(data)) {
		const fieldPath = prefix ? `${prefix}.${key}` : key;
		if (value === "") {
			emptyFields.push(fieldPath);
		} else if (isJSONObject(value)) {
			emptyFields.push(...findEmptyStringFields(value, fieldPath));
		}
	}
	return emptyFields;
}

function checkDuplicatePatches(
	overlay: ORDOverlay,
	result: OverlayFullValidationResult,
): void {
	const selectorMap = new Map<string, number[]>();

	overlay.patches.forEach((patch, patchIndex) => {
		const selectorKey = JSON.stringify(
			patch.selector,
			Object.keys(patch.selector as object).sort(),
		);
		const existing = selectorMap.get(selectorKey);
		if (existing !== undefined) {
			existing.push(patchIndex);
		} else {
			selectorMap.set(selectorKey, [patchIndex]);
		}
	});

	for (const [_selectorKey, patchIndices] of selectorMap) {
		if (patchIndices.length > 1) {
			const actions = patchIndices.map((i) => overlay.patches[i].action);
			const hasRemove = actions.includes("remove");
			const hasMergeOrUpdate =
				actions.includes("merge") || actions.includes("update");
			if (hasRemove && hasMergeOrUpdate) {
				continue;
			}
			const patchNumbers = patchIndices.map((i) => i + 1).join(", ");
			result.warnings.push({
				level: "warning",
				path: "$.patches",
				message: `Patches ${patchNumbers} target the same element. Consider reviewing whether this is intentional (e.g., remove then update) or indicates accidental duplication.`,
			});
		}
	}
}
