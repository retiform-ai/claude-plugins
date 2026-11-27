// Build the import's candidate list inside the developer's session. Run by the import skill as
// `node "${CLAUDE_PLUGIN_ROOT}/hooks/import-files.mjs"`, it prints one JSON list: the repository's
// instruction files and decision records the skill may propose to upload, and each candidate it skipped with the
// reason. It uploads nothing and reads no file's content into its output.
//
// `--stage <path>...` copies the confirmed candidates into a new folder for `kg upload <folder>` (step 2), and
// `--clean <folder>` removes that folder afterwards. Upload skips a path with a segment starting with
// `.` and any extension but Markdown's, and name a file chosen on its own by its path from the current folder, so the copies are
// renamed by uploadName and sit under a folder named after the linked Project: each one's external identifier is
// `<project>/<uploadName(path)>`, the same in every clone and unique in the tenant.
//
// The candidate lists:
//
// - Instruction files: INSTRUCTION_FILES at the repository root (or the given path below it), and the Markdown files
//   directly in INSTRUCTION_FOLDERS.
// - Decision records: the Markdown files directly in DECISION_FOLDERS, less indexes and templates (NOT_RECORDS).
// - Skipped as secret-bearing: a candidate whose name matches SECRET_NAMES, or whose text matches one of
//   SECRET_PATTERNS. Either way it is reported by its path and the pattern's name, never its content.
//
// Only the repository is read: its root is the nearest directory at or above the working directory holding `.git`,
// a symbolic link is never followed (in a folder named here or in the path to it), and a file larger than
// MAX_FILE_BYTES is skipped. Outside a repository the list is empty and the exit status is 2.
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_PATTERN, readLink } from './link.mjs';

