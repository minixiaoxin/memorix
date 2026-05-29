/**
 * Project Detector
 *
 * Flexible project detection with directory-based identity.
 *
 * ID strategy (revised for flexibility):
 *   1. Config override (memorix.yml → project.id) → "local/<config-id>"
 *   2. Directory name at workspace root → "local/<dirname>"
 *   3. Fallback to null if fallbackToPath=false
 *
 * Git remote is stored separately for git memory features (optional).
 * This ensures project identity binds to user's workspace, not child repos.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ProjectInfo, DetectionResult, DetectionFailure } from '../types.js';

/** Configuration options for project detection */
export interface ProjectConfigOptions {
  /** Manually specify projectId (overrides auto-detection) */
  manualId?: string;
  /** Whether to scan subdirectories for git repo when root has no .git (default: false) */
  scanSubdirs?: boolean;
  /** Whether to use path-based projectId when no git repo found (default: true) */
  fallbackToPath?: boolean;
}

/**
 * Detect the current project identity.
 * Uses directory-based identity by default.
 * @param cwd - Working directory to detect from (defaults to process.cwd())
 * @param config - Optional configuration for detection behavior
 */
export function detectProject(cwd?: string, config?: ProjectConfigOptions): ProjectInfo | null {
  return detectProjectWithDiagnostics(cwd, config).project;
}

/**
 * Detect project with full diagnostic info.
 *
 * ID priority:
 *   1. Config override (config.manualId) → "local/<manualId>"
 *   2. Directory name at workspace root → "local/<dirname>"
 *   3. null if fallbackToPath=false and no git
 *
 * Git remote is detected separately and stored for git memory features.
 */
export function detectProjectWithDiagnostics(cwd?: string, config?: ProjectConfigOptions): DetectionResult {
  const basePath = cwd ?? process.cwd();

  // Check: does the path exist?
  if (!existsSync(basePath)) {
    return {
      project: null,
      failure: { reason: 'path_not_found', path: basePath, detail: `Path does not exist: "${basePath}"` },
    };
  }

  // Check: is it a directory?
  try {
    if (!statSync(basePath).isDirectory()) {
      return {
        project: null,
        failure: { reason: 'not_a_directory', path: basePath, detail: `Path is not a directory: "${basePath}"` },
      };
    }
  } catch {
    return {
      project: null,
      failure: { reason: 'path_not_found', path: basePath, detail: `Cannot stat path: "${basePath}"` },
    };
  }

  const dirName = path.basename(basePath);
  const fallbackToPath = config?.fallbackToPath !== false; // Default true

  // 1. Check for manual override in config
  if (config?.manualId) {
    const id = `local/${config.manualId}`;
    const gitRemote = getGitRemoteIfExists(basePath);
    return {
      project: { id, name: config.manualId, rootPath: basePath, gitRemote: gitRemote ?? undefined },
      failure: null,
    };
  }

  // 2. Try to detect git info (optional, for git memory)
  const gitRootResult = getGitRootWithDiagnostics(basePath);
  const gitRemote = gitRootResult.root ? getGitRemote(gitRootResult.root) : null;

  // 3. If git root found and it's NOT the workspace root, we have a child/subdirectory git
  //    Still use workspace root directory name as projectId, git is just for git memory
  if (gitRootResult.root && gitRootResult.root !== basePath) {
    // Git found in parent or child - still bind to workspace root
    return {
      project: { id: `local/${dirName}`, name: dirName, rootPath: basePath, gitRemote: gitRemote ?? undefined },
      failure: null,
    };
  }

  // 4. Git found at workspace root - use directory name, store git remote for git memory
  if (gitRootResult.root) {
    return {
      project: { id: `local/${dirName}`, name: dirName, rootPath: basePath, gitRemote: gitRemote ?? undefined },
      failure: null,
    };
  }

  // 5. No git found - use directory name if fallbackToPath is true
  if (fallbackToPath) {
    return {
      project: { id: `local/${dirName}`, name: dirName, rootPath: basePath },
      failure: null,
    };
  }

  // 6. No git and fallbackToPath=false - fail closed
  return {
    project: null,
    failure: {
      reason: 'no_git',
      path: basePath,
      detail: `No .git directory found in "${basePath}" and fallbackToPath is disabled.`,
    },
  };
}

/**
 * Get the Git repository root directory.
 * Returns null if not inside a git repository.
 */
function getGitRoot(cwd: string): string | null {
  return getGitRootWithDiagnostics(cwd).root;
}

/**
 * Get git root with diagnostic failure info.
 * Distinguishes: no_git, git_worktree_error, git_safe_directory.
 */
