import assert from "node:assert/strict";
import test from "node:test";
import {
	validateOverlay,
	validateOverlayWithEdmxTarget,
	validateOverlayWithTarget,
} from "../../src/merge/validation";
import {
	createOrdOverlay,
	createOverlayPatch,
	loadTextFixture,
} from "../merge/test-helpers";

test("validateOverlay returns valid result for valid overlay", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.info",
				},
				data: {
					title: "Patched",
				},
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.deepEqual(result.errors, []);
});

test("validateOverlay returns errors for invalid overlay", () => {
	// Missing ordOverlay field
	const result = validateOverlay({ patches: [] } as never);

	assert.equal(result.valid, false);
	assert.ok(result.errors.length > 0);
	assert.ok(result.errors.some((e) => e.message.includes("ordOverlay")));
});

test("validateOverlay returns warnings for semantic issues", () => {
	const overlay = createOrdOverlay({
		perspective: "system-version", // Missing describedSystemVersion
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.info",
				},
				data: {
					title: "Patched",
				},
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(result.warnings.length > 0);
	assert.ok(
		result.warnings.some((w) => w.message.includes("describedSystemVersion")),
	);
});

test("validateOverlayWithTarget validates selector matches", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.info",
				},
				data: {
					title: "Patched",
				},
			}),
		],
	});

	const target = {
		openapi: "3.0.0",
		info: {
			title: "Original",
		},
	};

	const result = validateOverlayWithTarget(overlay, target, {
		definitionType: "openapi-v3",
	});

	assert.equal(result.valid, true);
	assert.ok(result.patchSummary !== undefined);
	assert.equal(result.patchSummary.length, 1);
	assert.equal(result.patchSummary[0].matchCount, 1);
	assert.equal(result.patchSummary[0].redundant, false);
});

test("validateOverlayWithTarget reports error for non-matching selector", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.nonexistent",
				},
				data: {
					title: "Patched",
				},
			}),
		],
	});

	const target = {
		openapi: "3.0.0",
		info: {
			title: "Original",
		},
	};

	const result = validateOverlayWithTarget(overlay, target, {
		definitionType: "openapi-v3",
	});

	assert.equal(result.valid, false);
	assert.ok(
		result.errors.some((e) => e.message.includes("does not match any element")),
	);
});

test("validateOverlayWithEdmxTarget reports error for non-matching selector", async () => {
	const edmxTarget = await loadTextFixture(
		"tests/fixtures/BusinessPartner.edmx.xml",
	);
	const overlay = createOrdOverlay({
		target: {
			definitionType: "edmx",
		},
		patches: [
			createOverlayPatch({
				selector: {
					entityType: "NoSuchType",
				},
				data: {
					"@Core.Description": "Ignored",
				} as never,
			}),
		],
	});

	const result = validateOverlayWithEdmxTarget(overlay, edmxTarget);

	assert.equal(result.valid, false);
	assert.ok(
		result.errors.some(
			(error) =>
				error.path === "$.patches[0].selector" &&
				error.message.includes("target EDMX document"),
		),
	);
	assert.ok(
		!result.warnings.some((warning) =>
			warning.message.includes("did not match any target element in EDMX"),
		),
	);
	assert.ok(result.patchSummary !== undefined);
	assert.equal(result.patchSummary[0].matchCount, -1);
});

test("validateOverlayWithTarget detects redundant update patch", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				action: "update",
				selector: {
					jsonPath: "$.info.title",
				},
				data: "Same Title",
			}),
		],
	});

	const target = {
		openapi: "3.0.0",
		info: {
			title: "Same Title",
		},
	};

	const result = validateOverlayWithTarget(overlay, target, {
		definitionType: "openapi-v3",
	});

	assert.equal(result.valid, true);
	assert.ok(result.patchSummary !== undefined);
	assert.equal(result.patchSummary[0].redundant, true);
	assert.ok(result.patchSummary[0].redundantDetails?.includes("identical"));
	assert.ok(result.warnings.some((w) => w.message.includes("Redundant")));
});

test("validateOverlayWithTarget detects redundant merge patch", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				action: "merge",
				selector: {
					jsonPath: "$.info",
				},
				data: {
					title: "Existing Title",
				},
			}),
		],
	});

	const target = {
		openapi: "3.0.0",
		info: {
			title: "Existing Title",
			description: "Some description",
		},
	};

	const result = validateOverlayWithTarget(overlay, target, {
		definitionType: "openapi-v3",
	});

	assert.equal(result.valid, true);
	assert.ok(result.patchSummary !== undefined);
	assert.equal(result.patchSummary[0].redundant, true);
	assert.ok(result.patchSummary[0].redundantDetails?.includes("not change"));
});

