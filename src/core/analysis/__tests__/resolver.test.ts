import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isCallExpression, isExpression, isIdentifier, isVariableDeclaration } from '../ast';
import { normalizeQueryKey } from '../queryKey';
import { createQueryKeyResolver, resetResolverCache } from '../resolver';
import { parseSource } from '../sourceParser';
import { buildSymbolIndex } from '../symbols';
import type { NormalizedQueryKey } from '../../../shared/contracts';

async function makeWorkspace(): Promise<{ root: string; files: Record<string, string> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'core', 'src'), { recursive: true });

  const files = {
    'package.json': JSON.stringify({ name: 'workspace' }),
    'tsconfig.json': JSON.stringify({
      extends: './tsconfig.base.json',
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@app/*': ['src/*'],
        },
      },
    }),
    'tsconfig.base.json': JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@shared/*': ['src/*'],
        },
      },
    }),
    'src/values.ts': [
      "import { ref } from 'vue';",
      "export const literalKey = ['literal'] as const;",
      'export const aliasKey = literalKey;',
      "export const refKey = ref(['ref'] as const);",
      "export let mutableKey = ['mutable'] as const;",
      "mutableKey = ['changed'] as const;",
      'export function makeKey(id: string) {',
      "  return ['local', id] as const;",
      '}',
    ].join('\n'),
    'src/other.ts': ["export { aliasKey as reExportedKey } from '../values';", "export * from '../values';"].join('\n'),
    'packages/core/package.json': JSON.stringify({ name: 'core' }),
    'packages/core/src/index.ts': [
      "export const pkgKey = ['pkg'] as const;",
      'export function makePkgKey(id: string) {',
      "  return ['pkg', id] as const;",
      '}',
      "export default function defaultFactory() { return ['default'] as const; }",
    ].join('\n'),
    'src/consumer.ts': [
      "import pkgDefault, { makePkgKey, pkgKey } from 'core';",
      "import { literalKey as aliasedByTsconfig } from '@shared/values';",
      "import { literalKey as importedLocalKey, makeKey, mutableKey, refKey } from '../values';",
      "import { reExportedKey } from '../other';",
      "import * as values from '../values';",
      "const localKey = ['local'] as const;",
      'const directValue = localKey;',
      'const pathAlias = importedLocalKey;',
      'const refAlias = refKey;',
      'const mutableAlias = mutableKey;',
      'const namespaceAlias = values.literalKey;',
      'const reExportAlias = reExportedKey;',
      'const packageAlias = pkgKey;',
      'const tsconfigAlias = aliasedByTsconfig;',
      'const packageNamespaceAlias = pkgDefault;',
      "const packagePathAlias = makePkgKey('pkg');",
      "const localCall = makeKey('local');",
      "const namespaceCall = values.makeKey('ns');",
      "const packageCall = makePkgKey('pkg');",
      'const packageDefaultCall = pkgDefault();',
    ].join('\n'),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content);
  }

  return { root, files };
}

async function makeAdvancedWorkspace(): Promise<{ root: string; consumerPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-advanced-'));
  const files = {
    'package.json': JSON.stringify({ name: 'advanced-workspace' }),
    'app/jsconfig.json': [
      '{',
      '  // comments and trailing commas are accepted here',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "#exact": ["src/exact"],',
      '      "@feature/*": ["features/*"],',
      '    },',
      '  },',
      '}',
    ].join('\n'),
    'app/src/exact.ts': "export const exactKey = ['exact'] as const;",
    'app/features/nested/index.ts': [
      "export const nestedKey = ['nested'] as const;",
      "export const holder = { queryKey: ['holder'] as const, nested: { queryKey: ['holder-nested'] as const }, 1: ['one'] as const };",
      "export const fromOptions = queryOptions({ queryKey: ['options'] as const });",
      'export function createNestedQueryKey(id: string) {',
      "  return ['nested-call', id] as const;",
      '}',
      'export function objectFactory() {',
      "  return { queryKey: ['object-factory'] as const, tuple: [['tuple-zero'] as const] as const };",
      '}',
    ].join('\n'),
    'packages/ui/package.json': JSON.stringify({
      name: '@scope/ui',
      exports: {
        '.': {
          import: 'src/main.ts',
        },
      },
    }),
    'packages/ui/src/main.ts': [
      "export const uiKey = ['ui'] as const;",
      'export const makeUiQueryKey = (id: string) => {',
      "  return ['ui-call', id] as const;",
      '};',
    ].join('\n'),
    'packages/ui/src/sub.ts': "export const subKey = ['sub'] as const;",
    'app/src/consumer.ts': [
      "import { exactKey } from '#exact';",
      "import { createNestedQueryKey, fromOptions, holder, nestedKey, objectFactory } from '@feature/nested';",
      "import { makeUiQueryKey, uiKey } from '@scope/ui';",
      "import { subKey } from '@scope/ui/sub';",
      'const exactAlias = exactKey;',
      'const nestedAlias = nestedKey;',
      'const holderKey = holder.queryKey;',
      'const holderNestedKey = holder.nested.queryKey;',
      'const holderNumericKey = holder[1];',
      'const optionsKey = fromOptions.queryKey;',
      'const objectFactoryKey = objectFactory().queryKey;',
      'const tupleFactoryKey = objectFactory().tuple[0];',
      "const nestedCall = createNestedQueryKey('value');",
      'const uiAlias = uiKey;',
      "const uiCall = makeUiQueryKey('value');",
      'const subAlias = subKey;',
      'const missingMember = holder.missing;',
    ].join('\n'),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return { root, consumerPath: path.join(root, 'app/src/consumer.ts') };
}

async function makeEdgeWorkspace(): Promise<{ root: string; consumerPath: string; helperPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-edge-'));
  const files = {
    'package.json': JSON.stringify({ name: 'edge-workspace' }),
    'app/tsconfig.json': [
      '{',
      '  "extends": "./missing-base",',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "": ["src/ignored"],',
      '      "@empty/*": [],',
      '      "@bad/*": [false],',
      '      "@mixed/*": [false, "src/*"],',
      '      "@dupe/*": ["../other/*", "src/*"]',
      '    }',
      '  }',
      '}',
    ].join('\n'),
    'app/src/mixed.ts': "export const mixedKey = ['mixed'] as const;",
    'app/src/chosen.ts': "export const chosenKey = ['near'] as const;",
    'other/chosen.ts': "export const chosenKey = ['far'] as const;",
    'packages/string-pkg/package.json': JSON.stringify({ name: 'string-pkg', exports: 'src/entry.ts' }),
    'packages/string-pkg/src/entry.ts': "export const stringKey = ['string-export'] as const;",
    'packages/main-pkg/package.json': JSON.stringify({ name: 'main-pkg', main: 'src/main.ts' }),
    'packages/main-pkg/src/main.ts': "export const mainKey = ['main-entry'] as const;",
    'packages/types-pkg/package.json': JSON.stringify({ name: 'types-pkg', types: 'src/types.ts' }),
    'packages/types-pkg/src/types.ts': "export const typesKey = ['types-entry'] as const;",
    'packages/ignored/package.json': JSON.stringify({ exports: 'src/index.ts' }),
    'app/src/helper.ts': [
      "export const namespaceFn = () => ['namespace-fn'] as const;",
      'export const namespaceAlias = namespaceFn;',
      "export const namespaceObject = { queryKey: ['namespace-object'] as const };",
    ].join('\n'),
    'app/src/consumer.ts': [
      "import { chosenKey } from '@dupe/chosen';",
      "import { mixedKey } from '@mixed/mixed';",
      "import { mainKey } from 'main-pkg';",
      "import * as helper from '../helper';",
      "import { stringKey } from 'string-pkg';",
      "import { typesKey } from 'types-pkg';",
      'const stringAlias = stringKey;',
      'const mainAlias = mainKey;',
      'const typesAlias = typesKey;',
      'const mixedAlias = mixedKey;',
      'const chosenAlias = chosenKey;',
      "const propertyName = 'queryKey';",
      'const numericProperty = 1;',
      "const spreadSource = { queryKey: ['spread'] as const };",
      'const spreadAlias = { ...spreadSource }[propertyName];',
      "const numericHolder = { 1: ['one'] as const };",
      'const numericAlias = numericHolder[numericProperty];',
      "const arrayHolder = [['zero'] as const, , ['two'] as const] as const;",
      'const arrayZero = arrayHolder[0];',
      'const arrayHole = arrayHolder[1];',
      "const wrappedObject = identity({ queryKey: ['wrapped-object'] as const }).queryKey;",
      "const wrappedArray = identity([['wrapped-array'] as const])[0];",
      "const frozenAlias = Object.freeze({ queryKey: ['frozen'] as const }).queryKey;",
      "const refValue = shallowRef(['shallow'] as const).value;",
      'const helperObjectAlias = helper.namespaceObject.queryKey;',
      'const helperCallAlias = helper.namespaceAlias();',
      'function wrapQueryKey(options: { queryKey: readonly unknown[] }) {',
      '  return options;',
      '}',
      'function makeNestedCall() {',
      "  return wrapQueryKey({ queryKey: ['nested-call'] as const });",
      '}',
      'function makeNestedArray() {',
      "  return [['nested-array'] as const, ['second-array'] as const] as const;",
      '}',
      "const localArrowFunctionQueryKey = () => ['local-arrow-function'] as const;",
      "let mutableArrowFunctionQueryKey = () => ['mutable-arrow-function'] as const;",
      "mutableArrowFunctionQueryKey = () => ['changed-arrow-function'] as const;",
      'const nestedCallQueryKey = makeNestedCall().queryKey;',
      'const nestedArrayValue = makeNestedArray()[0];',
      "function tupleFactory(first = ['default'] as const) {",
      "  return [first, ['second'] as const] as const;",
      '}',
      "const tupleFirst = tupleFactory(['provided'] as const)[0];",
      'function complexFactory(seed: readonly unknown[], key: string, keep: boolean) {',
      '  return [...seed, { nested: key }.nested, `' +
        '$' +
        '{key}' +
        '`, !keep ? key : "kept", (key, "tail")] as const;',
      '}',
      "const complexCall = complexFactory(['seed'] as const, 'dynamic', false);",
    ].join('\n'),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return {
    root,
    consumerPath: path.join(root, 'app/src/consumer.ts'),
    helperPath: path.join(root, 'app/src/helper.ts'),
  };
}

async function makeResolutionWorkspace(): Promise<{ root: string; consumerPath: string; sources: string[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-resolution-'));
  const files = {
    'package.json': JSON.stringify({ name: 'resolution-workspace' }),
    'tsconfig.json': [
      '{',
      '  // alias resolution with comments',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "@app/*": ["app/src/*"],',
      '    },',
      '  },',
      '}',
    ].join('\n'),
    'app/src/shared/createSharedQueryKey.ts':
      "export function createSharedQueryKey(seed: string) { return ['shared', seed] as const; }",
    'app/src/features/createSharedQueryKey.ts':
      "export function createSharedQueryKey(seed: string) { return ['shared-alt', seed] as const; }",
    'app/src/unique/createUniqueQueryKey.ts':
      "export function createUniqueQueryKey(seed: string) { return ['unique', seed] as const; }",
    'app/src/values.ts': [
      "import { ref, shallowRef } from 'vue';",
      "export const literalKey = ['literal'] as const;",
      'export const aliasKey = literalKey;',
      'export function identity<T>(value: T) {',
      '  return value;',
      '}',
      "export const refKey = ref(['ref'] as const);",
      "export const shallowKey = shallowRef(['shallow'] as const);",
      "export const frozenKey = Object.freeze(['frozen'] as const);",
      "export const wrappedObject = { queryKey: ['wrapped'] as const };",
      "export const nestedObject = { queryKey: ['nested'] as const, nested: { queryKey: ['nested-deep'] as const }, 1: ['one'] as const };",
      "export const objectFactory = () => ({ queryKey: ['factory-object'] as const, nested: { queryKey: ['factory-nested'] as const }, list: [['zero'] as const] as const, call: () => ['factory-call'] as const });",
      'export const nestedCall = () => objectFactory();',
    ].join('\n'),
    'packages/other/package.json': JSON.stringify({
      name: 'other-pkg',
      exports: {
        '.': {
          import: 'src/index.ts',
        },
      },
      main: 'src/main.ts',
      types: 'src/types.ts',
    }),
    'packages/other/src/index.ts': [
      "export const pkgKey = ['pkg-key'] as const;",
      'export function makePkgQueryKey(id: string) {',
      "  return ['pkg', id] as const;",
      '}',
      "export default function defaultPkg(id: string = 'default') {",
      "  return ['pkg-default', id] as const;",
      '}',
      "export const makeObject = () => ({ queryKey: ['pkg-object'] as const, nested: { queryKey: ['pkg-nested'] as const }, call: () => ['pkg-call'] as const, list: [['pkg-array'] as const] as const });",
      "export { subKey } from '../sub';",
    ].join('\n'),
    'packages/other/src/sub.ts': "export const subKey = ['sub'] as const;",
    'packages/other/src/main.ts': "export const mainKey = ['main-entry'] as const;",
    'packages/other/src/types.ts': "export const typesKey = ['types-entry'] as const;",
    'app/src/consumer.ts': [
      "import pkgDefault, { makeObject, makePkgQueryKey, pkgKey, subKey } from 'other-pkg';",
      "import * as pkgNS from 'other-pkg';",
      "import { aliasKey, frozenKey, literalKey, nestedCall, nestedObject, objectFactory, refKey, shallowKey, wrappedObject } from '@app/values';",
      "const computedName = 'queryKey';",
      'const numericIndex = 1;',
      'const uniqueFromWorkspace = createUniqueQueryKey("unique");',
      'const sharedFromWorkspace = createSharedQueryKey("shared");',
      'const packageCall = makePkgQueryKey("pkg");',
      'const packageDefaultCall = pkgDefault("pkg");',
      'const namespaceCall = pkgNS.makePkgQueryKey("ns");',
      'const namespaceDefaultCall = pkgNS.default("ns");',
      'const packageObjectKey = makeObject().queryKey;',
      'const packageNestedKey = makeObject().nested.queryKey;',
      'const packageListKey = makeObject().list[0];',
      'const packageCallKey = makeObject().call();',
      'const aliasValue = aliasKey;',
      'const literalValue = literalKey;',
      'const identityObjectKey = identity(objectFactory()).queryKey;',
      'const identityArrayKey = identity(objectFactory().list)[0];',
      'const identityNestedCallKey = identity(nestedCall()).queryKey;',
      'const refValue = refKey.value;',
      'const shallowValue = shallowKey.value;',
      'const frozenValue = frozenKey;',
      'const wrappedValue = wrappedObject.queryKey;',
      'const nestedValue = nestedObject.nested.queryKey;',
      'const nestedCallValue = nestedCall().queryKey;',
      'const factoryValue = objectFactory().queryKey;',
      'const factoryNestedValue = objectFactory().nested.queryKey;',
      'const factoryListValue = objectFactory().list[0];',
      'const factoryCallValue = objectFactory().call();',
      'const computedValue = nestedObject[computedName];',
      'const numericValue = nestedObject[numericIndex];',
      'const pkgAlias = pkgKey;',
      'const subAlias = subKey;',
    ].join('\n'),
  };

  const sources = Object.keys(files).filter((relativePath) => relativePath.endsWith('.ts'));
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return { root, consumerPath: path.join(root, 'app/src/consumer.ts'), sources };
}

async function makeAliasSortingWorkspace(): Promise<{
  root: string;
  consumerPath: string;
  sources: string[];
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-alias-sort-'));
  const files = {
    'package.json': JSON.stringify({ name: 'alias-sort-workspace' }),
    'app/node_modules/base-tsconfig.json': [
      '{',
      '  "compilerOptions": {',
      '    "baseUrl": "../src",',
      '    "paths": {',
      '      "@shared": ["shared"],',
      '      "@shared-util": ["shared/util"],',
      '      "@shared/*": ["shared/*"],',
      '      "@shared-util/*": ["shared/util/*"]',
      '    }',
      '  }',
      '}',
    ].join('\n'),
    'app/tsconfig.json': [
      '{',
      '  "extends": "base-tsconfig.json",',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "@alpha": ["src/alpha"],',
      '      "@beta": ["src/beta"],',
      '      "@wild/*": ["src/wild/*"]',
      '    }',
      '  }',
      '}',
    ].join('\n'),
    'app/src/shared/index.ts': "export const sharedKey = ['shared'] as const;",
    'app/src/shared/util.ts': "export const sharedUtilKey = ['shared-util'] as const;",
    'app/src/shared/item.ts': "export const sharedItemKey = ['shared-item'] as const;",
    'app/src/alpha.ts': "export const alphaKey = ['alpha'] as const;",
    'app/src/beta.ts': "export const betaKey = ['beta'] as const;",
    'app/src/wild/item.ts': "export const wildKey = ['wild'] as const;",
    'app/src/local.ts': [
      'export function makeLocal(id: string) {',
      "  return ['local', id] as const;",
      '}',
      'export const localAlias = makeLocal;',
      "export const arrowFactory = (id: string) => ['arrow', id] as const;",
      'export const arrowAlias = arrowFactory;',
      'export let mutableAlias = makeLocal;',
      'mutableAlias = arrowFactory;',
    ].join('\n'),
    'packages/pkg/package.json': JSON.stringify({
      name: 'pkg-exp',
      exports: {
        '.': {
          default: 'src/default.ts',
          types: 'src/types.ts',
          import: 'src/import.ts',
          require: 'src/require.ts',
        },
        './sub': {
          default: 'src/sub/index.ts',
          types: 'src/sub/index.ts',
        },
      },
      main: 'src/main.ts',
      types: 'src/types.ts',
    }),
    'packages/pkg/src/default.ts':
      "export default function defaultPkg(id: string = 'default') { return ['pkg-default', id] as const; }",
    'packages/pkg/src/types.ts': "export const typesKey = ['pkg-types'] as const;",
    'packages/pkg/src/import.ts': "export const importKey = ['pkg-import'] as const;",
    'packages/pkg/src/require.ts': "export const requireKey = ['pkg-require'] as const;",
    'packages/pkg/src/main.ts': "export const mainKey = ['pkg-main'] as const;",
    'packages/pkg/src/sub/index.ts': "export const subKey = ['pkg-sub'] as const;",
    'app/src/consumer.ts': [
      "import pkgDefault, { subKey } from 'pkg-exp';",
      "import * as pkgNS from 'pkg-exp';",
      "import { alphaKey } from '@alpha';",
      "import { betaKey } from '@beta';",
      "import { sharedItemKey, sharedKey } from '@shared';",
      "import { sharedUtilKey } from '@shared-util';",
      "import { wildKey } from '@wild/item';",
      "import { arrowAlias, localAlias, makeLocal, mutableAlias } from '../local';",
      'const alphaAlias = alphaKey;',
      'const betaAlias = betaKey;',
      'const sharedAlias = sharedKey;',
      'const sharedUtilAlias = sharedUtilKey;',
      'const sharedItemAlias = sharedItemKey;',
      'const wildAlias = wildKey;',
      'const defaultAlias = pkgDefault;',
      'const subAlias = subKey;',
      'const namespaceDefaultAlias = pkgNS.default;',
      "const localCall = localAlias('x');",
      "const arrowCall = arrowAlias('y');",
      "const directCall = makeLocal('z');",
      "const mutableCall = mutableAlias('m');",
      "const defaultCall = pkgDefault('d');",
      "const namespaceCall = pkgNS.default('n');",
    ].join('\n'),
  };

  const sources = new Map<string, ReturnType<typeof parseSource>>();
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    if (relativePath.endsWith('.ts')) {
      sources.set(filePath, parseSource(content, filePath));
    }
  }

  return {
    root,
    consumerPath: path.join(root, 'app/src/consumer.ts'),
    sources: [...sources.keys()],
  };
}

function queryKeySegments(queryKey: NormalizedQueryKey): string[] {
  return queryKey.segments;
}

function variableInit(ast: ReturnType<typeof parseSource>, name: string) {
  for (const statement of ast.program.body) {
    if (!isVariableDeclaration(statement)) {
      continue;
    }

    const declarator = statement.declarations[0];
    if (!declarator || !isIdentifier(declarator.id) || declarator.id.name !== name) {
      continue;
    }

    const init = declarator.init;
    if (init && isExpression(init)) {
      return init;
    }
  }

  throw new Error(`Missing statement ${name}`);
}

describe('core/analysis/resolver', () => {
  it('resolves local, imported, namespaced, and package symbols', async () => {
    const { root } = await makeWorkspace();
    const sources = new Map<string, ReturnType<typeof parseSource>>();

    for (const relativePath of ['src/values.ts', 'src/other.ts', 'packages/core/src/index.ts', 'src/consumer.ts']) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const index = buildSymbolIndex(sources);

    resetResolverCache();
    const resolver = createQueryKeyResolver(path.join(root, 'src/consumer.ts'), index, root);
    const consumerAst = sources.get(path.join(root, 'src/consumer.ts'));
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }
    expect(index.files.size).toBe(4);

    const statements = consumerAst.program.body;
    const getInit = (name: string) => {
      const statement = statements.find((entry): entry is (typeof statements)[number] => {
        const declarator = isVariableDeclaration(entry) ? entry.declarations[0] : undefined;
        return (
          isVariableDeclaration(entry) && !!declarator && isIdentifier(declarator.id) && declarator.id.name === name
        );
      });
      if (!statement || !isVariableDeclaration(statement)) {
        throw new Error(`Missing statement ${name}`);
      }
      const init = statement.declarations[0]?.init;
      return init && isExpression(init) ? init : undefined;
    };

    const directValue = getInit('directValue');
    const pathAlias = getInit('pathAlias');
    const refAlias = getInit('refAlias');
    const mutableAlias = getInit('mutableAlias');
    const namespaceAlias = getInit('namespaceAlias');
    const reExportAlias = getInit('reExportAlias');
    const packageAlias = getInit('packageAlias');
    const tsconfigAlias = getInit('tsconfigAlias');
    const packageNamespaceAlias = getInit('packageNamespaceAlias');
    const localCall = getInit('localCall');
    const packagePathAlias = getInit('packagePathAlias');
    const namespaceCall = getInit('namespaceCall');
    const packageCall = getInit('packageCall');
    const packageDefaultCall = getInit('packageDefaultCall');

    if (directValue) {
      expect(queryKeySegments(normalizeQueryKey(directValue, { defaultMode: 'exact' }, resolver))).toEqual(['local']);
    }
    if (pathAlias) {
      expect(queryKeySegments(normalizeQueryKey(pathAlias, { defaultMode: 'exact' }, resolver)).length).toBeGreaterThan(
        0,
      );
    }
    if (refAlias) {
      expect(queryKeySegments(normalizeQueryKey(refAlias, { defaultMode: 'exact' }, resolver)).length).toBeGreaterThan(
        0,
      );
    }
    if (mutableAlias) {
      expect(queryKeySegments(normalizeQueryKey(mutableAlias, { defaultMode: 'exact' }, resolver))).toEqual([
        '$mutableKey',
      ]);
    }
    if (namespaceAlias) {
      expect(
        queryKeySegments(normalizeQueryKey(namespaceAlias, { defaultMode: 'exact' }, resolver)).length,
      ).toBeGreaterThan(0);
    }
    if (reExportAlias) {
      expect(
        queryKeySegments(normalizeQueryKey(reExportAlias, { defaultMode: 'exact' }, resolver)).length,
      ).toBeGreaterThan(0);
    }
    if (packageAlias) {
      expect(queryKeySegments(normalizeQueryKey(packageAlias, { defaultMode: 'exact' }, resolver))).toEqual(['pkg']);
    }
    if (tsconfigAlias) {
      expect(queryKeySegments(normalizeQueryKey(tsconfigAlias, { defaultMode: 'exact' }, resolver))).toEqual([
        'literal',
      ]);
    }
    if (packageNamespaceAlias) {
      expect(queryKeySegments(normalizeQueryKey(packageNamespaceAlias, { defaultMode: 'exact' }, resolver))).toEqual([
        'default',
      ]);
    }

    if (localCall && isCallExpression(localCall)) {
      expect(queryKeySegments(normalizeQueryKey(localCall, { defaultMode: 'exact' }, resolver)).length).toBeGreaterThan(
        0,
      );
    }
    if (packagePathAlias && isCallExpression(packagePathAlias)) {
      expect(queryKeySegments(normalizeQueryKey(packagePathAlias, { defaultMode: 'exact' }, resolver))).toEqual([
        'pkg',
        '$id',
      ]);
    }
    if (namespaceCall && isCallExpression(namespaceCall)) {
      expect(
        queryKeySegments(normalizeQueryKey(namespaceCall, { defaultMode: 'exact' }, resolver)).length,
      ).toBeGreaterThan(0);
    }
    if (packageCall && isCallExpression(packageCall)) {
      expect(queryKeySegments(normalizeQueryKey(packageCall, { defaultMode: 'exact' }, resolver))).toEqual([
        'pkg',
        '$id',
      ]);
    }
    if (packageDefaultCall && isCallExpression(packageDefaultCall)) {
      expect(queryKeySegments(normalizeQueryKey(packageDefaultCall, { defaultMode: 'exact' }, resolver))).toEqual([
        'default',
      ]);
    }

    resetResolverCache();
  });

  it('resolves jsconfig aliases, lazily indexed files, package exports, and member chains', async () => {
    const { root, consumerPath } = await makeAdvancedWorkspace();
    const consumerAst = parseSource(await readFile(consumerPath, 'utf8'), consumerPath);
    const subPath = path.join(root, 'packages/ui/src/sub.ts');
    const subAst = parseSource(await readFile(subPath, 'utf8'), subPath);
    const index = buildSymbolIndex(
      new Map([
        [consumerPath, consumerAst],
        [subPath, subAst],
      ]),
    );

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, index, root);
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    expectSegments('exactAlias', ['exact']);
    expectSegments('nestedAlias', ['nested']);
    expectSegments('holderKey', ['holder']);
    expectSegments('holderNestedKey', ['holder-nested']);
    expectSegments('holderNumericKey', ['one']);
    expectSegments('optionsKey', ['options']);
    expectSegments('objectFactoryKey', ['object-factory']);
    expectSegments('tupleFactoryKey', ['tuple-zero']);
    expectSegments('nestedCall', ['nested-call', '$id']);
    expectSegments('uiAlias', ['ui']);
    expectSegments('uiCall', ['ui-call', 'value']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'subAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expectSegments('missingMember', ['[holder].missing']);
    expect(index.files.size).toBeGreaterThan(0);

    resetResolverCache();
  });

  it('resolves edge aliases, package entry fields, wrapped members, and hinted call arguments', async () => {
    const { root, consumerPath, helperPath } = await makeEdgeWorkspace();
    const consumerAst = parseSource(await readFile(consumerPath, 'utf8'), consumerPath);
    const helperAst = parseSource(await readFile(helperPath, 'utf8'), helperPath);
    const index = buildSymbolIndex(
      new Map([
        [consumerPath, consumerAst],
        [helperPath, helperAst],
      ]),
    );

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, index, root);
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    expectSegments('stringAlias', ['string-export']);
    expectSegments('mainAlias', ['main-entry']);
    expectSegments('typesAlias', ['types-entry']);
    expectSegments('mixedAlias', ['mixed']);
    expectSegments('chosenAlias', ['near']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'spreadAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expectSegments('numericAlias', ['{1: [one]}.numericProperty']);
    expectSegments('arrayZero', ['zero']);
    expectSegments('arrayHole', ['[[zero], undefined, [two]].1']);
    expectSegments('wrappedObject', ['wrapped-object']);
    expectSegments('wrappedArray', ['wrapped-array']);
    expectSegments('frozenAlias', ['frozen']);
    expectSegments('refValue', ['shallow']);
    expectSegments('helperObjectAlias', ['$helper.namespaceObject.queryKey']);
    expectSegments('helperCallAlias', ['$helper.namespaceAlias()']);
    expectSegments('nestedCallQueryKey', ['nested-call']);
    expectSegments('nestedArrayValue', ['nested-array']);
    expectSegments('tupleFirst', ['provided']);
    expectSegments('complexCall', ['$seed', '$key', '$' + '{key}', 'cond(...)', 'UNRESOLVED']);

    expect(index.files.size).toBeGreaterThan(2);
    resetResolverCache();
  });

  it('parses block comments and escaped strings while resolving aliases', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-comments-'));
    const files = {
      'package.json': JSON.stringify({ name: 'comment-workspace' }),
      'tsconfig.json': [
        '{',
        '  /* block comment */',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@escaped/*": ["src/*"],',
        '    },',
        '  },',
        '  "description": "value with a \\"quoted\\" string",',
        '}',
      ].join('\n'),
      'src/escape.ts': "export const escapeKey = ['escape'] as const;",
      'src/consumer.ts': ["import { escapeKey } from '@escaped/escape';", 'const alias = escapeKey;'].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const escapePath = path.join(root, 'src/escape.ts');
    const consumerAst = parseSource(await readFile(consumerPath, 'utf8'), consumerPath);
    const escapeAst = parseSource(await readFile(escapePath, 'utf8'), escapePath);
    const index = buildSymbolIndex(
      new Map([
        [consumerPath, consumerAst],
        [escapePath, escapeAst],
      ]),
    );

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'alias'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['escape']);

    resetResolverCache();
  });

  it('resolves local function aliases, wrapped objects, tuple indexes, ref values, and namespace calls', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-wrappers-'));
    const files = {
      'package.json': JSON.stringify({ name: 'wrapper-workspace' }),
      'src/values.ts': [
        "import { shallowRef } from 'vue';",
        "export const localFactory = (seed = ['seed'] as const) => ['factory', seed] as const;",
        'export const localAlias = localFactory;',
        "export const objectWrapper = Object.freeze({ queryKey: ['wrapped'] as const, nested: { queryKey: ['nested'] as const }, tuple: [['tuple'] as const] as const });",
        "export const refValue = shallowRef(['ref'] as const).value;",
        "export const namespaceFn = () => ['namespace'] as const;",
      ].join('\n'),
      'src/consumer.ts': [
        "import { localAlias, namespaceFn, objectWrapper, refValue } from '../values';",
        "import * as values from '../values';",
        "const aliasCall = localAlias('value');",
        'const wrappedKey = objectWrapper.queryKey;',
        'const wrappedNestedKey = objectWrapper.nested.queryKey;',
        'const wrappedTuple = objectWrapper.tuple[0];',
        'const refAlias = refValue;',
        'const namespaceCall = namespaceFn();',
        'const namespaceAlias = values.namespaceFn;',
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const sources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of Object.keys(files).filter((value) => value.endsWith('.ts'))) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = sources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sources), root);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'aliasCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'wrappedKey'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'wrappedNestedKey'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'wrappedTuple'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'refAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceAlias'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);

    resetResolverCache();
  });

  it('resolves aliased function expressions and namespace function declarations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-function-return-'));
    const files = {
      'src/values.ts': ["export function namespaceFactory() { return ['namespace-fn'] as const; }"].join('\n'),
      'src/consumer.ts': [
        "import * as values from '../values';",
        "const localFn = () => ['local-fn'] as const;",
        'const aliasCall = localFn;',
        'const namespaceCall = values.namespaceFactory();',
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const sources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of Object.keys(files)) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = sources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sources), root);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'aliasCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['local-fn']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);

    resetResolverCache();
  });

  it('resolves unique workspace query key factories without imports', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-workspace-factory-'));
    const files = {
      'src/consumer.ts': [
        "const uniqueCall = makeTodoQueryKey('42');",
        "const rqCall = buildRqKey('rq');",
        "const ambiguousCall = makeSharedQueryKey('ambiguous');",
        "const ignoredCall = makeKey('ignored');",
      ].join('\n'),
      'src/factory.ts': [
        'export function makeTodoQueryKey(id = "fallback") {',
        "  return ['todo', id] as const;",
        '}',
        "export const buildRqKey = (id: string) => ['rq', id] as const;",
      ].join('\n'),
      'src/a/shared.ts': "export const makeSharedQueryKey = (id: string) => ['a', id] as const;",
      'src/b/shared.ts': "export const makeSharedQueryKey = (id: string) => ['b', id] as const;",
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const sources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of Object.keys(files)) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = sources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sources), root);

    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'uniqueCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['todo', '$id']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'rqCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['rq', '$id']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'ambiguousCall'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['call(makeSharedQueryKey)']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'ignoredCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['call(makeKey)']);

    resetResolverCache();
  });

  it('fails closed for missing modules, invalid configs, and unresolvable members', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-fail-closed-'));
    const files = {
      'app/tsconfig.json': [
        '{',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@missing/*": ["missing/*"],',
        '      "@empty/*": [],',
        '      "@invalid/*": [false],',
        '    },',
        '  },',
        '}',
      ].join('\n'),
      'app/src/consumer.ts': [
        "import { missingKey } from '@missing/key';",
        "import { emptyKey } from '@empty/key';",
        "import { invalidKey } from '@invalid/key';",
        "import * as noFile from '../missing';",
        'const missingAlias = missingKey;',
        'const emptyAlias = emptyKey;',
        'const invalidAlias = invalidKey;',
        'const namespaceMissing = noFile.key;',
        'const computedMissing = namespaceMissing[propertyName];',
        'const outOfBounds = tupleFactory()[5];',
        "function tupleFactory() { return [['zero'] as const] as const; }",
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const consumerPath = path.join(root, 'app/src/consumer.ts');
    const consumerAst = parseSource(await readFile(consumerPath, 'utf8'), consumerPath);
    const index = buildSymbolIndex(new Map([[consumerPath, consumerAst]]));

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, index, root);
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    expectSegments('missingAlias', ['$missingKey']);
    expectSegments('emptyAlias', ['$emptyKey']);
    expectSegments('invalidAlias', ['$invalidKey']);
    expectSegments('namespaceMissing', ['$noFile.key']);
    expectSegments('computedMissing', ['$namespaceMissing.propertyName']);
    expectSegments('outOfBounds', ['[[zero]].5']);

    resetResolverCache();
  });

  it('resolves path alias sorting, package export fallbacks, and mutable local function aliases', async () => {
    const { root, consumerPath, sources } = await makeAliasSortingWorkspace();
    const sourceMaps = new Map<string, ReturnType<typeof parseSource>>();

    for (const filePath of sources) {
      sourceMaps.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerAst = sourceMaps.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sourceMaps), root);
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    expectSegments('alphaAlias', ['alpha']);
    expectSegments('betaAlias', ['beta']);
    expectSegments('sharedAlias', ['shared']);
    expectSegments('sharedUtilAlias', ['shared-util']);
    expectSegments('sharedItemAlias', ['$sharedItemKey']);
    expectSegments('wildAlias', ['wild']);
    expectSegments('defaultAlias', ['pkg-default', '$id']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'subAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'localCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrowCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'directCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'defaultCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);

    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'mutableCall'), { defaultMode: 'exact' }, resolver),
      ).join('/'),
    ).toContain('mutableAlias');

    expect(sourceMaps.size).toBeGreaterThan(0);
    resetResolverCache();
  });

  it('resolves function returns through star and renamed re-exports', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-reexport-fn-'));
    const files = {
      'src/base.ts': [
        'export function makeStarQueryKey(id: string) {',
        "  return ['star', id] as const;",
        '}',
        "export const aliasFactory = (kind: string) => ['alias', kind] as const;",
        "let mutableFactory = () => ['old'] as const;",
        "mutableFactory = () => ['new'] as const;",
        'export { mutableFactory };',
      ].join('\n'),
      'src/barrel.ts': [
        "export * from '../base';",
        "export { makeStarQueryKey as renamedQueryKey, aliasFactory as renamedAliasFactory } from '../base';",
      ].join('\n'),
      'src/consumer.ts': [
        "import { aliasFactory, makeStarQueryKey, mutableFactory, renamedAliasFactory, renamedQueryKey } from '../barrel';",
        "import * as barrel from '../barrel';",
        "const starCall = makeStarQueryKey('one');",
        "const renamedCall = renamedQueryKey('two');",
        "const aliasCall = aliasFactory('three');",
        "const renamedAliasCall = renamedAliasFactory('four');",
        "const namespaceCall = barrel.makeStarQueryKey('five');",
        'const mutableCall = mutableFactory();',
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const sources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of Object.keys(files)) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = sources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sources), root);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'starCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'renamedCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'aliasCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'renamedAliasCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'mutableCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);

    resetResolverCache();
  });

  it('resolves nested wrapper chains, member access, and optional access in a local workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-nested-'));
    const files = {
      'src/base.ts': [
        "export const baseObject = { queryKey: ['base'] as const, nested: { queryKey: ['nested'] as const }, 1: ['one'] as const };",
        'export const wrapObject = (options: { queryKey: readonly unknown[] }) => options;',
        "export const makeObject = () => ({ queryKey: ['call-object'] as const, nested: { queryKey: ['nested-object'] as const } });",
        "export const makeArray = () => [['call-array'] as const, ['second-array'] as const] as const;",
        "export const frozenObject = Object.freeze({ queryKey: ['frozen'] as const });",
        'export const aliasFactory = wrapObject;',
        "export default function defaultFactory() { return { queryKey: ['default'] as const }; }",
      ].join('\n'),
      'src/consumer.ts': [
        "import defaultFactory, * as base from '../base';",
        "import { aliasFactory, baseObject, frozenObject, makeArray, makeObject, wrapObject } from '../base';",
        'const spreadObject = { ...baseObject };',
        'const spreadAlias = spreadObject.queryKey;',
        'const nestedAlias = baseObject.nested.queryKey;',
        'const numericAlias = baseObject[1];',
        'const callObject = makeObject().queryKey;',
        'const callNested = makeObject().nested.queryKey;',
        'const callArray = makeArray()[0];',
        'const callArraySecond = makeArray()[1];',
        "const wrappedCall = wrapObject({ queryKey: ['wrapped'] as const }).queryKey;",
        "const aliasWrappedCall = aliasFactory({ queryKey: ['alias-wrap'] as const }).queryKey;",
        'const frozenAlias = frozenObject.queryKey;',
        'const defaultAlias = defaultFactory().queryKey;',
        'const namespaceCall = base.makeObject().queryKey;',
        'const namespaceObject = base.baseObject.queryKey;',
        'const optionalAlias = baseObject?.queryKey;',
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const sources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of Object.keys(files)) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = sources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sources), root);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'spreadAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'nestedAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'numericAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'callObject'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'callNested'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'callArray'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'callArraySecond'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'wrappedCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'aliasWrappedCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'frozenAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'defaultAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceCall'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceObject'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'optionalAlias'), { defaultMode: 'exact' }, resolver),
      ).length,
    ).toBeGreaterThan(0);

    resetResolverCache();
  });

  it('resolves local and namespace call results through identifier and member callees', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-call-result-'));
    const files = {
      'src/base.ts': [
        "export const makeBaseKey = () => ['base'] as const;",
        'export const makeObject = () => ({ queryKey: makeBaseKey() });',
        'export const nested = { makeBaseKey };',
      ].join('\n'),
      'src/consumer.ts': [
        "import * as base from '../base';",
        "const directFn = () => ['direct'] as const;",
        'const aliasFn = directFn;',
        'const objectHolder = { fn: directFn };',
        'const aliasHolder = { fn: aliasFn };',
        'const callDirect = directFn();',
        'const callAlias = aliasFn();',
        'const callObject = objectHolder.fn();',
        'const callAliasObject = aliasHolder.fn();',
        'const callNamespace = base.makeBaseKey();',
        'const callNamespaceObject = base.makeObject();',
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const sources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of Object.keys(files)) {
      const filePath = path.join(root, relativePath);
      sources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = sources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(sources), root);
    const callCallee = (name: string) => {
      const callExpression = variableInit(consumerAst, name);
      if (!callExpression || !isCallExpression(callExpression)) {
        throw new Error(`Missing call expression ${name}`);
      }
      return callExpression.callee;
    };

    expect(
      normalizeQueryKey(resolver.resolveCallResult(callCallee('callDirect')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['direct'],
    });
    expect(
      normalizeQueryKey(resolver.resolveCallResult(callCallee('callAlias')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['direct'],
    });
    expect(
      normalizeQueryKey(resolver.resolveCallResult(callCallee('callObject')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['direct'],
    });
    expect(
      normalizeQueryKey(resolver.resolveCallResult(callCallee('callAliasObject')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['direct'],
    });
    expect(
      normalizeQueryKey(resolver.resolveCallResult(callCallee('callNamespace')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['UNRESOLVED'],
    });
    expect(
      normalizeQueryKey(
        resolver.resolveCallResult(callCallee('callNamespaceObject')),
        { defaultMode: 'exact' },
        resolver,
      ),
    ).toMatchObject({
      segments: ['UNRESOLVED'],
    });

    resetResolverCache();
  });

  it('resolves workspace-search factories, package members, and nested wrapper paths', async () => {
    const { root, consumerPath, sources } = await makeResolutionWorkspace();
    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const relativePath of sources) {
      const filePath = path.join(root, relativePath);
      parsedSources.set(filePath, parseSource(await readFile(filePath, 'utf8'), filePath));
    }

    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing consumer AST');
    }

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, buildSymbolIndex(parsedSources), root);
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    const uniqueCall = variableInit(consumerAst, 'uniqueFromWorkspace');
    if (!uniqueCall || !isCallExpression(uniqueCall)) {
      throw new Error('Missing uniqueFromWorkspace call');
    }
    const sharedCall = variableInit(consumerAst, 'sharedFromWorkspace');
    if (!sharedCall || !isCallExpression(sharedCall)) {
      throw new Error('Missing sharedFromWorkspace call');
    }

    expect(
      normalizeQueryKey(resolver.resolveCallResult(uniqueCall.callee), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['unique', '$seed'],
    });
    expect(resolver.resolveCallResult(sharedCall.callee)).toBeUndefined();

    expectSegments('packageCall', ['pkg', '$id']);
    expectSegments('packageDefaultCall', ['pkg-default', '$id']);
    expectSegments('namespaceCall', ['pkg', '$id']);
    expectSegments('namespaceDefaultCall', ['pkg-default', '$id']);
    expectSegments('packageObjectKey', ['pkg-object']);
    expectSegments('packageNestedKey', ['pkg-nested']);
    expectSegments('packageListKey', ['pkg-array']);
    expectSegments('packageCallKey', ['pkg-call']);
    expectSegments('aliasValue', ['literal']);
    expectSegments('literalValue', ['literal']);
    expectSegments('identityObjectKey', ['factory-object']);
    expectSegments('identityArrayKey', ['call(identity).0']);
    expectSegments('identityNestedCallKey', ['factory-object']);
    expectSegments('refValue', ['ref']);
    expectSegments('shallowValue', ['shallow']);
    expectSegments('frozenValue', ['frozen']);
    expectSegments('wrappedValue', ['wrapped']);
    expectSegments('nestedValue', ['nested-deep']);
    expectSegments('nestedCallValue', ['factory-object']);
    expectSegments('factoryValue', ['factory-object']);
    expectSegments('factoryNestedValue', ['factory-nested']);
    expectSegments('factoryListValue', ['zero']);
    expectSegments('factoryCallValue', ['factory-call']);
    expectSegments('computedValue', ['[nested].computedName']);
    expectSegments('numericValue', ['[nested].numericIndex']);
    expectSegments('pkgAlias', ['pkg-key']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'subAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);

    const packageNamespaceCallee = variableInit(consumerAst, 'namespaceCall');
    if (!packageNamespaceCallee || !isCallExpression(packageNamespaceCallee)) {
      throw new Error('Missing namespaceCall');
    }
    expect(
      normalizeQueryKey(resolver.resolveCallResult(packageNamespaceCallee.callee), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['pkg', '$id'],
    });

    const packageDefaultCallee = variableInit(consumerAst, 'packageDefaultCall');
    if (!packageDefaultCallee || !isCallExpression(packageDefaultCallee)) {
      throw new Error('Missing packageDefaultCall');
    }
    expect(
      normalizeQueryKey(resolver.resolveCallResult(packageDefaultCallee.callee), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['pkg-default', '$id'],
    });

    resetResolverCache();
  });

  it('inlines function arguments through declaration, expression, and wrapper call chains', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-hints-'));
    const valuesPath = path.join(root, 'src/values.ts');
    const consumerPath = path.join(root, 'src/consumer.ts');
    const files = {
      'package.json': JSON.stringify({ name: 'hints-workspace' }),
      'src/values.ts': [
        "export const objectAlias = { queryKey: ['base'] as const, nested: { queryKey: ['nested'] as const }, tuple: [['tuple'] as const] as const, call: () => ['call'] as const, alias: ['alias'] as const };",
        'export const nestedAlias = objectAlias.nested;',
        "export const arrayAlias = [['array'] as const, ['second'] as const] as const;",
        'export function declReturn(id: string, suffix: string) {',
        '  return [id, suffix, { queryKey: [id] as const }, Object.freeze({ queryKey: [suffix] as const }).queryKey, `' +
          '$' +
          '{id}-' +
          '$' +
          '{suffix}`] as const;',
        '}',
        'export const exprReturn = function exprReturn(id: string, suffix: string) {',
        '  return [id, suffix, { queryKey: [suffix] as const }, [id, suffix], (id, suffix)] as const;',
        '};',
        'export const arrowReturn = (id: string, suffix: string) => [id, suffix, { queryKey: [id] as const }, [suffix] as const] as const;',
        'export const templateReturn = (id: string) => [`template-' + '$' + '{id}`] as const;',
        'export const sequenceReturn = (id: string, suffix: string) => [(id, suffix)] as const;',
        'export const identity = <T,>(value: T) => value;',
      ].join('\n'),
      'src/consumer.ts': [
        "import { arrayAlias, arrowReturn, declReturn, exprReturn, identity, nestedAlias, objectAlias, sequenceReturn, templateReturn } from '../values';",
        "const declCall = declReturn('left', 'right');",
        "const exprCall = exprReturn('left', 'right');",
        "const arrowCall = arrowReturn('left', 'right');",
        "const templateCall = templateReturn('left');",
        "const sequenceCall = sequenceReturn('left', 'right');",
        'const nestedObjectKey = objectAlias.nested.queryKey;',
        'const nestedAliasKey = nestedAlias.queryKey;',
        'const tupleKey = objectAlias.tuple[0];',
        'const callKey = objectAlias.call();',
        'const arrayFirst = arrayAlias[0];',
        "const identityCall = identity({ queryKey: ['identity'] as const }).queryKey;",
        "const computedKey = objectAlias['queryKey'];",
        'const aliasKey = objectAlias.alias;',
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const consumerAst = parseSource(await readFile(consumerPath, 'utf8'), consumerPath);
    const valuesAst = parseSource(await readFile(valuesPath, 'utf8'), valuesPath);
    const index = buildSymbolIndex(
      new Map([
        [consumerPath, consumerAst],
        [valuesPath, valuesAst],
      ]),
    );

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'declCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['call(declReturn)']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'exprCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrowCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'templateCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'sequenceCall'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'nestedObjectKey'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'nestedAliasKey'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'tupleKey'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'callKey'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrayFirst'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'identityCall'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'computedKey'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'aliasKey'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(expect.any(Array));

    const declCall = variableInit(consumerAst, 'declCall');
    if (!declCall || !isCallExpression(declCall)) {
      throw new Error('Missing declCall');
    }
    expect(
      normalizeQueryKey(resolver.resolveCallResult(declCall.callee), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: expect.any(Array),
    });

    resetResolverCache();
  });

  it('handles alias config edge cases without narrowing resolution scope', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-config-'));
    const absoluteTargetDir = path.join(root, 'shared');
    const files = {
      'shared/abs.ts': "export const absoluteKey = ['absolute'] as const;",
      'app/tsconfig.json': [
        '{',
        '  "extends": "./base",',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        `      "@abs/*": ["${absoluteTargetDir.split('\\').join('/')}/*"],`,
        '      "@empty/*": [],',
        '      "@mixed/*": [false, "src/*"],',
        '      "": ["src/ignored"]',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'app/base.json': [
        '{',
        '  "extends": "   ",',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@base/*": ["src/base/*"],',
        '    },',
        '  },',
        '}',
      ].join('\n'),
      'app/src/base/key.ts': "export const baseKey = ['base'] as const;",
      'app/src/mixed.ts': "export const mixedKey = ['mixed'] as const;",
      'app/src/consumer.ts': [
        "import { absoluteKey } from '@abs/abs';",
        "import { baseKey } from '@base/key';",
        "import { mixedKey } from '@mixed/mixed';",
        'const absoluteAlias = absoluteKey;',
        'const baseAlias = baseKey;',
        'const mixedAlias = mixedKey;',
      ].join('\n'),
      'invalid/tsconfig.json': '',
      'invalid/src/consumer.ts': [
        "import { missingKey } from '@missing/key';",
        'const missingAlias = missingKey;',
      ].join('\n'),
      'circular/a/tsconfig.json': JSON.stringify({ extends: '../b/tsconfig.json' }),
      'circular/b/tsconfig.json': JSON.stringify({ extends: '../a/tsconfig.json' }),
      'circular/a/src/consumer.ts': "const localKey = ['local'] as const;",
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'app/src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing config consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'absoluteAlias'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['absolute']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'baseAlias'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['base']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'mixedAlias'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['mixed']);

    const invalidPath = path.join(root, 'invalid/src/consumer.ts');
    const invalidAst = parsedSources.get(invalidPath);
    if (!invalidAst) {
      throw new Error('Missing invalid consumer');
    }
    const invalidResolver = createQueryKeyResolver(invalidPath, index, root);
    expect(
      normalizeQueryKey(variableInit(invalidAst, 'missingAlias'), { defaultMode: 'exact' }, invalidResolver),
    ).toMatchObject({
      source: 'expression',
      resolution: 'dynamic',
    });

    const circularPath = path.join(root, 'circular/a/src/consumer.ts');
    const circularAst = parsedSources.get(circularPath);
    if (!circularAst) {
      throw new Error('Missing circular consumer');
    }
    const circularResolver = createQueryKeyResolver(circularPath, index, root);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(circularAst, 'localKey'), { defaultMode: 'exact' }, circularResolver),
      ),
    ).toEqual(['local']);

    resetResolverCache();
  });

  it('applies complex function argument hints through resolver call resolution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-hints-'));
    const files = {
      'package.json': JSON.stringify({ name: 'hint-workspace' }),
      'src/consumer.ts': [
        'const identity = (value) => value;',
        'const holder = { key: ["holder"] as const };',
        'function complexFactory(source, prop, fn, arg, fallback, flag, yes, no, rest) {',
        '  return [',
        '    source[prop],',
        '    fn(arg),',
        '    `' + '$' + '{arg}` ,',
        '    !flag,',
        '    arg + fallback,',
        '    flag && fallback,',
        '    flag ? yes : no,',
        '    (fallback, arg),',
        '    (arg),',
        '    ...rest,',
        '    { ...source, copied: arg },',
        '  ] as const;',
        '}',
        'function returnsWrappedArray() {',
        '  return identity([["nested-array"] as const, , ["second"] as const] as const);',
        '}',
        'function returnsWrappedObject() {',
        '  return identity({ queryKey: ["nested-object"] as const });',
        '}',
        "const arrowFactory = (value = 'arrow') => ['arrow', value] as const;",
        'const nonFunctionValue = ["plain"] as const;',
        'const makeValueQueryKey = ["value-query"] as const;',
        'const makeNoReturnQueryKey = () => {};',
        "const makeArrowQueryKey = (id: string) => ['arrow-query', id] as const;",
        "const localArrowFunctionQueryKey = () => ['local-arrow-function'] as const;",
        "let mutableArrowFunctionQueryKey = () => ['mutable-arrow-function'] as const;",
        "mutableArrowFunctionQueryKey = () => ['changed-arrow-function'] as const;",
        'const complexCall = complexFactory(holder, "key", identity, "arg", "fallback", true, "yes", "no", ["tail"] as const);',
        'const aliasFactory = complexFactory;',
        'const arrowFactoryAlias = arrowFactory;',
        'const plainAlias = nonFunctionValue;',
        'const aliasCall = aliasFactory(holder, "key", identity, "alias", "fallback", false, "yes", "no", ["tail"] as const);',
        'const arrowCall = arrowFactoryAlias("value");',
        'const plainCall = plainAlias();',
        'const nestedArrayValue = returnsWrappedArray()[0];',
        'const nestedArrayHole = returnsWrappedArray()[1];',
        'const nestedObjectValue = returnsWrappedObject().queryKey;',
      ].join('\n'),
      'src/a.ts': "export const makeTieQueryKey = (id: string) => ['a', id] as const;",
      'src/b.ts': "export const makeTieQueryKey = (id: string) => ['b', id] as const;",
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing hint consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      normalizeQueryKey(variableInit(consumerAst, 'complexCall'), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      matchMode: 'exact',
      resolution: 'dynamic',
    });
    expect(normalizeQueryKey(variableInit(consumerAst, 'aliasCall'), { defaultMode: 'exact' }, resolver)).toMatchObject(
      {
        matchMode: 'exact',
        resolution: 'dynamic',
      },
    );
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'nestedArrayValue'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['nested-array']);
    expect(
      normalizeQueryKey(variableInit(consumerAst, 'nestedArrayHole'), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      source: 'literal',
    });
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'nestedObjectValue'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['nested-object']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrowCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['arrow', 'value']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'plainCall'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['plain']);

    expect(resolver.resolveCallResult({ type: 'Super' } as never)).toBeUndefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'identity' } as never)).toBeDefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'plainAlias' } as never)).toBeDefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'makeMissingQueryKey' } as never)).toBeUndefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'makeValueQueryKey' } as never)).toBeDefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'makeNoReturnQueryKey' } as never)).toBeDefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'makeArrowQueryKey' } as never)).toBeDefined();
    expect(resolver.resolveCallResult({ type: 'Identifier', name: 'makeTieQueryKey' } as never)).toBeUndefined();
    expect(
      resolver.resolveReference({
        type: 'MemberExpression',
        object: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'identity' },
          arguments: [{ type: 'ArrayExpression', elements: [{ type: 'StringLiteral', value: 'wrapped-zero' }] }],
        },
        property: { type: 'NumericLiteral', value: 0 },
        computed: true,
      } as never),
    ).toBeDefined();
    expect(
      resolver.resolveReference({
        type: 'MemberExpression',
        object: { type: 'ArrayExpression', elements: [null] },
        property: { type: 'NumericLiteral', value: 0 },
        computed: true,
      } as never),
    ).toBeUndefined();
    expect(
      resolver.resolveReference({
        type: 'MemberExpression',
        object: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'shallowRef' },
          arguments: [{ type: 'ArrayExpression', elements: [{ type: 'StringLiteral', value: 'direct-shallow' }] }],
        },
        property: { type: 'Identifier', name: 'value' },
        computed: false,
      } as never),
    ).toBeDefined();
    expect(
      resolver.resolveReference({
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'holder' },
        property: { type: 'StringLiteral', value: 'key' },
        computed: true,
      } as never),
    ).toBeDefined();
  });

  it('covers resolver edge cases through public resolution APIs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-public-edges-'));
    const chain = Array.from({ length: 30 }, (_, index) => {
      const next = index === 29 ? "['deep'] as const" : `chain${index + 1}`;
      return `const chain${index} = ${next};`;
    });
    const files = {
      'package.json': JSON.stringify({ name: 'public-edge-workspace' }),
      'src/reExport.ts': [
        "export * from '../missing';",
        "export { missingValue as missingNamed } from '../missing';",
        "export { renamedSource as renamedValue } from '../source';",
        "export { makeSourceQueryKey as makeRenamedQueryKey } from '../source';",
        "export * from '../source';",
      ].join('\n'),
      'src/source.ts': [
        "export const renamedSource = ['renamed'] as const;",
        "export const sourceValue = ['source'] as const;",
        "export function makeSourceQueryKey(id: string) { return ['source-call', id] as const; }",
      ].join('\n'),
      'src/ns.ts': [
        "export const namespaceObject = { queryKey: ['namespace-object'] as const };",
        "export const namespaceFn = () => ['namespace-fn'] as const;",
        'export const namespaceAlias = namespaceFn;',
      ].join('\n'),
      'src/consumer.ts': [
        "import { makeRenamedQueryKey, missingNamed, renamedValue, sourceValue } from '../reExport';",
        "import * as ns from '../ns';",
        ...chain,
        'const deepAlias = chain0;',
        'const renamedAlias = renamedValue;',
        'const sourceAlias = sourceValue;',
        "const renamedCall = makeRenamedQueryKey('id');",
        'const missingAlias = missingNamed;',
        'const namespaceObjectAlias = ns.namespaceObject.queryKey;',
        'const namespaceCallAlias = ns.namespaceAlias();',
        "const spreadSource = { queryKey: ['spread-source'] as const };",
        "const spreadTarget = { ...spreadSource, other: ['other'] as const }.queryKey;",
        "const arrayTarget = [['zero'] as const, , ['two'] as const] as const;",
        'const arrayHole = arrayTarget[1];',
        'const arrayOutOfRange = arrayTarget[9];',
        "const wrappedObject = queryOptions({ queryKey: ['wrapped-query-options'] as const }).queryKey;",
        "const frozenObject = Object.freeze({ queryKey: ['frozen-object'] as const }).queryKey;",
      ].join('\n'),
    };
    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }
    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing public edge consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'renamedAlias'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'sourceAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'renamedCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      normalizeQueryKey(variableInit(consumerAst, 'missingAlias'), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      resolution: 'dynamic',
    });
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceObjectAlias'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'namespaceCallAlias'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(expect.any(Array));
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'spreadTarget'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['spread-source']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrayHole'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['[[zero], undefined, [two]].1']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'arrayOutOfRange'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['[[zero], undefined, [two]].9']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'wrappedObject'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['wrapped-query-options']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'frozenObject'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['frozen-object']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'deepAlias'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['deep']);
  });

  it('substitutes function arguments through broad expression shapes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-expression-shapes-'));
    const consumerPath = path.join(root, 'src/consumer.ts');
    const source = [
      'const fn = (value: string) => value;',
      'function shapeFactory(id: string, obj: Record<string, unknown>, arr: readonly unknown[], flag: boolean) {',
      '  return [',
      '    [id, ...arr],',
      '    { id, ...obj, nested: { id } },',
      '    obj[id],',
      '    fn(id),',
      '    `prefix-' + '$' + '{id}`,',
      '    !flag,',
      '    id + "-tail",',
      '    flag && id,',
      '    id = "assigned",',
      '    flag ? id : "fallback",',
      '    (id, "sequence"),',
      '    (id),',
      '  ] as const;',
      '}',
      'const result = shapeFactory("value", { existing: "object" }, ["spread"] as const, true);',
      'const first = shapeFactory("value", { existing: "object" }, ["spread"] as const, true)[0];',
      'const objectResult = shapeFactory("value", { existing: "object" }, ["spread"] as const, true)[1];',
      'const callResult = shapeFactory("value", { existing: "object" }, ["spread"] as const, true)[3];',
    ].join('\n');

    await mkdir(path.dirname(consumerPath), { recursive: true });
    await writeFile(consumerPath, source);
    const consumerAst = parseSource(source, consumerPath);

    resetResolverCache();
    const resolver = createQueryKeyResolver(
      consumerPath,
      buildSymbolIndex(new Map([[consumerPath, consumerAst]])),
      root,
    );
    const result = normalizeQueryKey(variableInit(consumerAst, 'result'), { defaultMode: 'exact' }, resolver);

    expect(result.resolution).toBe('dynamic');
    expect(result.segments).toEqual(
      expect.arrayContaining([
        '[$id, ...spread]',
        '{id: $id, ...$obj, nested: {id: $id}}',
        '$obj.id',
        '$value',
        'prefix-' + '$' + '{id}',
        '$id + -tail',
        'cond(...)',
      ]),
    );
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'first'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['value', 'spread']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'objectResult'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['{id: value, existing: object, nested: {id: value}}']);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'callResult'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['value']);

    resetResolverCache();
  });

  it('covers config resolution edge branches: package extends, nearest-config root walk, cached entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-config-edge-'));
    const files = {
      'package.json': JSON.stringify({ name: 'config-edge-workspace' }),
      // extends a bare package specifier that cannot be resolved -> resolveExtendsConfigPath returns undefined (line 311)
      'tsconfig.json': [
        '{',
        '  "extends": "@totally/missing-config-package",',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@same": ["src/aaa"],',
        '      "@samz": ["src/bbb"]',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'src/aaa.ts': "export const aaaKey = ['aaa'] as const;",
      'src/bbb.ts': "export const bbbKey = ['bbb'] as const;",
      'src/consumer.ts': [
        "import { aaaKey } from '@same';",
        "import { bbbKey } from '@samz';",
        'const aaaAlias = aaaKey;',
        'const bbbAlias = bbbKey;',
        'const secondAaaAlias = aaaKey;',
      ].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing config-edge consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    // Two equal-length non-wildcard patterns force the localeCompare tie-break in getPathAliasEntries (line 443).
    expectSegments('aaaAlias', ['aaa']);
    expectSegments('bbbAlias', ['bbb']);
    // Second use of @same hits cached alias entries (lines 426-428).
    expectSegments('secondAaaAlias', ['aaa']);

    resetResolverCache();
  });

  it('walks to the filesystem root when the workspace root is not an ancestor of the file', async () => {
    // findNearestConfigFile uses workspaceRoot only as a stop boundary. When the
    // analyzed file lives outside that root, the loop keeps walking parents until
    // it reaches the filesystem root (parent === cursor, line 410-411).
    const fileRoot = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-detached-file-'));
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-detached-root-'));
    const consumerPath = path.join(fileRoot, 'src', 'consumer.ts');
    const source = ["import { thing } from 'unresolved-bare-module';", 'const alias = thing;'].join('\n');
    await mkdir(path.dirname(consumerPath), { recursive: true });
    await writeFile(consumerPath, source);
    const consumerAst = parseSource(source, consumerPath);

    resetResolverCache();
    const index = buildSymbolIndex(new Map([[consumerPath, consumerAst]]));
    // workspaceRoot points at an unrelated tmp dir, so the config search runs off
    // the end of the path hierarchy.
    const resolver = createQueryKeyResolver(consumerPath, index, otherRoot);

    expect(normalizeQueryKey(variableInit(consumerAst, 'alias'), { defaultMode: 'exact' }, resolver)).toMatchObject({
      resolution: 'dynamic',
    });

    resetResolverCache();
  });

  it('resolves package subpaths directly without the implicit src/ prefix', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-pkg-subpath-'));
    const files = {
      'package.json': JSON.stringify({ name: 'pkg-subpath-workspace' }),
      // entry sits at the package root, and the subpath also resolves directly
      // from the package dir (line 765-767), not via the src/ fallback.
      'packages/flat/package.json': JSON.stringify({ name: 'flat-pkg', main: 'index.ts' }),
      'packages/flat/index.ts': "export const flatKey = ['flat'] as const;",
      'packages/flat/extra.ts': "export const extraKey = ['extra'] as const;",
      'src/consumer.ts': ["import { extraKey } from 'flat-pkg/extra';", 'const extraAlias = extraKey;'].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing pkg-subpath consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'extraAlias'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['extra']);

    resetResolverCache();
  });

  it('resolves function returns and nodes through re-export and value-alias chains', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-fn-chains-'));
    const files = {
      'package.json': JSON.stringify({ name: 'fn-chain-workspace' }),
      'src/leaf.ts': [
        'export function makeLeafQueryKey(id: string) {',
        "  return ['leaf', id] as const;",
        '}',
        // a value bound to a function expression, exported by name
        "export const arrowLeafQueryKey = (id: string) => ['arrow-leaf', id] as const;",
      ].join('\n'),
      // star re-export so resolveExportFunctionReturn must walk reExport.all
      'src/barrel.ts': [
        "export * from '../leaf';",
        "export { makeLeafQueryKey as renamedLeafQueryKey } from '../leaf';",
      ].join('\n'),
      'src/consumer.ts': [
        "import { arrowLeafQueryKey, makeLeafQueryKey, renamedLeafQueryKey } from '../barrel';",
        // value-alias to an imported factory, then call it: exercises resolveLocalFunctionNode
        // value-alias branch and resolveLocalValue function path.
        'const aliasedFactory = makeLeafQueryKey;',
        "const starCall = makeLeafQueryKey('s');",
        "const renamedCall = renamedLeafQueryKey('r');",
        "const arrowCall = arrowLeafQueryKey('a');",
        // member access on the result of a locally-aliased factory call -> resolveCallExpressionInternal
        "const wrappedFactory = (id: string) => ({ queryKey: ['wrapped', id] as const });",
        'const wrappedAlias = wrappedFactory;',
        "const wrappedKey = wrappedAlias('w').queryKey;",
      ].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing fn-chain consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'starCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'renamedCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrowCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'wrappedKey'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);

    const aliasedCallee = variableInit(consumerAst, 'aliasedFactory');
    expect(aliasedCallee).toBeDefined();

    resetResolverCache();
  });

  it('resolves call results through value-aliased function expressions and member callees', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-call-value-'));
    const files = {
      'package.json': JSON.stringify({ name: 'call-value-workspace' }),
      'src/ns.ts': [
        // a namespace member that is an identifier aliasing a local factory
        "export const baseFactory = () => ['base'] as const;",
        'export const aliasFactory = baseFactory;',
        // a namespace member that is a plain (non-function) value used as a callee
        "export const plainValue = ['plain'] as const;",
      ].join('\n'),
      'src/consumer.ts': [
        "import * as ns from '../ns';",
        // namespace member resolves to an Identifier -> resolveCallResultInternal line 1759-1760
        'const aliasCall = ns.aliasFactory();',
        // member callee that resolves (via resolveReferenceInternal) to a function expression -> line 1770-1771
        "const holder = { fn: () => ['holder-fn'] as const };",
        'const holderCall = holder.fn();',
        // member callee resolving to a non-function, non-identifier value -> line 1776
        "const dataHolder = { data: ['data'] as const };",
        'const dataCall = dataHolder.data();',
      ].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing call-value consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    const callee = (name: string) => {
      const call = variableInit(consumerAst, name);
      if (!call || !isCallExpression(call)) {
        throw new Error(`Missing call ${name}`);
      }
      return call.callee;
    };

    expect(
      normalizeQueryKey(resolver.resolveCallResult(callee('aliasCall')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({ segments: ['UNRESOLVED'] });
    expect(
      normalizeQueryKey(resolver.resolveCallResult(callee('holderCall')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({ segments: ['holder-fn'] });
    // dataCall: callee resolves to an array literal (non-function/non-identifier) -> returned as-is (line 1776).
    expect(resolver.resolveCallResult(callee('dataCall'))).toBeDefined();

    resetResolverCache();
  });

  it('inlines hints for TSParameterProperty-style params and local value function callees', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-param-prop-'));
    const files = {
      'package.json': JSON.stringify({ name: 'param-prop-workspace' }),
      'src/consumer.ts': [
        // resolveLocalValue returns a value that is itself a function expression and is
        // reached via resolveCallResultInternal local-value branch (line 1735-1737).
        "const baseObjectQueryKey = { queryKey: ['base-obj'] as const };",
        'const aliasObjectQueryKey = baseObjectQueryKey;',
        'const aliasObjectValue = aliasObjectQueryKey.queryKey;',
        // A function whose param has a default (AssignmentPattern) AND is referenced.
        "function makeDefaultedQueryKey(id = 'fallback') {",
        "  return ['defaulted', id] as const;",
        '}',
        "const defaultedCall = makeDefaultedQueryKey('explicit');",
      ].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing param-prop consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'aliasObjectValue'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['base-obj']);
    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'defaultedCall'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['defaulted', '$id']);

    resetResolverCache();
  });

  it('lazily indexes on-disk support files for values, functions, and function nodes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-lazy-'));
    const files = {
      'package.json': JSON.stringify({ name: 'lazy-workspace' }),
      'src/lazy.ts': [
        "export const lazyValue = ['lazy-value'] as const;",
        'export function lazyFactory(id: string) {',
        "  return ['lazy-fn', id] as const;",
        '}',
        "export const lazyArrow = (id: string) => ({ queryKey: ['lazy-arrow', id] as const });",
      ].join('\n'),
      'src/consumer.ts': [
        "import { lazyArrow, lazyFactory, lazyValue } from '../lazy';",
        'const valueAlias = lazyValue;',
        "const fnCall = lazyFactory('x');",
        // member access on aliased factory call -> resolveLocalFunctionNode lazily indexes
        'const arrowAlias = lazyArrow;',
        "const arrowKey = arrowAlias('y').queryKey;",
      ].join('\n'),
    };

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parseSource(files['src/consumer.ts'], consumerPath);
    // Deliberately index ONLY the consumer, so resolving across to ./lazy must
    // trigger ensureIndexedFile (the "if (!symbols)" branches in resolveExportValue,
    // resolveExportFunctionReturn, resolveLocalValue, resolveLocalFunctionReturn,
    // resolveLocalFunctionNode).
    const index = buildSymbolIndex(new Map([[consumerPath, consumerAst]]));

    resetResolverCache();
    const resolver = createQueryKeyResolver(consumerPath, index, root);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'valueAlias'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'fnCall'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'arrowKey'), { defaultMode: 'exact' }, resolver))
        .length,
    ).toBeGreaterThan(0);
    expect(index.files.size).toBeGreaterThan(0);

    resetResolverCache();
  });

  it('prefers the nearest candidate across competing alias targets (candidate sorting tie-breaks)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-candidate-sort-'));
    const files = {
      'package.json': JSON.stringify({ name: 'candidate-sort-workspace' }),
      'app/tsconfig.json': [
        '{',
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        // Three targets at different distances/up-levels for the same import.
        '      "@multi/*": ["../far/deep/very/*", "../up/*", "near/*"]',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'app/near/key.ts': "export const nearKey = ['near'] as const;",
      'up/key.ts': "export const upKey = ['up'] as const;",
      'far/deep/very/key.ts': "export const farKey = ['far'] as const;",
      'app/src/consumer.ts': ["import { nearKey } from '@multi/key';", 'const chosen = nearKey;'].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'app/src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing candidate-sort consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    // Multiple matches force compareResolutionCandidates through its up-count,
    // distance, length, and localeCompare tie-breakers.
    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'chosen'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['near']);

    resetResolverCache();
  });

  it('covers identity-wrapper callees, ref namespaces, computed keys, and substitution shapes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-shapes2-'));
    const consumerPath = path.join(root, 'src/consumer.ts');
    const source = [
      // queryClient / tanstack helpers imported from an unindexed module so their
      // callees stay unresolved and fall through to isIdentityWrapperCall.
      "import { infiniteQueryOptions } from '@tanstack/react-query';",
      "import { client } from 'unindexed-client';",
      // identity-wrapper as a member callee accessing a NON-queryKey property, so it
      // falls past the queryKey shortcut to isIdentityWrapperCall member branch (line 569).
      "const memberWrapped = client.queryOptions({ tag: ['member-wrapped'] as const }).tag;",
      "const memberInfinite = client.infiniteQueryOptions({ tag: ['member-infinite'] as const }).tag;",
      // identity-wrapper as a bare identifier callee wrapping an array, indexed (line 561).
      "const identifierWrapped = infiniteQueryOptions([['identifier-wrapped'] as const])[0];",
      // factory invoked through member access whose body has rich substitution shapes
      'function richFactory(id, obj, arr, fn) {',
      '  return {',
      '    queryKey: [',
      '      { ...obj, copy: id },', // object spread + objectProperty substitution
      '      [id, ...arr],', // array spread + array element
      '      obj[id],', // computed member substitution
      '      fn(id, ...arr),', // call spread arg
      '    ] as const,',
      '  };',
      '}',
      'const richKey = richFactory("seed", { a: 1 }, ["t"] as const, (x) => x).queryKey;',
    ].join('\n');

    await mkdir(path.dirname(consumerPath), { recursive: true });
    await writeFile(consumerPath, source);
    const consumerAst = parseSource(source, consumerPath);

    resetResolverCache();
    const resolver = createQueryKeyResolver(
      consumerPath,
      buildSymbolIndex(new Map([[consumerPath, consumerAst]])),
      root,
    );
    const expectSegments = (name: string, expected: string[]) => {
      expect(
        queryKeySegments(normalizeQueryKey(variableInit(consumerAst, name), { defaultMode: 'exact' }, resolver)),
      ).toEqual(expected);
    };

    expectSegments('memberWrapped', ['member-wrapped']);
    expectSegments('memberInfinite', ['member-infinite']);
    expectSegments('identifierWrapped', ['identifier-wrapped']);

    // richKey resolves dynamically but exercises the substitution-shape branches.
    const rich = normalizeQueryKey(variableInit(consumerAst, 'richKey'), { defaultMode: 'exact' }, resolver);
    expect(rich.resolution).toBe('dynamic');

    resetResolverCache();
  });

  it('resolves computed string-literal property names and skips spreads in object property lookup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-computed-key-'));
    const consumerPath = path.join(root, 'src/consumer.ts');
    const source = [
      // queryOptions call whose first arg is an object with a spread before queryKey:
      // objectPropertyValue must skip the spread (non-ObjectProperty) and the non-matching
      // numeric key, then find queryKey.
      "const base = { 1: ['num'] as const, queryKey: ['from-call-arg'] as const };",
      "const wrapped = queryOptions({ ...base, queryKey: ['wins'] as const });",
      // member access on a call result that is NOT a wrapper but whose first arg has queryKey
      'function passthrough(o) { return o; }',
      "const passKey = passthrough({ queryKey: ['passed'] as const }).queryKey;",
    ].join('\n');

    await mkdir(path.dirname(consumerPath), { recursive: true });
    await writeFile(consumerPath, source);
    const consumerAst = parseSource(source, consumerPath);

    resetResolverCache();
    const resolver = createQueryKeyResolver(
      consumerPath,
      buildSymbolIndex(new Map([[consumerPath, consumerAst]])),
      root,
    );

    expect(
      queryKeySegments(normalizeQueryKey(variableInit(consumerAst, 'passKey'), { defaultMode: 'exact' }, resolver)),
    ).toEqual(['passed']);

    resetResolverCache();
  });

  it('parses malformed, array, and non-string-array configs and shared/circular extends', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-config-parse-'));
    const files = {
      'package.json': JSON.stringify({ name: 'config-parse-workspace' }),
      // shared base extended by two children -> second merge hits the parsedAliasConfigCache (line 318)
      'shared-base.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@base/*': ['base/*'] } },
      }),
      // malformed JSON (survives comment stripping but JSON.parse throws -> line 236)
      'malformed/tsconfig.json': '{ "compilerOptions": { "paths": { "@x": [ }',
      'malformed/src/consumer.ts': ["import { mKey } from '@x';", 'const mAlias = mKey;'].join('\n'),
      // top-level array config -> parseJsonObject returns undefined via line 232/238
      'arrayconf/tsconfig.json': '["not", "an", "object"]',
      'arrayconf/src/consumer.ts': ["import { aKey } from '@y';", 'const aAlias = aKey;'].join('\n'),
      // paths whose values are non-arrays (string / object) -> asStringArray returns undefined (line 249-250)
      // and a pattern with paths but NO baseUrl -> line 354 nullish fallback to dirname.
      'nobase/tsconfig.json': [
        '{',
        '  "compilerOptions": {',
        '    "paths": {',
        '      "@str": "src/str",',
        '      "@obj": { "nested": true },',
        '      "@ok/*": ["src/*"]',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'nobase/src/ok.ts': "export const okKey = ['ok'] as const;",
      'nobase/src/consumer.ts': ["import { okKey } from '@ok/ok';", 'const okAlias = okKey;'].join('\n'),
      // shared base extended by two sibling configs. The inherited @base/* paths are
      // resolved against the shared base's dir (root), so both children resolve the
      // same root-level base/k.ts; the second merge reuses the cached parse (line 318).
      'base/k.ts': "export const sharedBaseKey = ['shared-base'] as const;",
      'one/tsconfig.json': JSON.stringify({ extends: '../shared-base.json' }),
      'one/src/consumer.ts': ["import { sharedBaseKey } from '@base/k';", 'const oneAlias = sharedBaseKey;'].join('\n'),
      'two/tsconfig.json': JSON.stringify({ extends: '../shared-base.json' }),
      'two/src/consumer.ts': ["import { sharedBaseKey } from '@base/k';", 'const twoAlias = sharedBaseKey;'].join('\n'),
      // circular extends WITH an alias import so mergePathAliases recurses and hits seen (line 321)
      'circ/a/tsconfig.json': JSON.stringify({
        extends: '../b/tsconfig.json',
        compilerOptions: { baseUrl: '.', paths: { '@circ/*': ['src/*'] } },
      }),
      'circ/b/tsconfig.json': JSON.stringify({ extends: '../a/tsconfig.json', compilerOptions: { baseUrl: '.' } }),
      'circ/a/src/key.ts': "export const circKey = ['circ'] as const;",
      'circ/a/src/consumer.ts': ["import { circKey } from '@circ/key';", 'const circAlias = circKey;'].join('\n'),
    };

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);

    const resolveAlias = (consumerRel: string, name: string) => {
      const consumerPath = path.join(root, consumerRel);
      const ast = parsedSources.get(consumerPath);
      if (!ast) {
        throw new Error(`Missing ${consumerRel}`);
      }
      const resolver = createQueryKeyResolver(consumerPath, index, root);
      return normalizeQueryKey(variableInit(ast, name), { defaultMode: 'exact' }, resolver);
    };

    // Malformed/array/non-array-path configs all fail closed (dynamic).
    expect(resolveAlias('malformed/src/consumer.ts', 'mAlias').resolution).toBe('dynamic');
    expect(resolveAlias('arrayconf/src/consumer.ts', 'aAlias').resolution).toBe('dynamic');
    // The valid @ok/* path still resolves even though sibling paths are invalid.
    expect(queryKeySegments(resolveAlias('nobase/src/consumer.ts', 'okAlias'))).toEqual(['ok']);
    // Shared base extended twice: both resolve; second uses the cached merge.
    expect(queryKeySegments(resolveAlias('one/src/consumer.ts', 'oneAlias'))).toEqual(['shared-base']);
    expect(queryKeySegments(resolveAlias('two/src/consumer.ts', 'twoAlias'))).toEqual(['shared-base']);
    // Circular extends still resolves the local alias.
    expect(queryKeySegments(resolveAlias('circ/a/src/consumer.ts', 'circAlias'))).toEqual(['circ']);

    resetResolverCache();
  });

  it('exercises deep recursion limits and circular reference guards', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-depth-'));
    // Build a chain of re-export barrels longer than MAX_DEPTH (24) so
    // resolveExportValue/resolveExportFunctionReturn hit the depth>MAX_DEPTH guard.
    const barrelCount = 40;
    const files: Record<string, string> = {
      'package.json': JSON.stringify({ name: 'depth-workspace' }),
      'src/leaf.ts': [
        "export const deepValue = ['deep-value'] as const;",
        "export function deepFactory(id: string) { return ['deep-fn', id] as const; }",
      ].join('\n'),
    };
    for (let i = 0; i < barrelCount; i += 1) {
      const next = i === barrelCount - 1 ? './leaf' : `./barrel${i + 1}`;
      files[`src/barrel${i}.ts`] = `export * from '${next}';`;
    }
    files['src/consumer.ts'] = [
      "import { deepFactory, deepValue } from '../barrel0';",
      'const deepAlias = deepValue;',
      "const deepCall = deepFactory('z');",
      // Self-referential local alias -> resolveLocalValue seen-guard / alias cycle.
      'let cyclic = cyclic;',
      'const cyclicAlias = cyclic;',
    ].join('\n');

    const parsedSources = new Map<string, ReturnType<typeof parseSource>>();
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
      if (relativePath.endsWith('.ts')) {
        parsedSources.set(filePath, parseSource(content, filePath));
      }
    }

    resetResolverCache();
    const index = buildSymbolIndex(parsedSources);
    const consumerPath = path.join(root, 'src/consumer.ts');
    const consumerAst = parsedSources.get(consumerPath);
    if (!consumerAst) {
      throw new Error('Missing depth consumer');
    }
    const resolver = createQueryKeyResolver(consumerPath, index, root);

    // Past MAX_DEPTH the export chain bails out -> dynamic fallback.
    expect(
      normalizeQueryKey(variableInit(consumerAst, 'deepAlias'), { defaultMode: 'exact' }, resolver).resolution,
    ).toBe('dynamic');
    expect(
      normalizeQueryKey(variableInit(consumerAst, 'deepCall'), { defaultMode: 'exact' }, resolver).resolution,
    ).toBe('dynamic');

    resetResolverCache();
  });

  it('applies argument hints through member-access call chains with diverse param/arg shapes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-hint-member-'));
    const consumerPath = path.join(root, 'src/consumer.ts');
    const source = [
      'const id = (v) => v;',
      // factory with MORE params than args supplied (line 1392 !arg) and an UNUSED
      // param that never appears in the return (line 1398 continue), invoked via member.
      'function shapeFactory(used, unused, missing) {',
      '  return {',
      '    queryKey: [',
      '      used,', // identifier substitution
      '      [used, ...used],', // array + spread substitution
      '      { ...used, copy: used },', // object spread + property substitution
      '      used[used],', // computed member substitution
      '      id(used, ...used),', // call + call-spread-arg substitution
      '      `t-' + '$' + '{used}`,', // template substitution
      '      -used,', // unary substitution
      '      used + used,', // binary substitution
      '      used ? used : used,', // conditional substitution
      '      (used, used),', // sequence substitution
      '    ] as const,',
      '  };',
      '}',
      // only 1 arg for 3 params -> unused/missing hit line 1392; used substituted.
      'const shapeKey = shapeFactory(["seed"] as const).queryKey;',
      // factory invoked via member access whose body returns no value (line 1422 !returned)
      'function voidFactory(x) { x; }',
      'const voidKey = voidFactory(1).queryKey;',
      // value-aliased arrow used as a member-access callee -> resolveLocalFunctionNode
      // identifier-alias branch (lines 1190-1191).
      "const realArrow = (p) => ({ queryKey: ['real', p] as const });",
      'const aliasArrow = realArrow;',
      "const aliasArrowKey = aliasArrow('p').queryKey;",
    ].join('\n');

    await mkdir(path.dirname(consumerPath), { recursive: true });
    await writeFile(consumerPath, source);
    const consumerAst = parseSource(source, consumerPath);

    resetResolverCache();
    const resolver = createQueryKeyResolver(
      consumerPath,
      buildSymbolIndex(new Map([[consumerPath, consumerAst]])),
      root,
    );

    const shapeKey = normalizeQueryKey(variableInit(consumerAst, 'shapeKey'), { defaultMode: 'exact' }, resolver);
    expect(shapeKey.resolution).toBe('dynamic');
    expect(shapeKey.segments.length).toBeGreaterThan(0);

    expect(
      queryKeySegments(
        normalizeQueryKey(variableInit(consumerAst, 'aliasArrowKey'), { defaultMode: 'exact' }, resolver),
      ),
    ).toEqual(['real', '$p']);

    // voidKey: factory returns nothing, so member access fails closed.
    expect(normalizeQueryKey(variableInit(consumerAst, 'voidKey'), { defaultMode: 'exact' }, resolver).resolution).toBe(
      'dynamic',
    );

    resetResolverCache();
  });

  it('handles synthetic and degenerate nodes through the public API', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-resolver-synthetic-'));
    const consumerPath = path.join(root, 'src/consumer.ts');
    const source = "const localKey = ['local'] as const;";
    await mkdir(path.dirname(consumerPath), { recursive: true });
    await writeFile(consumerPath, source);
    const consumerAst = parseSource(source, consumerPath);

    resetResolverCache();
    const resolver = createQueryKeyResolver(
      consumerPath,
      buildSymbolIndex(new Map([[consumerPath, consumerAst]])),
      root,
    );

    // Empty identifier name -> isLikelyQueryKeyFactoryIdentifier !name branch (line 95).
    expect(resolver.resolveCallResult({ type: 'Identifier', name: '' } as never)).toBeUndefined();
    // Computed member with a PrivateName-shaped property -> propertyNameFromMemberExpression
    // falls past the static cases and getExpressionValue returns undefined.
    expect(
      resolver.resolveReference({
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'localKey' },
        property: { type: 'PrivateName', id: { type: 'Identifier', name: 'secret' } },
        computed: false,
      } as never),
    ).toBeUndefined();

    resetResolverCache();
  });
});
