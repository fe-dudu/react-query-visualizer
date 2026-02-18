import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';

import type { WebviewPayload } from './model';
import { defaultPayload } from './constants';
import { GraphCanvas } from './GraphCanvas';
import { vscode } from './vscode';

const HEX3_RE = /^#([0-9a-f]{3})$/i;
const HEX4_RE = /^#([0-9a-f]{4})$/i;
const HEX6_RE = /^#([0-9a-f]{6})$/i;
const HEX8_RE = /^#([0-9a-f]{8})$/i;
const THEME_ATTRIBUTE_NAMES = [
  'class',
  'style',
  'data-theme',
  'data-color-mode',
  'data-vscode-theme-kind',
  'data-vscode-theme-id',
  'data-vscode-theme-name',
  'data-theme-kind',
  'data-color-theme',
] as const;

type ParsedColor = { r: number; g: number; b: number; a: number };
type HostThemeKind = 1 | 2 | 3 | 4;

const parseRgbChannel = (value: string): number | undefined => {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  if (text.endsWith('%')) {
    const ratio = Number.parseFloat(text.slice(0, -1));
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      return undefined;
    }
    return Math.round((ratio / 100) * 255);
  }
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 255) {
    return undefined;
  }
  return Math.round(numeric);
};

const parseAlphaChannel = (value: string | undefined): number | undefined => {
  if (!value) {
    return 1;
  }
  const text = value.trim();
  if (!text) {
    return 1;
  }
  if (text.endsWith('%')) {
    const ratio = Number.parseFloat(text.slice(0, -1));
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      return undefined;
    }
    return ratio / 100;
  }
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    return undefined;
  }
  return numeric;
};

const parseHueChannel = (value: string): number | undefined => {
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  if (text.endsWith('turn')) {
    return numeric * 360;
  }
  if (text.endsWith('grad')) {
    return numeric * 0.9;
  }
  if (text.endsWith('rad')) {
    return (numeric * 180) / Math.PI;
  }
  return numeric;
};

const parseHslPercentChannel = (value: string): number | undefined => {
  const text = value.trim();
  if (!text.endsWith('%')) {
    return undefined;
  }
  const numeric = Number.parseFloat(text.slice(0, -1));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return undefined;
  }
  return numeric / 100;
};

const hslToRgb = (hue: number, saturation: number, lightness: number): { r: number; g: number; b: number } => {
  const hueUnit = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hueUnit / 60) % 2) - 1));
  const m = lightness - chroma / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (hueUnit < 60) {
    rPrime = chroma;
    gPrime = x;
  } else if (hueUnit < 120) {
    rPrime = x;
    gPrime = chroma;
  } else if (hueUnit < 180) {
    gPrime = chroma;
    bPrime = x;
  } else if (hueUnit < 240) {
    gPrime = x;
    bPrime = chroma;
  } else if (hueUnit < 300) {
    rPrime = x;
    bPrime = chroma;
  } else {
    rPrime = chroma;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
};

