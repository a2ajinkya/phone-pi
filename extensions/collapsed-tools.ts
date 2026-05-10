/**
 * Collapsed Tools Extension - Hide tool output body, keep call + status lines
 *
 * Collapsed mode (default): Shows tool call line + status/duration line, hides body
 * Expanded mode (ctrl+o): Delegates to built-in renderers for full output
 *
 * Usage:
 *   Place in ~/.pi/agent/extensions/collapsed-tools.ts
 *   Or: pi -e ./collapsed-tools.ts
 */

import type { ExtensionAPI, ToolRenderContext } from "@earendil-works/pi-coding-agent";
import {
	type BashToolDetails,
	type EditToolDetails,
	type ReadToolDetails,
	createBashTool,
	createBashToolDefinition,
	createEditTool,
	createEditToolDefinition,
	createFindTool,
	createFindToolDefinition,
	createGrepTool,
	createGrepToolDefinition,
	createLsTool,
	createLsToolDefinition,
	createReadTool,
	createReadToolDefinition,
	createWriteTool,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { homedir } from "os";

function shortenPath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

// Cache for built-in tool instances and definitions by cwd
const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
		readDef: createReadToolDefinition(cwd),
		bashDef: createBashToolDefinition(cwd),
		editDef: createEditToolDefinition(cwd),
		writeDef: createWriteToolDefinition(cwd),
		findDef: createFindToolDefinition(cwd),
		grepDef: createGrepToolDefinition(cwd),
		lsDef: createLsToolDefinition(cwd),
	};
}

function getBuiltInTools(cwd: string) {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = createBuiltInTools(cwd);
		toolCache.set(cwd, tools);
	}
	return tools;
}

/**
 * Extract the "Took Xs" line from bash output by delegating to the built-in
 * result renderer, then pulling just the last child component.
 * For simplicity, we compute duration from details and show it ourselves.
 */