test("validateOverlayWithTarget does not flag non-redundant merge", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				action: "merge",
				selector: {
					jsonPath: "$.info",
				},
				data: {
					"x-new-field": "new value",
				},
			}),
		],
	});

	const target = {
		openapi: "3.0.0",
		info: {
			title: "Title",
		},
	};

	const result = validateOverlayWithTarget(overlay, target, {
		definitionType: "openapi-v3",
	});

	assert.equal(result.valid, true);
	assert.ok(result.patchSummary !== undefined);
	assert.equal(result.patchSummary[0].redundant, false);
});

test("validateOverlay warns on empty string values in patch data", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.info",
				},
				data: {
					description: "Valid description",
					"x-empty": "",
				},
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(
		result.warnings.some((w) => w.message.includes("empty string value")),
	);
	assert.ok(result.warnings.some((w) => w.message.includes("x-empty")));
});

test("validateOverlay warns on duplicate patches targeting same element", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.info",
				},
				data: {
					title: "First patch",
				},
			}),
			createOverlayPatch({
				selector: {
					jsonPath: "$.info",
				},
				data: {
					title: "Second patch - same selector",
				},
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(
		result.warnings.some((w) =>
			w.message.includes("Patches 1, 2 target the same element"),
		),
	);
});

test("validateOverlay does not warn on different selectors", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch({
				selector: {
					jsonPath: "$.info.title",
				},
				data: "Title",
			}),
			createOverlayPatch({
				selector: {
					jsonPath: "$.info.description",
				},
				data: "Description",
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(
		!result.warnings.some((w) => w.message.includes("Multiple patches")),
	);
});

test("validateOverlay does not warn on remove+merge pattern (valid array replacement)", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch(
				{
					action: "remove",
					selector: {
						jsonPath: "$.info.tags",
					},
				},
				{ omitData: true },
			),
			createOverlayPatch({
				action: "merge",
				selector: {
					jsonPath: "$.info.tags",
				},
				data: ["new-tag"],
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(
		!result.warnings.some((w) => w.message.includes("target the same element")),
		"Should not warn on remove+merge pattern",
	);
});

test("validateOverlay does not warn on remove+merge+update pattern (3 patches on same selector)", () => {
	const overlay = createOrdOverlay({
		target: {
			definitionType: "openapi-v3",
		},
		patches: [
			createOverlayPatch(
				{
					action: "remove",
					selector: { jsonPath: "$.info.tags" },
				},
				{ omitData: true },
			),
			createOverlayPatch({
				action: "merge",
				selector: { jsonPath: "$.info.tags" },
				data: ["tag-a"],
			}),
			createOverlayPatch({
				action: "update",
				selector: { jsonPath: "$.info.tags" },
				data: ["tag-b"],
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(
		!result.warnings.some((w) => w.message.includes("target the same element")),
		"Should not warn on remove+merge+update pattern with 3 patches",
	);
});

test("validateOverlay rejects returnType selector on openapi-v3 (validation bug now fixed)", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "openapi-v3" },
		patches: [
			createOverlayPatch({
				selector: { returnType: true, operation: "getEmployee" } as never,
				data: { "@Core.LongDescription": "Returns employee details" },
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, false);
	assert.ok(
		result.errors.some(
			(e) =>
				e.message.includes("returnType") &&
				e.message.includes("only supported for OData metadata"),
		),
	);
});

test("validateOverlay allows parameter selector on openapi-v3", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "openapi-v3" },
		patches: [
			createOverlayPatch({
				selector: { parameter: "id", operation: "getEmployee" } as never,
				data: { description: "The employee ID" },
			}),
		],
	});

	const result = validateOverlay(overlay);
	assert.equal(result.valid, true);
	assert.ok(!result.errors.some((e) => e.message.includes("parameter")));
});

test("validateOverlayWithTarget reports all patch summaries including non-matching and redundant", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "openapi-v3" },
		patches: [
			createOverlayPatch({
				selector: { jsonPath: "$.info" },
				data: { "x-new": "value" },
			}),
			createOverlayPatch({
				selector: { jsonPath: "$.nonexistent" },
				data: { foo: "bar" },
			}),
			createOverlayPatch({
				action: "update",
				selector: { jsonPath: "$.info.title" },
				data: "Same Title",
			}),
		],
	});

	const target = { openapi: "3.0.0", info: { title: "Same Title" } };

	const result = validateOverlayWithTarget(overlay, target, {
		definitionType: "openapi-v3",
	});

	assert.equal(result.valid, false);
	assert.equal(result.patchSummary?.length, 3);
	assert.equal(result.patchSummary?.[0].matchCount, 1);
	assert.equal(result.patchSummary?.[0].redundant, false);
	assert.equal(result.patchSummary?.[1].matchCount, 0);
	assert.ok(result.errors.some((e) => e.path.includes("patches[1]")));
	assert.equal(result.patchSummary?.[2].matchCount, 1);
	assert.equal(result.patchSummary?.[2].redundant, true);
});

