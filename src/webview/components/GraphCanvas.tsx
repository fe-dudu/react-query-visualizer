import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';

import { RqvFlowNode } from './FlowNode';
import { LeftPanel } from './LeftPanel';
import { ProjectDividerNode } from './ProjectDividerNode';
import { ResizeDivider } from './ResizeDivider';
import { RightPanel } from './RightPanel';
import type { WebviewPayload } from '../../shared/contracts';
import { collapseGraphIfLarge } from '../layout/collapseGraphIfLarge';
import { applyEdgeGeometryLanes, minimumNodeY } from '../layout/edgeGeometry';
import { type LayoutOptions, getLayoutedElements } from '../layout/layout';
import { getGraphLayoutIndex } from '../layout/layoutIndex';
import { orderNodesForLayout } from '../layout/layoutOrdering';
import { arrangeProjectsHorizontally, isMonorepoGraph } from '../layout/projectArrangement';
import { applyProjectBandSpacing, buildProjectDividerNodes } from '../layout/projectDividers';
import {
  alignDeclareNodesLeftOfQuery,
  alignQueryNodesNearSources,
  alignQueryNodesToRightColumn,
} from '../layout/queryAlignment';
import { clampHorizontalSpacing, clampVerticalSpacing } from '../layout/spacing';
import { useDagreLayoutWorker } from '../layout/useDagreLayoutWorker';
import { useResizablePanels } from '../layout/useResizablePanels';
import type { FilterState, FlowEdgeData } from '../types/viewTypes';
import { defaultFilters } from '../utils/defaultFilters';
import { alignFileActionGroups } from '../utils/fileActionGroups';
import { applySearchFilter, computeVisibleGraph } from '../utils/filters';
import { buildFlowGraph } from '../utils/flowGraph';
import { buildNodeExplanation } from '../utils/nodeExplanation';
import { buildRelatedFiles } from '../utils/relatedFiles';
import { revealCallsiteInCode, revealFileInCode, revealNodeInCode } from '../utils/reveal';
import { buildSelectedTrail } from '../utils/selectedTrail';
import { cx } from '../utils/utils';
export function GraphCanvas({ payload }: { payload: WebviewPayload }) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verticalSpacing, setVerticalSpacing] = useState<number>(() =>
    clampVerticalSpacing(payload.layout.verticalSpacing),
  );
  const [horizontalSpacing, setHorizontalSpacing] = useState<number>(() =>
    clampHorizontalSpacing(payload.layout.horizontalSpacing),
  );

  const { shellRef, shellStyle, activeResizer, startResize } = useResizablePanels();
  const runDagreLayout = useDagreLayoutWorker();

  const relationFilteredGraph = useMemo(() => computeVisibleGraph(payload.graph, filters), [payload.graph, filters]);
  const searchFilteredGraph = useMemo(
    () => applySearchFilter(relationFilteredGraph, filters.search),
    [relationFilteredGraph, filters.search],
  );
  const visible = useMemo(() => collapseGraphIfLarge(searchFilteredGraph).graph, [searchFilteredGraph]);
  const graphLayoutIndex = useMemo(() => getGraphLayoutIndex(visible), [visible]);
  const isMultiProject = graphLayoutIndex.projectCount > 1;
  const isMonorepo = useMemo(() => isMonorepoGraph(payload.graph), [payload.graph]);
  const queryKeys = useMemo(
    () =>
      [...new Set(visible.nodes.filter((node) => node.kind === 'queryKey').map((node) => node.label))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [visible.nodes],
  );
  const relatedFiles = useMemo(() => buildRelatedFiles(payload.scannedFiles, visible), [payload.scannedFiles, visible]);
  const queryCallsiteImpactById = graphLayoutIndex.queryCallsiteImpactById;
  const selectedTrail = useMemo(() => buildSelectedTrail(visible, selectedId), [visible, selectedId]);
  const flowGraph = useMemo(
    () =>
      buildFlowGraph(visible, filters.search, {
        highlightedNodeIds: selectedTrail.highlightedNodeIds,
        highlightedEdgeIds: selectedTrail.highlightedEdgeIds,
        selectedNodeId: selectedId,
      }),
    [visible, filters.search, selectedTrail, selectedId],
  );
  const latestFlowGraphRef = useRef(flowGraph);
  const layoutFlowGraph = useMemo(
    () =>
      buildFlowGraph(visible, '', {
        highlightedNodeIds: new Set<string>(),
        highlightedEdgeIds: new Set<string>(),
        selectedNodeId: null,
      }),
    [visible],
  );
  const layoutNodes = useMemo(
    () => orderNodesForLayout(layoutFlowGraph.nodes, visible, queryCallsiteImpactById),
    [layoutFlowGraph.nodes, visible, queryCallsiteImpactById],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const reactFlow = useReactFlow();
  const selectedNode = selectedId ? (graphLayoutIndex.nodeById.get(selectedId) ?? null) : null;

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      rqvNode: RqvFlowNode,
      rqvDivider: ProjectDividerNode,
    }),
    [],
  );

  useEffect(() => {
    latestFlowGraphRef.current = flowGraph;
  }, [flowGraph]);

  useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) {
      return;
    }

    const flowNodeById = new Map(flowGraph.nodes.map((node) => [node.id, node]));
    setNodes((previous) =>
      previous.map((node) => {
        if (node.id.startsWith('divider:')) {
          return node;
        }

        const next = flowNodeById.get(node.id);
        if (!next) {
          return node;
        }

        return {
          ...node,
          data: next.data,
          style: {
            ...node.style,
            ...next.style,
          },
        };
      }),
    );

    const flowEdgeById = new Map(flowGraph.edges.map((edge) => [edge.id, edge]));
    setEdges((previous) =>
      previous.map((edge) => {
        const next = flowEdgeById.get(edge.id);
        if (!next) {
          return edge;
        }

        return {
          ...edge,
          type: next.type,
          sourceHandle: next.sourceHandle,
          targetHandle: next.targetHandle,
          data: next.data,
          style: next.style,
        };
      }),
    );
  }, [flowGraph.nodes, flowGraph.edges, nodes.length, edges.length, setNodes, setEdges]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const runLayout = async () => {
        const compactVerticalSpacing = clampVerticalSpacing(verticalSpacing);
        const wideHorizontalSpacing = clampHorizontalSpacing(horizontalSpacing);
        const layoutOptions: LayoutOptions = {
          direction: 'LR',
          verticalSpacing: compactVerticalSpacing,
          horizontalSpacing: wideHorizontalSpacing,
        };
        let layouted: { nodes: Node[]; edges: Edge[] };
        try {
          layouted = await runDagreLayout(layoutNodes, layoutFlowGraph.edges, layoutOptions);
        } catch {
          layouted = getLayoutedElements(layoutNodes, layoutFlowGraph.edges, layoutOptions);
        }
        if (cancelled) {
          return;
        }

        const spacedNodes = applyProjectBandSpacing(layouted.nodes, visible, isMultiProject);
        const groupedNodes = alignFileActionGroups(spacedNodes, visible, compactVerticalSpacing);
        const topAlignedNodes = alignQueryNodesNearSources(
          groupedNodes,
          visible,
          queryCallsiteImpactById,
          compactVerticalSpacing,
        );
        const rightAlignedQueryNodes = alignQueryNodesToRightColumn(topAlignedNodes, visible, isMonorepo);
        const leftPlacedDeclareNodes = alignDeclareNodesLeftOfQuery(rightAlignedQueryNodes, visible);
        const projectPositionedNodes = arrangeProjectsHorizontally(leftPlacedDeclareNodes, visible, isMonorepo);
        const alignedEdges = applyEdgeGeometryLanes(projectPositionedNodes, layouted.edges);
        const projectDividers = buildProjectDividerNodes(projectPositionedNodes, visible, isMultiProject, isMonorepo);
        const currentFlowGraph = latestFlowGraphRef.current;
        const currentFlowNodeById = new Map(currentFlowGraph.nodes.map((node) => [node.id, node]));
        const currentFlowEdgeById = new Map(currentFlowGraph.edges.map((edge) => [edge.id, edge]));

        const layoutedNodesWithCurrentVisuals = projectPositionedNodes.map((node) => {
          const currentNode = currentFlowNodeById.get(node.id);
          if (!currentNode) {
            return node;
          }

          return {
            ...node,
            data: currentNode.data,
            style: {
              ...node.style,
              ...currentNode.style,
            },
          };
        });

        const alignedEdgesWithCurrentVisuals = alignedEdges.map((edge) => {
          const currentEdge = currentFlowEdgeById.get(edge.id);
          if (!currentEdge) {
            return edge;
          }

          const alignedData = edge.data as FlowEdgeData | undefined;
          const currentData = currentEdge.data as FlowEdgeData | undefined;

          return {
            ...edge,
            type: currentEdge.type,
            sourceHandle: currentEdge.sourceHandle,
            targetHandle: currentEdge.targetHandle,
            data: {
              relation: currentData?.relation ?? alignedData?.relation ?? 'invalidates',
              dim: currentData?.dim ?? alignedData?.dim ?? false,
              highlighted: currentData?.highlighted ?? alignedData?.highlighted ?? false,
              laneOffset: Number(alignedData?.laneOffset ?? currentData?.laneOffset ?? 0),
            } satisfies FlowEdgeData,
            style: currentEdge.style,
            className: currentEdge.className,
            animated: currentEdge.animated,
          };
        });

        const layoutedWithDividers = [...projectDividers, ...layoutedNodesWithCurrentVisuals];

        setNodes(layoutedWithDividers);
        setEdges(alignedEdgesWithCurrentVisuals);

        reactFlow
          .fitView({ padding: 0.1, duration: 180 })
          .then(() => {
            if (cancelled) {
              return;
            }

            const minY = minimumNodeY(layoutedWithDividers);
            if (minY === null) {
              return;
            }

            const viewport = reactFlow.getViewport();
            const alignedY = 28 - minY * viewport.zoom;
            reactFlow
              .setViewport(
                {
                  x: viewport.x,
                  y: alignedY,
                  zoom: viewport.zoom,
                },
                { duration: 120 },
              )
              .then(undefined, () => undefined);
          })
          .then(undefined, () => undefined);
      };

      runLayout().then(undefined, () => undefined);
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    layoutNodes,
    layoutFlowGraph.edges,
    verticalSpacing,
    horizontalSpacing,
    reactFlow,
    setEdges,
    setNodes,
    visible,
    isMultiProject,
    isMonorepo,
    queryCallsiteImpactById,
    runDagreLayout,
  ]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (node.id.startsWith('divider:')) {
      return;
    }
    setSelectedId(node.id);
  };

  const onSelectRelatedFile = (filePath: string) => {
    const fileNode = visible.nodes.find((node) => node.kind === 'file' && node.label === filePath);
    if (!fileNode) {
      return;
    }

    setSelectedId(fileNode.id);
  };

  const onSelectQueryKey = (queryKeyLabel: string) => {
    const candidateQueryNodes = visible.nodes.filter(
      (node) => node.kind === 'queryKey' && node.label === queryKeyLabel,
    );
    if (candidateQueryNodes.length === 0) {
      return;
    }

    const currentlySelected =
      selectedNode?.kind === 'queryKey' &&
      selectedNode.label === queryKeyLabel &&
      candidateQueryNodes.some((candidate) => candidate.id === selectedNode.id)
        ? selectedNode.id
        : null;

    if (currentlySelected) {
      setSelectedId(currentlySelected);
      return;
    }

    const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
    const [targetNode] = [...candidateQueryNodes].sort((a, b) => {
      const layoutA = layoutNodeById.get(a.id);
      const layoutB = layoutNodeById.get(b.id);

      if (layoutA && layoutB) {
        if (layoutA.position.y !== layoutB.position.y) {
          return layoutA.position.y - layoutB.position.y;
        }

        if (layoutA.position.x !== layoutB.position.x) {
          return layoutA.position.x - layoutB.position.x;
        }
      } else if (layoutA) {
        return -1;
      } else if (layoutB) {
        return 1;
      }

      const impactDiff = Number(b.metrics?.affectedFiles ?? 0) - Number(a.metrics?.affectedFiles ?? 0);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      return a.id.localeCompare(b.id);
    });

    if (!targetNode) {
      return;
    }

    setSelectedId(targetNode.id);
  };

  const setFiltersAndClearSelection = (nextFilters: SetStateAction<FilterState>) => {
    setSelectedId(null);
    setFilters(nextFilters);
  };

  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if (node.id.startsWith('divider:')) {
      return;
    }

    const original = visible.nodes.find((value) => value.id === node.id);
    if (!original) {
      return;
    }

    revealNodeInCode(original);
  };

  const explanation = useMemo(
    () => buildNodeExplanation(visible, selectedNode, payload.graph),
    [visible, selectedNode, payload.graph],
  );

  return (
    <div
      ref={shellRef}
      className={cx(
        'rqv-theme flex h-full w-full min-w-0 bg-zinc-100 text-zinc-900 [font-family:Space_Grotesk,Segoe_UI,sans-serif] dark:bg-zinc-950 dark:text-zinc-100',
        activeResizer && 'cursor-col-resize select-none [&_*]:cursor-col-resize [&_*]:select-none',
      )}
      style={shellStyle}
    >
      <LeftPanel
        filters={filters}
        setFilters={setFiltersAndClearSelection}
        queryKeys={queryKeys}
        selectedQueryKey={selectedNode?.kind === 'queryKey' ? selectedNode.label : null}
        onSelectQueryKey={onSelectQueryKey}
        relatedFiles={relatedFiles}
        verticalSpacing={verticalSpacing}
        onVerticalSpacingChange={(value) => setVerticalSpacing(clampVerticalSpacing(value))}
        horizontalSpacing={horizontalSpacing}
        onHorizontalSpacingChange={(value) => setHorizontalSpacing(clampHorizontalSpacing(value))}
        showProjectDividers={isMultiProject}
        selectedRelatedFilePath={selectedNode?.kind === 'file' ? selectedNode.label : null}
        onSelectRelatedFile={onSelectRelatedFile}
      />

      <ResizeDivider onPointerDown={startResize('left')} />

      <main className="h-full min-w-0 grow basis-0">
        <ReactFlow
          className="bg-zinc-100 dark:bg-zinc-950 [&_.react-flow__controls]:shadow-[0_4px_16px_rgba(0,0,0,0.22)] [&_.react-flow__edge-textbg]:fill-[rgba(250,250,250,0.88)] dark:[&_.react-flow__edge-textbg]:fill-[rgba(24,24,27,0.92)] [&_.react-flow__edge-text]:font-bold"
          proOptions={{ hideAttribution: true }}
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={() => setSelectedId(null)}
          connectionLineType={ConnectionLineType.Bezier}
          onlyRenderVisibleElements
          fitView
          minZoom={0.24}
          maxZoom={2.2}
        >
          <Controls />
          <MiniMap
            position="bottom-right"
            zoomable
            pannable
            nodeStrokeWidth={3}
            nodeColor="var(--rqv-minimap-node)"
            maskColor="var(--rqv-minimap-mask)"
            style={{
              width: 198,
              height: 132,
              background: 'var(--rqv-minimap-bg)',
              border: '1px solid var(--rqv-minimap-border)',
              borderRadius: 10,
              boxShadow: '0 8px 20px var(--rqv-minimap-shadow)',
              marginRight: 10,
              marginBottom: 10,
              ['--xy-minimap-mask-stroke-color' as string]: 'var(--rqv-minimap-mask-stroke)',
              ['--xy-minimap-mask-stroke-width' as string]: 2.5,
            }}
          />
          <Background variant={BackgroundVariant.Lines} gap={44} size={0.48} color="var(--rqv-grid-color)" />
        </ReactFlow>
      </main>

      <ResizeDivider hiddenOnSmall onPointerDown={startResize('right')} />

      <RightPanel
        selectedNode={selectedNode}
        explanation={explanation}
        onReveal={revealNodeInCode}
        onRevealFile={revealFileInCode}
        onRevealCallsite={revealCallsiteInCode}
      />
    </div>
  );
}
