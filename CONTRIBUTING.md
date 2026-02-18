# Contributing to React Query Visualizer

Thanks for contributing.

Repository: [https://github.com/fe-dudu/react-query-visualizer](https://github.com/fe-dudu/react-query-visualizer)

## How to Contribute

- Open an issue for bugs, regressions, or feature proposals
- Submit a pull request with a focused change
- Include rationale and before/after behavior in the PR description

## Development Setup

Requirements:

- Node.js 24.8.0 (`.nvmrc`)
- pnpm 10+
- VS Code

Install:

```bash
pnpm install
```

Build:

```bash
pnpm run build
```

Type-check:

```bash
pnpm run type-check
```

Package extension:

```bash
pnpm run package:vsix
```

## Project Structure

- `src/core/analyzer/*`
  - AST parsing/import resolution/query-key normalization/inference
- `src/core/graphBuilder.ts`
  - Converts analysis records to graph nodes/edges with metrics
- `src/webview/*`
  - React Flow UI, layout, filters, details panel
- `src/extension/*`
  - VS Code command registration and scan orchestration

## Contribution Guidelines

- Keep PRs small and task-focused
- Preserve existing behavior unless explicitly changing it
- Update docs when behavior/configuration changes
- Prefer deterministic behavior for analyzer logic
- Avoid introducing expensive runtime work in the webview render loop

## Recommended PR Checklist

- [ ] Reproduced the issue or validated the feature scenario
- [ ] Added/updated code in the correct layer (`analyzer`, `graphBuilder`, `webview`, `extension`)
- [ ] Ran `pnpm run type-check`
- [ ] Ran `pnpm run build`
- [ ] Updated `README.md` and/or this file if needed

## Good First Areas

- Query key inference edge cases (`src/core/analyzer/queryKey.ts`)
- New React Query API coverage in scanner (`src/core/analyzer/astScan.ts`)
- Graph readability/layout tuning (`src/webview/GraphCanvas.tsx`, `src/webview/graphUtils.ts`)
- Details panel clarity and UX (`src/webview/components/RightPanel.tsx`)

## Questions

If you are unsure where to implement a change, open an issue first and share:

- target behavior
- minimal example
- expected graph output
