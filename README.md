[![REUSE status](https://api.reuse.software/badge/github.com/open-resource-discovery/overlay-tools)](https://api.reuse.software/info/github.com/open-resource-discovery/overlay-tools) [![CI](https://github.com/open-resource-discovery/overlay-tools/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/open-resource-discovery/overlay-tools/actions/workflows/main.yml) [![npm version](https://img.shields.io/npm/v/@open-resource-discovery/overlay-tools)](https://www.npmjs.com/package/@open-resource-discovery/overlay-tools)

# ORD Overlay Tools

Tools for merging, validating, and converting [ORD Overlay](https://open-resource-discovery.github.io/specification/spec-v1/interfaces/overlay) documents.

> **Alpha Status:** This tooling has been developed with AI assistance and is intended to validate the ORD Overlay specification under realistic conditions. Use with appropriate caution in production environments.

## Installation

```bash
npm install @open-resource-discovery/overlay-tools
```

## CLI Usage

```bash
npx ord-overlay <command> [options]
```

### Merge

Apply an ORD Overlay to a target document (JSON, YAML, or EDMX XML):

```bash
ord-overlay merge --overlay <overlay.json> --input <target-file> [options]

Options:
  --output <path>                  Output file path (default: stdout)
  --dry-run                        Validate overlay and selectors without applying changes
  --json                           Output the --dry-run report as JSON to stdout (requires --dry-run)
  --allow-no-match                 Do not fail if a patch selector has no matches
  --warn-on-no-match               Warn instead of failing if a patch selector has no matches
  --target-ord-id <ordId>          Validate overlay.target.ordId against this value
  --target-url <url>               URL context for target matching
  --target-definition-type <type>  Definition type (e.g. openapi-v3, edmx, csdl-json)
```

Example:

```bash
# Apply overlay
ord-overlay merge --overlay overlay.json --input api.oas3.json --target-definition-type openapi-v3
ord-overlay merge --overlay overlay.json --input service.edmx.xml --target-definition-type edmx

# Validate without applying (human-readable report on stderr)
ord-overlay merge --overlay overlay.json --input api.oas3.json --dry-run

# Validate and capture a machine-readable JSON report on stdout
ord-overlay merge --overlay overlay.json --input api.oas3.json --dry-run --json
ord-overlay merge --overlay overlay.json --input api.oas3.json --dry-run --json > report.json
```

### Convert

Convert enrichment formats (OpenAPI Overlay, OData v2/v4 Enrichments) to ORD Overlay:

```bash
ord-overlay convert <input.json> [options]

Options:
  -o, --output <path>      Output file path (default: <input>.overlay.json)
  --format <format>        Source format: odatav2, odatav4, openapi-overlay (auto-detected)
  --definition-type <type> Target definition type (e.g. edmx, csdl-json)
  --namespace <namespace>  OData namespace for qualified selectors
  --ord-id <ordId>         Set ordId in overlay output
  --description <text>     Set description in overlay output
```

Example:

```bash
ord-overlay convert openapi-overlay.json
ord-overlay convert odata-enrichment.json --definition-type edmx --namespace My.Service
```

## Programmatic API

```typescript
import {
  applyOverlayToDocument,
  applyOverlayToEdmxDocument,
  validateOverlay,
  validateOverlayWithTarget,
  convertOpenApiOverlayToOrd,
  convertODataV4EnrichmentToOrd,
} from "@open-resource-discovery/overlay-tools";
```

### Merge

```typescript
import { applyOverlayToDocument } from "@open-resource-discovery/overlay-tools";

const overlay = JSON.parse(fs.readFileSync("overlay.json", "utf8"));
const target = JSON.parse(fs.readFileSync("api.json", "utf8"));

const merged = applyOverlayToDocument(target, overlay, {
  context: { definitionType: "openapi-v3" },
});
```

For EDMX XML targets:

```typescript
import { applyOverlayToEdmxDocument } from "@open-resource-discovery/overlay-tools";

const xmlString = fs.readFileSync("service.edmx.xml", "utf8");
const patchedXml = applyOverlayToEdmxDocument(xmlString, overlay);
```

### Validate

```typescript
import { validateOverlay, validateOverlayWithTarget } from "@open-resource-discovery/overlay-tools";

// Schema + semantics only
const result = validateOverlay(overlay);
if (!result.valid) {
  console.error(result.errors);
}

// With target document
const fullResult = validateOverlayWithTarget(overlay, targetDocument, {
  definitionType: "openapi-v3",
});
```

### Convert

```typescript
import { convertOpenApiOverlayToOrd } from "@open-resource-discovery/overlay-tools";

const openapiOverlay = JSON.parse(fs.readFileSync("openapi-overlay.json", "utf8"));
const { overlay, warnings } = convertOpenApiOverlayToOrd(openapiOverlay);
```

## Subpath Imports

For tree-shaking or when you only need one module:

```typescript
import { applyOverlayToDocument } from "@open-resource-discovery/overlay-tools/merge";
import { convertOpenApiOverlayToOrd } from "@open-resource-discovery/overlay-tools/convert";
```

## Supported Formats

### Selector Types

| Selector | Supported target formats |
|---|---|
| `jsonPath` | Any JSON/YAML document |
| `root` | Any document |
| `operation` | OpenAPI, MCP, A2A Agent Card, CSDL JSON, EDMX |
| `entityType` | CSDL JSON, EDMX, CSN Interop |
| `complexType` | CSDL JSON, EDMX |
| `enumType` | CSDL JSON, EDMX |
| `propertyType` | CSDL JSON, EDMX, CSN Interop |
| `entitySet` | CSDL JSON, EDMX |
| `namespace` | CSDL JSON, EDMX |
| `parameter` | OpenAPI, CSDL JSON, EDMX |
| `returnType` | CSDL JSON, EDMX |

### Patch Actions

- **merge** - Deep merge data into matched elements
- **update** - Replace matched elements entirely
- **remove** - Remove matched elements or specific fields

## Links

- [ORD Overlay Specification](https://open-resource-discovery.github.io/specification/spec-v1/interfaces/overlay)
- [ORD Specification](https://open-resource-discovery.org)
- [Examples](./examples/)

## Development

```bash
npm ci                   # Install dependencies
npm run build            # Compile TypeScript to dist/
npm test                 # Build + run all unit tests
npm run check            # Lint + format check + tests (run before committing)
```

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/open-resource-discovery/overlay-tools).
