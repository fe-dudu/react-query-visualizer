import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';

import { GraphCanvas } from './components/GraphCanvas';
import { useHostThemeSync } from './utils/hostTheme';
import type { WebviewPayload } from '../shared/contracts';

function createDefaultPayload(): WebviewPayload {
  return {
    graph: {
      nodes: [],
      edges: [],
      summary: {
        files: 0,
        actions: 0,
        queryKeys: 0,
        parseErrors: 0,
      },
      parseErrors: [],
    },
    scannedFiles: [],
    scopeLabel: 'No scan has run yet',
    layout: {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    },
  };
}

export default function App() {
  const [payload, setPayload] = useState<WebviewPayload>(createDefaultPayload());
  const updatePayload = useCallback((nextPayload: WebviewPayload) => {
    setPayload(nextPayload);
  }, []);

  useHostThemeSync(updatePayload);

  return (
    <ReactFlowProvider>
      <GraphCanvas payload={payload} />
    </ReactFlowProvider>
  );
}