function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export default function (pi: ExtensionAPI) {
	// ─── Bash ───────────────────────────────────────────────────────────
	pi.registerTool({
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first).",
		parameters: getBuiltInTools(process.cwd()).bash.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			// Delegate to the built-in call renderer
			return tools.bashDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				// Delegate to the built-in result renderer for full output
				const tools = getBuiltInTools(context.cwd);
				return tools.bashDef.renderResult!(result, options, theme, context);
			}

			// Collapsed: just show status + duration (no body)
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}

			// Live-updating timer while running
			if (options.isPartial && !context.isError) {
				if (state.startedAt !== undefined && !state.interval) {
					state.interval = setInterval(() => context.invalidate(), 1000);
				}
				const elapsed = state.startedAt ? formatDuration(Date.now() - state.startedAt) : "...";
				return new Text(theme.fg("muted", `⏳ ${elapsed}`), 0, 0);
			}

			// Final result — stop timer
			if (state.interval) {
				clearInterval(state.interval);
				state.interval = undefined;
			}
			state.endedAt ??= Date.now();

			// Error result (non-zero exit, timeout, aborted)
			if (context.isError) {
				const content = result.content[0];
				const output = content?.type === "text" ? content.text : "";
				const exitMatch = output.match(/exit code: (\d+)/);
				const timeoutMatch = output.match(/timed out after (\d+) seconds/);
				const abortedMatch = output.match(/aborted/);

				let text = theme.fg("error", "✗ ");
				if (exitMatch) {
					text += theme.fg("error", `exit ${exitMatch[1]}`);
				} else if (timeoutMatch) {
					text += theme.fg("error", `timeout (${timeoutMatch[1]}s)`);
				} else if (abortedMatch) {
					text += theme.fg("error", "aborted");
				} else {
					text += theme.fg("error", "failed");
				}

				if (state.startedAt) {
					const end = state.endedAt ?? Date.now();
					text += theme.fg("muted", ` • Took ${formatDuration(end - state.startedAt)}`);
				}

				return new Text(text, 0, 0);
			}

			// Success
			let text = theme.fg("success", "✓ done");

			// Show duration
			if (state.startedAt) {
				const end = state.endedAt ?? Date.now();
				text += theme.fg("muted", ` • Took ${formatDuration(end - state.startedAt)}`);
			}

			// Truncation notice
			const details = result.details as BashToolDetails | undefined;
			if (details?.truncation?.truncated || details?.fullOutputPath) {
				text += theme.fg("warning", " [truncated]");
			}

			return new Text(text, 0, 0);
		},
	});

	// ─── Read ───────────────────────────────────────────────────────────
	pi.registerTool({
		name: "read",
		label: "read",
		description:
			"Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files.",
		parameters: getBuiltInTools(process.cwd()).read.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			return tools.readDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				const tools = getBuiltInTools(context.cwd);
				return tools.readDef.renderResult!(result, options, theme, context);
			}

			if (options.isPartial) {
				return new Text(theme.fg("muted", "⏳"), 0, 0);
			}

			if (context.isError) {
				return new Text(theme.fg("error", "✗ Read failed"), 0, 0);
			}

			const details = result.details as ReadToolDetails | undefined;
			const content = result.content[0];

			if (content?.type === "image") {
				return new Text(theme.fg("success", "✓ Image loaded"), 0, 0);
			}
			if (content?.type !== "text") {
				return new Text(theme.fg("error", "✗ No content"), 0, 0);
			}

			const lineCount = content.text.split("\n").length;
			let text = theme.fg("success", "✓ ");
			text += theme.fg("dim", `${lineCount} lines`);
			if (details?.truncation?.truncated) {
				text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
			}
			return new Text(text, 0, 0);
		},
	});

	// ─── Edit ───────────────────────────────────────────────────────────
	pi.registerTool({
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: getBuiltInTools(process.cwd()).edit.parameters,
		renderShell: "self",

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			return tools.editDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				const tools = getBuiltInTools(context.cwd);
				return tools.editDef.renderResult!(result, options, theme, context);
			}

			if (options.isPartial) {
				return new Text(theme.fg("muted", "⏳"), 0, 0);
			}

			const details = result.details as EditToolDetails | undefined;
			const content = result.content[0];

			// Error
			if (context.isError || (content?.type === "text" && content.text.startsWith("Error"))) {
				const errLine = content?.type === "text" ? content.text.split("\n")[0] : "Error";
				return new Text(theme.fg("error", `✗ ${errLine}`), 0, 0);
			}

			// Count diff
			let additions = 0;
			let removals = 0;
			if (details?.diff) {
				for (const line of details.diff.split("\n")) {
					if (line.startsWith("+") && !line.startsWith("+++")) additions++;
					if (line.startsWith("-") && !line.startsWith("---")) removals++;
				}
			}

			let text = theme.fg("success", "✓ ");
			text += theme.fg("success", `+${additions}`);
			text += theme.fg("dim", " / ");
			text += theme.fg("error", `-${removals}`);
			return new Text(text, 0, 0);
		},
	});

	// ─── Write ──────────────────────────────────────────────────────────
	pi.registerTool({
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: getBuiltInTools(process.cwd()).write.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			return tools.writeDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				const tools = getBuiltInTools(context.cwd);
				return tools.writeDef.renderResult!(result, options, theme, context);
			}

			if (options.isPartial) {
				return new Text(theme.fg("muted", "⏳"), 0, 0);
			}

			if (context.isError) {
				const content = result.content[0];
				const errLine = content?.type === "text" ? content.text.split("\n")[0] : "Write failed";
				return new Text(theme.fg("error", `✗ ${errLine}`), 0, 0);
			}

			const content = result.content[0];
			if (content?.type === "text" && content.text.startsWith("Error")) {
				return new Text(theme.fg("error", `✗ ${content.text.split("\n")[0]}`), 0, 0);
			}

			return new Text(theme.fg("success", "✓ Written"), 0, 0);
		},
	});

	// ─── Find ───────────────────────────────────────────────────────────
	pi.registerTool({
		name: "find",
		label: "find",
		description:
			"Find files by name pattern (glob). Searches recursively from the specified path. Output limited to 1000 results.",
		parameters: getBuiltInTools(process.cwd()).find.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			return tools.findDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				const tools = getBuiltInTools(context.cwd);
				return tools.findDef.renderResult!(result, options, theme, context);
			}

			if (options.isPartial) {
				return new Text(theme.fg("muted", "⏳"), 0, 0);
			}

			if (context.isError) {
				return new Text(theme.fg("error", "✗ Search failed"), 0, 0);
			}

			const content = result.content[0];
			if (content?.type !== "text") return new Text("", 0, 0);

			const lines = content.text.trim().split("\n").filter(Boolean);
			if (lines.length === 0 || content.text.includes("No files found")) {
				return new Text(theme.fg("dim", "0 files"), 0, 0);
			}

			let text = theme.fg("success", "✓ ");
			text += theme.fg("dim", `${lines.length} file${lines.length !== 1 ? "s" : ""}`);
			return new Text(text, 0, 0);
		},
	});

	// ─── Grep ───────────────────────────────────────────────────────────
	pi.registerTool({
		name: "grep",
		label: "grep",
		description:
			"Search file contents by regex pattern. Uses ripgrep for fast searching. Output limited to 200 matches.",
		parameters: getBuiltInTools(process.cwd()).grep.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			return tools.grepDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				const tools = getBuiltInTools(context.cwd);
				return tools.grepDef.renderResult!(result, options, theme, context);
			}

			if (options.isPartial) {
				return new Text(theme.fg("muted", "⏳"), 0, 0);
			}

			if (context.isError) {
				return new Text(theme.fg("error", "✗ Search failed"), 0, 0);
			}

			const content = result.content[0];
			if (content?.type !== "text") return new Text("", 0, 0);

			const lines = content.text.trim().split("\n").filter(Boolean);
			if (lines.length === 0 || content.text.includes("No matches")) {
				return new Text(theme.fg("dim", "0 matches"), 0, 0);
			}

			let text = theme.fg("success", "✓ ");
			text += theme.fg("dim", `${lines.length} match${lines.length !== 1 ? "es" : ""}`);
			return new Text(text, 0, 0);
		},
	});

	// ─── Ls ─────────────────────────────────────────────────────────────
	pi.registerTool({
		name: "ls",
		label: "ls",
		description:
			"List directory contents with file sizes. Shows files and directories with their sizes. Output limited to 500 entries.",
		parameters: getBuiltInTools(process.cwd()).ls.parameters,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const tools = getBuiltInTools(context.cwd);
			return tools.lsDef.renderCall!(args, theme, context);
		},

		renderResult(result, options, theme, context) {
			if (options.expanded) {
				const tools = getBuiltInTools(context.cwd);
				return tools.lsDef.renderResult!(result, options, theme, context);
			}

			if (options.isPartial) {
				return new Text(theme.fg("muted", "⏳"), 0, 0);
			}

			if (context.isError) {
				return new Text(theme.fg("error", "✗ List failed"), 0, 0);
			}

			const content = result.content[0];
			if (content?.type !== "text") return new Text("", 0, 0);

			const lines = content.text.trim().split("\n").filter(Boolean);
			if (lines.length === 0) {
				return new Text(theme.fg("dim", "empty"), 0, 0);
			}

			let text = theme.fg("success", "✓ ");
			text += theme.fg("dim", `${lines.length} entr${lines.length !== 1 ? "ies" : "y"}`);
			return new Text(text, 0, 0);
		},
	});
}
