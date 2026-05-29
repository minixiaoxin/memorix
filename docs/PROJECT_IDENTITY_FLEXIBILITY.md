# Project Identity Flexibility - Design Proposal

> Author: minixiaoxin
> Date: 2026-04-08
> Status: **Implemented**

## 1. Problem Statement

### Current Behavior

Memorix currently enforces a strict Git-based project identity model:

```typescript
// detector.ts:11-14 (comments)
// ID strategy:
//   - .git + remote → normalizeGitRemote(remote)  (globally unique, e.g. "user/repo")
//   - .git + no remote → "local/<dirname>"         (local git repo, no remote yet)
//   - no .git → null                               (not a project)
```

### Problem Scenarios

| Scenario | Current Behavior | Expected Behavior |
|----------|-----------------|-------------------|
| Non-git project folder | `null` (no project binding) | Should bind to directory name |
| Project with git submodule/child | Wrongly binds to child repo | Should bind to user's workspace root |
| Git project without remote | `local/<dirname>` | Should work correctly (already OK) |

### User's Core Requirements

1. **Project ID should bind to the AI tool's root directory name** - regardless of git status
2. **Memory search priority**: project scope first, then global scope
3. **Git history capture must remain functional** - when git exists, still capture commits

## 2. Design Goals

### Primary Goals

1. **Directory-based project identity**: The project ID should derive from the workspace root directory name, not git remote
2. **Git-independence**: Projects without `.git` should still have valid project IDs
3. **Git coexistence**: When git exists, git memory features should remain fully functional

### Secondary Goals

1. **Configuration flexibility**: Allow manual override of project ID via config
2. **Subdirectory scan control**: Disable by default, enable via config if needed
3. **Backward compatibility**: Existing git-based projects should work unchanged
4. **Clear scope hierarchy**: Project scope → Global scope

## 3. Proposed Solution

### 3.1 Configuration Schema Extension

Add a new `project` section to `memorix.yml`:

```yaml
# memorix.yml

project:
  # Manually specify projectId (overrides auto-detection)
  # Example: "my-project" → projectId = "local/my-project"
  id: "my-project-name"

  # Whether to scan subdirectories for git repo when root has no .git
  # Default: false (NEW - prevents binding to wrong child repo)
  scanSubdirs: false

  # Whether to use directory name as projectId when no git repo found
  # Default: true (NEW - enables non-git project support)
  fallbackToPath: true
```

### 3.2 Project ID Strategy (Revised)

```
Detection Flow:
1. Check memorix.yml → project.id (manual override, highest priority)
2. Check .git at workspace root → use directory name as projectId
   - If git remote exists → store for git memory features ONLY
3. If no .git and fallbackToPath=true → "local/<dirname>"
4. If no .git and fallbackToPath=false → null (fail closed)
```

### 3.3 Key Concept: Dual Identity

The project maintains **two separate identity concepts**:

| Identity Type | Purpose | Source |
|---------------|---------|--------|
| **projectId** | Memory storage/retrieval scope | Directory name (or manual config) |
| **gitRemote** | Git memory capture source | Git remote URL (optional) |

This separation ensures:
- Memory is scoped by user's workspace
- Git history (if exists) is still captured with correct provenance

### 3.4 ID Generation Examples

| Workspace Path | Git Status | Config | Generated projectId |
|----------------|------------|--------|---------------------|
| `/workspace/my-app` | No .git | default | `local/my-app` |
| `/workspace/my-app` | Has .git, remote `user/repo` | default | `local/my-app` (gitRemote stored separately) |
| `/workspace/my-app` | Has .git, no remote | default | `local/my-app` |
| `/workspace/my-app` | Any | `id: "custom-name"` | `local/custom-name` |
| `/workspace/my-app` | No .git | `fallbackToPath: false` | `null` (fail) |

## 4. Implementation Plan

### 4.1 Files to Modify

| File | Changes |
|------|---------|
| `src/config/yaml-loader.ts` | Add `project` config type |
| `memorix.example.yml` | Add `project` section example |
| `src/project/detector.ts` | Implement new detection logic |
| `src/cli/commands/serve-shared.ts` | Use new detection, respect `scanSubdirs` config |
| `src/server.ts` | Pass config to detection functions |
| `src/git/extractor.ts` | Use `gitRemote` (not projectId) for git memory |

### 4.2 Detailed Changes

#### 4.2.1 yaml-loader.ts - Add Project Config Type

```typescript
export interface MemorixYamlConfig {
  // ... existing fields ...

  /** Project identity configuration */
  project?: {
    /** Manually specify projectId (overrides auto-detection) */
    id?: string;
    /** Whether to scan subdirectories for git repo when root has no .git (default: false) */
    scanSubdirs?: boolean;
    /** Whether to use path-based projectId when no git repo found (default: true) */
    fallbackToPath?: boolean;
  };
}
```

#### 4.2.2 detector.ts - New Detection Function

