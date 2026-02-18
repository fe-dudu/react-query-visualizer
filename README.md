# React Query Visualizer

Visualize React Query state flow in VS Code using static source analysis.

[![VS Marketplace](https://img.shields.io/vscode-marketplace/v/fe-dudu.react-query-visualizer?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=fe-dudu.react-query-visualizer)
[![Open VSX](https://img.shields.io/open-vsx/v/fe-dudu/react-query-visualizer)](https://open-vsx.org/extension/fe-dudu/react-query-visualizer)
![React Query Visualizer screenshot](https://raw.githubusercontent.com/fe-dudu/react-query-visualizer/main/media/screenshot.png)

## Open Source

This project is open source: [https://github.com/fe-dudu/react-query-visualizer](https://github.com/fe-dudu/react-query-visualizer)

If this tool helps you, please star the repository and contribute improvements through issues and pull requests.

## What It Does

The extension scans your project on demand and builds a graph:

`File -> Action -> QueryKey`

It helps answer:

- Where query keys are defined
- Which callsites invalidate, refetch, reset, or clear query caches
- Which files and projects are most impacted

## Core Features

- On-demand scanning (`Scan Now`, `Scan With Scope`)
- React Flow graph view with details panel and code reveal
- File/action/query-key linkage with callsite locations
- Wildcard/prefix/exact query-key matching
- Predicate/exact option support for `invalidateQueries`, `refetchQueries`, `resetQueries`
- Monorepo-aware grouping and project-based impact boundaries
- Large-graph safety with query-key grouping/collapsing
- Tunable layout controls in panel (`verticalSpacing`: default 30, range 0-300; `horizontalSpacing`: default 500, range 100-3000)
- Related files tree with impact badges

## React Query Coverage

### Declare flows

- `useQuery`
- `useInfiniteQuery`
- `useSuspenseQuery`
- `useSuspenseInfiniteQuery`
- `useQueries`
- `useSuspenseQueries`
- `usePrefetchQuery`
- `usePrefetchInfiniteQuery`
- `queryClient.fetchQuery`
- `queryClient.prefetchQuery`
- `queryClient.ensureQueryData`
- `queryClient.fetchInfiniteQuery`
- `queryClient.prefetchInfiniteQuery`
- `queryClient.ensureInfiniteQueryData`

### Query option helpers (key inference)

- `queryOptions`
- `infiniteQueryOptions`

### Action flows

- `queryClient.invalidateQueries`
- `queryClient.refetchQueries`
- `queryClient.resetQueries`
- `queryClient.removeQueries`
- `queryClient.setQueryData`
- `queryClient.setQueriesData`
- `queryClient.clear`
- `refetch()` from hook results

## UI Notes

- Operation filters control mutation relations (`invalidate`, `refetch`, `reset`, `clear`).
- Query key details include:
  - Files involved
  - Callsites
  - Declared in (when declaration callsites are detected)

## Commands

- `React Query Visualizer: Focus Activity View`
- `React Query Visualizer: Open Graph Panel`
- `React Query Visualizer: Scan Now`
- `React Query Visualizer: Scan With Scope`
- `React Query Visualizer: Reveal In Code`

## Settings

### Scope

- `rqv.scope.folders`
- `rqv.scope.include`
- `rqv.scope.exclude`

### Scan

- `rqv.scan.maxFileSizeKB`
- `rqv.scan.useGitIgnore`

### Graph

- `rqv.graph.renderer` (`react-flow`)
- `rqv.graph.direction` (`LR`)
- `rqv.graph.layoutEngine` (`dagre`)
- `rqv.graph.verticalSpacing` (default: `30`, min: `0`, max: `300`)
- `rqv.graph.horizontalSpacing` (default: `500`, min: `100`, max: `3000`)

## Local Development

Requirements:

- Node.js 24.8.0 (`.nvmrc`)
- pnpm 10+

1. Install dependencies:

```bash
nvm use
pnpm install
```

2. Build:

```bash
pnpm run build
```

3. Type-check:

```bash
pnpm run type-check
```

4. Package VSIX:

```bash
pnpm run package:vsix
```

## Release Automation

VS Code Marketplace publish is automated with GitHub Actions:

- Workflow file: `.github/workflows/publish-vscode-extension.yml`
- Trigger: push to `main` or manual run (`workflow_dispatch`)
- Release strategy: Changesets (`.changeset/*`)
- Secret: `AZURE_ACCESS_TOKEN` (used as `VSCE_PAT`)

Typical release flow:

1. Add a changeset in your feature PR (`pnpm changeset`)
2. Merge PR to `main` (workflow creates/updates a version PR)
3. Merge version PR (workflow publishes to VS Code Marketplace)

## Contributing

See contribution guide: [CONTRIBUTING.md](https://github.com/fe-dudu/react-query-visualizer/blob/main/CONTRIBUTING.md)

Contributions of any size are welcome:

- parser and query-key inference improvements
- graph UX/layout improvements
- performance and stability
- docs and examples

## License

MIT
