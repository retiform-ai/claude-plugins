---
name: decisions
description: List the decisions this session recorded or superseded in Retiform, with each entry's identifier. Use when the developer asks what was recorded.
---

# This session's decisions

List what this session recorded or superseded, from this session's own `record_memory` and `supersede_memory`
results. Do not query the platform for other sessions' entries.

For each entry, in the order written, show:

- whether it was recorded or superseded;
- its statement;
- its entry identifier;
- for a superseding entry, the identifier of the entry it replaced. When the developer asks for the earlier
  versions, call `get_memory_history` with the entry's `entryId`.

If this session recorded nothing, say so in one line. If the developer stopped recording, say from when.
