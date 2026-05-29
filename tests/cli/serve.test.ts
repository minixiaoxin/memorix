import { describe, expect, it } from 'vitest';

import { resolveServeProject } from '../../src/cli/commands/serve-shared.js';
import type { ProjectInfo } from '../../src/types.js';

function makeProject(id: string, rootPath: string, gitRemote?: string): ProjectInfo {
  return {
    id,
    name: id.split('/').pop() || id,
    rootPath,
    gitRemote,
  };
}

describe('serve-shared', () => {
  it('resolves a direct project from cwd (directory-based identity)', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/repo',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/repo' ? makeProject('local/repo', cwd) : null),
        findGitInSubdirs: () => null,
        isSystemDirectory: () => false,
        getGitRemoteIfExists: () => null,
      },
    );

    expect(result.detectedProject?.id).toBe('local/repo');
    expect(result.source).toBe('direct');
    expect(result.error).toBeUndefined();
  });

  it('resolves the first subdirectory when scanSubdirs is enabled', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/workspace',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/workspace/app' ? makeProject('local/app', cwd) : null),
        findGitInSubdirs: (cwd) => (cwd === 'E:/workspace' ? 'E:/workspace/app' : null),
        isSystemDirectory: () => false,
        getGitRemoteIfExists: () => null,
      },
      { scanSubdirs: true }, // Enable subdir scanning
    );

    // With new logic, projectId should be based on workspace root, not subdir
    expect(result.detectedProject?.id).toBe('local/workspace');
    expect(result.projectRoot).toBe('E:/workspace');
    expect(result.source).toBe('subdir');
  });

  it('does NOT scan subdirs by default (scanSubdirs: false)', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/workspace',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/workspace/app' ? makeProject('local/app', cwd) : null),
        findGitInSubdirs: (cwd) => (cwd === 'E:/workspace' ? 'E:/workspace/app' : null),
        isSystemDirectory: () => false,
        getGitRemoteIfExists: () => null,
      },
      // No scanSubdirs config - defaults to false
    );

    // Should fail because root has no git and subdir scanning is disabled
    expect(result.detectedProject).toBeNull();
    expect(result.source).toBe('unresolved');
  });

  it('restores the last known project when launched from a system directory', () => {
    const result = resolveServeProject(
      {
        processCwd: 'C:/Windows/System32',
        homeDir: 'C:/Users/tester',
        lastKnownProjectRoot: 'E:/repo',
      },
      {
        detectProject: (cwd) => (cwd === 'E:/repo' ? makeProject('local/repo', cwd) : null),
        findGitInSubdirs: () => null,
        isSystemDirectory: (cwd) => cwd.includes('System32'),
        getGitRemoteIfExists: () => null,
      },
    );

    expect(result.detectedProject?.id).toBe('local/repo');
    expect(result.projectRoot).toBe('E:/repo');
    expect(result.source).toBe('last-known');
  });

  it('fails when fallbackToPath is false and no project found', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/tools/CockpitTools',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: () => null,
        findGitInSubdirs: () => null,
        isSystemDirectory: () => false,
        getGitRemoteIfExists: () => null,
      },
      { fallbackToPath: false }, // Disable fallback
    );

    expect(result.detectedProject).toBeNull();
    expect(result.source).toBe('unresolved');
    expect(result.error).toContain('No project could be resolved');
  });

  it('succeeds with fallbackToPath true (default) even without git', () => {
    const result = resolveServeProject(
      {
        processCwd: 'E:/tools/MyProject',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: (cwd, config) => {
          // Simulate new behavior: use directory name when fallbackToPath is true
          if (config?.fallbackToPath !== false) {
            return makeProject('local/MyProject', cwd);
          }
          return null;
        },
        findGitInSubdirs: () => null,
        isSystemDirectory: () => false,
        getGitRemoteIfExists: () => null,
      },
    );

    expect(result.detectedProject?.id).toBe('local/MyProject');
    expect(result.source).toBe('direct');
  });

  it('fails for system directories when neither last-known nor home scan yields a project', () => {
    const result = resolveServeProject(
      {
        processCwd: 'C:/Windows/System32',
        homeDir: 'C:/Users/tester',
      },
      {
        detectProject: () => null,
        findGitInSubdirs: () => null,
        isSystemDirectory: (cwd) => cwd.includes('System32'),
        getGitRemoteIfExists: () => null,
      },
      { fallbackToPath: false },
    );

    expect(result.detectedProject).toBeNull();
    expect(result.error).toContain('No project could be resolved');
    expect(result.messages.join('\n')).toContain('System directory detected');
  });
});