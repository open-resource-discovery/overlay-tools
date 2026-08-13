// TODO: Replace vendored types with import from @open-resource-discovery/specification
// once the ORD Overlay types are published in the specification package.
export * from "./types";

import * as schema from "./OrdOverlay.schema.json";
export const ordOverlaySchema = schema;
