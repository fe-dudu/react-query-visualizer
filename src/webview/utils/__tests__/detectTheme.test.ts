/* @vitest-environment jsdom */
import '../../../testing/setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectDarkMode, hostThemeKindToDark, readHostThemeKind } from '../detectTheme';

describe('webview/utils/detectTheme', () => {
  beforeEach(() => {
    for (const element of [document.documentElement, document.body]) {
      element.removeAttribute('data-theme');
      element.removeAttribute('data-color-mode');
      element.removeAttribute('data-vscode-theme-kind');
      element.removeAttribute('data-vscode-theme-id');
      element.removeAttribute('data-vscode-theme-name');
      element.removeAttribute('data-theme-kind');
      element.removeAttribute('data-color-theme');
    }
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.body.className = '';
    document.body.removeAttribute('style');
  });

  it('prefers data attributes over css and class fallbacks', () => {
    document.documentElement.setAttribute('data-color-mode', 'dark');
    document.documentElement.className = 'theme-light';
    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');

    expect(detectDarkMode(false)).toBe(true);

    document.documentElement.removeAttribute('data-color-mode');
    document.body.setAttribute('data-vscode-theme-name', 'Light Theme');
    expect(detectDarkMode(true)).toBe(false);
  });

  it('reads theme from css custom properties and class tokens', () => {
    document.documentElement.className = 'theme-dark';
    expect(detectDarkMode(false)).toBe(true);

    document.documentElement.className = 'theme-light theme-dark';
    expect(detectDarkMode(false)).toBe(false);

    document.documentElement.className = 'high-contrast';
    expect(detectDarkMode(true)).toBe(true);

    document.documentElement.className = '';
    document.body.className = 'theme-light';
    expect(detectDarkMode(true)).toBe(false);
  });

  it.each([
    ['#000', true],
    ['#fff', false],
    ['#1234', true],
    ['#ffffff', false],
    ['#ffffff80', false],
    ['#000000ff', true],
    ['rgb(0, 0, 0, 0.8)', true],
    ['rgb(100% 100% 100% / 50%)', false],
    ['rgb(0 0 0 / 1)', true],
    ['rgba(0, 0, 0)', true],
    ['rgb(0 0 0 /   )', true],
    ['rgb(255 255 255 / 1)', false],
    ['hsl(60 100% 50%)', false],
    ['hsl(120 100% 50%)', false],
    ['hsl(180 100% 50%)', false],
    ['hsl(240 100% 50%)', true],
    ['hsl(300 100% 50%)', true],
    ['hsl(0.5turn 100% 50% / 1)', false],
    ['hsl(0, 0%, 0%)', true],
    ['hsl(0 0% 0% 0.5)', true],
    ['hsla(0, 0%, 0%)', true],
    ['hsl(0 0% 0% /   )', true],
    ['hsl(200grad 100% 50%)', false],
    ['hsl(3.141592653589793rad 100% 50%)', false],
    ['hsl(0 0% 0%)', true],
    ['hsl(0 0% 100%)', false],
    ['rebeccapurple', true],
  ] as const)('reads %s from css custom properties', (color, expectedDark) => {
    document.documentElement.style.setProperty('--vscode-editor-background', color);
    expect(detectDarkMode(false)).toBe(expectedDark);
  });

  it('falls back when css colors are transparent', () => {
    document.documentElement.style.setProperty('--vscode-editor-background', 'transparent');
    document.body.className = 'theme-dark';
    expect(detectDarkMode(false)).toBe(true);
  });

  it('ignores ambiguous theme signals and invalid css colors', () => {
    document.documentElement.setAttribute('data-theme', 'high contrast');
    document.body.setAttribute('data-color-theme', 'hc-black');
    document.documentElement.style.setProperty('--vscode-editor-background', 'rgb(0 0 0 / 200%)');
    document.body.style.setProperty('--vscode-panel-background', 'not-a-color');

    expect(detectDarkMode(false)).toBe(true);
  });

  it.each([
    '',
    'rgb()',
    'rgb(   )',
    'hsl(0 0)',
    'hsl()',
    'hsl(   100% 50%)',
    'hsl(   )',
    'hsl(foo 100% 50%)',
    'hsl(0 100 50%)',
    'hsl(0 101% 50%)',
    'hsl(0 100% 50% / 200%)',
    'hsl(0 100% 50% / -1)',
    'rgb( 0 0)',
    'rgb(foo 0 0)',
    'rgb(256 0 0)',
    'rgb(-1 0 0)',
    'rgb(0 0 0 / -1)',
    'definitely-not-a-color',
  ])('ignores invalid css color %s', (color) => {
    document.documentElement.style.setProperty('--vscode-editor-background', color);
    document.body.className = 'theme-dark';

    expect(detectDarkMode(false)).toBe(true);
  });

  it('reads body css variables when root variables are absent', () => {
    document.body.style.setProperty('--vscode-sideBar-background', 'rgba(0, 0, 0, 0.9)');
    expect(detectDarkMode(false)).toBe(true);
  });

  it('handles numeric alpha, neutral theme labels, and css variable indirection', () => {
    document.documentElement.style.setProperty('--vscode-editor-background', 'rgba(255, 255, 255, 0.5)');
    expect(detectDarkMode(true)).toBe(false);

    document.documentElement.removeAttribute('style');
    document.documentElement.setAttribute('data-theme', 'solarized');
    document.body.className = 'theme-dark';
    expect(detectDarkMode(false)).toBe(true);

    document.body.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.setProperty('--actual-editor-background', '#000000');
    document.documentElement.style.setProperty('--vscode-editor-background', 'var(--actual-editor-background)');
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element);
      if (element instanceof HTMLSpanElement) {
        Object.defineProperty(style, 'backgroundColor', { configurable: true, value: 'rgb(0, 0, 0)' });
      }
      return style;
    });

    try {
      expect(detectDarkMode(false)).toBe(true);
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  it.each([
    'rgb(, 0, 0)',
    'rgb(foo% 0 0)',
    '',
    'hsl()',
    'hsl(0 0% 0%',
    'rgb(0 0 0',
  ])('falls back when resolved css variable color is invalid: %s', (resolvedColor) => {
    document.documentElement.style.setProperty('--vscode-editor-background', 'var(--actual-editor-background)');
    document.body.className = 'theme-dark';
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element);
      if (element instanceof HTMLSpanElement) {
        Object.defineProperty(style, 'backgroundColor', { configurable: true, value: resolvedColor });
      }
      return style;
    });

    try {
      expect(detectDarkMode(false)).toBe(true);
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  it('parses host theme kind values', () => {
    expect(readHostThemeKind(1)).toBe(1);
    expect(readHostThemeKind(2)).toBe(2);
    expect(readHostThemeKind(3)).toBe(3);
    expect(readHostThemeKind(4)).toBe(4);
    expect(readHostThemeKind(0)).toBeUndefined();
    expect(readHostThemeKind('2')).toBeUndefined();
    expect(hostThemeKindToDark(2)).toBe(true);
    expect(hostThemeKindToDark(1)).toBe(false);
    expect(hostThemeKindToDark(4)).toBe(false);
    expect(hostThemeKindToDark(3)).toBeUndefined();
    expect(hostThemeKindToDark(undefined)).toBeUndefined();
  });

  it('handles rgba colors that omit the alpha channel or leave it blank', () => {
    document.documentElement.style.setProperty('--vscode-editor-background', 'rgba(0, 0, 0)');
    expect(detectDarkMode(false)).toBe(true);

    document.documentElement.style.setProperty('--vscode-editor-background', 'rgba(255, 255, 255, )');
    expect(detectDarkMode(false)).toBe(false);
  });

  it('treats blank alpha tokens as opaque in rgba and slash syntax', () => {
    document.documentElement.style.setProperty('--vscode-editor-background', 'rgba(0, 0, 0, )');
    expect(detectDarkMode(false)).toBe(true);

    document.documentElement.style.setProperty('--vscode-editor-background', 'rgb(255 255 255 / )');
    expect(detectDarkMode(false)).toBe(false);
  });

  it('returns undefined from hue channel parser when hue is empty (comma-separated hsl with blank first token)', () => {
    // 'hsl(, 100%, 50%)' - comma syntax where hue token is an empty string after split/trim
    // This exercises the !text early-return branch inside parseHueChannel.
    document.documentElement.style.setProperty('--vscode-editor-background', 'hsl(, 100%, 50%)');
    document.body.className = 'theme-dark';
    expect(detectDarkMode(false)).toBe(true);
  });

  it('returns undefined from parseColorWithBrowser when document.body is null at call time', () => {
    // Use a named CSS color so parseColorLiteral fails and parseColorWithBrowser is attempted.
    // Temporarily override document.body so that the 4th access (inside parseColorWithBrowser)
    // returns null, exercising line 252.  Accesses 1-3 are:
    //   1 – readThemeFromDataAttributes(document.body)          (detectDarkMode line 409)
    //   2 – styleSources element: document.body                 (readThemeFromCss line 355)
    //   3 – getComputedStyle(document.body)                     (readThemeFromCss line 355)
    // Access 4 is parseColorWithBrowser's guard check (!document.body) → returns undefined.
    // Access 5+ restore real body so readThemeFromClassList and the rest work normally.
    document.documentElement.style.setProperty('--vscode-editor-background', 'blue');
    document.body.className = 'theme-dark';
    const originalBodyDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'body');
    if (!originalBodyDescriptor) {
      throw new Error('Missing body descriptor');
    }
    let hitCount = 0;
    Object.defineProperty(document, 'body', {
      configurable: true,
      get() {
        hitCount += 1;
        if (hitCount === 4) {
          return null;
        }
        return originalBodyDescriptor.get?.call(this);
      },
    });
    try {
      // detectDarkMode falls through to class-based detection since CSS parsing fails.
      expect(detectDarkMode(false)).toBe(true);
    } finally {
      Object.defineProperty(document, 'body', originalBodyDescriptor);
    }
  });
});
