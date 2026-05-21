import { useEffect, useRef } from 'react';

import {
  type HostThemeKind,
  THEME_ATTRIBUTE_NAMES,
  detectDarkMode,
  hostThemeKindToDark,
  readHostThemeKind,
} from './detectTheme';
import { vscode } from './vscode';
import type { WebviewPayload } from '../types/model';

export function useHostThemeSync(onPayload: (payload: WebviewPayload) => void): void {
  const hostThemeKindRef = useRef<HostThemeKind | undefined>(undefined);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => {
      const fromHost = hostThemeKindToDark(hostThemeKindRef.current);
      const isDark = fromHost ?? detectDarkMode(media.matches);
      document.documentElement.classList.toggle('dark', isDark);
    };

    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [...THEME_ATTRIBUTE_NAMES],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [...THEME_ATTRIBUTE_NAMES],
    });
    media.addEventListener('change', syncTheme);

    const handler = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        payload?: WebviewPayload;
        isDark?: boolean;
        themeKind?: unknown;
      };
      if (message?.type === 'theme') {
        const hostThemeKind = readHostThemeKind(message.themeKind);
        hostThemeKindRef.current = hostThemeKind;
        if (hostThemeKind === undefined && typeof message.isDark === 'boolean') {
          hostThemeKindRef.current = message.isDark ? 2 : 1;
        }
        syncTheme();
        return;
      }

      if (message?.type === 'graphData' && message.payload) {
        onPayload(message.payload);
      }
    };

    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'ready' });

    return () => {
      observer.disconnect();
      media.removeEventListener('change', syncTheme);
      window.removeEventListener('message', handler);
    };
  }, [onPayload]);
}