function getGitRootWithDiagnostics(cwd: string): { root: string | null; failure: DetectionFailure | null } {
  // Fast path: walk up to find .git directory (instant, no subprocess)
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  while (dir !== fsRoot) {
    const gitPath = path.join(dir, '.git');
    if (existsSync(gitPath)) {
      // .git may be a file (worktree) or directory (normal repo)
      try {
        const st = statSync(gitPath);
        if (st.isDirectory() || st.isFile()) return { root: dir, failure: null };
      } catch {
        return {
          root: null,
          failure: {
            reason: 'git_worktree_error',
            path: cwd,
            detail: `Found .git at "${gitPath}" but cannot stat it (permission denied or broken worktree link).`,
          },
        };
      }
    }
    dir = path.dirname(dir);
  }

  // Slow path: git CLI for edge cases (submodules, worktrees, bare repos)
  try {
    const root = execSync('git -c safe.directory=* rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    return root ? { root, failure: null } : { root: null, failure: null };
  } catch (err) {
    // Inspect stderr for known git error patterns
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('safe.directory') || msg.includes('dubious ownership')) {
      return {
        root: null,
        failure: {
          reason: 'git_safe_directory',
          path: cwd,
          detail: `Git refuses to operate in "${cwd}" due to ownership/safe.directory restrictions. ` +
            'Run: git config --global --add safe.directory "' + cwd + '"',
        },
      };
    }
    return {
      root: null,
      failure: { reason: 'no_git', path: cwd, detail: `No git repository found at "${cwd}" or any parent directory.` },
    };
  }
}

/**
 * Get the Git remote URL for the given directory (wrapper that never throws).
 * Returns null if not a git repository or no remote configured.
 * Use this when you want optional git info without affecting the main detection logic.
 */
export function getGitRemoteIfExists(cwd: string): string | null {
  return getGitRemote(cwd);
}

/**
 * Get the Git remote URL for the given directory.
 * Returns null if not a git repository or no remote configured.
 */
function getGitRemote(cwd: string): string | null {
  // Fast path: read .git/config directly (instant, no subprocess)
  const fsRemote = readGitConfigRemote(cwd);
  if (fsRemote) return fsRemote;

  // Slow path: git CLI for edge cases (submodules, worktrees, non-standard layouts)
  try {
    const remote = execSync('git -c safe.directory=* remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

/**
 * Fallback: parse remote.origin.url from .git/config when git CLI fails.
 * Handles Windows "dubious ownership" and other permission issues.
 */
function readGitConfigRemote(cwd: string): string | null {
  try {
    const configPath = path.join(cwd, '.git', 'config');
    if (!existsSync(configPath)) return null;
    const content = readFileSync(configPath, 'utf-8');
    // Parse INI-style: [remote "origin"] section, url = ...
    const remoteMatch = content.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
    if (!remoteMatch) return null;
    const urlMatch = remoteMatch[1].match(/^\s*url\s*=\s*(.+)$/m);
    return urlMatch ? urlMatch[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Detect if a directory is a "system directory" that's clearly not a user workspace.
 * These include Windows system dirs, IDE installation dirs, and temp dirs.
 */
export function isSystemDirectory(dir: string): boolean {
  const lower = dir.toLowerCase().replace(/\\/g, '/');
  return (
    lower.includes('/windows/') || lower.endsWith('/windows') ||
    lower.includes('/program files') ||
    lower.includes('/appdata/') ||
    // IDE installation directories
    /\/(windsurf|cursor|code|vscode)\/\1/i.test(lower) ||
    /\/windsurf\b/i.test(lower) && !lower.includes('.windsurf') ||
    // Node / npm internal paths
    lower.includes('/node_modules/') ||
    lower.includes('/nvm') ||
    // System root
    /^[a-z]:\/$/i.test(lower)
  );
}

/**
 * Scan immediate subdirectories for a .git directory.
 * Used when the workspace root itself isn't a git repo (multi-project workspace).
 * Returns the first subdirectory containing .git, or null.
 */
export function findGitInSubdirs(dir: string): string | null {
  try {
    const resolved = path.resolve(dir);
    const entries = readdirSync(resolved);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue; // skip hidden dirs
      const fullPath = path.join(resolved, entry);
      try {
        if (statSync(fullPath).isDirectory() && existsSync(path.join(fullPath, '.git'))) {
          return fullPath;
        }
      } catch { /* permission error, skip */ }
    }
  } catch { /* readdir failed */ }
  return null;
}

/**
 * Normalize a Git remote URL to a consistent project ID.
 *
 * Examples:
 *   https://github.com/user/repo.git  → user/repo
 *   git@github.com:user/repo.git      → user/repo
 *   ssh://git@github.com/user/repo    → user/repo
 */
function normalizeGitRemote(remote: string): string {
  let normalized = remote;

  // Remove trailing .git
  normalized = normalized.replace(/\.git$/, '');

  // Handle SSH format: git@github.com:user/repo
  const sshMatch = normalized.match(/^[\w-]+@[\w.-]+:(.+)$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  // Handle HTTPS/SSH URL format
  try {
    const url = new URL(normalized);
    // Remove leading slash
    return url.pathname.replace(/^\//, '');
  } catch {
    // If URL parsing fails, take last two segments
    const segments = normalized.split('/').filter(Boolean);
    return segments.slice(-2).join('/');
  }
}
