/**
 * Mobile Persona — switches between default pi prompt and a mobile-optimized one.
 *
 *   /mobile    —  enable mobile persona
 *   /default   —  back to built-in pi prompt
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE = join(homedir(), ".pi", "agent", ".mobile-persona");
const PROMPT = join(homedir(), ".pi", "agent", "SYSTEM-mobile.md");

async function enabled(): Promise<boolean> {
  try { await access(STATE); return true; } catch { return false; }
}

export default async function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async () => {
    if (!(await enabled())) return;
    const content = await readFile(PROMPT, "utf-8");
    return { systemPrompt: content };
  });

  pi.registerCommand("mobile", {
    description: "Switch to mobile-optimized persona",
    async handler(_args, ctx) {
      await writeFile(STATE, "");
      ctx.ui.notify("📱 Mobile persona active.", "info");
    },
  });

  pi.registerCommand("default", {
    description: "Restore the default pi persona",
    async handler(_args, ctx) {
      try { await unlink(STATE); } catch { /* already off */ }
      ctx.ui.notify("🔄 Default persona active.", "info");
    },
  });
}
