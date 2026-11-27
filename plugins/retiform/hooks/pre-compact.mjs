// Before compaction, ask the summary to retain the identifiers needed to continue the session's recorded work.
//
// Claude Code uses a PreCompact hook's stdout as instructions for the compaction summary, which is written without
// tools, so the hook cannot record anything itself. In a linked repository it asks the summary to keep what the
// session recorded in Retiform, so that the compacted session, told by session-start.mjs to record its hand-off, can
// supersede its earlier hand-off instead of adding a second one. Outside a link it prints nothing.
// Like the session-start hook, it makes no network call, reads only its input and the link file, and never throws.
import { isEntry, readLink } from './link.mjs';

/** The summary instruction's own version, raised whenever its text changes. */
export const SUMMARY_VERSION = 1;

/** The fixed text the compaction summary is asked to follow. */
export function summaryInstruction() {
  return `Retiform (summary instruction version ${SUMMARY_VERSION}): keep the entryId of each hand-off and ` +
    'decision this session recorded or superseded in Retiform, and say which is its latest hand-off.';
}

function parse(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The hook's stdout for its stdin text: the summary instruction in a linked repository, else nothing. */
export function respond(stdinText, { cwd }) {
  const input = parse(stdinText);
  const link = readLink(typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : cwd);
  return link.status === 'linked' ? summaryInstruction() : '';
}

async function readAll(stream) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

/** Runs the hook: reads stdin, writes its output. Never throws, so the compaction always goes ahead. */
export async function main({ stdin, stdout, cwd }) {
  try {
    stdin.setEncoding?.('utf8');
    stdout.write(respond(await readAll(stdin), { cwd }));
  } catch {
    // The compaction goes ahead without the instruction.
  }
}

if (isEntry(import.meta.url, process.argv[1])) {
  await main({ stdin: process.stdin, stdout: process.stdout, cwd: process.cwd() });
}
