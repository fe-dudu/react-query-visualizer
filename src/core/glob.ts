export const DEFAULT_INCLUDE = '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}';
export const DEFAULT_EXCLUDE =
  '**/{node_modules,dist,build,.next,coverage,.expo,.expo-shared,.turbo,.yarn,android,ios,Pods}/**';

export function parseGlobPatterns(input: string): string[] {
  const results: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of input) {
    if (char === '{') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        results.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    results.push(tail);
  }

  return results;
}
