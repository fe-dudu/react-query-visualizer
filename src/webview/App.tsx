import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useState } from 'react';

import type { WebviewPayload } from './types/model';
import { GraphCanvas } from './components/GraphCanvas';
import { defaultPayload } from './utils/constants';
import { useHostThemeSync } from './utils/hostTheme';

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
