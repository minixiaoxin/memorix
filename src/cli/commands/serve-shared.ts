import type { ProjectInfo } from '../../types.js';
import type { ProjectConfigOptions } from '../../project/detector.js';

export interface ResolveServeProjectOptions {
  cwdArg?: string;
  envProjectRoot?: string;
  initCwd?: string;
  processCwd: string;
  homeDir: string;
  lastKnownProjectRoot?: string;
}

export interface ResolveServeProjectDeps {
  detectProject: (cwd: string, config?: ProjectConfigOptions) => ProjectInfo | null;
  findGitInSubdirs: (dir: string) => string | null;
  isSystemDirectory: (dir: string) => boolean;
  getGitRemoteIfExists: (cwd: string) => string | null;
}

export interface ServeProjectResolution {
  projectRoot: string;
  detectedProject: ProjectInfo | null;
  source: 'direct' | 'subdir' | 'last-known' | 'home' | 'home-subdir' | 'unresolved';
  messages: string[];
  error?: string;
}

/**
 * Resolve the serve project with flexible directory-based identity.
 *
 * Key behavior:
 * - projectId always binds to workspace root directory name
 * - gitRemote is detected separately for git memory features
 * - subdirectory scanning is disabled by default (scanSubdirs config)
 */
export function resolveServeProject(
  options: ResolveServeProjectOptions,
  deps: ResolveServeProjectDeps,
  projectConfig?: ProjectConfigOptions,
): ServeProjectResolution {
  let projectRoot =
    options.cwdArg ||
    options.envProjectRoot ||
    options.initCwd ||
    options.processCwd;

  const messages: string[] = [`[memorix] Starting with cwd: ${projectRoot}`];

  // Use flexible detection with config
  const config: ProjectConfigOptions = {
    manualId: projectConfig?.manualId,
    scanSubdirs: projectConfig?.scanSubdirs ?? false,
    fallbackToPath: projectConfig?.fallbackToPath ?? true,
  };

  let detected = deps.detectProject(projectRoot, config);
  if (detected) {
    return {
      projectRoot,
      detectedProject: detected,
      source: 'direct',
      messages,
    };
  }

  // Only scan subdirectories if explicitly configured
  if (config.scanSubdirs) {
    const subGit = deps.findGitInSubdirs(projectRoot);
    if (subGit) {
      // Still use ROOT directory name, not subGit directory
      const rootName = projectRoot.split(/[/\\]/).pop() || projectRoot;
      const gitRemote = deps.getGitRemoteIfExists(subGit);
      detected = {
        id: `local/${rootName}`,
        name: rootName,
        rootPath: projectRoot,
        gitRemote: gitRemote ?? undefined,
      };
      messages.push(`[memorix] Found .git in subdirectory: ${subGit}`);
      messages.push(`[memorix] Binding to workspace root: ${projectRoot}`);
      return {
        projectRoot,
        detectedProject: detected,
        source: 'subdir',
        messages,
      };
    }
  }

  if (deps.isSystemDirectory(projectRoot)) {
    messages.push(`[memorix] System directory detected: ${projectRoot}`);
    messages.push('[memorix] Your IDE launched memorix from a non-workspace directory.');
    messages.push('[memorix] Fix: add --cwd to your MCP config, or use an IDE/client that exposes workspace roots.');

    if (options.lastKnownProjectRoot) {
      detected = deps.detectProject(options.lastKnownProjectRoot, config);
      if (detected) {
        messages.push(`[memorix] Restored last known project: ${options.lastKnownProjectRoot}`);
        return {
          projectRoot: options.lastKnownProjectRoot,
          detectedProject: detected,
          source: 'last-known',
          messages,
        };
      }
    }

    detected = deps.detectProject(options.homeDir, config);
    if (detected) {
      messages.push(`[memorix] Restored project from home directory: ${options.homeDir}`);
      return {
        projectRoot: options.homeDir,
        detectedProject: detected,
        source: 'home',
        messages,
      };
    }

    // Only scan home subdirs if configured
    if (config.scanSubdirs) {
      const homeSubGit = deps.findGitInSubdirs(options.homeDir);
      if (homeSubGit) {
        detected = deps.detectProject(homeSubGit, config);
        if (detected) {
          messages.push(`[memorix] Found .git in home subdirectory: ${homeSubGit}`);
          return {
            projectRoot: homeSubGit,
            detectedProject: detected,
            source: 'home-subdir',
            messages,
          };
        }
      }
    }
  }

  messages.push('[memorix] Unable to establish a project context.');
  messages.push('[memorix] Tip: Ensure your workspace directory exists, or set project.fallbackToPath=true in memorix.yml');

  return {
    projectRoot,
    detectedProject: null,
    source: 'unresolved',
    messages,
    error:
      'No project could be resolved from the current workspace. Open a valid directory, pass --cwd, or enable fallbackToPath in memorix.yml.',
  };
}
