import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelector } from "../../src/merge/selectors";
import type { JSONValue } from "../../src/merge/types";

test("resolveSelector resolves root selector to document root", () => {
	const target = {
		info: { title: "Test API", version: "1.0.0" },
		paths: { "/foo": {} },
	};
	const result = resolveSelector(target as JSONValue, { root: true } as never);

	assert.equal(result.length, 1);
	assert.equal(result[0].path, "$");
	assert.equal(result[0].parent, undefined);
	assert.equal(result[0].key, undefined);
	assert.deepEqual(result[0].value, target);
});

test("resolveSelector root selector works with any document type", () => {
	// OpenAPI-like
	const openapi = { openapi: "3.0.0", info: {}, paths: {} };
	assert.equal(
		resolveSelector(openapi as JSONValue, { root: true } as never)[0].value,
		openapi,
	);

	// CSDL JSON-like
	const csdl = { $Version: "4.0", "OData.Demo": {} };
	assert.equal(
		resolveSelector(csdl as JSONValue, { root: true } as never)[0].value,
		csdl,
	);

	// ORD Document-like
	const ord = { openResourceDiscovery: "1.9", apiResources: [] };
	assert.equal(
		resolveSelector(ord as JSONValue, { root: true } as never)[0].value,
		ord,
	);

	// Primitive root (array)
	const arr = [1, 2, 3];
	assert.deepEqual(
		resolveSelector(arr as JSONValue, { root: true } as never)[0].value,
		arr,
	);
});

test("resolveSelector rejects invalid JSONPath expressions", () => {
	assert.throws(
		() => resolveSelector({ info: {} } as JSONValue, { jsonPath: "$[" }),
		/Invalid JSONPath/,
	);
});

test("resolveSelector requires JSON objects for operation selectors", () => {
	assert.throws(
		() =>
			resolveSelector(
				["not-an-object"] as JSONValue,
				{ operation: "listThings" },
				"openapi-v3",
			),
		/operation selector requires a JSON object as target document/,
	);
});

// TODO: ordId selector temporarily removed from spec — re-enable when restored
// test("resolveSelector requires ORD documents for ordId selectors", () => {
// 	assert.throws(
// 		() =>
// 			resolveSelector(
// 				["not-an-ord-document"] as JSONValue,
// 				{
// 					ordId: "sap.foo:apiResource:astronomy:v1",
// 				} as any,
// 			),
// 		/ordId selector requires an ORD Document object as target/,
// 	);
// });

test("resolveSelector throws for entityType selector on unsupported target format", () => {
	// An empty object with no $Version or csnInteropEffective — format unknown
	assert.throws(
		() => resolveSelector({} as JSONValue, { entityType: "BusinessPartner" }),
		/entityType.*not supported/i,
	);

	// Explicit unsupported definitionType
	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ entityType: "BusinessPartner" },
				"openapi-v3",
			),
		/entityType.*not supported/i,
	);
});

test("resolveSelector throws for propertyType selector on unsupported target format", () => {
	// Explicit unsupported definitionType
	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ propertyType: "Name", entityType: "Customer" },
				"openapi-v3",
			),
		/propertyType.*not supported/i,
	);
});

test("resolveSelector throws for entityType/propertyType on edmx (must use EDMX-specific API)", () => {
	assert.throws(
		() => resolveSelector({} as JSONValue, { entityType: "Customer" }, "edmx"),
		/applyOverlayToEdmxDocument/,
	);

	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ propertyType: "Name", entityType: "Customer" },
				"edmx",
			),
		/applyOverlayToEdmxDocument/,
	);
});

test("resolveSelector throws for entitySet selector on unsupported target format", () => {
	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ entitySet: "Customers" },
				"openapi-v3",
			),
		/'entitySet' selector is only supported/,
	);
});

test("resolveSelector throws for namespace selector on unsupported target format", () => {
	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ namespace: "com.example.Svc" },
				"openapi-v3",
			),
		/'namespace' selector is only supported/,
	);
});

test("resolveSelector throws for entitySet/namespace on edmx (must use EDMX-specific API)", () => {
	assert.throws(
		() => resolveSelector({} as JSONValue, { entitySet: "Customers" }, "edmx"),
		/applyOverlayToEdmxDocument/,
	);

	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ namespace: "com.example.Svc" },
				"edmx",
			),
		/applyOverlayToEdmxDocument/,
	);
});

test("resolveSelector throws for parameter selector on unsupported target format", () => {
	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ parameter: "employeeId", operation: "listEmployees" },
				"a2a-agent-card",
			),
		/'parameter' selector is supported for/,
	);
});

test("resolveSelector throws for returnType selector on unsupported target format", () => {
	assert.throws(
		() =>
			resolveSelector(
				{} as JSONValue,
				{ returnType: true, operation: "com.example.Svc.GetReports" },
				"a2a-agent-card",
			),
		/'returnType' selector is only supported/,
	);
});

// ─── Ambiguity detection tests ───────────────────────────────────────────────