```typescript
/**
 * Detect project with flexible identity strategy.
 *
 * ID priority:
 *   1. Config override (memorix.yml → project.id)
 *   2. Directory name at workspace root
 *   3. Fallback to null if fallbackToPath=false
 *
 * Git remote is stored separately for git memory features.
 */
export function detectProjectFlexible(
  cwd: string,
  config?: ProjectConfigOptions
): ProjectInfo | null {
  const basePath = cwd ?? process.cwd();

  // 1. Validate path exists and is directory
  if (!existsSync(basePath) || !statSync(basePath).isDirectory()) {
    return null;
  }

  // 2. Check for manual override in config
  if (config?.manualId) {
    return {
      id: `local/${config.manualId}`,
      name: config.manualId,
      rootPath: basePath,
      gitRemote: getGitRemoteIfExists(basePath) // Still capture git if exists
    };
  }

  // 3. Use directory name as projectId
  const dirName = path.basename(basePath);
  const gitRemote = getGitRemoteIfExists(basePath);

  // 4. If no git and fallbackToPath=false, fail closed
  if (!gitRemote && config?.fallbackToPath === false) {
    return null;
  }

  return {
    id: `local/${dirName}`,
    name: dirName,
    rootPath: basePath,
    gitRemote: gitRemote // Optional, for git memory only
  };
}

/**
 * Get git remote if exists, without failing if not found.
 * Returns null if no .git or no remote configured.
 */
function getGitRemoteIfExists(cwd: string): string | null {
  // ... existing git remote detection logic, return null on failure ...
}
```

#### 4.2.3 serve-shared.ts - Respect scanSubdirs Config

```typescript
export function resolveServeProject(
  options: ResolveServeProjectOptions,
  deps: ResolveServeProjectDeps,
  config?: ProjectConfigOptions
): ServeProjectResolution {
  let projectRoot = resolveInitialPath(options);
  const messages: string[] = [`[memorix] Starting with cwd: ${projectRoot}`];

  // NEW: Use flexible detection (directory-based)
  let detected = deps.detectProjectFlexible(projectRoot, config);
  if (detected) {
    return {
      projectRoot,
      detectedProject: detected,
      source: 'direct',
      messages,
    };
  }

  // NEW: Only scan subdirs if explicitly configured
  if (config?.scanSubdirs === true) {
    const subGit = deps.findGitInSubdirs(projectRoot);
    if (subGit) {
      // Still use ROOT directory name, not subGit directory
      const rootName = path.basename(projectRoot);
      detected = {
        id: `local/${rootName}`,
        name: rootName,
        rootPath: projectRoot,
        gitRemote: deps.getGitRemote(subGit) // Git from subdirectory
      };
      messages.push(`[memorix] Found .git in subdirectory: ${subGit}`);
      return { projectRoot, detectedProject: detected, source: 'subdir', messages };
    }
  }

  // ... rest of fallback logic ...
}
```

#### 4.2.4 Git Extractor - Use gitRemote for Provenance

```typescript
// In git/extractor.ts - when creating git memory observations
// Use project.gitRemote (not project.id) as the source identifier

const gitMemoryObservation = {
  // ...
  projectId: project.id, // For memory scope (user's workspace)
  source: 'git',
  gitRemote: project.gitRemote, // NEW field - for provenance tracking
  // ...
};
```

### 4.3 Types Extension

```typescript
// types.ts - ProjectInfo extension

export interface ProjectInfo {
  id: string;          // Memory scope ID (directory-based)
  name: string;        // Display name
  rootPath: string;    // Workspace root
  gitRemote?: string;  // Git remote URL (optional, for git memory)
}
```

## 5. Migration and Backward Compatibility

### 5.1 Existing Projects

For projects already using memorix with git remote-based IDs:

1. **First run with new version**: Creates alias entry mapping old ID to new ID
2. **Existing memories**: Automatically accessible via alias resolution
3. **No data loss**: All memories remain intact

### 5.2 Alias System Integration

```typescript
// When switching to new ID strategy, register alias
await registerAlias({
  canonical: `local/my-app`,  // New ID
  aliases: ['user/repo'],     // Old git remote ID
  rootPaths: ['/workspace/my-app'],
  gitRemote: 'https://github.com/user/repo.git'
});
```

This ensures:
- Search finds memories from both old and new IDs
- Git memory continues to work with old commit records

### 5.3 Configuration Defaults

| Config Option | Default | Reason |
|---------------|---------|--------|
| `project.id` | undefined | Auto-detect from directory |
| `project.scanSubdirs` | false | Prevent wrong binding |
| `project.fallbackToPath` | true | Enable non-git project support |

## 6. Testing Plan

### 6.1 Test Cases

| Test Case | Input | Expected projectId | Notes |
|-----------|-------|-------------------|-------|
| Non-git folder | `/workspace/my-app` | `local/my-app` | New behavior |
| Git project | `/workspace/my-app` with remote | `local/my-app` | Git remote stored separately |
| Git project no remote | `/workspace/my-app` with .git | `local/my-app` | Works like before |
| Manual override | `project.id: "custom"` | `local/custom` | Config wins |
| Disable fallback | `fallbackToPath: false` on non-git | `null` | Fail closed |
| Subdir scan enabled | `scanSubdirs: true` with child .git | `local/parent` | Uses parent name |

### 6.2 Integration Tests

1. Memory storage with new projectId
2. Search with project scope
3. Git memory capture still works
4. Alias resolution for old IDs
5. Session start binding

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing projects | Alias system bridges old/new IDs |
| Git memory provenance confusion | Separate gitRemote field |
| User confusion about ID change | Clear documentation and status display |

## 8. Documentation Updates

Files to update:
- `docs/ARCHITECTURE.md` - Section 5 (Project Identity Model)
- `docs/CONFIGURATION.md` - Add project section
- `docs/AGENT_OPERATOR_PLAYBOOK.md` - Update binding rules
- `README.md` - Update quick start

## 9. Summary

This proposal introduces a **directory-based project identity** model that:

1. Uses workspace root directory name as projectId (primary)
2. Stores git remote separately for git memory features (optional)
3. Allows manual override via configuration
4. Disables subdirectory scanning by default
5. Maintains backward compatibility via alias system

The result: **Every workspace has a valid project identity**, regardless of git status, while git memory features remain fully functional when git exists.