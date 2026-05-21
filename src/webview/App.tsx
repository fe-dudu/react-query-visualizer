import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';

import type { WebviewPayload } from './model';
import { defaultPayload } from './constants';
import { GraphCanvas } from './GraphCanvas';
import { useHostThemeSync } from './theme/hostTheme';

export default function App() {
  const [payload, setPayload] = useState<WebviewPayload>(defaultPayload);
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