export const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CONVENTIONS.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.github/copilot-instructions.md',
];
export const INSTRUCTION_FOLDERS = [
  '.claude/rules',
  '.cursor/rules',
  '.windsurf/rules',
  '.clinerules',
  '.amazonq/rules',
  '.github/instructions',
];
export const DECISION_FOLDERS = [
  'adr',
  'adrs',
  'decisions',
  'doc/adr',
  'doc/decisions',
  'docs/adr',
  'docs/adrs',
  'docs/decisions',
  'docs/architecture/decisions',
  'architecture/decisions',
];
export const RECORD_SUFFIXES = ['.md', '.mdc', '.markdown'];
// An index or a template in a decision folder is not a decision.
export const NOT_RECORDS = /^(?:readme|index|template|adr-template|0000-template|_template)\.(?:md|markdown)$/i;
export const SECRET_NAMES = [
  { name: 'environment file', pattern: /^\.env(?:\..*)?$/i },
  { name: 'key or certificate file', pattern: /\.(?:pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i },
  { name: 'SSH key', pattern: /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i },
  { name: 'credentials file', pattern: /^(?:\.netrc|\.npmrc|\.pypirc|\.htpasswd|credentials(?:\..*)?)$/i },
  { name: 'secret in the name', pattern: /(?:secret|credential|passw(?:or)?d)/i },
];
export const SECRET_PATTERNS = [
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'cloud access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'source host token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,})\b/ },
  { name: 'chat token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { name: 'provider API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'URL with a password', pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i },
  {
    name: 'credential assignment',
    // No leading word boundary, so that `smtp_password = ...` matches.
    pattern: /(?:password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?[^\s"'$<{]{8,}/i,
  },
];
// Decision records and instruction files are small; a larger file is reported, not read.
export const MAX_FILE_BYTES = 1024 * 1024;

/** The repository root: the nearest directory at or above `start` holding `.git`, or null. */
export function findRoot(start) {
  let directory = resolve(start);
  for (;;) {
    if (exists(join(directory, '.git'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The entry at `relative` under `root`, if every part of the path is a real directory or file and none is a
 * symbolic link: `{ kind: 'file', size }`, `{ kind: 'directory' }`, `{ kind: 'link', at }` naming the first part of
 * the path that is a symbolic link, or null when absent.
 */
export function entryAt(root, relative) {
  let path = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    path = join(path, parts[index]);
    let stats;
    try {
      stats = lstatSync(path);
    } catch {
      return null;
    }
    if (stats.isSymbolicLink()) return { kind: 'link', at: parts.slice(0, index + 1).join('/') };
    const last = index === parts.length - 1;
    if (!last && !stats.isDirectory()) return null;
    if (last) {
      if (stats.isDirectory()) return { kind: 'directory' };
      return stats.isFile() ? { kind: 'file', size: stats.size } : null;
    }
  }
  return null;
}

/** The secret-bearing name or pattern a file matches, by its name and text, or null. */
export function secretReason(fileName, text) {
  for (const rule of SECRET_NAMES) {
    if (rule.pattern.test(fileName)) return rule.name;
  }
  if (text === undefined) return null;
  for (const rule of SECRET_PATTERNS) {
    if (rule.pattern.test(text)) return rule.name;
  }
  return null;
}

function isRecord(fileName) {
  const lower = fileName.toLowerCase();
  return RECORD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** The relative paths of the candidate files, with their kinds, in a stable order, and the symbolic links met. */
function locate(root) {
  const found = new Map();
  const links = new Map();
  const addLink = (path, kind) => {
    if (!links.has(path)) links.set(path, kind);
  };
  const add = (path, kind) => {
    if (!found.has(path)) found.set(path, kind);
  };
  for (const path of INSTRUCTION_FILES) {
    const entry = entryAt(root, path);
    if (entry?.kind === 'file') add(path, 'instructions');
    else if (entry?.kind === 'link') addLink(entry.at, 'instructions');
  }
  const folders = [
    ...INSTRUCTION_FOLDERS.map((folder) => ({ folder, kind: 'instructions' })),
    ...DECISION_FOLDERS.map((folder) => ({ folder, kind: 'decision-record' })),
  ];
  for (const { folder, kind } of folders) {
    const entry = entryAt(root, folder);
    if (entry?.kind === 'link') {
      addLink(entry.at, kind);
      continue;
    }
    if (entry?.kind !== 'directory') continue;
    const names = readdirSync(join(root, ...folder.split('/')), { withFileTypes: true })
      .map((dirent) => ({ name: dirent.name, link: dirent.isSymbolicLink(), file: dirent.isFile() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const { name, link, file } of names) {
      const path = folder + '/' + name;
      if (kind === 'decision-record' && NOT_RECORDS.test(name)) continue;
      if (link) {
        if (isRecord(name) || secretReason(name) !== null) addLink(path, kind);
        continue;
      }
      if (!file) continue;
      if (isRecord(name) || secretReason(name) !== null) add(path, kind);
    }
  }
  return { found, links };
}

/**
 * The candidate list for the repository holding `start`: `{ root, entries }`, where each entry is
 * `{ path, kind, bytes }` for a file to propose, or `{ path, kind, skipped }` with the reason it was left out.
 * `root` is null outside a repository. `read` reads a file's text; tests pass one that fails.
 */
export function listCandidates(start, read = readFileSync) {
  const root = findRoot(start);
  if (root === null) return { root: null, entries: [] };
  const real = realpathSync(root);
  const { found, links } = locate(root);
  const entries = [];
  for (const [path, kind] of found) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const byName = secretReason(name);
    if (byName !== null) {
      entries.push({ path, kind, skipped: byName });
      continue;
    }
    const absolute = join(root, ...path.split('/'));
    const entry = entryAt(root, path);
    if (entry.size > MAX_FILE_BYTES) {
      entries.push({ path, kind, skipped: 'too large' });
      continue;
    }
    let text;
    try {
      // The path was checked part by part above; its real path must still be inside the repository.
      const resolved = realpathSync(absolute);
      if (resolved !== real && !resolved.startsWith(real + sep)) {
        entries.push({ path, kind, skipped: 'outside the repository' });
        continue;
      }
      text = read(resolved, 'utf8');
    } catch {
      entries.push({ path, kind, skipped: 'unreadable' });
      continue;
    }
    const byText = secretReason('', text);
    entries.push(byText === null ? { path, kind, bytes: entry.size } : { path, kind, skipped: byText });
  }
  for (const [path, kind] of links) entries.push({ path, kind, skipped: 'symbolic link' });
  return { root, entries };
}

/** The prefix of a staging folder's parent, in the system's temporary directory. */
export const STAGING_PREFIX = 'retiform-import-';
const UPLOADED_SUFFIXES = ['.md', '.markdown'];

/**
 * The name a candidate is uploaded under: each segment starting with `.` starts with `_` instead, and a name
 * without a Markdown extension gains `.md`. `.claude/rules/a.mdc` becomes `_claude/rules/a.mdc.md`. No documented
 * folder starts with `_`, so two candidates never share a name.
 */
export function uploadName(path) {
  const segments = path.split('/').map((segment) => (segment.startsWith('.') ? '_' + segment.slice(1) : segment));
  const last = segments.length - 1;
  if (!UPLOADED_SUFFIXES.some((suffix) => segments[last].toLowerCase().endsWith(suffix))) segments[last] += '.md';
  return segments.join('/');
}

/**
 * Copies the confirmed candidates `paths` of the repository holding `start` into a new folder, for `kg upload`.
 * Returns `{ status: 0, folder, files: [{ path, externalId }] }`; or `{ status: 1, error }`, copying nothing, when
 * the repository is not linked or a path is not a candidate to propose (a skipped one included); 2 outside one.
 */
export function stage(start, paths, read = readFileSync, into = tmpdir()) {
  const { root, entries } = listCandidates(start, read);
  if (root === null) return { status: 2, error: 'not in a repository' };
  const link = readLink(root);
  if (link.status !== 'linked') return { status: 1, error: 'the repository is not linked; run the link skill' };
  const wanted = [...new Set(paths)].sort();
  if (wanted.length === 0) return { status: 1, error: 'no file to stage' };
  const proposed = new Set(entries.filter((entry) => entry.skipped === undefined).map((entry) => entry.path));
  const refused = wanted.filter((path) => !proposed.has(path));
  if (refused.length > 0) return { status: 1, error: 'not a candidate to upload: ' + refused.join(', ') };
  const folder = join(mkdtempSync(join(into, STAGING_PREFIX)), link.project);
  const files = wanted.map((path) => {
    const name = uploadName(path);
    const target = join(folder, ...name.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, read(join(root, ...path.split('/')), 'utf8'));
    return { path, externalId: link.project + '/' + name };
  });
  return { status: 0, folder, files };
}

/**
 * Removes a folder that `stage` made (a Project's folder in a STAGING_PREFIX folder directly in `into`) and its
 * parent. Returns 0, or 1 for any other path, which it leaves alone.
 */
export function clean(folder, into = tmpdir()) {
  const parent = dirname(resolve(folder));
  const made = dirname(parent) === resolve(into) && basename(parent).startsWith(STAGING_PREFIX);
  if (!made || !PROJECT_PATTERN.test(basename(folder))) return 1;
  rmSync(parent, { recursive: true, force: true });
  return 0;
}

/**
 * Runs the command for `args`: none prints the list for `start` (exit 0, or 2 outside a repository); `--stage
 * <path>...` prints `{ folder, files }` or `{ error }`; `--clean <folder>` prints one line. Returns the exit status.
 */
export function main(start, out, args = []) {
  if (args[0] === '--stage') {
    const result = stage(start, args.slice(1));
    const printed = result.status === 0 ? { folder: result.folder, files: result.files } : { error: result.error };
    out.write(JSON.stringify(printed, null, 2) + '\n');
    return result.status;
  }
  if (args[0] === '--clean') {
    const status = args.length === 2 ? clean(args[1]) : 1;
    out.write(status === 0 ? 'Removed the staging folder.\n' : 'Not a staging folder; nothing removed.\n');
    return status;
  }
  if (args.length > 0) {
    out.write('Usage: node import-files.mjs [--stage <path>... | --clean <folder>]\n');
    return 2;
  }
  const { root, entries } = listCandidates(start);
  out.write(JSON.stringify(entries, null, 2) + '\n');
  return root === null ? 2 : 0;
}

/** Whether this module is the process's entry script (real paths, case-folded on Windows). */
export function isMain(argv1, moduleUrl) {
  if (argv1 === undefined) return false;
  let entry;
  let self;
  try {
    entry = realpathSync(argv1);
    self = realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
  return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
}

if (isMain(process.argv[1], import.meta.url)) {
  process.exitCode = main(process.cwd(), process.stdout, process.argv.slice(2));
}