const parseColorLiteral = (value: string): ParsedColor | undefined => {
  const text = value.trim().toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hex3Match = text.match(HEX3_RE);
  if (hex3Match?.[1]) {
    const [r, g, b] = hex3Match[1].split('').map((ch) => Number.parseInt(`${ch}${ch}`, 16));
    return { r, g, b, a: 1 };
  }

  const hex4Match = text.match(HEX4_RE);
  if (hex4Match?.[1]) {
    const [r, g, b, a] = hex4Match[1].split('').map((ch) => Number.parseInt(`${ch}${ch}`, 16));
    return { r, g, b, a: a / 255 };
  }

  const hex6Match = text.match(HEX6_RE);
  if (hex6Match?.[1]) {
    return {
      r: Number.parseInt(hex6Match[1].slice(0, 2), 16),
      g: Number.parseInt(hex6Match[1].slice(2, 4), 16),
      b: Number.parseInt(hex6Match[1].slice(4, 6), 16),
      a: 1,
    };
  }

  const hex8Match = text.match(HEX8_RE);
  if (hex8Match?.[1]) {
    return {
      r: Number.parseInt(hex8Match[1].slice(0, 2), 16),
      g: Number.parseInt(hex8Match[1].slice(2, 4), 16),
      b: Number.parseInt(hex8Match[1].slice(4, 6), 16),
      a: Number.parseInt(hex8Match[1].slice(6, 8), 16) / 255,
    };
  }

  if (text.startsWith('rgb(') || text.startsWith('rgba(')) {
    const openingIndex = text.indexOf('(');
    const closingIndex = text.lastIndexOf(')');
    if (openingIndex < 0 || closingIndex <= openingIndex) {
      return undefined;
    }
    const inner = text.slice(openingIndex + 1, closingIndex).trim();
    if (!inner) {
      return undefined;
    }

    const [rgbPart, alphaPart] = inner.split('/').map((part) => part.trim());
    const rgbTokens = rgbPart.includes(',')
      ? rgbPart.split(',').map((part) => part.trim())
      : rgbPart.split(/\s+/).map((part) => part.trim());
    if (rgbTokens.length < 3) {
      return undefined;
    }

    const r = parseRgbChannel(rgbTokens[0]);
    const g = parseRgbChannel(rgbTokens[1]);
    const b = parseRgbChannel(rgbTokens[2]);
    let a: number | undefined;
    if (alphaPart) {
      a = parseAlphaChannel(alphaPart);
    } else if (rgbTokens[3]) {
      a = parseAlphaChannel(rgbTokens[3]);
    } else {
      a = 1;
    }

    if (r === undefined || g === undefined || b === undefined || a === undefined) {
      return undefined;
    }

    return { r, g, b, a };
  }

  if (text.startsWith('hsl(') || text.startsWith('hsla(')) {
    const openingIndex = text.indexOf('(');
    const closingIndex = text.lastIndexOf(')');
    if (openingIndex < 0 || closingIndex <= openingIndex) {
      return undefined;
    }
    const inner = text.slice(openingIndex + 1, closingIndex).trim();
    if (!inner) {
      return undefined;
    }

    const [hslPart, alphaPart] = inner.split('/').map((part) => part.trim());
    const hslTokens = hslPart.includes(',')
      ? hslPart.split(',').map((part) => part.trim())
      : hslPart.split(/\s+/).map((part) => part.trim());
    if (hslTokens.length < 3) {
      return undefined;
    }

    const h = parseHueChannel(hslTokens[0]);
    const s = parseHslPercentChannel(hslTokens[1]);
    const l = parseHslPercentChannel(hslTokens[2]);
    let a: number | undefined;
    if (alphaPart) {
      a = parseAlphaChannel(alphaPart);
    } else if (hslTokens[3]) {
      a = parseAlphaChannel(hslTokens[3]);
    } else {
      a = 1;
    }
    if (h === undefined || s === undefined || l === undefined || a === undefined) {
      return undefined;
    }
    return { ...hslToRgb(h, s, l), a };
  }

  return undefined;
};

const parseColorWithBrowser = (value: string): ParsedColor | undefined => {
  if (typeof window === 'undefined' || !document.body) {
    return undefined;
  }
  const probe = document.createElement('span');
  probe.style.position = 'fixed';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  probe.style.color = value.trim();
  if (!probe.style.color) {
    return undefined;
  }
  document.body.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return parseColorLiteral(resolved);
};

const parseColor = (value: string): ParsedColor | undefined => {
  const direct = parseColorLiteral(value);
  if (direct) {
    return direct;
  }
  return parseColorWithBrowser(value);
};

const toLuma = ({ r, g, b }: ParsedColor): number => {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const tokenizeThemeSignal = (value: string): Set<string> => {
  const words = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return new Set(words);
};

const readThemeFlag = (value: string | null): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  const lower = value.toLowerCase();
  const tokens = tokenizeThemeSignal(lower);
  const hasLight = tokens.has('light');
  const hasDark = tokens.has('dark');
  const hasHighContrast =
    lower.includes('high-contrast') || tokens.has('hc') || (tokens.has('high') && tokens.has('contrast'));

  if (hasLight) {
    return false;
  }
  if (hasDark) {
    return true;
  }
  if (hasHighContrast) {
    return undefined;
  }
  return undefined;
};

