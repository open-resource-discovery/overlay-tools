import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
	createOrdOverlay,
	createOverlayPatch,
	loadTextFixture,
} from "../merge/test-helpers";

const execFileAsync = promisify(execFile);
const cliPath = resolve(__dirname, "../../src/merge/cli.js");

test("merge --dry-run --help prints usage and dry-run info", async () => {
	const { stderr } = await execFileAsync(process.execPath, [cliPath, "--help"]);

	assert.match(stderr, /Usage:/);
	assert.match(stderr, /--dry-run/);
	assert.match(stderr, /--json/);
	assert.match(stderr, /Dry-run mode:/);
});

test("merge --dry-run validates overlay + target (schema + semantics)", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
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
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: {
				title: "Original",
			},
		}),
		"utf8",
	);

	const { stderr } = await execFileAsync(process.execPath, [
		cliPath,
		"--overlay",
		overlayPath,
		"--input",
		targetPath,
		"--dry-run",
	]);

	assert.match(stderr, /Status: VALID/);
	assert.match(stderr, /Patch #1: 1 match/);
});

test("merge --dry-run reports schema errors for invalid overlay", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify({
			patches: [],
		}),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({ openapi: "3.0.0", info: { title: "Test" } }),
		"utf8",
	);

	try {
		await execFileAsync(process.execPath, [
			cliPath,
			"--overlay",
			overlayPath,
			"--input",
			targetPath,
			"--dry-run",
		]);
		assert.fail("Should have failed");
	} catch (error) {
		const err = error as { stderr: string; code: number };
		assert.match(err.stderr, /INVALID/);
		assert.match(err.stderr, /ordOverlay/);
		assert.equal(err.code, 1);
	}
});

test("merge --dry-run reports error when selector does not match any element", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
				target: {
					definitionType: "openapi-v3",
				},
				patches: [
					createOverlayPatch({
						selector: {
							jsonPath: "$.nonexistent.path",
						},
						data: {
							title: "Patched",
						},
					}),
				],
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: {
				title: "Test",
			},
		}),
		"utf8",
	);

	try {
		await execFileAsync(process.execPath, [
			cliPath,
			"--overlay",
			overlayPath,
			"--input",
			targetPath,
			"--dry-run",
		]);
		assert.fail("Should have failed");
	} catch (error) {
		const err = error as { stderr: string };
		assert.match(err.stderr, /INVALID/);
		assert.match(err.stderr, /does not match any element/);
	}
});

test("merge --dry-run reports error when EDMX selector does not match any element", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.edmx");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
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
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		await loadTextFixture("tests/fixtures/BusinessPartner.edmx.xml"),
		"utf8",
	);

	try {
		await execFileAsync(process.execPath, [
			cliPath,
			"--overlay",
			overlayPath,
			"--input",
			targetPath,
			"--dry-run",
		]);
		assert.fail("Should have failed");
	} catch (error) {
		const err = error as { stderr: string };
		assert.match(err.stderr, /INVALID/);
		assert.match(
			err.stderr,
			/Selector does not match any element in the target EDMX document/,
		);
	}
});

test("merge --dry-run warns when patch is redundant (update with same value)", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
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
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: {
				title: "Same Title",
			},
		}),
		"utf8",
	);

	const { stderr } = await execFileAsync(process.execPath, [
		cliPath,
		"--overlay",
		overlayPath,
		"--input",
		targetPath,
		"--dry-run",
	]);

	assert.match(stderr, /VALID \(with warnings\)/);
	assert.match(stderr, /Redundant patch/);
	assert.match(stderr, /\[REDUNDANT\]/);
});

test("merge --dry-run warns when merge patch has no effect", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
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
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: {
				title: "Existing Title",
				description: "Some description",
			},
		}),
		"utf8",
	);

	const { stderr } = await execFileAsync(process.execPath, [
		cliPath,
		"--overlay",
		overlayPath,
		"--input",
		targetPath,
		"--dry-run",
	]);

	assert.match(stderr, /VALID \(with warnings\)/);
	assert.match(stderr, /Redundant patch/);
	assert.match(stderr, /Merge would not change/);
});

