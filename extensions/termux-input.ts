/**
 * Termux Enhanced Input Extension v4
 *
 * Focus: reliability + lower perceived lag.
 *
 * - ENTER on empty editor => native keyboard dialog
 * - Ctrl+Shift+V or /voice => speech input
 * - /keyboard => open keyboard dialog manually
 * - Typed text + ENTER => normal submit
 *
 * v4 change: switched back to `termux-dialog` wrapper because direct
 * libexec path felt slower on this device setup.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

const CANCELLED_CODES = new Set([-1, 1]);
let extensionPi: ExtensionAPI;
let latestCtx: { isIdle?: () => boolean } | undefined;

interface DialogResult {
  code: number;
  text: string;
}

function parseDialogResult(stdout: string): DialogResult | null {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed.code === "number") {
      return { code: parsed.code, text: String(parsed.text ?? "") };
    }
  } catch {
    // ignore
  }
  return null;
}

async function runDialog(widget: "text" | "speech"): Promise<DialogResult | null> {
  const args =
    widget === "text"
      ? ["text", "-t", "pi input", "-m"]
      : ["speech", "-t", "Speak your message"];

  try {
    const result = await extensionPi.exec("termux-dialog", args);
    if (result.code !== null && CANCELLED_CODES.has(result.code)) return null;
    return parseDialogResult(result.stdout);
  } catch {
    return null;
  }
}

function sendUserTextSafely(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    const idle = latestCtx?.isIdle?.() ?? true;
    if (idle) {
      extensionPi.sendUserMessage(trimmed);
    } else {
      extensionPi.sendUserMessage(trimmed, { deliverAs: "steer" });
    }
  } catch {
    try {
      extensionPi.sendUserMessage(trimmed, { deliverAs: "followUp" });
    } catch {
      // swallow
    }
  }
}

class TermuxInputEditor extends CustomEditor {
  private openingKeyboard = false;
  private listening = false;

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+shift+v")) {
      if (this.openingKeyboard || this.listening) return;
      this.listening = true;
      void this.runSpeech();
      return;
    }

    if (matchesKey(data, "enter")) {
      if (this.openingKeyboard || this.listening) return;

      const editorText = this.getText()?.trim() ?? "";
      if (editorText) {
        super.handleInput(data);
        return;
      }

      this.openingKeyboard = true;
      void this.runKeyboard();
      return;
    }

    super.handleInput(data);
  }

  private async runKeyboard(): Promise<void> {
    try {
      const result = await runDialog("text");
      const text = result?.text?.trim();
      if (text) sendUserTextSafely(text);
    } finally {
      this.openingKeyboard = false;
    }
  }

  private async runSpeech(): Promise<void> {
    try {
      const result = await runDialog("speech");
      const text = result?.text?.trim();
      if (text) sendUserTextSafely(text);
    } finally {
      this.listening = false;
    }
  }

  render(width: number): string[] {
    if (this.openingKeyboard) return ["Opening keyboard…"];
    if (this.listening) return ["Listening… speak your message"];
    return super.render(width);
  }
}

export default function (pi: ExtensionAPI) {
  extensionPi = pi;

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;

    const check = await pi.exec("which", ["termux-dialog"]);
    if (check.code !== 0) {
      ctx.ui.setStatus("termux-input", "⚠ Install termux-api (pkg install termux-api)");
      return;
    }

    // Warm-up Termux:API process once at startup to reduce first-open delay.
    // This command is fast and non-interactive.
    void pi.exec("termux-battery-status", []).catch(() => undefined);

    ctx.ui.setStatus("termux-input", "⌨ ENTER=keyboard · Ctrl+Shift+V=/voice");
    ctx.ui.setEditorComponent((tui, theme, kb) => new TermuxInputEditor(tui, theme, kb));
  });

  pi.registerCommand("voice", {
    description: "Speak your message (speech-to-text)",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      const result = await runDialog("speech");
      const text = result?.text?.trim();
      if (text) sendUserTextSafely(text);
      ctx.ui.notify(text ? `Sent: ${text.slice(0, 60)}…` : "Cancelled", "info");
    },
  });

  pi.registerCommand("keyboard", {
    description: "Open Android text dialog manually",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      const result = await runDialog("text");
      const text = result?.text?.trim();
      if (text) sendUserTextSafely(text);
      ctx.ui.notify(text ? "Sent" : "Cancelled", "info");
    },
  });
}
