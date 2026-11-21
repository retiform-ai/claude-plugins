# Retiform plugins for Claude Code

This repository is the plugin marketplace for [Retiform](https://retiform.ai/), shared memory for your AI agents.
It holds one plugin, `retiform`.

## What the plugin does

In a code repository linked to one of your team's Retiform Projects, every Claude Code session starts by recalling
the decisions your team has recorded about it, and records new ones as they are made. Decisions are kept in your
Retiform tenant, each with its writer, its date and what it rests on, and a corrected one keeps its history.

The plugin adds:

- Retiform's MCP server, at `https://api.retiform.ai/mcp`. You sign in and approve it once.
- A session-start hook that tells the agent which Project the repository is linked to. It makes no network call.
- Four skills: `retiform:link`, `retiform:import`, `retiform:decisions` and `retiform:shared-decisions`.

## Install

You need a Retiform tenant, Claude Code, and Node.js 22 or later.

In Claude Code, run:

```text
/plugin marketplace add retiform-ai/claude-plugins
/plugin install retiform@retiform
```

Then restart Claude Code, run `/mcp`, choose the plugin's `retiform` server and authenticate.

The full guide, from installing to linking a repository, is at
[retiform.ai/docs/claude-code-plugin](https://retiform.ai/docs/claude-code-plugin/).

## What it stores, and where

- In your repository: `.retiform/project.json`, which holds only the Project's identifier. It holds no key, address
  or tenant data, and you commit it.
- On your computer: a record of which sessions the hook has already instructed, kept by a digest of the session's
  identifier and removed after 30 days.
- In your Retiform tenant: the decisions your sessions record.

The plugin holds no credential. Claude Code keeps the sign-in it obtains for the MCP server.

Privacy: Retiform's [privacy notice](https://retiform.ai/privacy/) says what the service keeps and for how long.

## Releases

Each release here is built from Retiform's source by a script, so the files under `plugins/retiform/` are generated.
Please do not open pull requests against them. Report a problem or ask a question at support@retiform.ai.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