test("merge --dry-run --json outputs JSON format to stdout", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
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
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: { title: "Original" },
		}),
		"utf8",
	);

	const { stdout } = await execFileAsync(process.execPath, [
		cliPath,
		"--overlay",
		overlayPath,
		"--input",
		targetPath,
		"--dry-run",
		"--json",
	]);

	const report = JSON.parse(stdout) as {
		valid: boolean;
		errors: unknown[];
		warnings: unknown[];
	};
	assert.equal(report.valid, true);
	assert.deepEqual(report.errors, []);
});

test("merge --dry-run validates YAML overlay files", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.yaml");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		`ordOverlay: "0.1"
target:
  definitionType: openapi-v3
patches:
  - action: merge
    selector:
      jsonPath: $.info
    data:
      title: Patched
`,
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({ openapi: "3.0.0", info: { title: "Original" } }),
		"utf8",
	);

	const { stderr } = await execFileAsync(process.execPath, [
		cliPath,
		"--overlay",
		overlayPath,
		"--input",
		targetPath,
		"--dry-run",
	]);

	assert.match(stderr, /Status: VALID/);
});

test("merge --dry-run validates operation selector against OpenAPI target", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
				target: {
					definitionType: "openapi-v3",
				},
				patches: [
					createOverlayPatch({
						selector: {
							operation: "getUsers",
						},
						data: {
							description: "Updated description",
						},
					}),
				],
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: {
				title: "Test API",
			},
			paths: {
				"/users": {
					get: {
						operationId: "getUsers",
						summary: "Get users",
					},
				},
			},
		}),
		"utf8",
	);

	const { stderr } = await execFileAsync(process.execPath, [
		cliPath,
		"--overlay",
		overlayPath,
		"--input",
		targetPath,
		"--dry-run",
	]);

	assert.match(stderr, /Status: VALID/);
	assert.match(stderr, /Patch #1: 1 match/);
});

test("merge --dry-run reports multiple errors and warnings together", async () => {
	const tempDir = await mkdtemp(resolve(tmpdir(), "overlay-merge-dryrun-"));
	const overlayPath = resolve(tempDir, "overlay.json");
	const targetPath = resolve(tempDir, "target.json");

	await writeFile(
		overlayPath,
		JSON.stringify(
			createOrdOverlay({
				target: {
					definitionType: "openapi-v3",
				},
				perspective: "system-version", // Missing describedSystemVersion - should warn
				patches: [
					createOverlayPatch({
						selector: {
							jsonPath: "$.info.title",
						},
						data: "Same Title", // Will be redundant
					}),
					createOverlayPatch({
						selector: {
							jsonPath: "$.nonexistent",
						},
						data: {
							title: "Will not match",
						},
					}),
				],
			}),
			null,
			2,
		),
		"utf8",
	);

	await writeFile(
		targetPath,
		JSON.stringify({
			openapi: "3.0.0",
			info: {
				title: "Same Title",
			},
		}),
		"utf8",
	);

	try {
		await execFileAsync(process.execPath, [
			cliPath,
			"--overlay",
			overlayPath,
			"--input",
			targetPath,
			"--dry-run",
		]);
		assert.fail("Should have failed");
	} catch (error) {
		const err = error as { stderr: string };
		assert.match(err.stderr, /INVALID/);
		assert.match(err.stderr, /does not match any element/);
		assert.match(err.stderr, /Warnings/);
	}
});

test("merge --dry-run exits with code 1 and reports error when overlay file does not exist", async () => {
	try {
		await execFileAsync(process.execPath, [
			cliPath,
			"--overlay",
			"/nonexistent/path/overlay.json",
			"--input",
			"/nonexistent/path/target.json",
			"--dry-run",
		]);
		assert.fail("Should have exited with non-zero code");
	} catch (error) {
		const err = error as { code: number; stderr: string };
		assert.equal(err.code, 1);
		assert.match(err.stderr, /overlay-merge failed/);
	}
});
