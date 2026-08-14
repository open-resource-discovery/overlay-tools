#!/usr/bin/env node

const subcommand = process.argv[2];

function printUsage(): void {
	const usage = `
ord-overlay - Tools for ORD Overlay documents

Usage:
  ord-overlay <command> [options]

Commands:
  merge     Apply an overlay to a target document (use --dry-run to validate without applying)
  convert   Convert enrichment formats to ORD Overlay

Run 'ord-overlay <command> --help' for details on each command.
`.trim();
	console.log(usage);
}

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
	printUsage();
	process.exit(0);
}

// Strip the subcommand from argv so each CLI sees its own arguments
process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];

switch (subcommand) {
	case "merge":
		require("./merge/cli");
		break;
	case "convert":
		require("./convert/cli");
		break;
	default:
		console.error(`Unknown command: ${subcommand}`);
		printUsage();
		process.exit(1);
}
