# OpenCMO for Claude

The `opencmo` skill and OpenCMO's MCP server for Claude Code, plus the same skill as a zip for
claude.ai.

## Claude Code

1. Create an API key in OpenCMO → Settings → API keys.
2. `export OPENCMO_API_KEY=ocm_…` (and `OPENCMO_MCP_URL=…` to use another server than
   `https://opencmo.io/api/mcp`).
3. Install the plugin:

   ```bash
   claude plugin marketplace add ./plugins/opencmo-claude
   claude plugin install opencmo@opencmo
   ```

   Or try it for one session: `claude --plugin-dir ./plugins/opencmo-claude`.

Then say `/inbox`, `/plan-week` or "make a 30-second explainer of how invoicing reminders work".

## claude.ai and Claude Desktop

- Add a custom connector with the MCP URL (OAuth sign-in once the server supports it).
- Upload the skill: `plugins/opencmo-claude/scripts/zip-skill.sh`, then Settings → Capabilities →
  Skills → Upload `opencmo-skill.zip`.

The MCP server's prompts carry the same workflows for clients without the skill.