test("openapi-v3.1+ target is accepted for definitionType openapi-v3.1+", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "openapi-v3.1+" },
		patches: [
			createOverlayPatch({
				selector: { jsonPath: "$.info" },
				data: { "x-team": "platform" },
			}),
		],
	});

	const v31 = { openapi: "3.1.0", info: { title: "v3.1 API", version: "1.0" } };
	assert.equal(
		validateOverlayWithTarget(overlay, v31, {
			definitionType: "openapi-v3.1+",
		}).valid,
		true,
	);

	const v30 = { openapi: "3.0.0", info: { title: "v3.0 API", version: "1.0" } };
	const rejectedResult = validateOverlayWithTarget(overlay, v30, {
		definitionType: "openapi-v3.1+",
	});
	assert.equal(rejectedResult.valid, false);
	assert.ok(
		rejectedResult.errors.some((e) => e.message.includes("does not match")),
	);
});

test("asyncapi-v2 target is accepted for 2.x documents and rejected for 3.x", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "asyncapi-v2" },
		patches: [
			createOverlayPatch({
				selector: { jsonPath: "$.info" },
				data: { "x-team": "events" },
			}),
		],
	});

	const asyncapi2 = {
		asyncapi: "2.6.0",
		info: { title: "Events", version: "1.0" },
	};
	assert.equal(
		validateOverlayWithTarget(overlay, asyncapi2, {
			definitionType: "asyncapi-v2",
		}).valid,
		true,
	);

	const asyncapi3 = {
		asyncapi: "3.0.0",
		info: { title: "Events", version: "1.0" },
	};
	assert.equal(
		validateOverlayWithTarget(overlay, asyncapi3, {
			definitionType: "asyncapi-v2",
		}).valid,
		false,
	);
});

test("validateOverlay warns when three merge patches target the same selector", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "openapi-v3" },
		patches: [
			createOverlayPatch({ selector: { jsonPath: "$.info" }, data: { a: 1 } }),
			createOverlayPatch({ selector: { jsonPath: "$.info" }, data: { b: 2 } }),
			createOverlayPatch({ selector: { jsonPath: "$.info" }, data: { c: 3 } }),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, true);
	assert.ok(
		result.warnings.some((w) => w.message.includes("Patches 1, 2, 3")),
		`expected warning about patches 1, 2, 3 but got: ${result.warnings.map((w) => w.message).join("; ")}`,
	);
});

test("validateOverlay warns on unqualified entityType name", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "edmx" },
		patches: [
			createOverlayPatch({
				selector: { entityType: "Employee" },
				data: { "@Core.Description": "Test" },
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.ok(
		result.warnings.some((w) => w.message.includes("Unqualified type name")),
	);
});

test("validateOverlay does not warn on qualified entityType name", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "edmx" },
		patches: [
			createOverlayPatch({
				selector: { entityType: "SFOData.Employee" },
				data: { "@Core.Description": "Test" },
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.ok(
		!result.warnings.some((w) => w.message.includes("Unqualified type name")),
	);
});

test("validateOverlay skips unqualified name check for non-OData and undefined definitionType", () => {
	const patch = createOverlayPatch({
		selector: { entityType: "Employee" },
		data: { "@Core.Description": "Test" },
	});

	const nonOData = validateOverlay(
		createOrdOverlay({
			target: { definitionType: "openapi-v3" },
			patches: [patch],
		}),
	);
	assert.ok(
		!nonOData.warnings.some((w) => w.message.includes("Unqualified type name")),
	);

	const noTarget = validateOverlay(createOrdOverlay({ patches: [patch] }));
	assert.ok(
		!noTarget.warnings.some((w) => w.message.includes("Unqualified type name")),
	);
});

test("validateOverlay gives helpful hint for misused selector keys", () => {
	const overlay = createOrdOverlay({
		target: { definitionType: "edmx" },
		patches: [
			createOverlayPatch({
				selector: { action: "MyAction" } as unknown as Record<string, unknown>,
				data: { "@Core.Description": "Test" },
			}),
		],
	});

	const result = validateOverlay(overlay);

	assert.equal(result.valid, false);
	assert.ok(
		result.errors.some(
			(e) => e.message.includes("action") && e.message.includes("operation"),
		),
	);
});

test("validateOverlayWithEdmxTarget captures 'properties' merge-warning with hint", async () => {
	const edmxContent = await loadTextFixture(
		"tests/fixtures/BusinessPartner.edmx.xml",
	);
	const overlay = createOrdOverlay({
		target: { definitionType: "edmx" },
		patches: [
			createOverlayPatch({
				selector: { entityType: "API_BUSINESS_PARTNER.A_BusinessPartnerType" },
				data: { properties: { firstName: { "@Core.Description": "First" } } },
			}),
		],
	});

	const result = validateOverlayWithEdmxTarget(overlay, edmxContent);

	assert.ok(
		result.warnings.some(
			(w) =>
				w.message.includes("properties") &&
				w.message.includes("inline property names"),
		),
	);
});
