/**
 * Project Detector Tests
 *
 * Flexible directory-based identity: projectId = directory name
 * Git remote is detected separately for git memory features
 */

import { describe, it, expect } from 'vitest';
import { detectProject, detectProjectWithDiagnostics } from '../../src/project/detector.js';
import type { ProjectConfigOptions } from '../../src/project/detector.js';

describe('Project Detector', () => {
  it('should detect current project (this repo has .git)', () => {
    const project = detectProject();
    expect(project).not.toBeNull();
    expect(project!.id).toBeTruthy();
    expect(project!.name).toBeTruthy();
    expect(project!.rootPath).toBeTruthy();
    // With new logic, projectId should be based on directory name
    expect(project!.id.startsWith('local/')).toBe(true);
  }, 30_000);

  it('should detect project from a specific directory with .git', () => {
    const project = detectProject(process.cwd());
    expect(project).not.toBeNull();
    // Normalize path separators for cross-platform compatibility
    expect(project!.rootPath.replace(/\\/g, '/')).toBe(process.cwd().replace(/\\/g, '/'));
    // With new logic, projectId should be based on directory name
    expect(project!.id.startsWith('local/')).toBe(true);
  }, 30_000);

  it('should return project with directory name for non-git directories (fallbackToPath default)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const project = detectProject(tempDir);
    expect(project).not.toBeNull();
    expect(project!.id.startsWith('local/')).toBe(true);
    expect(project!.gitRemote).toBeUndefined(); // No git remote
  });

  it('should return null for non-git directories when fallbackToPath is false', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const config: ProjectConfigOptions = { fallbackToPath: false };
    const project = detectProject(tempDir, config);
    expect(project).toBeNull();
  });

  it('should use manual ID when configured', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tempDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const config: ProjectConfigOptions = { manualId: 'my-custom-project' };
    const project = detectProject(tempDir, config);
    expect(project).not.toBeNull();
    expect(project!.id).toBe('local/my-custom-project');
    expect(project!.name).toBe('my-custom-project');
  });

  it('should return null for empty directories when fallbackToPath is false', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const emptyDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const config: ProjectConfigOptions = { fallbackToPath: false };
    const project = detectProject(emptyDir, config);
    expect(project).toBeNull();
  }, 30_000);

  it('should return project with directory name for empty directories (fallbackToPath default)', async () => {
    const { mkdtempSync, rmdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, basename } = await import('node:path');
    const emptyDir = mkdtempSync(join(tmpdir(), 'memorix-test-'));
    const project = detectProject(emptyDir);
    expect(project).not.toBeNull();
    const dirName = basename(emptyDir);
    expect(project!.id).toBe(`local/${dirName}`);
    expect(project!.name).toBe(dirName);
    rmdirSync(emptyDir);
  }, 30_000);

  it('detectProjectWithDiagnostics should provide failure info for invalid path', () => {
    const config: ProjectConfigOptions = { fallbackToPath: false };
    const result = detectProjectWithDiagnostics('/nonexistent-test-path-12345', config);
    expect(result.project).toBeNull();
    expect(result.failure).not.toBeNull();
    expect(result.failure!.reason).toBe('path_not_found');
  });
});