const csdlTwoNamespaces = {
	$Version: "4.0",
	"com.example.NS1": {
		Customer: { $Kind: "EntityType" },
		Approve: [{ $Kind: "Action" }],
		Container1: {
			$Kind: "EntityContainer",
			Customers: { $Type: "com.example.NS1.Customer", $Collection: true },
		},
	},
	"com.example.NS2": {
		Customer: { $Kind: "EntityType" },
		Approve: [{ $Kind: "Action" }],
		Container2: {
			$Kind: "EntityContainer",
			Customers: { $Type: "com.example.NS2.Customer", $Collection: true },
		},
	},
} as JSONValue;

test("resolveSelector throws on ambiguous unqualified entityType across CSDL namespaces", () => {
	assert.throws(
		() =>
			resolveSelector(
				csdlTwoNamespaces,
				{ entityType: "Customer" },
				"csdl-json",
			),
		/Ambiguous entityType selector "Customer"/,
	);
});

test("resolveSelector resolves qualified entityType unambiguously in CSDL", () => {
	const result = resolveSelector(
		csdlTwoNamespaces,
		{ entityType: "com.example.NS1.Customer" },
		"csdl-json",
	);
	assert.equal(result.length, 1);
	assert.equal(result[0].path, "$['com.example.NS1']['Customer']");
});

test("resolveSelector throws on ambiguous unqualified operation across CSDL namespaces", () => {
	assert.throws(
		() =>
			resolveSelector(csdlTwoNamespaces, { operation: "Approve" }, "csdl-json"),
		/Ambiguous operation selector "Approve"/,
	);
});

test("resolveSelector resolves qualified operation unambiguously in CSDL", () => {
	const result = resolveSelector(
		csdlTwoNamespaces,
		{ operation: "com.example.NS2.Approve" },
		"csdl-json",
	);
	assert.equal(result.length, 1);
	assert.equal(result[0].path, "$['com.example.NS2']['Approve'][0]");
});

test("resolveSelector throws on ambiguous entitySet name across CSDL EntityContainers", () => {
	assert.throws(
		() =>
			resolveSelector(
				csdlTwoNamespaces,
				{ entitySet: "Customers" },
				"csdl-json",
			),
		/Ambiguous entitySet selector "Customers"/,
	);
});

test("propertyType without entityType scans all entity types in CSDL JSON", () => {
	const csdlDoc = {
		$Version: "4.0",
		"com.example.Svc": {
			Customer: { $Kind: "EntityType", Name: { $Type: "Edm.String" } },
			Product: {
				$Kind: "EntityType",
				Name: { $Type: "Edm.String" },
				Price: { $Type: "Edm.Decimal" },
			},
		},
	} as JSONValue;

	const result = resolveSelector(
		csdlDoc,
		{ propertyType: "Name" },
		"csdl-json",
	);

	assert.equal(result.length, 2);
	assert.ok(result.every((r) => r.key === "Name"));
});

test("propertyType without entityType scans all definitions in CSN Interop document", () => {
	const csnDoc = {
		csnInteropEffective: "1.0",
		definitions: {
			"MySvc.Employee": {
				kind: "entity",
				elements: { name: { type: "String" }, employeeId: { type: "Integer" } },
			},
			"MySvc.Department": {
				kind: "entity",
				elements: { name: { type: "String" }, code: { type: "Integer" } },
			},
		},
	} as JSONValue;

	const result = resolveSelector(
		csnDoc,
		{ propertyType: "name" },
		"sap-csn-interop-effective-v1",
	);

	assert.equal(result.length, 2);
	assert.ok(result.every((r) => r.key === "name"));
});

test("returnType selector on openapi-v3 now throws with a clear error (validation also rejects it)", () => {
	assert.throws(
		() =>
			resolveSelector(
				{ openapi: "3.0.0", paths: {} } as JSONValue,
				{ returnType: true, operation: "getEmployee" } as never,
				"openapi-v3",
			),
		/'returnType' selector is only supported for OData/,
	);
});

test("parameter selector resolves named parameter in OpenAPI operation's parameters array", () => {
	const openApiDoc = {
		openapi: "3.0.0",
		paths: {
			"/employees/{id}": {
				get: {
					operationId: "getEmployee",
					parameters: [
						{ name: "id", in: "path", required: true },
						{ name: "format", in: "query" },
					],
				},
			},
		},
	} as JSONValue;

	const result = resolveSelector(
		openApiDoc,
		{ parameter: "id", operation: "getEmployee" },
		"openapi-v3",
	);

	assert.equal(result.length, 1);
	assert.equal((result[0].value as Record<string, unknown>).name, "id");
});

// Path-item-level parameters (parameters defined on the path item, not on the individual method)
// are not resolved by the `parameter` selector — only operation-level parameters are found.
// Use a jsonPath selector to target path-item parameters directly.
test("parameter selector does not find path-item-level OpenAPI parameters (documents limitation)", () => {
	const openApiDoc = {
		openapi: "3.0.0",
		paths: {
			"/employees/{id}": {
				parameters: [{ name: "id", in: "path", required: true }], // path-item level
				get: {
					operationId: "getEmployee",
					summary: "Get employee", // no operation-level parameters array
				},
			},
		},
	} as JSONValue;

	const result = resolveSelector(
		openApiDoc,
		{ parameter: "id", operation: "getEmployee" },
		"openapi-v3",
	);

	assert.equal(result.length, 0);
});
