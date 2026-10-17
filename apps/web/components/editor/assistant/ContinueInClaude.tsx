"use client";

/**
 * "Continue in Claude" (mode B): when OpenCMO's own AI is not thinking for the founder (fewer
 * credits than one Assistant request, or our AI cannot answer), their own Claude can do the
 * planning and writing over MCP at no credit cost. Shown in the Assistant panel and the CMO chat.
 * Renders nothing in mode A.
 */

import { useEffect, useState } from "react";

import { api } from "@/components/clipping/api";

type Mode = { brain: "opencmo" | "claude"; reason: "ok" | "credits" | "llm_down" | "forced"; credits: number; inbox: number; mcp_url: string | null };

const command = (url: string) => `claude mcp add --transport http opencmo ${url} --header "Authorization: Bearer <your API key>"`;

export function ContinueInClaude({ where }: { where: "assistant" | "cmo" }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    api<Mode>("/cmo/mode")
      .then((body) => live && setMode(body))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // No MCP server configured: there is nothing to connect to.
  if (!mode || mode.brain !== "claude" || !mode.mcp_url) return null;
  const url = mode.mcp_url;

  const why =
    mode.reason === "credits"
      ? `You have ${mode.credits} ${mode.credits === 1 ? "credit" : "credits"}, less than one ${where === "assistant" ? "Assistant request" : "CMO task"}.`
      : mode.reason === "llm_down"
        ? "OpenCMO's AI can't answer right now."
        : "This server sends the thinking to your own Claude.";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command(url));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="cic" role="status" data-testid="continue-in-claude">
      <p className="cic-title">Continue in Claude</p>
      <p className="cic-text">
        {why} Connect your own Claude to OpenCMO and it can plan, write and edit for you at no credit cost. Images, video, voice and
        renders still use credits.
      </p>
      {mode.inbox > 0 ? (
        <p className="cic-text" data-testid="continue-in-claude-inbox">
          <strong>
            {mode.inbox} {mode.inbox === 1 ? "task waits" : "tasks wait"} in your Claude inbox.
          </strong>{" "}
          Type /inbox in Claude to do {mode.inbox === 1 ? "it" : "them"}; the drafts come back here for you to approve.
        </p>
      ) : null}
      <ol className="cic-steps">
        <li>
          Create an API key in <a href="/app/settings">Settings</a>.
        </li>
        <li>
          Claude Code: run{" "}
          <button type="button" className="cic-copy" onClick={() => void copy()} data-testid="continue-in-claude-copy">
            {copied ? "Copied" : "Copy command"}
          </button>
          <code className="cic-code">{command(url)}</code>
        </li>
        <li>
          Claude Desktop or claude.ai: add a custom connector with <code className="cic-code">{url}</code>
        </li>
      </ol>
      {mode.reason === "credits" ? (
        <p className="cic-text">
          Or <a href="/app/billing">top up credits</a> to keep using OpenCMO&apos;s AI.
        </p>
      ) : null}
    </div>
  );
}