const readThemeFromClassList = (classList: DOMTokenList): boolean | undefined => {
  let hasLight = false;
  let hasDark = false;
  for (let index = 0; index < classList.length; index += 1) {
    const token = classList.item(index) ?? '';
    const parsed = readThemeFlag(token);
    if (parsed === false) {
      hasLight = true;
    }
    if (parsed === true) {
      hasDark = true;
    }
  }
  if (hasLight) {
    return false;
  }
  if (hasDark) {
    return true;
  }
  return undefined;
};

const resolveCssVariableColor = (
  sourceElement: HTMLElement,
  variableName: '--vscode-editor-background' | '--vscode-sideBar-background' | '--vscode-panel-background',
): ParsedColor | undefined => {
  const probe = document.createElement('span');
  probe.style.position = 'fixed';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  probe.style.backgroundColor = `var(${variableName})`;
  sourceElement.appendChild(probe);
  const resolved = window.getComputedStyle(probe).backgroundColor;
  probe.remove();
  const parsed = parseColor(resolved);
  if (!parsed || parsed.a <= 0) {
    return undefined;
  }
  return parsed;
};

const readThemeFromCss = (): boolean | undefined => {
  const styleSources = [
    { element: document.documentElement, styles: window.getComputedStyle(document.documentElement) },
    { element: document.body, styles: window.getComputedStyle(document.body) },
  ] as const;
  const cssVariableCandidates = [
    '--vscode-editor-background',
    '--vscode-sideBar-background',
    '--vscode-panel-background',
  ] as const;
  for (const variableName of cssVariableCandidates) {
    for (const source of styleSources) {
      const candidate = source.styles.getPropertyValue(variableName).trim();
      if (!candidate) {
        continue;
      }
      const parsedLiteral = parseColorLiteral(candidate);
      if (parsedLiteral && parsedLiteral.a > 0) {
        return toLuma(parsedLiteral) < 0.5;
      }
      if (!candidate.includes('var(')) {
        const parsedFallback = parseColor(candidate);
        if (parsedFallback && parsedFallback.a > 0) {
          return toLuma(parsedFallback) < 0.5;
        }
      }
      const resolvedFromVar = resolveCssVariableColor(source.element, variableName);
      if (resolvedFromVar) {
        return toLuma(resolvedFromVar) < 0.5;
      }
    }
  }
  return undefined;
};

const readThemeFromDataAttributes = (element: HTMLElement): boolean | undefined => {
  const dataAttributes = [
    'data-theme',
    'data-color-mode',
    'data-vscode-theme-kind',
    'data-vscode-theme-id',
    'data-vscode-theme-name',
    'data-theme-kind',
    'data-color-theme',
  ] as const;
  for (const attributeName of dataAttributes) {
    const parsed = readThemeFlag(element.getAttribute(attributeName));
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
};

const detectDarkMode = (fallbackToSystemDark: boolean): boolean => {
  const root = document.documentElement;

  const byDataAttr = readThemeFromDataAttributes(root) ?? readThemeFromDataAttributes(document.body);
  if (byDataAttr !== undefined) {
    return byDataAttr;
  }

  const byCss = readThemeFromCss();
  if (byCss !== undefined) {
    return byCss;
  }

  const byClass = readThemeFromClassList(root.classList) ?? readThemeFromClassList(document.body.classList);
  if (byClass !== undefined) {
    return byClass;
  }

  return fallbackToSystemDark;
};

const readHostThemeKind = (value: unknown): HostThemeKind | undefined => {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  return undefined;
};

const hostThemeKindToDark = (kind: HostThemeKind | undefined): boolean | undefined => {
  if (kind === 2) {
    return true;
  }
  if (kind === 1 || kind === 4) {
    return false;
  }
  // HighContrast(3)은 Cursor/IDE별 구현 차가 있어 강제하지 않음.
  return undefined;
};

export default function App() {
  const [payload, setPayload] = useState<WebviewPayload>(defaultPayload);
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
        setPayload(message.payload);
      }
    };

    window.addEventListener('message', handler);
    vscode?.postMessage({ type: 'ready' });

    return () => {
      observer.disconnect();
      media.removeEventListener('change', syncTheme);
      window.removeEventListener('message', handler);
    };
  }, []);

  return (
    <ReactFlowProvider>
      <GraphCanvas payload={payload} />
    </ReactFlowProvider>
  );
}
