import { describe, expect, it, vi } from 'vitest';

import type {
  ArrayExpression,
  ArrowFunctionExpression,
  BinaryExpression,
  BooleanLiteral,
  CallExpression,
  Expression,
  IdentifierReference,
  MemberExpression,
  NumericLiteral,
  ObjectExpression,
  ObjectProperty,
  PrivateName,
  SpreadElement,
  StringLiteral,
  TemplateLiteral,
} from '../ast';
import type { QueryKeyResolver, SegmentResult } from '../types';
import { isExpression, isIdentifier, isVariableDeclaration } from '../ast';
import {
  __queryKeyTestInternals,
  buildPassThroughActionKey,
  findObjectPropertyValue,
  inferActionQueryKey,
  inferHookQueryKey,
  inferHookQueryKeys,
  isHookCallDirectQueryKeyDeclaration,
  isOpaqueCollectionQueryKey,
  locationFromNode,
  normalizeQueryKey,
  readBooleanProperty,
  resolveQueryKeyExpression,
  segmentFromExpression,
} from '../queryKey';
import { parseSource } from '../sourceParser';

function identifier(name: string): IdentifierReference {
  return { type: 'Identifier', name };
}

function stringLiteral(value: string): StringLiteral {
  return { type: 'StringLiteral', value };
}

function numericLiteral(value: number): NumericLiteral {
  return { type: 'NumericLiteral', value };
}

function booleanLiteral(value: boolean): BooleanLiteral {
  return { type: 'BooleanLiteral', value };
}

function nonExpression(type = 'NotExpression'): Expression {
  return { type } as Expression;
}

function arrayExpression(elements: Array<Expression | SpreadElement | null>): ArrayExpression {
  return { type: 'ArrayExpression', elements };
}

function objectProperty(key: Expression | PrivateName, value: Expression, computed = false): ObjectProperty {
  return {
    type: 'Property',
    kind: 'init',
    key,
    value,
    method: false,
    shorthand: false,
    computed,
    optional: false,
  };
}

function objectExpression(properties: Array<ObjectProperty | SpreadElement>): ObjectExpression {
  return { type: 'ObjectExpression', properties };
}

function spreadElement(argument: Expression): SpreadElement {
  return { type: 'SpreadElement', argument };
}

function memberExpression(object: Expression, property: Expression | PrivateName, computed = false): MemberExpression {
  return { type: 'MemberExpression', object, property, computed };
}

function callExpression(callee: Expression, args: Array<Expression | SpreadElement> = []): CallExpression {
  return { type: 'CallExpression', callee, arguments: args };
}

function arrowFunction(body: Expression): ArrowFunctionExpression {
  return {
    type: 'ArrowFunctionExpression',
    params: [{ type: 'Identifier', name: 'entry' }],
    body,
    generator: false,
    async: false,
    expression: true,
  };
}

function templateLiteral(text: string): TemplateLiteral {
  return {
    type: 'TemplateLiteral',
    quasis: [
      {
        type: 'TemplateElement',
        value: { raw: text, cooked: text },
        tail: true,
      },
    ],
    expressions: [],
  };
}

function expressionFromSource(source: string, name: string): Expression {
  const ast = parseSource(source, '/virtual/queryKey.spec.ts');
  const statement = ast.program.body.find((entry): entry is (typeof ast.program.body)[number] => {
    const declarator = isVariableDeclaration(entry) ? entry.declarations[0] : undefined;
    return isVariableDeclaration(entry) && !!declarator && isIdentifier(declarator.id) && declarator.id.name === name;
  });
  if (!statement || !isVariableDeclaration(statement)) {
    throw new Error(`Missing declaration for ${name}`);
  }

  const init = statement.declarations[0]?.init;
  if (!init || !isExpression(init)) {
    throw new Error(`Missing initializer for ${name}`);
  }

  return init;
}

describe('core/analysis/queryKey', () => {
  it('covers resolver edge cases for spreads, hints, and fallback literals', () => {
    const spreadObject = objectExpression([objectProperty(identifier('b'), stringLiteral('two'))]);
    const queryObject = objectExpression([
      objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('from-spread')])),
    ]);
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'spreadObject') {
          return spreadObject;
        }
        if (node.type === 'Identifier' && node.name === 'queryObject') {
          return queryObject;
        }
        if (node.type === 'MemberExpression') {
          return arrayExpression([stringLiteral('member-reference')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([identifier('first'), identifier('second')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'queryKeys') {
          return identifier('queryKeys');
        }
        if (callee.type === 'Identifier' && callee.name === 'objectFactory') {
          return objectExpression([objectProperty(identifier('queryKey'), identifier('queryKey'))]);
        }
        return undefined;
      }),
    };
    expect(
      segmentFromExpression(
        objectExpression([
          spreadElement(identifier('spreadObject')),
          objectProperty(identifier('a'), identifier('undefined')),
        ]),
        resolver,
      ).text,
    ).toBe('{b: two, a: undefined}');
    expect(segmentFromExpression(objectExpression([spreadElement(stringLiteral('x'))]), resolver).text).toBe('{...x}');
    expect(segmentFromExpression({ type: 'NullLiteral' } as Expression)).toEqual({ text: 'null', isStatic: true });
    expect(segmentFromExpression(templateLiteral(''))).toEqual({ text: '', isStatic: true });
    expect(
      resolveQueryKeyExpression(
        callExpression(identifier('createQueryKey'), [stringLiteral('a'), stringLiteral('b')]),
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('a'), stringLiteral('b')]));
    expect(
      resolveQueryKeyExpression(
        callExpression(identifier('queryKeys'), [arrayExpression([stringLiteral('q')])]),
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('q')]));
    expect(
      resolveQueryKeyExpression(
        callExpression(identifier('objectFactory'), [
          objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('hinted')]))]),
        ]),
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('hinted')]));
    expect(
      findObjectPropertyValue(objectExpression([spreadElement(identifier('queryObject'))]), 'queryKey', resolver),
    ).toEqual(arrayExpression([stringLiteral('from-spread')]));
    expect(
      findObjectPropertyValue(objectExpression([spreadElement(stringLiteral('x'))]), 'queryKey', resolver),
    ).toBeUndefined();
    expect(readBooleanProperty(objectExpression([spreadElement(identifier('spreadObject'))]), 'exact')).toBeUndefined();
    expect(
      readBooleanProperty(objectExpression([objectProperty(stringLiteral('exact'), booleanLiteral(false))]), 'exact'),
    ).toBe(false);
    expect(
      readBooleanProperty(objectExpression([objectProperty(numericLiteral(1), booleanLiteral(true))]), 'exact'),
    ).toBeUndefined();
    expect(
      inferHookQueryKey([
        objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('from-hook')]))]),
      ]),
    ).toMatchObject({
      segments: ['from-hook'],
      resolution: 'static',
    });
  });

  it('resolves and normalizes query key expressions', () => {
    const arrayKey = arrayExpression([stringLiteral('todos'), numericLiteral(1)]);
    const resolvedCallResult = arrayExpression([stringLiteral('call-result')]);
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'keyRef') {
          return arrayKey;
        }
        if (
          node.type === 'MemberExpression' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'keyRef'
        ) {
          return arrayKey;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'factory') {
          return resolvedCallResult;
        }
        return undefined;
      }),
    };

    const locatedIdentifier: IdentifierReference = {
      type: 'Identifier',
      name: 'x',
      loc: { start: { line: 3, column: 7 }, end: { line: 3, column: 8 } },
    };
    const unlocatedIdentifier: IdentifierReference = { type: 'Identifier', name: 'x' };

    expect(locationFromNode(locatedIdentifier)).toEqual({
      line: 3,
      column: 8,
    });
    expect(locationFromNode(unlocatedIdentifier)).toEqual({ line: 1, column: 1 });

    expect(
      readBooleanProperty(objectExpression([objectProperty(identifier('exact'), booleanLiteral(true))]), 'exact'),
    ).toBe(true);
    expect(
      readBooleanProperty(objectExpression([objectProperty(stringLiteral('exact'), booleanLiteral(false))]), 'exact'),
    ).toBe(false);
    expect(
      readBooleanProperty(objectExpression([objectProperty(identifier('other'), stringLiteral('nope'))]), 'exact'),
    ).toBeUndefined();

    expect(
      findObjectPropertyValue(
        objectExpression([
          spreadElement(objectExpression([objectProperty(identifier('exact'), booleanLiteral(false))])),
          objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('todos')])),
        ]),
        'queryKey',
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('todos')]));

    expect(segmentFromExpression(identifier('undefined'))).toEqual({
      text: 'undefined',
      isStatic: true,
    });
    expect(segmentFromExpression({ type: 'PrivateName', id: identifier('secret') })).toEqual({
      text: '#secret',
      isStatic: false,
    });
    expect(segmentFromExpression(spreadElement(stringLiteral('todos')))).toEqual({
      text: '...spread',
      isStatic: false,
    });
    expect(segmentFromExpression(callExpression(identifier('ref'), [stringLiteral('live')]))).toEqual({
      text: 'live',
      isStatic: true,
    });

    expect(resolveQueryKeyExpression(identifier('keyRef'), resolver)).toBe(arrayKey);
    expect(
      resolveQueryKeyExpression(
        callExpression(memberExpression(identifier('Object'), identifier('freeze')), [arrayKey]),
        resolver,
      ),
    ).toBe(arrayKey);
    expect(resolveQueryKeyExpression(callExpression(identifier('factory')), resolver)).toBe(resolvedCallResult);

    expect(normalizeQueryKey(arrayKey, { defaultMode: 'prefix' }, resolver)).toEqual({
      id: 'todos|1',
      display: '[todos, 1]',
      segments: ['todos', '1'],
      matchMode: 'prefix',
      resolution: 'static',
      source: 'literal',
    });
    expect(normalizeQueryKey(undefined, { wildcardIfMissing: true }, resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(normalizeQueryKey(callExpression(identifier('factory')), { defaultMode: 'exact' }, resolver)).toEqual({
      id: 'call-result',
      display: '[call-result]',
      segments: ['call-result'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });

    expect(
      isOpaqueCollectionQueryKey({
        id: 'x',
        display: 'x',
        segments: ['UNRESOLVED'],
        matchMode: 'all',
        resolution: 'dynamic',
        source: 'expression',
      }),
    ).toBe(true);
    expect(isOpaqueCollectionQueryKey(normalizeQueryKey(arrayKey, { defaultMode: 'exact' }, resolver))).toBe(false);
  });

  it('infers hook query keys and direct declarations', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'memoized') {
          return arrayExpression([stringLiteral('memo')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    const hookObject = objectExpression([
      objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('todos')])),
    ]);
    const queryCollection = arrayExpression([
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('todos')]))]),
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('users')]))]),
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('todos')]))]),
    ]);

    expect(inferHookQueryKey([hookObject], resolver)).toMatchObject({
      segments: ['todos'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });

    expect(inferHookQueryKeys('useQuery', [hookObject], resolver)).toHaveLength(1);
    expect(inferHookQueryKeys('useQueries', [queryCollection], resolver)).toEqual([
      expect.objectContaining({ segments: ['todos'], source: 'literal' }),
      expect.objectContaining({ segments: ['users'], source: 'literal' }),
    ]);

    expect(isHookCallDirectQueryKeyDeclaration([hookObject], 'useQuery')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([queryCollection], 'useQueries')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([stringLiteral('todos')], 'useQuery')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([templateLiteral('todos')], 'useQuery')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([], 'useQuery')).toBe(false);
  });

  it('infers action query keys from options and predicates', () => {
    const predicateBody: BinaryExpression = {
      type: 'BinaryExpression',
      operator: '===',
      left: memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), numericLiteral(0), true),
      right: stringLiteral('todos'),
    };
    const predicate = arrowFunction(predicateBody);

    expect(inferActionQueryKey('clear', [])).toMatchObject({
      source: 'wildcard',
      matchMode: 'all',
    });
    expect(inferActionQueryKey('setQueryData', [arrayExpression([stringLiteral('todos')])])).toMatchObject({
      segments: ['todos'],
      source: 'literal',
      matchMode: 'exact',
    });
    expect(
      inferActionQueryKey('invalidateQueries', [
        objectExpression([
          objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('todos')])),
          objectProperty(identifier('exact'), booleanLiteral(true)),
        ]),
      ]),
    ).toMatchObject({
      segments: ['todos'],
      matchMode: 'exact',
    });
    expect(
      inferActionQueryKey('invalidateQueries', [
        objectExpression([
          objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('users')])),
          objectProperty(identifier('exact'), booleanLiteral(false)),
        ]),
      ]),
    ).toMatchObject({
      segments: ['users'],
      matchMode: 'prefix',
    });
    expect(inferActionQueryKey('invalidateQueries', [objectExpression([])])).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(
      inferActionQueryKey('removeQueries', [objectExpression([objectProperty(identifier('predicate'), predicate)])]),
    ).toMatchObject({
      segments: ['todos'],
      resolution: 'static',
    });
  });

  it('handles additional expression shapes and query collections', () => {
    const source = [
      "const localArray = ['todos', 1, true] as const;",
      "const wrapped = queryOptions({ queryKey: localArray, queryFn: () => Promise.resolve('ok') });",
      'const memoWrapped = useMemo(() => localArray, []);',
      'const stateWrapped = useState(localArray)[0];',
      'const reducerWrapped = useReducer(() => localArray, localArray)[0];',
      'const optionalWrapped = wrapped?.queryKey;',
      'const memberWrapped = wrapped.queryKey;',
      'const fallbackWrapped = foo || localArray;',
      'const nullishWrapped = foo ?? undefined;',
      "const conditionalWrapped = cond ? localArray : ['other'];",
      'const collection = [',
      '  wrapped,',
      "  queryOptions({ queryKey: ['users'] as const, queryFn: () => Promise.resolve('ok') }),",
      "].map((entry) => entry).concat([queryOptions({ queryKey: ['posts'] as const, queryFn: () => Promise.resolve('ok') })]);",
      'const queryCollection = { queries: collection };',
      "const queryCall = createQueryKey('prefix', wrapped, ['suffix'] as const);",
    ].join('\n');

    const localArray = expressionFromSource(source, 'localArray');
    const wrapped = expressionFromSource(source, 'wrapped');
    const memoWrapped = expressionFromSource(source, 'memoWrapped');
    const stateWrapped = expressionFromSource(source, 'stateWrapped');
    const reducerWrapped = expressionFromSource(source, 'reducerWrapped');
    const optionalWrapped = expressionFromSource(source, 'optionalWrapped');
    const memberWrapped = expressionFromSource(source, 'memberWrapped');
    const fallbackWrapped = expressionFromSource(source, 'fallbackWrapped');
    const nullishWrapped = expressionFromSource(source, 'nullishWrapped');
    const conditionalWrapped = expressionFromSource(source, 'conditionalWrapped');
    const collection = expressionFromSource(source, 'collection');
    const queryCollection = expressionFromSource(source, 'queryCollection');
    const queryCall = expressionFromSource(source, 'queryCall');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'localArray') {
          return localArray;
        }
        if (node.type === 'Identifier' && node.name === 'wrapped') {
          return wrapped;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(segmentFromExpression(localArray)).toMatchObject({ text: '[todos, 1, true]', isStatic: true });
    expect(segmentFromExpression(wrapped, resolver)).toMatchObject({
      text: '[todos, 1, true]',
      isStatic: true,
    });
    expect(segmentFromExpression(memoWrapped, resolver)).toMatchObject({
      text: '[todos, 1, true]',
      isStatic: true,
    });
    expect(segmentFromExpression(stateWrapped, resolver)).toMatchObject({
      text: '[todos, 1, true].0',
      isStatic: true,
    });
    expect(segmentFromExpression(reducerWrapped, resolver)).toMatchObject({ text: 'todos.0', isStatic: true });
    expect(segmentFromExpression(optionalWrapped, resolver)).toMatchObject({
      text: '[todos, 1, true]',
      isStatic: true,
    });
    expect(segmentFromExpression(memberWrapped, resolver)).toMatchObject({
      text: '[todos, 1, true]',
      isStatic: true,
    });
    expect(segmentFromExpression(fallbackWrapped)).toMatchObject({ text: '$foo || $localArray' });
    expect(segmentFromExpression(nullishWrapped)).toMatchObject({ text: '$foo' });
    expect(segmentFromExpression(conditionalWrapped)).toMatchObject({ text: 'cond(...)', isStatic: false });

    expect(normalizeQueryKey(queryCall, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['prefix', '[todos, 1, true]', '[suffix]'],
    });

    expect(inferHookQueryKeys('useQueries', [collection], resolver)).toEqual([
      expect.objectContaining({ segments: ['posts'] }),
    ]);

    expect(inferHookQueryKeys('useQueries', [queryCollection], resolver)).toEqual([
      expect.objectContaining({ id: 'pass-through-query-key', segments: ['$queryKey'] }),
    ]);

    expect(isHookCallDirectQueryKeyDeclaration([queryCollection], 'useQueries')).toBe(false);
    expect(isHookCallDirectQueryKeyDeclaration([collection], 'useQueries')).toBe(false);
  });

  it('normalizes complex expressions, collection hooks, and predicate actions', () => {
    const source = [
      "const root = 'todos';",
      "const objectKey = [{ b: undefined, a: 1, ...{ z: 'last' }, [root]: true }];",
      'const tupleKey = [null, 1n, `item-$' + '{root}`, { nested: root }];',
      'const optionalMember = api?.queryKey?.[0];',
      "const optionalCall = api?.makeKey('optional');",
      "const callbackKey = () => ['callback'] as const;",
      'const emptyCallback = () => {};',
      "const memberOptions = rq.queryOptions({ queryKey: ['member'] as const });",
      'const suspenseArgs = {',
      '  queries: cond',
      "    ? [{ queryKey: ['conditional'] as const }]",
      "    : [{ queryKey: ['alternate'] as const }],",
      '};',
      "const inlineQueries = [{ queryKey: ['inline'] as const }].flatMap((entry) => [entry]).concat([{ queryKey: ['tail'] as const }]);",
      "const predicateOptions = { predicate: (entry) => entry.queryKey[0] === root && 'detail' == entry.queryKey['1'] };",
      "const exactPredicateOptions = { exact: true, predicate: (entry) => entry.queryKey[0] === 'exact' };",
      'const passThrough = queryKey;',
    ].join('\n');

    const root = expressionFromSource(source, 'root');
    const objectKey = expressionFromSource(source, 'objectKey');
    const tupleKey = expressionFromSource(source, 'tupleKey');
    const optionalMember = expressionFromSource(source, 'optionalMember');
    const optionalCall = expressionFromSource(source, 'optionalCall');
    const callbackKey = expressionFromSource(source, 'callbackKey');
    const emptyCallback = expressionFromSource(source, 'emptyCallback');
    const memberOptions = expressionFromSource(source, 'memberOptions');
    const suspenseArgs = expressionFromSource(source, 'suspenseArgs');
    const inlineQueries = expressionFromSource(source, 'inlineQueries');
    const predicateOptions = expressionFromSource(source, 'predicateOptions');
    const exactPredicateOptions = expressionFromSource(source, 'exactPredicateOptions');
    const passThrough = expressionFromSource(source, 'passThrough');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'root') {
          return root;
        }
        if (node.type === 'Identifier' && node.name === 'queryKey') {
          return passThrough;
        }
        if (node.type === 'Identifier' && node.name === 'makeKey') {
          return {
            type: 'ArrowFunctionExpression',
            params: [identifier('id')],
            body: arrayExpression([stringLiteral('made'), identifier('id')]),
            generator: false,
            async: false,
            expression: true,
          };
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([identifier('first'), identifier('second')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'positional') {
          return arrayExpression([identifier('id'), identifier('kind')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'makeOptions') {
          return objectExpression([objectProperty(identifier('queryKey'), identifier('queryKey'))]);
        }
        return undefined;
      }),
    };

    expect(segmentFromExpression(objectKey, resolver)).toMatchObject({
      text: '[{b: undefined, a: 1, z: last, [todos]: true}]',
      isStatic: true,
    });
    expect(segmentFromExpression(tupleKey, resolver)).toMatchObject({
      text: '[null, expr, item-$' + '{todos}, {nested: todos}]',
      isStatic: false,
    });
    expect(segmentFromExpression(optionalMember, resolver)).toMatchObject({
      text: '$api?.queryKey?.[0]',
      isStatic: false,
    });
    expect(segmentFromExpression(optionalCall, resolver)).toMatchObject({
      text: '$api?.makeKey(optional)',
      isStatic: false,
    });
    expect(segmentFromExpression(callbackKey, resolver)).toMatchObject({ text: 'callback', isStatic: true });
    expect(segmentFromExpression(emptyCallback, resolver)).toMatchObject({ text: 'expr', isStatic: false });
    expect(normalizeQueryKey(memberOptions, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['member'],
    });
    expect(segmentFromExpression(objectExpression([]), resolver)).toMatchObject({ text: '{}', isStatic: true });
    expect(
      segmentFromExpression(objectExpression([objectProperty(identifier('empty'), identifier('undefined'))]), resolver),
    ).toMatchObject({ text: '{}', isStatic: true });
    expect(
      segmentFromExpression(objectExpression([spreadElement(identifier('dynamicObject'))]), resolver),
    ).toMatchObject({
      text: '{...$dynamicObject}',
      isStatic: false,
    });
    expect(
      segmentFromExpression(callExpression(memberExpression(identifier('ids'), identifier('sort')), []), resolver),
    ).toMatchObject({ text: '$ids', isStatic: false });
    expect(
      normalizeQueryKey(
        callExpression(identifier('createQueryKey'), [stringLiteral('one'), stringLiteral('two')]),
        {
          defaultMode: 'exact',
        },
        resolver,
      ),
    ).toMatchObject({ segments: ['one', 'two'] });
    expect(
      normalizeQueryKey(
        callExpression(identifier('makeKey'), [stringLiteral('42')]),
        { defaultMode: 'exact' },
        resolver,
      ),
    ).toMatchObject({ segments: ['made', '42'] });
    expect(
      normalizeQueryKey(
        callExpression(identifier('positional'), [stringLiteral('x'), stringLiteral('y')]),
        {
          defaultMode: 'exact',
        },
        resolver,
      ),
    ).toMatchObject({ segments: ['x', 'y'] });

    expect(inferHookQueryKeys('useSuspenseQueries', [suspenseArgs], resolver)).toEqual([
      expect.objectContaining({ segments: ['conditional'] }),
      expect.objectContaining({ segments: ['alternate'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [inlineQueries], resolver)).toEqual([
      expect.objectContaining({ segments: ['tail'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [], resolver)).toEqual([
      expect.objectContaining({ matchMode: 'unknown', source: 'expression' }),
    ]);

    expect(inferActionQueryKey('invalidateQueries', [predicateOptions], resolver)).toMatchObject({
      segments: ['todos', 'detail'],
      matchMode: 'prefix',
      resolution: 'static',
    });
    expect(inferActionQueryKey('invalidateQueries', [exactPredicateOptions], resolver)).toMatchObject({
      segments: ['exact'],
      matchMode: 'exact',
    });
    expect(inferActionQueryKey('setQueryData', [passThrough], resolver)).toMatchObject({
      id: 'pass-through-query-key',
      matchMode: 'exact',
    });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [callExpression(identifier('makeOptions'), [arrayExpression([stringLiteral('from-call')])])],
        resolver,
      ),
    ).toMatchObject({ segments: ['from-call'] });
  });

  it('covers action-key fallbacks, non-expression args, and predicate-only options', () => {
    const predicateBody: BinaryExpression = {
      type: 'BinaryExpression',
      operator: '===',
      left: memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), numericLiteral(0), true),
      right: stringLiteral('todos'),
    };
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn(() => undefined),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'arrayFactory') {
          return arrayExpression([stringLiteral('call-array')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'optionsFactory') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('call-query')])),
            objectProperty(identifier('exact'), booleanLiteral(true)),
          ]);
        }
        if (callee.type === 'Identifier' && callee.name === 'predicateFactory') {
          return objectExpression([objectProperty(identifier('predicate'), arrowFunction(predicateBody))]);
        }
        if (callee.type === 'Identifier' && callee.name === 'predicateOnlyFactory') {
          return objectExpression([objectProperty(identifier('predicate'), arrowFunction(booleanLiteral(true)))]);
        }
        return undefined;
      }),
    };

    expect(inferActionQueryKey('invalidateQueries', [], resolver)).toMatchObject({
      source: 'wildcard',
      matchMode: 'all',
    });
    expect(inferActionQueryKey('invalidateQueries', [spreadElement(stringLiteral('oops'))], resolver)).toMatchObject({
      matchMode: 'unknown',
    });
    expect(inferActionQueryKey('setQueryData', [callExpression(identifier('arrayFactory'))], resolver)).toMatchObject({
      segments: ['call-array'],
      matchMode: 'exact',
    });
    expect(
      inferActionQueryKey('invalidateQueries', [callExpression(identifier('optionsFactory'))], resolver),
    ).toMatchObject({
      segments: ['call-query'],
      matchMode: 'exact',
    });
    expect(
      inferActionQueryKey('invalidateQueries', [callExpression(identifier('predicateFactory'))], resolver),
    ).toMatchObject({
      segments: ['todos'],
      matchMode: 'prefix',
    });
    expect(
      inferActionQueryKey('invalidateQueries', [callExpression(identifier('predicateOnlyFactory'))], resolver),
    ).toMatchObject({
      source: 'wildcard',
      matchMode: 'all',
    });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [objectExpression([objectProperty(identifier('predicate'), arrowFunction(booleanLiteral(true)))])],
        resolver,
      ),
    ).toMatchObject({
      source: 'wildcard',
      matchMode: 'all',
    });
  });

  it('covers memo-like calls, sparse arguments, and unusual object keys', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'rest') {
          return arrayExpression([stringLiteral('rest-item')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'factory') {
          return {
            type: 'ArrowFunctionExpression',
            params: [
              { type: 'Identifier', name: 'first' },
              { type: 'Identifier', name: 'second' },
            ],
            body: arrayExpression([stringLiteral('made'), identifier('first'), identifier('second')]),
            generator: false,
            async: false,
            expression: true,
          };
        }
        return undefined;
      }),
    };

    const weirdObject = objectExpression([
      objectProperty(identifier('plain'), stringLiteral('value')),
      objectProperty(stringLiteral('quoted'), numericLiteral(7)),
      objectProperty(numericLiteral(7), identifier('undefined')),
      objectProperty({ type: 'PrivateName', id: identifier('secret') }, stringLiteral('hidden')),
      objectProperty(callExpression(identifier('infer'), [stringLiteral('name')]), stringLiteral('expr'), true),
      spreadElement(objectExpression([objectProperty(identifier('b'), stringLiteral('bee'))])),
    ]);

    const factoryCall = callExpression(identifier('factory'), [stringLiteral('one'), stringLiteral('two')]);

    const sparseArgsCall = callExpression(memberExpression(identifier('api'), identifier('noop')), [
      stringLiteral('one'),
      null as unknown as Expression,
      spreadElement(identifier('rest')),
    ]);

    const memoCall = callExpression(identifier('useMemo'), [
      arrowFunction(arrayExpression([stringLiteral('memo')])),
      arrayExpression([]),
    ]);

    const callbackCall = callExpression(identifier('useCallback'), [
      arrowFunction(arrayExpression([stringLiteral('callback')])),
      arrayExpression([]),
    ]);

    const joinedCall = callExpression(memberExpression(identifier('items'), identifier('join')), [stringLiteral(',')]);

    const weirdObjectSegment = segmentFromExpression(weirdObject, resolver);
    expect(weirdObjectSegment.text).toContain('plain: value');
    expect(weirdObjectSegment.text).toContain('quoted: 7');
    expect(weirdObjectSegment.text).toContain('#secret: hidden');
    expect(weirdObjectSegment.text).toContain('[call(infer)]: UNRESOLVED');
    expect(weirdObjectSegment.text).toContain('b: bee');

    expect(segmentFromExpression(factoryCall, resolver)).toMatchObject({
      text: 'made',
      isStatic: true,
    });
    const sparseArgsSegment = segmentFromExpression(sparseArgsCall, resolver);
    expect(sparseArgsSegment.text).toContain('one');
    expect(sparseArgsSegment.text).toContain('UNRESOLVED');
    expect(sparseArgsSegment.text).toContain('rest-item');
    expect(segmentFromExpression(memoCall, resolver)).toMatchObject({
      text: '[memo]',
      isStatic: true,
    });
    expect(segmentFromExpression(callbackCall, resolver)).toMatchObject({
      text: '[callback]',
      isStatic: true,
    });
    expect(segmentFromExpression(joinedCall, resolver)).toMatchObject({
      text: '$items',
      isStatic: false,
    });
  });

  it('handles cache pass-throughs, spread keys, and direct collection declarations', () => {
    const source = [
      "const extra = ['b', 'c'] as const;",
      "const spreadKey = ['a', ...extra] as const;",
      'const emptyKey = [] as const;',
      'const queryCacheLookup = queryCache.find({ queryKey: spreadKey });',
      'const nestedCacheLookup = client.getQueryCache().get({ queryKey: spreadKey });',
      "const inlineCollection = cond ? [{ queryKey: ['conditional-direct'] as const }] : [{ queryKey: ['alternate-direct'] as const }];",
      "const logicalCollection = maybe && [{ queryKey: ['logical-direct'] as const }];",
      'const wrappedInlineCollection = { queries: inlineCollection };',
      'const wrappedLogicalCollection = { queries: logicalCollection };',
      'const opaqueCollection = [{ queryKey }];',
      "const predicateWithoutPrefix = { predicate: (entry) => entry.queryKey[1] === 'detail' };",
      "const predicateWithUnary = { predicate: (entry) => !(entry.queryKey[0] !== 'negated') };",
      'const collectionWithoutMapper = inlineCollection.map().filter(Boolean);',
      'const optionalCollectionCall = inlineCollection?.slice?.(0);',
      "const optionalMemberCall = ids?.join?.(',');",
      "const computedMemberCall = api[method]('x');",
      'const holeKey = [undefined, , ...extra] as const;',
    ].join('\n');

    const extra = expressionFromSource(source, 'extra');
    const spreadKey = expressionFromSource(source, 'spreadKey');
    const emptyKey = expressionFromSource(source, 'emptyKey');
    const queryCacheLookup = expressionFromSource(source, 'queryCacheLookup');
    const nestedCacheLookup = expressionFromSource(source, 'nestedCacheLookup');
    const inlineCollection = expressionFromSource(source, 'inlineCollection');
    const logicalCollection = expressionFromSource(source, 'logicalCollection');
    const wrappedInlineCollection = expressionFromSource(source, 'wrappedInlineCollection');
    const wrappedLogicalCollection = expressionFromSource(source, 'wrappedLogicalCollection');
    const opaqueCollection = expressionFromSource(source, 'opaqueCollection');
    const predicateWithoutPrefix = expressionFromSource(source, 'predicateWithoutPrefix');
    const predicateWithUnary = expressionFromSource(source, 'predicateWithUnary');
    const collectionWithoutMapper = expressionFromSource(source, 'collectionWithoutMapper');
    const optionalCollectionCall = expressionFromSource(source, 'optionalCollectionCall');
    const optionalMemberCall = expressionFromSource(source, 'optionalMemberCall');
    const computedMemberCall = expressionFromSource(source, 'computedMemberCall');
    const holeKey = expressionFromSource(source, 'holeKey');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'extra') {
          return extra;
        }
        if (node.type === 'Identifier' && node.name === 'spreadKey') {
          return spreadKey;
        }
        if (node.type === 'Identifier' && node.name === 'inlineCollection') {
          return inlineCollection;
        }
        if (node.type === 'Identifier' && node.name === 'queryCacheLookup') {
          return queryCacheLookup;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(normalizeQueryKey(spreadKey, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['a', 'b', 'c'],
      resolution: 'static',
    });
    expect(normalizeQueryKey(emptyKey, { defaultMode: 'exact' }, resolver)).toMatchObject({
      id: 'empty',
      segments: [],
    });
    expect(normalizeQueryKey(holeKey, { defaultMode: 'prefix' }, resolver)).toMatchObject({
      segments: ['undefined', 'UNRESOLVED', 'b', 'c'],
    });

    expect(inferActionQueryKey('setQueryData', [queryCacheLookup], resolver)).toMatchObject({
      segments: ['a', 'b', 'c'],
      matchMode: 'exact',
    });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [objectExpression([objectProperty(identifier('queryKey'), nestedCacheLookup)])],
        resolver,
      ),
    ).toMatchObject({
      id: 'pass-through-query-key',
      matchMode: 'prefix',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicateWithoutPrefix], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicateWithUnary], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });

    expect(inferHookQueryKeys('useQueries', [inlineCollection], resolver)).toEqual([
      expect.objectContaining({ segments: ['cond(...)'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [wrappedInlineCollection], resolver)).toEqual([
      expect.objectContaining({ segments: ['conditional-direct'] }),
      expect.objectContaining({ segments: ['alternate-direct'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [wrappedLogicalCollection], resolver)).toEqual([
      expect.objectContaining({ id: 'pass-through-query-key' }),
    ]);
    expect(inferHookQueryKeys('useQueries', [opaqueCollection], resolver)).toEqual([
      expect.objectContaining({ segments: ['UNRESOLVED'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [collectionWithoutMapper], resolver)).toEqual([
      expect.objectContaining({ segments: ['cond(...)'] }),
    ]);
    expect(isHookCallDirectQueryKeyDeclaration([inlineCollection], 'useQueries')).toBe(false);
    expect(isHookCallDirectQueryKeyDeclaration([logicalCollection], 'useQueries')).toBe(false);
    expect(segmentFromExpression(optionalCollectionCall, resolver)).toMatchObject({
      text: 'cond(...)',
      isStatic: false,
    });
    expect(segmentFromExpression(optionalMemberCall, resolver)).toMatchObject({
      text: '$ids',
      isStatic: false,
    });
    expect(segmentFromExpression(computedMemberCall, resolver)).toMatchObject({
      text: '$api[method](x)',
      isStatic: false,
    });
  });

  it('normalizes edge expression shapes used inside query keys', () => {
    const source = [
      'const objectSpread = [{ ...{ b: 2 }, a: 1 }];',
      "const objectMethod = [{ method() { return 1; }, value: 'x' }];",
      "const computedObject = [{ ['dyn' + 'Key']: 'value' }];",
      "const bigKeyObject = [{ [1n]: 'big' }];",
      "const identityArray = identity(['wrapped'] as const);",
      "const identityObject = identity({ queryKey: ['object-query'] as const });",
      "const memberQueryKey = ['member'] as const;",
      'const memberObject = { queryKey: memberQueryKey };',
      'const memberExpressionKey = memberObject.queryKey;',
      "const valueRef = shallowRef(['ref-value'] as const);",
      'const refValue = valueRef.value;',
      "const fallbackString = maybe || '';",
      'const fallbackTemplate = maybe ?? ``;',
      'const fallbackObject = maybe || {};',
      'const fallbackArray = maybe ?? [];',
      'const positionalShort = positionalOnly(first);',
      'const queryKeyCall = queryKey(first);',
      'const queryKeysCall = queryKeys(first);',
      'const emptyMemo = useMemo();',
      'const callbackLiteral = useCallback(() => ["callback-literal"] as const, []);',
    ].join('\n');

    const objectSpread = expressionFromSource(source, 'objectSpread');
    const objectMethod = expressionFromSource(source, 'objectMethod');
    const computedObject = expressionFromSource(source, 'computedObject');
    const bigKeyObject = expressionFromSource(source, 'bigKeyObject');
    const identityArray = expressionFromSource(source, 'identityArray');
    const identityObject = expressionFromSource(source, 'identityObject');
    const memberExpressionKey = expressionFromSource(source, 'memberExpressionKey');
    const memberObject = expressionFromSource(source, 'memberObject');
    const memberQueryKey = expressionFromSource(source, 'memberQueryKey');
    const valueRef = expressionFromSource(source, 'valueRef');
    const refValue = expressionFromSource(source, 'refValue');
    const fallbackString = expressionFromSource(source, 'fallbackString');
    const fallbackTemplate = expressionFromSource(source, 'fallbackTemplate');
    const fallbackObject = expressionFromSource(source, 'fallbackObject');
    const fallbackArray = expressionFromSource(source, 'fallbackArray');
    const positionalShort = expressionFromSource(source, 'positionalShort');
    const queryKeyCall = expressionFromSource(source, 'queryKeyCall');
    const queryKeysCall = expressionFromSource(source, 'queryKeysCall');
    const emptyMemo = expressionFromSource(source, 'emptyMemo');
    const callbackLiteral = expressionFromSource(source, 'callbackLiteral');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'memberQueryKey') {
          return memberQueryKey;
        }
        if (node.type === 'Identifier' && node.name === 'memberObject') {
          return memberObject;
        }
        if (node.type === 'Identifier' && node.name === 'valueRef') {
          return valueRef;
        }
        if (node.type === 'Identifier' && node.name === 'identity') {
          return arrayExpression([stringLiteral('identity-callee')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'positionalOnly') {
          return arrayExpression([identifier('first'), identifier('missing')]);
        }
        return undefined;
      }),
    };

    expect(segmentFromExpression(objectSpread, resolver)).toMatchObject({
      text: '[{b: 2, a: 1}]',
      isStatic: true,
    });
    expect(segmentFromExpression(objectMethod, resolver)).toMatchObject({
      text: '[{[method], value: x}]',
      isStatic: false,
    });
    expect(segmentFromExpression(computedObject, resolver)).toMatchObject({
      text: '[{[dyn + Key]: value}]',
      isStatic: true,
    });
    expect(segmentFromExpression(bigKeyObject, resolver)).toMatchObject({
      text: '[{[UNRESOLVED]: big}]',
      isStatic: false,
    });
    expect(normalizeQueryKey(identityArray, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['wrapped'],
    });
    expect(normalizeQueryKey(identityObject, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['object-query'],
    });
    expect(normalizeQueryKey(memberExpressionKey, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['member'],
    });
    expect(segmentFromExpression(refValue, resolver)).toMatchObject({ text: '[ref-value].value', isStatic: true });
    expect(segmentFromExpression(fallbackString, resolver)).toMatchObject({ text: '$maybe', isStatic: false });
    expect(segmentFromExpression(fallbackTemplate, resolver)).toMatchObject({ text: '$maybe', isStatic: false });
    expect(segmentFromExpression(fallbackObject, resolver)).toMatchObject({ text: '$maybe', isStatic: false });
    expect(segmentFromExpression(fallbackArray, resolver)).toMatchObject({ text: '$maybe', isStatic: false });
    expect(normalizeQueryKey(positionalShort, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['$first', '$missing'],
    });
    expect(segmentFromExpression(queryKeyCall, resolver)).toMatchObject({ text: 'call(queryKey)', isStatic: false });
    expect(segmentFromExpression(queryKeysCall, resolver)).toMatchObject({ text: 'call(queryKeys)', isStatic: false });
    expect(segmentFromExpression(emptyMemo, resolver)).toMatchObject({ text: 'call(useMemo)', isStatic: false });
    expect(segmentFromExpression(callbackLiteral, resolver)).toMatchObject({
      text: '[callback-literal]',
      isStatic: true,
    });
  });

  it('applies function argument hints across complex return shapes and predicate positions', () => {
    const source = [
      "const suffix = 'detail';",
      'const complexFactory = (seed, key, keep) => [...seed, { nested: key }.nested, `' +
        '$' +
        "{key}`, !keep, key || [], keep ? key : 'off', (key, 'tail')] as const;",
      "const complexCall = complexFactory(['seed'] as const, 'dynamic', false);",
      'const objectArgFactory = ({ queryKey, exact }: { queryKey: readonly unknown[]; exact: boolean }) => ({ queryKey: [queryKey, exact] as const });',
      "const objectArgCall = objectArgFactory({ queryKey: ['object-arg'] as const, exact: true });",
      "const mapper = (entry) => queryOptions({ queryKey: ['mapped', entry.id] as const });",
      "const mappedCollection = [{ queryKey: ['source'] as const, id: 'a' }].map(mapper);",
      "const flatMapper = (entry) => [{ queryKey: ['flat-mapped', entry.id] as const }];",
      "const flatMappedCollection = [{ queryKey: ['source'] as const, id: 'b' }].flatMap(flatMapper);",
      "const rightPredicate = { predicate: (entry) => 'right' === entry.queryKey[0] && entry.queryKey['1'] == suffix };",
      'const bothSidesPredicate = { predicate: (entry) => entry.queryKey[0] === entry.queryKey[1] };',
    ].join('\n');

    const suffix = expressionFromSource(source, 'suffix');
    const complexFactory = expressionFromSource(source, 'complexFactory');
    const complexCall = expressionFromSource(source, 'complexCall');
    const objectArgFactory = expressionFromSource(source, 'objectArgFactory');
    const objectArgCall = expressionFromSource(source, 'objectArgCall');
    const mapper = expressionFromSource(source, 'mapper');
    const mappedCollection = expressionFromSource(source, 'mappedCollection');
    const flatMapper = expressionFromSource(source, 'flatMapper');
    const flatMappedCollection = expressionFromSource(source, 'flatMappedCollection');
    const rightPredicate = expressionFromSource(source, 'rightPredicate');
    const bothSidesPredicate = expressionFromSource(source, 'bothSidesPredicate');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'complexFactory') {
          return complexFactory;
        }
        if (node.type === 'Identifier' && node.name === 'objectArgFactory') {
          return objectArgFactory;
        }
        if (node.type === 'Identifier' && node.name === 'mapper') {
          return mapper;
        }
        if (node.type === 'Identifier' && node.name === 'flatMapper') {
          return flatMapper;
        }
        if (node.type === 'Identifier' && node.name === 'suffix') {
          return suffix;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(normalizeQueryKey(complexCall, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['seed', 'dynamic', '$' + '{dynamic}', '!false', 'dynamic', 'cond(...)', 'UNRESOLVED'],
    });
    expect(normalizeQueryKey(objectArgCall, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['UNRESOLVED', '$exact'],
    });
    expect(inferHookQueryKeys('useQueries', [mappedCollection], resolver)).toEqual([
      expect.objectContaining({ segments: ['[[source]]'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [flatMappedCollection], resolver)).toEqual([
      expect.objectContaining({ segments: ['[[source]]'] }),
    ]);
    expect(inferActionQueryKey('invalidateQueries', [rightPredicate], resolver)).toMatchObject({
      segments: ['right', 'detail'],
    });
    expect(inferActionQueryKey('invalidateQueries', [bothSidesPredicate], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
  });

  it('normalizes unresolved call and member expression displays', () => {
    const source = [
      "const arrayArgCall = passthrough(['array-arg'] as const);",
      "const callArgSpread = invoke('head', ...tail, ['last'] as const);",
      "const memberCall = api.run('x', ...tail);",
      "const computedOptionalCall = api?.[method]?.('x');",
      'const optionalIdentifierCall = maybeCall?.();',
      'const optionalExpressionCall = (cond ? left : right)?.();',
      'const unknownOptionalMember = target?.[method];',
      'const unknownMember = target[method];',
      'const nonCollectionMethod = ids.reduce(joiner, seed);',
    ].join('\n');

    const arrayArgCall = expressionFromSource(source, 'arrayArgCall');
    const callArgSpread = expressionFromSource(source, 'callArgSpread');
    const memberCall = expressionFromSource(source, 'memberCall');
    const computedOptionalCall = expressionFromSource(source, 'computedOptionalCall');
    const optionalIdentifierCall = expressionFromSource(source, 'optionalIdentifierCall');
    const optionalExpressionCall = expressionFromSource(source, 'optionalExpressionCall');
    const unknownOptionalMember = expressionFromSource(source, 'unknownOptionalMember');
    const unknownMember = expressionFromSource(source, 'unknownMember');
    const nonCollectionMethod = expressionFromSource(source, 'nonCollectionMethod');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn(() => undefined),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(segmentFromExpression(arrayArgCall, resolver)).toMatchObject({ text: '[array-arg]', isStatic: true });
    expect(segmentFromExpression(callArgSpread)).toMatchObject({
      text: 'call(invoke)',
      isStatic: false,
    });
    expect(segmentFromExpression(callArgSpread, undefined, 24)).toMatchObject({
      text: 'call(invoke)',
      isStatic: false,
    });
    expect(segmentFromExpression(memberCall)).toMatchObject({ text: '$api.run(x, ...$tail)', isStatic: false });
    expect(segmentFromExpression(computedOptionalCall)).toMatchObject({
      text: '$api?.[method](x)',
      isStatic: false,
    });
    expect(segmentFromExpression(optionalIdentifierCall)).toMatchObject({
      text: 'call(maybeCall)',
      isStatic: false,
    });
    expect(segmentFromExpression(optionalExpressionCall)).toMatchObject({ text: 'call(expr)', isStatic: false });
    expect(segmentFromExpression(unknownOptionalMember)).toMatchObject({
      text: '$target?.[method]',
      isStatic: false,
    });
    expect(segmentFromExpression(unknownMember)).toMatchObject({ text: '$target.method', isStatic: false });
    expect(segmentFromExpression(nonCollectionMethod)).toMatchObject({
      text: '$ids.reduce($joiner, $seed)',
      isStatic: false,
    });
  });

  it('falls back for unresolved collection and action query objects', () => {
    const source = [
      'const emptyQueries = { queries: [] };',
      'const holeQueries = { queries: [, { queryKey: queryKey }] };',
      'const dynamicQueries = unknownQueries;',
      "const actionWithoutKey = { predicate: (entry) => entry.type === 'query' };",
      "const actionWithKey = { queryKey: queryCache.find({ queryKey: ['cached'] as const }), exact: true };",
      'const directObjectWithoutKey = { stale: true };',
      'const directPredicateWithoutMatch = { predicate: () => false };',
      'const directNonObject = maybeKey;',
    ].join('\n');

    const emptyQueries = expressionFromSource(source, 'emptyQueries');
    const holeQueries = expressionFromSource(source, 'holeQueries');
    const dynamicQueries = expressionFromSource(source, 'dynamicQueries');
    const actionWithoutKey = expressionFromSource(source, 'actionWithoutKey');
    const actionWithKey = expressionFromSource(source, 'actionWithKey');
    const directObjectWithoutKey = expressionFromSource(source, 'directObjectWithoutKey');
    const directPredicateWithoutMatch = expressionFromSource(source, 'directPredicateWithoutMatch');
    const directNonObject = expressionFromSource(source, 'directNonObject');

    expect(inferHookQueryKeys('useQuery', [dynamicQueries])).toEqual([
      expect.objectContaining({ segments: ['$unknownQueries'], matchMode: 'exact' }),
    ]);
    expect(inferHookQueryKeys('useQueries', [emptyQueries])).toEqual([
      expect.objectContaining({ id: 'pass-through-query-key', segments: ['$queryKey'] }),
    ]);
    expect(inferHookQueryKeys('useQueries', [holeQueries])).toEqual([
      expect.objectContaining({ id: 'pass-through-query-key', segments: ['$queryKey'] }),
    ]);
    expect(inferActionQueryKey('invalidateQueries', [actionWithoutKey])).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [actionWithKey])).toMatchObject({
      id: 'pass-through-query-key',
      matchMode: 'exact',
    });
    expect(inferActionQueryKey('invalidateQueries', [directObjectWithoutKey])).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [directPredicateWithoutMatch])).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [directNonObject])).toMatchObject({
      segments: ['$maybeKey'],
      matchMode: 'prefix',
    });
  });

  it('covers manual AST edge cases and pass-through setQueryData detection', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn(() => undefined),
      resolveCallResult: vi.fn(() => undefined),
    };

    const edgeObject = objectExpression([
      null as never,
      { type: 'SpreadElement', argument: null as never } as never,
      {
        type: 'Property',
        kind: 'init',
        key: identifier('defined'),
        value: identifier('undefined'),
        method: false,
        shorthand: false,
        computed: false,
        optional: false,
      },
      {
        type: 'ObjectMethod',
      } as never,
    ]);

    expect(segmentFromExpression(edgeObject, resolver)).toMatchObject({
      text: '{...UNRESOLVED, defined: undefined, [method]}',
      isStatic: false,
    });
    expect(segmentFromExpression(callExpression(identifier('invoke'), [null as never]), resolver)).toMatchObject({
      text: 'call(invoke)',
      isStatic: false,
    });
    expect(
      segmentFromExpression(callExpression(identifier('invoke'), [spreadElement(stringLiteral('tail'))]), resolver),
    ).toMatchObject({
      text: 'call(invoke)',
      isStatic: false,
    });
    expect(segmentFromExpression(callExpression(identifier('useMemo'), []), resolver)).toMatchObject({
      text: 'call(useMemo)',
      isStatic: false,
    });
    expect(
      segmentFromExpression(callExpression(identifier('useMemo'), [stringLiteral('value')]), resolver),
    ).toMatchObject({
      text: 'value',
      isStatic: true,
    });
    expect(inferActionQueryKey('invalidateQueries', [null as never])).toMatchObject({
      matchMode: 'unknown',
      source: 'expression',
    });
    expect(inferActionQueryKey('setQueryData', [identifier('queryKey')], resolver)).toMatchObject({
      id: 'pass-through-query-key',
      matchMode: 'exact',
    });
  });

  it('detects inline query key declarations in nested collection shapes', () => {
    const source = [
      "const nestedObject = { queries: [{ queryKey: ['nested'] as const }] };",
      "const conditionalCollection = cond ? [] : [{ queryKey: ['alternate'] as const }];",
      "const logicalCollection = maybe || [{ queryKey: ['logical'] as const }];",
      "const wrappedConditionalCollection = { queries: cond ? [] : [{ queryKey: ['alternate'] as const }] };",
      "const wrappedLogicalCollection = { queries: maybe || [{ queryKey: ['logical'] as const }] };",
      'const emptyCollection = [null, ...items];',
      'const wrappedEmptyCollection = { queries: emptyCollection };',
    ].join('\n');

    const nestedObject = expressionFromSource(source, 'nestedObject');
    const conditionalCollection = expressionFromSource(source, 'conditionalCollection');
    const logicalCollection = expressionFromSource(source, 'logicalCollection');
    const wrappedConditionalCollection = expressionFromSource(source, 'wrappedConditionalCollection');
    const wrappedLogicalCollection = expressionFromSource(source, 'wrappedLogicalCollection');
    const emptyCollection = expressionFromSource(source, 'emptyCollection');
    const wrappedEmptyCollection = expressionFromSource(source, 'wrappedEmptyCollection');

    expect(isHookCallDirectQueryKeyDeclaration([nestedObject], 'useQueries')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([conditionalCollection], 'useQueries')).toBe(false);
    expect(isHookCallDirectQueryKeyDeclaration([logicalCollection], 'useQueries')).toBe(false);
    expect(isHookCallDirectQueryKeyDeclaration([wrappedConditionalCollection], 'useQueries')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([wrappedLogicalCollection], 'useQueries')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([emptyCollection], 'useQueries')).toBe(false);
    expect(isHookCallDirectQueryKeyDeclaration([wrappedEmptyCollection], 'useQueries')).toBe(false);
    expect(
      isOpaqueCollectionQueryKey({
        id: 'blank',
        display: 'blank',
        segments: [''],
        matchMode: 'exact',
        resolution: 'dynamic',
        source: 'expression',
      }),
    ).toBe(true);
    expect(
      isOpaqueCollectionQueryKey({
        id: 'empty',
        display: '[]',
        segments: [],
        matchMode: 'exact',
        resolution: 'static',
        source: 'literal',
      }),
    ).toBe(false);
  });

  it('covers unresolved hooks, ref members, and predicate index edge cases', () => {
    const source = [
      'const stateNoArg = useState();',
      'const reducerNoArg = useReducer();',
      "const directRefValue = ref(['direct-ref'] as const).value;",
      "const directShallowValue = shallowRef(['direct-shallow'] as const).value;",
      "const optionalRefValue = shallowRef(['optional-ref'] as const)?.value;",
      "const stateElement = useState(['state-value'] as const)[0];",
      "const memoAlias = useMemo(() => ['memo-value'] as const, []);",
      "const memberCallAlias = api.makeKey('member');",
      "const optionalMemberCall = api?.makeKey?.('optional');",
      "const createShort = createQueryKey('one');",
      "const predicateExpression = entry.queryKey[0] === 'direct' && entry.queryKey[index] === 'dynamic';",
      "const predicateResolvedIndex = { predicate: (entry) => entry.queryKey[position] === 'resolved' };",
      "const predicateNegativeIndex = { predicate: (entry) => entry.queryKey[-1] === 'negative' };",
      'const predicateBothIndexes = { predicate: (entry) => entry.queryKey[0] === entry.queryKey[1] };',
      "const predicateExact = { exact: true, predicate: (entry) => entry.queryKey[0] === 'exact-edge' };",
    ].join('\n');

    const stateNoArg = expressionFromSource(source, 'stateNoArg');
    const reducerNoArg = expressionFromSource(source, 'reducerNoArg');
    const directRefValue = expressionFromSource(source, 'directRefValue');
    const directShallowValue = expressionFromSource(source, 'directShallowValue');
    const optionalRefValue = expressionFromSource(source, 'optionalRefValue');
    const stateElement = expressionFromSource(source, 'stateElement');
    const memoAlias = expressionFromSource(source, 'memoAlias');
    const memberCallAlias = expressionFromSource(source, 'memberCallAlias');
    const optionalMemberCall = expressionFromSource(source, 'optionalMemberCall');
    const createShort = expressionFromSource(source, 'createShort');
    const predicateExpression = expressionFromSource(source, 'predicateExpression');
    const predicateResolvedIndex = expressionFromSource(source, 'predicateResolvedIndex');
    const predicateNegativeIndex = expressionFromSource(source, 'predicateNegativeIndex');
    const predicateBothIndexes = expressionFromSource(source, 'predicateBothIndexes');
    const predicateExact = expressionFromSource(source, 'predicateExact');
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'memoAlias') {
          return memoAlias;
        }
        if (node.type === 'Identifier' && node.name === 'memberCallAlias') {
          return memberCallAlias;
        }
        if (node.type === 'Identifier' && node.name === 'position') {
          return numericLiteral(0);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(segmentFromExpression(stateNoArg, resolver)).toMatchObject({ text: 'UNRESOLVED', isStatic: false });
    expect(segmentFromExpression(reducerNoArg, resolver)).toMatchObject({ text: 'UNRESOLVED', isStatic: false });
    expect(segmentFromExpression(directRefValue, resolver)).toMatchObject({
      text: '[direct-ref].value',
      isStatic: true,
    });
    expect(segmentFromExpression(directShallowValue, resolver)).toMatchObject({
      text: '[direct-shallow].value',
      isStatic: true,
    });
    expect(segmentFromExpression(optionalRefValue, resolver)).toMatchObject({
      text: '[optional-ref]?.value',
      isStatic: true,
    });
    expect(segmentFromExpression(stateElement, resolver)).toMatchObject({ text: '[state-value].0', isStatic: true });
    expect(segmentFromExpression(identifier('memoAlias'), resolver)).toMatchObject({ text: '$memoAlias' });
    expect(segmentFromExpression(identifier('memberCallAlias'), resolver)).toMatchObject({ text: '$memberCallAlias' });
    expect(segmentFromExpression(optionalMemberCall, resolver)).toMatchObject({
      text: '$api?.makeKey(optional)',
      isStatic: false,
    });
    expect(normalizeQueryKey(createShort, { defaultMode: 'exact' }, resolver)).toMatchObject({
      segments: ['one', 'UNRESOLVED', 'UNRESOLVED'],
    });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [objectExpression([objectProperty(identifier('predicate'), predicateExpression)])],
        resolver,
      ),
    ).toMatchObject({
      segments: ['direct'],
      matchMode: 'prefix',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicateResolvedIndex], resolver)).toMatchObject({
      segments: ['resolved'],
      matchMode: 'prefix',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicateNegativeIndex], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicateBothIndexes], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicateExact], resolver)).toMatchObject({
      segments: ['exact-edge'],
      matchMode: 'exact',
    });
  });

  it('covers wrapper calls, canonical objects, collections, and predicate inference edges', () => {
    const source = [
      "const suffix = 'suffix' as const;",
      "const spreadSource = { queryKey: ['spread-source'] as const, nested: { queryKey: ['nested'] as const } };",
      "const canonicalObject = { beta: ['b'] as const, alpha: ['a'] as const, gamma: undefined };",
      "const spreadObject = { ...spreadSource, queryKey: ['spread-target'] as const, method() { return 1; } };",
      "const options = queryOptions({ queryKey: ['opts'] as const });",
      "const memoResult = useMemo(() => ['memo-result'] as const, []);",
      "const callbackResult = useCallback(() => ['callback-result'] as const, []);",
      "const wrappedArray = identity(['wrapped-array'] as const);",
      'const factoryArrayCall = factoryArray();',
      'const factoryObjectCall = factoryObject();',
      "const directQueries = { queries: [{ queryKey: ['direct'] as const }] };",
      "const collection = { queries: [options, queryOptions({ queryKey: ['list'] as const })].map((entry) => entry).flatMap((entry) => [entry]).concat([{ queryKey: ['concat'] as const }]) };",
      "const predicate = (entry) => entry.queryKey[0] === 'alpha' && entry.queryKey[1] === suffix;",
      'const actionOptions = { exact: true, predicate };',
    ].join('\n');

    const canonicalObject = expressionFromSource(source, 'canonicalObject');
    const spreadObject = expressionFromSource(source, 'spreadObject');
    const options = expressionFromSource(source, 'options');
    const memoResult = expressionFromSource(source, 'memoResult');
    const callbackResult = expressionFromSource(source, 'callbackResult');
    const wrappedArray = expressionFromSource(source, 'wrappedArray');
    const factoryArrayCall = expressionFromSource(source, 'factoryArrayCall');
    const factoryObjectCall = expressionFromSource(source, 'factoryObjectCall');
    const directQueries = expressionFromSource(source, 'directQueries');
    const collection = expressionFromSource(source, 'collection');
    const predicate = expressionFromSource(source, 'predicate');
    const actionOptions = expressionFromSource(source, 'actionOptions');

    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'spreadSource') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('spread-source')])),
            objectProperty(
              identifier('nested'),
              objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('nested')]))]),
            ),
          ]);
        }

        if (node.type === 'Identifier' && node.name === 'suffix') {
          return stringLiteral('suffix');
        }

        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'factoryArray') {
          return arrayExpression([stringLiteral('factory-first'), stringLiteral('factory-second')]);
        }

        if (callee.type === 'Identifier' && callee.name === 'factoryObject') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('factory-object')])),
            objectProperty(identifier('other'), stringLiteral('value')),
          ]);
        }

        return undefined;
      }),
    };

    expect(segmentFromExpression(canonicalObject, resolver)).toEqual({
      text: '{alpha: [a], beta: [b]}',
      isStatic: true,
    });
    expect(segmentFromExpression(spreadObject, resolver)).toMatchObject({
      isStatic: true,
      text: expect.stringContaining('spread-target'),
    });
    expect(segmentFromExpression(options, resolver)).toMatchObject({
      text: '[opts]',
      isStatic: true,
    });
    expect(segmentFromExpression(memoResult, resolver)).toMatchObject({
      text: '[memo-result]',
      isStatic: true,
    });
    expect(segmentFromExpression(callbackResult, resolver)).toMatchObject({
      text: '[callback-result]',
      isStatic: true,
    });
    expect(segmentFromExpression(wrappedArray, resolver)).toMatchObject({
      text: '[wrapped-array]',
      isStatic: true,
    });
    expect(segmentFromExpression(factoryArrayCall, resolver)).toMatchObject({
      text: '[factory-first, factory-second]',
      isStatic: true,
    });
    expect(segmentFromExpression(factoryObjectCall, resolver)).toMatchObject({
      isStatic: true,
    });
    expect(
      resolveQueryKeyExpression(memberExpression(identifier('spreadSource'), identifier('queryKey')), resolver),
    ).toEqual(arrayExpression([stringLiteral('spread-source')]));
    expect(inferHookQueryKeys('useQueries', [options], resolver).map((entry) => entry.segments.join('/'))).toEqual([
      'opts',
    ]);
    expect(inferHookQueryKeys('useQueries', [collection], resolver).map((entry) => entry.segments.join('/'))).toContain(
      'concat',
    );
    expect(isHookCallDirectQueryKeyDeclaration([directQueries], 'useQueries')).toBe(true);
    expect(isHookCallDirectQueryKeyDeclaration([canonicalObject], 'useQuery')).toBe(false);
    expect(inferActionQueryKey('invalidateQueries', [actionOptions], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
    expect(inferActionQueryKey('invalidateQueries', [predicate], resolver)).toMatchObject({
      matchMode: 'prefix',
      source: 'expression',
    });
    expect(normalizeQueryKey(undefined, { wildcardIfMissing: true }, resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });
  });

  it('covers object spreads, function hints, positional hints, and pass-through action keys', () => {
    const source = [
      "const spreadSource = { queryKey: ['spread'] as const, nested: { queryKey: ['spread-nested'] as const } };",
      'const spreadWrapper = { ...spreadSource };',
      "const overrideWrapper = { ...spreadSource, queryKey: ['override'] as const };",
      "const tupleFactory = (first: readonly unknown[], second = ['second-default'] as const) => [first, second, first] as const;",
      "const positionalFactory = createQueryKey('prefix', ['middle'] as const, ['suffix'] as const);",
      "const optionsFactoryCall = optionsFactory({ ...spreadSource, queryKey: ['object'] as const, nested: { queryKey: ['nested-call'] as const }, suffix: 'tail' });",
      "const tupleFactoryCall = tupleFactory(['tuple'] as const, ['pair'] as const);",
      'const identityWrapped = queryOptions({ queryKey: overrideWrapper, exact: true });',
      'const nestedIdentityWrapped = infiniteQueryOptions({ queryKey: spreadWrapper.nested });',
      'const optionalMember = overrideWrapper?.queryKey;',
      'const optionalNestedMember = spreadWrapper?.nested?.queryKey;',
      "const optionalCall = tupleFactory?.(['optional'] as const, ['call'] as const);",
      'const directQueryKey = queryKey;',
      'const queryCacheLookup = queryCache.get(queryKey);',
      "const predicateAction = { predicate: (entry) => !entry.queryKey[0] && entry.queryKey[0] === 'exact' && entry.queryKey[1] == 'second' };",
      'const invalidateAction = { queryKey: queryCacheLookup, exact: true };',
      'const exactAction = { queryKey: overrideWrapper.queryKey, exact: true };',
      "const wildcardAction = { predicate: (entry) => entry.queryKey[0] === 'wild' };",
    ].join('\n');

    const spreadSource = expressionFromSource(source, 'spreadSource');
    const spreadWrapper = expressionFromSource(source, 'spreadWrapper');
    const overrideWrapper = expressionFromSource(source, 'overrideWrapper');
    const tupleFactory = expressionFromSource(source, 'tupleFactory');
    const positionalFactory = expressionFromSource(source, 'positionalFactory');
    const optionsFactoryCall = expressionFromSource(source, 'optionsFactoryCall');
    const tupleFactoryCall = expressionFromSource(source, 'tupleFactoryCall');
    const identityWrapped = expressionFromSource(source, 'identityWrapped');
    const nestedIdentityWrapped = expressionFromSource(source, 'nestedIdentityWrapped');
    const optionalMember = expressionFromSource(source, 'optionalMember');
    const optionalNestedMember = expressionFromSource(source, 'optionalNestedMember');
    const optionalCall = expressionFromSource(source, 'optionalCall');
    const directQueryKey = expressionFromSource(source, 'directQueryKey');
    const queryCacheLookup = expressionFromSource(source, 'queryCacheLookup');
    const predicateAction = expressionFromSource(source, 'predicateAction');
    const invalidateAction = expressionFromSource(source, 'invalidateAction');
    const exactAction = expressionFromSource(source, 'exactAction');
    const wildcardAction = expressionFromSource(source, 'wildcardAction');

    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier') {
          if (node.name === 'spreadSource') {
            return spreadSource;
          }
          if (node.name === 'spreadWrapper') {
            return spreadWrapper;
          }
          if (node.name === 'overrideWrapper') {
            return overrideWrapper;
          }
          if (node.name === 'tupleFactory') {
            return tupleFactory;
          }
          if (node.name === 'queryCacheLookup') {
            return queryCacheLookup;
          }
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([identifier('first'), identifier('second'), identifier('third')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'optionsFactory') {
          return objectExpression([
            objectProperty(identifier('queryKey'), identifier('queryKey')),
            objectProperty(identifier('exact'), identifier('exact')),
            objectProperty(identifier('predicate'), identifier('predicate')),
          ]);
        }
        return undefined;
      }),
    };

    expect(segmentFromExpression(spreadWrapper, resolver)).toMatchObject({
      text: '[spread]',
      isStatic: true,
    });
    expect(segmentFromExpression(overrideWrapper, resolver)).toMatchObject({
      text: '[override]',
      isStatic: true,
    });
    expect(
      segmentFromExpression(memberExpression(identifier('spreadWrapper'), identifier('nested')), resolver),
    ).toMatchObject({
      text: expect.stringContaining('nested'),
      isStatic: true,
    });
    expect(
      segmentFromExpression(memberExpression(identifier('overrideWrapper'), identifier('nested')), resolver),
    ).toMatchObject({
      text: expect.stringContaining('nested'),
      isStatic: true,
    });
    expect(segmentFromExpression(optionalMember, resolver)).toMatchObject({
      text: '[override]',
      isStatic: true,
    });
    expect(segmentFromExpression(optionalNestedMember, resolver)).toMatchObject({
      text: expect.stringContaining('nested'),
      isStatic: true,
    });
    expect(segmentFromExpression(optionalCall, resolver)).toMatchObject({
      text: '$first',
      isStatic: false,
    });

    expect(normalizeQueryKey(positionalFactory, { defaultMode: 'exact' }, resolver)).toEqual({
      id: 'prefix|[middle]|[suffix]',
      display: '[prefix, [middle], [suffix]]',
      segments: ['prefix', '[middle]', '[suffix]'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });

    expect(normalizeQueryKey(optionsFactoryCall, { defaultMode: 'exact' }, resolver)).toEqual({
      id: 'object',
      display: '[object]',
      segments: ['object'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });
    expect(normalizeQueryKey(tupleFactoryCall, { defaultMode: 'exact' }, resolver)).toEqual({
      id: '[tuple]|[pair]|[tuple]',
      display: '[[tuple], [pair], [tuple]]',
      segments: ['[tuple]', '[pair]', '[tuple]'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });
    expect(normalizeQueryKey(identityWrapped, { defaultMode: 'exact' }, resolver)).toEqual({
      id: 'override',
      display: '[override]',
      segments: ['override'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });
    expect(normalizeQueryKey(nestedIdentityWrapped, { defaultMode: 'exact' }, resolver)).toEqual({
      id: '[spread].nested',
      display: '[spread].nested',
      segments: ['[spread].nested'],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    });

    expect(inferActionQueryKey('setQueryData', [directQueryKey])).toEqual(buildPassThroughActionKey('exact'));
    expect(inferActionQueryKey('invalidateQueries', [invalidateAction], resolver)).toEqual(
      buildPassThroughActionKey('exact'),
    );
    expect(inferActionQueryKey('invalidateQueries', [exactAction], resolver)).toMatchObject({
      segments: ['override'],
      matchMode: 'exact',
    });
    expect(inferActionQueryKey('removeQueries', [predicateAction], resolver)).toMatchObject({
      segments: ['exact', 'second'],
      matchMode: 'prefix',
      resolution: 'static',
    });
    expect(inferActionQueryKey('invalidateQueries', [wildcardAction], resolver)).toMatchObject({
      segments: ['wild'],
    });
    expect(inferActionQueryKey('invalidateQueries', [objectExpression([])], resolver)).toMatchObject({
      matchMode: 'all',
      source: 'wildcard',
    });

    expect(isOpaqueCollectionQueryKey(buildPassThroughActionKey('exact'))).toBe(true);
  });

  it('covers memo wrappers, freeze wrappers, and collection transform shortcuts', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'items') {
          return arrayExpression([stringLiteral('items')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(
      segmentFromExpression(
        callExpression(identifier('useMemo'), [arrowFunction(arrayExpression([stringLiteral('memo')]))]),
      ),
    ).toMatchObject({ text: '[memo]', isStatic: true });
    expect(
      segmentFromExpression(
        callExpression(identifier('useCallback'), [arrowFunction(arrayExpression([stringLiteral('callback')]))]),
      ),
    ).toMatchObject({ text: '[callback]', isStatic: true });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('Object'), identifier('freeze')), [
          objectExpression([objectProperty(identifier('a'), stringLiteral('1'))]),
        ]),
      ),
    ).toMatchObject({ text: '$Object.freeze({a: 1})', isStatic: false });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('items'), identifier('join')), [stringLiteral(',')]),
        resolver,
      ),
    ).toMatchObject({ text: '[items]' });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('items'), identifier('toSorted')), []),
        resolver,
      ),
    ).toMatchObject({
      text: '[items]',
    });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('items'), identifier('flatMap')), [
          arrowFunction(identifier('entry')),
        ]),
        resolver,
      ),
    ).toMatchObject({ text: '[items]' });
  });

  it('covers computed properties, object spread fallbacks, and function-return inference edges', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'arrayRef') {
          return arrayExpression([stringLiteral('array-ref')]);
        }
        if (node.type === 'Identifier' && node.name === 'factoryArray') {
          return arrayExpression([stringLiteral('factory-array')]);
        }
        if (node.type === 'Identifier' && node.name === 'factoryObject') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('factory-object')])),
            objectProperty(
              identifier('nested'),
              objectExpression([
                objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('factory-nested')])),
              ]),
            ),
            objectProperty(identifier('list'), arrayExpression([arrayExpression([stringLiteral('factory-list')])])),
          ]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'factoryArray') {
          return arrayExpression([stringLiteral('factory-array')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'factoryObject') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('factory-object')])),
            objectProperty(
              identifier('nested'),
              objectExpression([
                objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('factory-nested')])),
              ]),
            ),
            objectProperty(identifier('list'), arrayExpression([arrayExpression([stringLiteral('factory-list')])])),
          ]);
        }
        if (callee.type === 'Identifier' && callee.name === 'makeEmptyArray') {
          return arrayExpression([]);
        }
        if (callee.type === 'Identifier' && callee.name === 'makePositionalArray') {
          return arrayExpression([identifier('first'), identifier('second')]);
        }
        return undefined;
      }),
    };

    const computedMember = memberExpression(
      identifier('holder'),
      {
        type: 'BinaryExpression',
        operator: '+',
        left: stringLiteral('que'),
        right: stringLiteral('ryKey'),
      } as BinaryExpression,
      true,
    );

    const spreadObject = objectExpression([spreadElement(callExpression(identifier('factoryArray')))]);

    const invalidPropertyObject = objectExpression([
      {
        type: 'Property',
        kind: 'init',
        key: null as never,
        value: stringLiteral('missing'),
        method: false,
        shorthand: false,
        computed: true,
        optional: false,
      } as never,
    ]);

    const emptyStringFallback = callExpression(identifier('maybe'), [stringLiteral('')]);
    const emptyTemplateFallback = callExpression(identifier('maybe'), [templateLiteral('')]);
    const emptyObjectFallback = callExpression(identifier('maybe'), [objectExpression([])]);
    const emptyArrayFallback = callExpression(identifier('maybe'), [arrayExpression([])]);
    const nullFallback = callExpression(identifier('maybe'), [{ type: 'NullLiteral' } as never]);
    const undefinedFallback = callExpression(identifier('maybe'), [identifier('undefined')]);

    expect(segmentFromExpression(computedMember, resolver)).toMatchObject({
      text: '$holder.que + ryKey',
      isStatic: false,
    });
    const spreadObjectSegment = segmentFromExpression(spreadObject, resolver);
    expect(spreadObjectSegment.text).toContain('factory-array');
    expect(segmentFromExpression(invalidPropertyObject, resolver)).toMatchObject({
      text: '{[UNRESOLVED]: missing}',
      isStatic: false,
    });
    expect(segmentFromExpression(emptyStringFallback, resolver)).toMatchObject({ isStatic: false });
    expect(segmentFromExpression(emptyTemplateFallback, resolver)).toMatchObject({ isStatic: false });
    expect(segmentFromExpression(emptyObjectFallback, resolver)).toMatchObject({ text: '{}', isStatic: true });
    expect(segmentFromExpression(emptyArrayFallback, resolver)).toMatchObject({ text: '[]', isStatic: true });
    expect(segmentFromExpression(nullFallback, resolver)).toMatchObject({ isStatic: false });
    expect(segmentFromExpression(undefinedFallback, resolver)).toMatchObject({ isStatic: false });
    expect(inferHookQueryKey([arrowFunction(arrayExpression([stringLiteral('hook-return')]))], resolver)).toMatchObject(
      {
        segments: ['hook-return'],
      },
    );
    expect(
      normalizeQueryKey(
        callExpression(identifier('makePositionalArray'), [stringLiteral('left'), stringLiteral('right')]),
        { defaultMode: 'exact' },
        resolver,
      ),
    ).toMatchObject({
      segments: ['left', 'right'],
    });
    expect(
      normalizeQueryKey(callExpression(identifier('factoryObject')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['factory-object'],
    });
    expect(
      normalizeQueryKey(callExpression(identifier('factoryArray')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['factory-array'],
    });
    expect(
      normalizeQueryKey(callExpression(identifier('makeEmptyArray')), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: [],
    });
  });

  it('covers computed keys, bigint and private names, and call hint substitutions', () => {
    const complexSource = `
      const identity = (value) => value;
      const makeComplex = (
        source,
        prop,
        fn,
        arg,
        name,
        count,
        left,
        right,
        flag,
        fallback,
        cond,
        yes,
        no,
        first,
        second,
        rest,
      ) => [
        source[prop],
        source?.[prop],
        fn(arg),
        \`hello \${name}\`,
        -count,
        left + right,
        flag && fallback,
        cond ? yes : no,
        (first, second),
        ...rest,
      ];
      const complexCall = makeComplex(
        { key: ['source'] as const },
        'key',
        identity,
        'arg',
        'name',
        1,
        'left',
        'right',
        true,
        'fallback',
        false,
        'yes',
        'no',
        'first',
        'second',
        ['tail'] as const,
      );
      const passThrough = queryKeys(['direct'] as const);
      const createKeyCall = createQueryKey('left', 'right');
    `;
    const makeComplex = expressionFromSource(complexSource, 'makeComplex');
    const complexCall = expressionFromSource(complexSource, 'complexCall');
    const identityFn = expressionFromSource(complexSource, 'identity');
    const passThrough = expressionFromSource(complexSource, 'passThrough');
    const createKeyCall = expressionFromSource(complexSource, 'createKeyCall');

    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'makeComplex') {
          return makeComplex;
        }
        if (node.type === 'Identifier' && node.name === 'identity') {
          return identityFn;
        }
        if (node.type === 'Identifier' && node.name === 'queryKeys') {
          return identifier('queryKeys');
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([identifier('first'), identifier('second')]);
        }
        if (callee.type === 'Identifier' && callee.name === 'queryKeys') {
          return identifier('queryKeys');
        }
        return undefined;
      }),
    };

    expect(normalizeQueryKey(complexCall, { defaultMode: 'exact' }, resolver)).toMatchObject({
      matchMode: 'exact',
      resolution: 'dynamic',
    });
    expect(segmentFromExpression(passThrough, resolver)).toMatchObject({ text: '[direct]', isStatic: true });
    expect(normalizeQueryKey(createKeyCall, { defaultMode: 'exact' }, resolver).segments).toEqual(['left', 'right']);

    const complexObject = segmentFromExpression(
      objectExpression([
        objectProperty(stringLiteral('quoted'), stringLiteral('value')),
        objectProperty(numericLiteral(7), stringLiteral('number')),
        objectProperty({ type: 'PrivateName', id: identifier('secret') }, stringLiteral('hidden')),
        objectProperty(
          {
            type: 'BinaryExpression',
            operator: '+',
            left: stringLiteral('a'),
            right: stringLiteral('b'),
          } as BinaryExpression,
          stringLiteral('computed'),
          true,
        ),
        objectProperty({ type: 'BigIntLiteral', value: '10' } as never, stringLiteral('big'), true),
      ]),
      resolver,
    );

    expect(complexObject.text).toContain('quoted: value');
    expect(complexObject.text).toContain('7: number');
    expect(complexObject.text).toContain('#secret: hidden');
    expect(complexObject.text).toContain('[10]: big');
  });

  it('covers malformed and fallback AST query-key shapes', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn(() => undefined),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(segmentFromExpression({ type: 'NullLiteral', value: null } as never)).toEqual({
      text: 'null',
      isStatic: true,
    });
    expect(
      segmentFromExpression(
        objectExpression([
          spreadElement(identifier('dynamicObject')),
          {
            type: 'ObjectMethod',
            kind: 'method',
            key: identifier('method'),
            body: { type: 'BlockStatement', body: [] },
            params: [],
            generator: false,
            async: false,
            computed: false,
            optional: false,
          } as never,
        ]),
        resolver,
      ),
    ).toMatchObject({ text: '{...$dynamicObject, [method]}', isStatic: false });
    expect(
      segmentFromExpression(objectExpression([spreadElement(callExpression(identifier('makeSpread')))]), resolver),
    ).toMatchObject({ text: '{...call(makeSpread)}', isStatic: false });

    expect(
      segmentFromExpression(
        callExpression(identifier('fn'), [spreadElement(identifier('items')), { type: 'Super' } as never]),
        resolver,
      ),
    ).toMatchObject({ text: 'call(fn)', isStatic: false });
    expect(
      segmentFromExpression(callExpression(identifier('fn'), [spreadElement({ type: 'Super' } as never)]), resolver),
    ).toMatchObject({ text: 'call(fn)', isStatic: false });

    expect(
      segmentFromExpression(
        memberExpression(identifier('collection'), { type: 'PrivateName', id: identifier('secret') }, true),
        resolver,
      ),
    ).toMatchObject({ text: '$collection.?', isStatic: false });

    expect(
      normalizeQueryKey(arrayExpression([null, spreadElement(identifier('rest'))]), { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['UNRESOLVED', '$rest'],
      resolution: 'dynamic',
    });
    expect(
      normalizeQueryKey({ type: 'NullLiteral', value: null } as never, { defaultMode: 'exact' }, resolver),
    ).toMatchObject({
      segments: ['null'],
      source: 'literal',
    });

    expect(
      normalizeQueryKey(
        {
          type: 'ConditionalExpression',
          test: identifier('enabled'),
          consequent: arrayExpression([]),
          alternate: { type: 'NullLiteral', value: null } as never,
        } as Expression,
        { defaultMode: 'prefix' },
        resolver,
      ),
    ).toMatchObject({
      matchMode: 'prefix',
      source: 'expression',
    });
  });

  it('applies object argument hints to resolved call results', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'spreadArgs') {
          return objectExpression([objectProperty(identifier('suffix'), stringLiteral('spread'))]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'makeObjectKey') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([identifier('prefix'), identifier('suffix')])),
          ]);
        }
        return undefined;
      }),
    };
    expect(
      normalizeQueryKey(
        callExpression(identifier('makeObjectKey'), [
          objectExpression([
            objectProperty(identifier('prefix'), stringLiteral('object')),
            spreadElement(identifier('spreadArgs')),
          ]),
        ]),
        { defaultMode: 'exact' },
        resolver,
      ),
    ).toMatchObject({
      segments: ['object', 'spread'],
      source: 'literal',
    });
  });

  it('covers defensive substitution and argument-normalization branches', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'defensiveFactory') {
          return {
            type: 'ArrowFunctionExpression',
            params: [
              { type: 'TSParameterProperty', parameter: identifier('wrapped') } as never,
              {
                type: 'TSParameterProperty',
                parameter: {
                  type: 'AssignmentPattern',
                  left: identifier('fallback'),
                  right: stringLiteral('default'),
                },
              } as never,
              {
                type: 'AssignmentPattern',
                left: identifier('assigned'),
                right: stringLiteral('assigned-default'),
              } as never,
              { type: 'RestElement', argument: identifier('ignored') } as never,
            ],
            body: arrayExpression([
              null,
              spreadElement({ type: 'Super' } as never),
              spreadElement(identifier('wrapped')),
              objectExpression([
                spreadElement({ type: 'Super' } as never),
                spreadElement(identifier('wrapped')),
                {
                  type: 'Property',
                  kind: 'init',
                  key: identifier('methodLike'),
                  value: { type: 'Super' },
                  method: false,
                  shorthand: false,
                  computed: false,
                  optional: false,
                } as never,
                objectProperty(identifier('same'), identifier('wrapped')),
              ]),
              callExpression(identifier('invoke'), [spreadElement(identifier('wrapped')), { type: 'Super' } as never]),
              {
                type: 'TemplateLiteral',
                quasis: [
                  { type: 'TemplateElement', value: { raw: 'x', cooked: 'x' }, tail: false },
                  { type: 'TemplateElement', value: { raw: 'y', cooked: 'y' }, tail: true },
                ],
                expressions: [identifier('wrapped')],
              } as TemplateLiteral,
              {
                type: 'UnaryExpression',
                operator: '!',
                prefix: true,
                argument: identifier('wrapped'),
              } as never,
              {
                type: 'BinaryExpression',
                operator: '+',
                left: identifier('wrapped'),
                right: identifier('fallback'),
              } as BinaryExpression,
              {
                type: 'ConditionalExpression',
                test: identifier('assigned'),
                consequent: identifier('wrapped'),
                alternate: identifier('fallback'),
              } as Expression,
              {
                type: 'SequenceExpression',
                expressions: [identifier('fallback'), identifier('wrapped')],
              } as Expression,
              {
                type: 'ParenthesizedExpression',
                expression: identifier('wrapped'),
              } as Expression,
            ]),
            generator: false,
            async: false,
            expression: true,
          };
        }

        if (node.type === 'Identifier' && node.name === 'spreadRest') {
          return arrayExpression([]);
        }

        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(
      normalizeQueryKey(
        callExpression(identifier('defensiveFactory'), [
          arrayExpression([stringLiteral('replacement')]),
          stringLiteral('fallback-value'),
          stringLiteral('assigned-value'),
          spreadElement(identifier('spreadRest')),
        ]),
        { defaultMode: 'exact' },
        resolver,
      ),
    ).toMatchObject({
      matchMode: 'exact',
      resolution: 'dynamic',
    });

    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('invoke'), { type: 'Super' } as never, true), [
          { type: 'Super' } as never,
          spreadElement({ type: 'Super' } as never),
        ]),
        resolver,
      ),
    ).toMatchObject({
      text: '$invoke[expr](UNRESOLVED, ...UNRESOLVED)',
      isStatic: false,
    });

    expect(segmentFromExpression(identifier('never'), resolver, 25)).toEqual({ text: 'expr', isStatic: false });
    expect(resolveQueryKeyExpression(identifier('never'), resolver, 25)).toBeUndefined();
    expect(normalizeQueryKey(undefined, { defaultMode: 'exact' }, resolver)).toMatchObject({
      matchMode: 'exact',
      source: 'expression',
    });
  });

  it('covers remaining public query-key branch probes', () => {
    const refCall = callExpression(identifier('ref'), [arrayExpression([stringLiteral('ref-probe')])]);
    const useStateCall = callExpression(identifier('useState'), [arrayExpression([stringLiteral('state-probe')])]);
    const stateMember = memberExpression(useStateCall, numericLiteral(0), true);
    const objectWithStringKey = objectExpression([
      objectProperty(stringLiteral('queryKey'), arrayExpression([stringLiteral('string-key')])),
      objectProperty(identifier('exact'), stringLiteral('not-boolean')),
    ]);
    const queryCacheLookup = callExpression(memberExpression(identifier('queryCache'), identifier('get')), [
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('cache-probe')]))]),
    ]);
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'stateAlias') {
          return useStateCall;
        }
        if (node.type === 'Identifier' && node.name === 'stateMemberAlias') {
          return stateMember;
        }
        if (node.type === 'Identifier' && node.name === 'refObject') {
          return refCall;
        }
        if (node.type === 'MemberExpression') {
          return arrayExpression([stringLiteral('member-resolved')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([identifier('first'), identifier('second'), identifier('third')]);
        }
        return undefined;
      }),
    };

    expect(
      segmentFromExpression(
        {
          type: 'LogicalExpression',
          operator: '||',
          left: identifier('maybe'),
          right: { type: 'NullLiteral', value: null },
        } as never,
        resolver,
      ),
    ).toEqual({
      text: '$maybe',
      isStatic: false,
    });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('api'), identifier('run')), [
          { type: 'Super' } as never,
          spreadElement({ type: 'Super' } as never),
        ]),
      ),
    ).toMatchObject({ text: '$api.run(UNRESOLVED, ...UNRESOLVED)', isStatic: false });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('api'), { type: 'PrivateName', id: identifier('x') }, true)),
      ),
    ).toMatchObject({ text: '$api[?]()', isStatic: false });
    expect(segmentFromExpression(identifier('stateAlias'), resolver)).toMatchObject({
      text: '[state-probe]',
      isStatic: true,
    });
    expect(segmentFromExpression(identifier('stateMemberAlias'), resolver)).toMatchObject({
      text: '[state-probe]',
      isStatic: true,
    });
    expect(
      segmentFromExpression(
        {
          type: 'OptionalMemberExpression',
          object: refCall,
          property: identifier('value'),
          computed: false,
          optional: true,
        } as never,
        resolver,
      ),
    ).toMatchObject({ text: '[ref-probe]?.value', isStatic: true });
    expect(segmentFromExpression(memberExpression(refCall, identifier('value')))).toMatchObject({
      text: '[ref-probe].value',
      isStatic: true,
    });
    expect(
      segmentFromExpression(callExpression(identifier('queryOptions'), [objectWithStringKey]), resolver),
    ).toMatchObject({ text: '[string-key]', isStatic: true });
    expect(readBooleanProperty(objectWithStringKey, 'exact')).toBeUndefined();
    expect(findObjectPropertyValue(objectWithStringKey, 'queryKey', resolver)).toEqual(
      arrayExpression([stringLiteral('string-key')]),
    );
    expect(inferHookQueryKey([], resolver)).toMatchObject({ matchMode: 'unknown' });
    expect(inferHookQueryKey([spreadElement(identifier('bad'))], resolver)).toMatchObject({ matchMode: 'unknown' });
    expect(inferHookQueryKey([objectWithStringKey], resolver)).toMatchObject({ segments: ['string-key'] });
    expect(inferHookQueryKeys('useQueries', [spreadElement(identifier('bad'))], resolver)).toEqual([
      expect.objectContaining({ matchMode: 'unknown' }),
    ]);
    expect(inferHookQueryKeys('useQueries', [arrayExpression([])], resolver)).toEqual([
      expect.objectContaining({ matchMode: 'exact' }),
    ]);
    expect(isHookCallDirectQueryKeyDeclaration([spreadElement(identifier('bad'))], 'useQueries')).toBe(false);
    expect(isHookCallDirectQueryKeyDeclaration([arrayExpression([objectWithStringKey])], 'useMutation')).toBe(true);
    expect(isOpaqueCollectionQueryKey({ ...buildPassThroughActionKey('exact'), segments: ['call(fetch)'] })).toBe(true);
    expect(isOpaqueCollectionQueryKey({ ...buildPassThroughActionKey('exact'), source: 'wildcard' })).toBe(false);
    expect(inferActionQueryKey('invalidateQueries', [identifier('queryKey')], resolver)).toEqual(
      buildPassThroughActionKey('prefix'),
    );
    expect(inferActionQueryKey('invalidateQueries', [queryCacheLookup], resolver)).toMatchObject({
      segments: ['cache-probe'],
      matchMode: 'prefix',
    });
    expect(
      normalizeQueryKey(callExpression(identifier('createQueryKey'), [stringLiteral('only')]), {}, resolver),
    ).toMatchObject({ matchMode: 'prefix', segments: ['only', '$second', '$third'] });
    expect(findObjectPropertyValue(objectWithStringKey, 'queryKey', resolver, 25)).toBeUndefined();
  });

  it('covers additional unresolved object, wrapper, and member branches', () => {
    const spreadResolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'spreadText') {
          return stringLiteral('spread-value');
        }
        if (node.type === 'Identifier' && node.name === 'emptySpread') {
          return objectExpression([]);
        }
        if (node.type === 'Identifier' && node.name === 'queryOptionsRef') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('ref-options')])),
          ]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(segmentFromExpression(objectExpression([spreadElement(identifier('spreadText'))]), spreadResolver)).toEqual({
      text: '{...spread-value}',
      isStatic: false,
    });
    expect(segmentFromExpression(objectExpression([spreadElement(identifier('emptySpread'))]), spreadResolver)).toEqual(
      {
        text: '{}',
        isStatic: true,
      },
    );
    expect(
      segmentFromExpression(
        objectExpression([
          spreadElement(objectExpression([objectProperty(identifier('x'), callExpression(identifier('fn')))])),
        ]),
      ),
    ).toEqual({
      text: '{x: call(fn)}',
      isStatic: false,
    });
    expect(
      segmentFromExpression(objectExpression([objectProperty(identifier('bad'), nonExpression())]), spreadResolver),
    ).toEqual({
      text: '{bad: UNRESOLVED}',
      isStatic: false,
    });
    expect(
      segmentFromExpression({
        type: 'LogicalExpression',
        operator: '??',
        left: identifier('maybe'),
        right: {
          type: 'TemplateLiteral',
          quasis: [{ type: 'TemplateElement', value: { raw: '', cooked: null }, tail: true }],
          expressions: [],
        },
      } as never),
    ).toEqual({ text: '$maybe', isStatic: false });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          callExpression(identifier('queryOptions'), [
            objectExpression([
              objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('wrapped-action')])),
            ]),
          ]),
        ],
        spreadResolver,
      ),
    ).toMatchObject({ segments: ['wrapped-action'], matchMode: 'prefix' });
    expect(
      resolveQueryKeyExpression(
        memberExpression(identifier('target'), { type: 'PrivateName', id: identifier('x') }, true),
        undefined,
      ),
    ).toEqual(memberExpression(identifier('target'), { type: 'PrivateName', id: identifier('x') }, true));
    expect(
      resolveQueryKeyExpression(
        memberExpression(
          objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('inline-member')]))]),
          identifier('queryKey'),
        ),
        undefined,
      ),
    ).toEqual(arrayExpression([stringLiteral('inline-member')]));
    expect(resolveQueryKeyExpression(identifier('queryOptionsRef'), spreadResolver)).toEqual(
      arrayExpression([stringLiteral('ref-options')]),
    );
  });

  it('directly covers query-key internal defensive helpers', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'spreadObject') {
          return objectExpression([objectProperty(identifier('nested'), stringLiteral('value'))]);
        }
        if (node.type === 'Identifier' && node.name === 'spreadArray') {
          return arrayExpression([]);
        }
        if (node.type === 'Identifier' && node.name === 'mapper') {
          return arrowFunction(
            objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('mapped')]))]),
          );
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    const internals = __queryKeyTestInternals;
    expect(internals.segmentTextOrUnresolved({ text: '', isStatic: true })).toBe('UNRESOLVED');
    expect(internals.segmentTextOrUnresolved({ text: 'value', isStatic: true })).toBe('value');
    expect(internals.isDisplayableResolvedSegment({ text: 'expr', isStatic: false })).toBe(false);
    expect(internals.isDisplayableResolvedSegment({ text: 'value', isStatic: true })).toBe(true);
    expect(internals.callArgumentsSegment([spreadElement(nonExpression()), nonExpression()], resolver, 0)).toEqual({
      text: '...UNRESOLVED, UNRESOLVED',
      isStatic: false,
    });
    expect(internals.simplifyCollectionMethodCallSegment({ text: 'items', isStatic: true }, undefined)).toBeUndefined();
    expect(internals.isEmptyFallbackExpression({ type: 'NullLiteral', value: null } as never)).toBe(true);

    const substitutions = new Map<string, Expression>();
    internals.collectObjectArgumentSubstitutions(objectExpression([null as never]), resolver, 25, substitutions);
    internals.collectObjectArgumentSubstitutions(
      objectExpression([
        null as never,
        objectProperty({ type: 'PrivateName', id: identifier('secret') }, stringLiteral('private')),
        objectProperty(identifier('bad'), { type: 'Super' } as never),
        spreadElement(stringLiteral('not-object')),
        spreadElement(identifier('spreadObject')),
      ]),
      resolver,
      0,
      substitutions,
    );
    expect([...substitutions.keys()]).toContain('nested');
    expect(
      internals.applyObjectArgumentIdentifierHints(identifier('untouched'), objectExpression([]), resolver, 0),
    ).toEqual(identifier('untouched'));
    expect(
      internals.substituteIdentifierInExpression(
        objectExpression([
          {
            ...objectProperty(identifier('token'), identifier('token')),
            shorthand: true,
          },
          {
            type: 'ObjectMethod',
            method: true,
            key: identifier('m'),
            params: [],
            body: { type: 'BlockStatement', body: [] },
          } as never,
        ]),
        'token',
        identifier('replacement'),
      ),
    ).toBeDefined();

    expect(
      internals.resolveObjectPropertyExpression(objectExpression([null as never]), 'x', resolver, 0),
    ).toBeUndefined();
    expect(internals.resolveObjectPropertyExpression(objectExpression([]), 'x', resolver, 25)).toBeUndefined();
    expect(
      internals.resolveObjectPropertyExpression(
        objectExpression([spreadElement(nonExpression()), objectProperty(identifier('x'), stringLiteral('direct'))]),
        'missing',
        resolver,
        0,
      ),
    ).toBeUndefined();
    expect(
      internals.resolveObjectPropertyExpression(
        objectExpression([spreadElement(stringLiteral('not-object')), spreadElement(identifier('spreadObject'))]),
        'nested',
        resolver,
        0,
      ),
    ).toEqual(stringLiteral('value'));

    expect(
      internals.functionParameterNames([
        { parameter: identifier('wrapped') },
        {
          parameter: {
            type: 'AssignmentPattern',
            left: identifier('wrappedAssigned'),
            right: stringLiteral('fallback'),
          },
        },
        {
          parameter: {
            type: 'AssignmentPattern',
            left: { type: 'ObjectPattern', properties: [] },
            right: stringLiteral('fallback'),
          },
        },
        {
          type: 'AssignmentPattern',
          left: identifier('assigned'),
          right: stringLiteral('fallback'),
        },
        { type: 'RestElement', argument: identifier('rest') } as never,
      ]),
    ).toEqual(['wrapped', 'wrappedAssigned', 'assigned']);

    const fn = {
      type: 'ArrowFunctionExpression',
      params: [identifier('used'), identifier('unused')],
      body: arrayExpression([identifier('used')]),
      generator: false,
      async: false,
      expression: true,
    } as ArrowFunctionExpression;
    expect(
      internals.applyFunctionArgumentHints(
        callExpression(identifier('fn'), [spreadElement(identifier('skip'))]),
        fn,
        fn.body,
        resolver,
        0,
      ),
    ).toEqual(fn.body);
    expect(
      internals.applyFunctionArgumentHints(
        callExpression(identifier('fn'), [stringLiteral('hit')]),
        fn,
        fn.body,
        resolver,
        0,
      ),
    ).toEqual(arrayExpression([stringLiteral('hit')]));
    expect(
      internals.applyFunctionArgumentHints(
        callExpression(identifier('fn'), [stringLiteral('hit'), stringLiteral('ignored')]),
        fn,
        fn.body,
        resolver,
        0,
      ),
    ).toEqual(arrayExpression([stringLiteral('hit')]));

    expect(
      internals.applyPositionalArgumentHints(callExpression(identifier('x')), stringLiteral('not-array'), resolver, 0),
    ).toEqual(stringLiteral('not-array'));
    expect(
      internals.applyPositionalArgumentHints(
        callExpression(identifier('x'), [stringLiteral('arg')]),
        arrayExpression([stringLiteral('static')]),
        resolver,
        0,
      ),
    ).toEqual(arrayExpression([stringLiteral('static')]));
    expect(
      internals.applyPositionalArgumentHints(
        callExpression(identifier('x')),
        arrayExpression([identifier('missing')]),
        resolver,
        0,
      ),
    ).toEqual(arrayExpression([identifier('missing')]));
    expect(
      internals.applyPositionalArgumentHints(
        callExpression(identifier('x'), [stringLiteral('arg')]),
        arrayExpression([identifier('staticPlaceholder')]),
        {
          resolveReference: vi.fn((node) =>
            node.type === 'Identifier' && node.name === 'staticPlaceholder' ? stringLiteral('static') : undefined,
          ),
          resolveCallResult: vi.fn(() => undefined),
        },
        0,
      ),
    ).toEqual(arrayExpression([identifier('staticPlaceholder')]));

    expect(internals.resolveActionOptionsObject(identifier('x'), resolver, 25)).toBeUndefined();
    expect(
      internals.resolveActionOptionsObject(
        callExpression(identifier('queryOptions'), [
          objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('wrapped')]))]),
        ]),
        resolver,
        0,
      ),
    ).toEqual(objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('wrapped')]))]));

    expect(internals.segmentsFromArrayElement(spreadElement(nonExpression()), resolver, 0)).toEqual([
      { text: 'UNRESOLVED', isStatic: false },
    ]);
    expect(internals.segmentsFromArrayElement(spreadElement(identifier('spreadArray')), resolver, 0)).toEqual([
      { text: 'UNRESOLVED', isStatic: false },
    ]);

    expect(internals.collectQueryKeyExpressionsFromQueryOptionEntry(identifier('x'), resolver, 25)).toEqual([]);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryOptionEntry(
          {
            type: 'ConditionalExpression',
            test: identifier('ok'),
            consequent: objectExpression([
              objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('yes')])),
            ]),
            alternate: objectExpression([
              objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('no')])),
            ]),
          } as never,
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[yes]', '[no]']);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryOptionEntry(
          {
            type: 'LogicalExpression',
            operator: '&&',
            left: identifier('ok'),
            right: objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('and')]))]),
          } as never,
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[and]']);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryOptionEntry(
          callExpression(
            memberExpression(
              arrayExpression([
                objectExpression([
                  objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('from-call')])),
                ]),
              ]),
              identifier('filter'),
            ),
            [],
          ),
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[from-call]']);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryOptionEntry(
          {
            type: 'LogicalExpression',
            operator: '||',
            left: objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('left')]))]),
            right: objectExpression([
              objectProperty(
                identifier('queries'),
                arrayExpression([
                  objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('right')]))]),
                ]),
              ),
            ]),
          } as never,
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[left]', '[right]']);

    expect(internals.collectQueryKeyExpressionsFromQueriesCollection(identifier('x'), resolver, 25)).toEqual([]);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueriesCollection(
          {
            type: 'LogicalExpression',
            operator: '&&',
            left: identifier('ok'),
            right: arrayExpression([
              objectExpression([
                objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('logical-and')])),
              ]),
            ]),
          } as never,
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[logical-and]']);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueriesCollection(
          {
            type: 'LogicalExpression',
            operator: '||',
            left: arrayExpression([
              objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('left-list')]))]),
            ]),
            right: arrayExpression([
              objectExpression([
                objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('right-list')])),
              ]),
            ]),
          } as never,
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[left-list]', '[right-list]']);
    expect(
      internals.collectQueryKeyExpressionsFromQueriesCollection(
        arrayExpression([spreadElement({ type: 'Super' } as never), { type: 'Super' } as never]),
        resolver,
        0,
      ),
    ).toEqual([]);

    expect(internals.resolveCollectionMapperResult(identifier('x'), resolver, 25)).toBeUndefined();
    expect(internals.resolveCollectionMapperResult(stringLiteral('x'), resolver, 0)).toBeUndefined();
    expect(internals.resolveCollectionMapperResult(identifier('missingMapper'), resolver, 0)).toBeUndefined();
    expect(internals.resolveCollectionMapperResult(identifier('mapper'), resolver, 0)).toEqual(
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('mapped')]))]),
    );
    expect(
      internals.resolveCollectionMapperResult(
        identifier('nonFunctionMapper'),
        {
          resolveReference: vi.fn((node) =>
            node.type === 'Identifier' && node.name === 'nonFunctionMapper' ? objectExpression([]) : undefined,
          ),
          resolveCallResult: vi.fn(() => undefined),
        },
        0,
      ),
    ).toEqual(objectExpression([]));

    expect(
      internals.collectQueryKeyExpressionsFromQueryCollectionCall(callExpression(identifier('notMember')), resolver, 0),
    ).toEqual([]);
    expect(
      internals.collectQueryKeyExpressionsFromQueryCollectionCall(
        callExpression(memberExpression(arrayExpression([]), identifier('map')), []),
        resolver,
        25,
      ),
    ).toEqual([]);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryCollectionCall(
          callExpression(
            memberExpression(
              arrayExpression([
                objectExpression([
                  objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('concat-source')])),
                ]),
              ]),
              identifier('concat'),
            ),
            [
              arrayExpression([
                objectExpression([
                  objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('concat-arg')])),
                ]),
              ]),
              spreadElement(identifier('skip')),
              nonExpression(),
            ],
          ),
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[concat-source]', '[concat-arg]']);
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryCollectionCall(
          callExpression(
            memberExpression(
              arrayExpression([
                objectExpression([
                  objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('pass-source')])),
                ]),
              ]),
              identifier('filter'),
            ),
            [],
          ),
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[pass-source]']);
    expect(
      internals.collectQueryKeyExpressionsFromQueryCollectionCall(
        callExpression(memberExpression(identifier('items'), identifier('map'), true), [identifier('mapper')]),
        resolver,
        0,
      ),
    ).toEqual([]);

    expect(internals.isInlineQueryKeyObject(objectExpression([]), 25)).toBe(false);
    expect(internals.isInlineQueryKeyCollection(arrayExpression([]), 25)).toBe(false);
    expect(
      internals.isInlineQueryKeyObject(
        objectExpression([
          objectProperty(
            identifier('queries'),
            arrayExpression([
              objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('inline')]))]),
            ]),
          ),
        ]),
        0,
      ),
    ).toBe(true);

    expect(internals.queryKeyIndexFromAccessExpression(identifier('x'), resolver, 0)).toBeUndefined();
    expect(
      internals.queryKeyIndexFromAccessExpression(
        memberExpression(identifier('entry'), stringLiteral('0'), true),
        resolver,
        0,
      ),
    ).toBeUndefined();
    expect(
      internals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), stringLiteral('0'), true),
        resolver,
        25,
      ),
    ).toBeUndefined();
    expect(
      internals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('other')), stringLiteral('0'), true),
        resolver,
        0,
      ),
    ).toBeUndefined();
    expect(
      internals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), stringLiteral('-1'), true),
        resolver,
        0,
      ),
    ).toBeUndefined();
    expect(
      internals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), stringLiteral('1'), true),
        resolver,
        0,
      ),
    ).toBe(1);
    expect(
      internals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), identifier('idx'), true),
        {
          resolveReference: vi.fn((node) =>
            node.type === 'Identifier' && node.name === 'idx' ? stringLiteral('2') : undefined,
          ),
          resolveCallResult: vi.fn(() => undefined),
        },
        0,
      ),
    ).toBe(2);

    const constraints = new Map<number, SegmentResult>();
    internals.setPredicateQueryKeyConstraint(constraints, 0, { text: 'UNRESOLVED', isStatic: false });
    internals.setPredicateQueryKeyConstraint(constraints, 0, { text: 'same', isStatic: true });
    internals.setPredicateQueryKeyConstraint(constraints, 0, { text: 'same', isStatic: false });
    expect(constraints.get(0)).toEqual({ text: 'same', isStatic: false });
    constraints.set(1, { text: 'UNRESOLVED', isStatic: false });
    internals.setPredicateQueryKeyConstraint(constraints, 1, { text: 'resolved', isStatic: true });
    expect(constraints.get(1)).toEqual({ text: 'resolved', isStatic: true });
    internals.collectPredicateQueryKeyConstraints(identifier('x'), resolver, 25, constraints);

    expect(
      internals.inferActionQueryKeyFromPredicate(
        arrowFunction({ type: 'BlockStatement', body: [] } as never),
        resolver,
      ),
    ).toBeUndefined();
    expect(internals.normalizeActionKeyOrWildcard(identifier('queryKey'), { defaultMode: 'prefix' }, resolver)).toEqual(
      buildPassThroughActionKey('prefix'),
    );
    expect(
      internals.shouldTreatAsWildcardActionKey(
        normalizeQueryKey(arrayExpression([]), { defaultMode: 'exact' }, resolver),
      ),
    ).toBe(true);
    expect(
      internals.shouldTreatAsWildcardActionKey({
        id: 'unresolved_query_key',
        display: 'UNRESOLVED_QUERY_KEY',
        segments: ['x'],
        matchMode: 'unknown',
        resolution: 'dynamic',
        source: 'expression',
      }),
    ).toBe(true);
    expect(internals.isPassThroughQueryKeyReference(undefined)).toBe(false);
    expect(
      internals.isQueryCacheLookupCall(
        callExpression(memberExpression(identifier('queryCache'), identifier('find')), []),
        resolver,
        25,
      ),
    ).toBe(false);
    expect(
      internals.isQueryCacheLookupCall(
        callExpression(memberExpression(identifier('queryCache'), identifier('set')), []),
        resolver,
        0,
      ),
    ).toBe(false);
    expect(
      internals.isQueryCacheLookupCall(
        callExpression(
          memberExpression(memberExpression(identifier('client'), identifier('getQueryCache')), identifier('get')),
          [],
        ),
        resolver,
        0,
      ),
    ).toBe(true);
    expect(internals.isPassThroughQueryInstanceReference(identifier('x'), resolver, 25)).toBe(false);
    expect(
      internals.isPassThroughQueryInstanceReference(
        identifier('lookup'),
        {
          resolveReference: vi.fn((node) =>
            node.type === 'Identifier' && node.name === 'lookup'
              ? callExpression(memberExpression(identifier('queryCache'), identifier('find')), [])
              : undefined,
          ),
          resolveCallResult: vi.fn(() => undefined),
        },
        0,
      ),
    ).toBe(true);
    expect(
      internals.normalizeActionKeyOrWildcard(arrayExpression([]), { defaultMode: 'prefix' }, resolver),
    ).toMatchObject({
      source: 'wildcard',
      matchMode: 'all',
    });
    expect(normalizeQueryKey(undefined)).toMatchObject({ matchMode: 'unknown', source: 'expression' });
    expect(
      normalizeQueryKey(
        callExpression(identifier('createQueryKey'), [nonExpression(), stringLiteral('two')]),
        { defaultMode: 'exact' },
        resolver,
      ),
    ).toMatchObject({
      segments: ['UNRESOLVED', 'two', 'UNRESOLVED'],
      matchMode: 'exact',
    });
    expect(
      inferHookQueryKey(
        [objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('hook-object')]))])],
        resolver,
      ),
    ).toMatchObject({
      segments: ['hook-object'],
    });
    expect(
      internals
        .collectQueryKeyExpressionsFromQueryOptionEntry(
          objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('option-entry')]))]),
          resolver,
          0,
        )
        .map((entry) => segmentFromExpression(entry, resolver).text),
    ).toEqual(['[option-entry]']);
    expect(
      inferHookQueryKeys(
        'useQueries',
        [arrayExpression([objectExpression([objectProperty(identifier('queryKey'), identifier('queryKey'))])])],
        resolver,
      ),
    ).toEqual([expect.objectContaining({ id: 'UNRESOLVED', segments: ['UNRESOLVED'], matchMode: 'exact' })]);
    expect(
      isHookCallDirectQueryKeyDeclaration(
        [objectExpression([objectProperty(identifier('queries'), arrayExpression([]))])],
        'useQueries',
      ),
    ).toBe(false);
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('action-object')])),
            objectProperty(identifier('exact'), booleanLiteral(true)),
          ]),
        ],
        resolver,
      ),
    ).toMatchObject({ segments: ['action-object'], matchMode: 'exact' });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          objectExpression([
            objectProperty(identifier('exact'), booleanLiteral(true)),
            objectProperty(
              identifier('predicate'),
              arrowFunction({
                type: 'BinaryExpression',
                operator: '===',
                left: memberExpression(
                  memberExpression(identifier('entry'), identifier('queryKey')),
                  numericLiteral(0),
                  true,
                ),
                right: stringLiteral('action-predicate'),
              } as never),
            ),
          ]),
        ],
        resolver,
      ),
    ).toMatchObject({ segments: ['action-predicate'], matchMode: 'exact' });
    expect(
      internals.collectQueryKeyExpressionsFromQueryCollectionCall(
        {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            object: { type: 'Super' },
            property: identifier('map'),
            computed: false,
          },
          arguments: [],
        } as never,
        resolver,
        0,
      ),
    ).toEqual([]);
    expect(
      internals.collectQueryKeyExpressionsFromQueryCollectionCall(
        {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            object: { type: 'Super' },
            property: identifier('flatMap'),
            computed: false,
          },
          arguments: [],
        } as never,
        resolver,
        0,
      ),
    ).toEqual([]);
  });

  it('covers remaining call-expression display branches', () => {
    const fn = arrowFunction(arrayExpression([stringLiteral('from-resolved-callee')]));
    const nonFunctionValue = arrayExpression([stringLiteral('from-value-callee')]);
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'fnRef') {
          return fn;
        }
        if (node.type === 'Identifier' && node.name === 'valueRef') {
          return nonFunctionValue;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(
      segmentFromExpression(
        callExpression(identifier('queryOptions'), [
          objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('segment-options')])),
          ]),
        ]),
        resolver,
      ),
    ).toMatchObject({ text: '[segment-options]', isStatic: true });
    expect(segmentFromExpression(callExpression(identifier('fnRef')), resolver)).toMatchObject({
      text: 'from-resolved-callee',
      isStatic: true,
    });
    expect(segmentFromExpression(callExpression(identifier('valueRef')), resolver)).toMatchObject({
      text: '[from-value-callee]',
      isStatic: true,
    });
    expect(
      segmentFromExpression({
        type: 'OptionalCallExpression',
        callee: memberExpression(identifier('api'), identifier('run')),
        arguments: [stringLiteral('x')],
        optional: true,
      } as never),
    ).toMatchObject({ text: '$api.run(x)', isStatic: false });
    expect(
      segmentFromExpression({
        type: 'OptionalCallExpression',
        callee: memberExpression(identifier('items'), identifier('slice')),
        arguments: [],
        optional: true,
      } as never),
    ).toMatchObject({ text: '$items', isStatic: false });
    expect(
      segmentFromExpression({
        type: 'OptionalCallExpression',
        callee: {
          type: 'OptionalMemberExpression',
          object: stringLiteral('staticObject'),
          property: stringLiteral('run'),
          computed: true,
          optional: true,
        },
        arguments: [identifier('dynamicArg')],
        optional: true,
      } as never),
    ).toMatchObject({ text: 'staticObject?.[run]($dynamicArg)', isStatic: false });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(stringLiteral('staticObject'), stringLiteral('run'), true), [
          identifier('dynamicArg'),
        ]),
      ),
    ).toMatchObject({
      text: 'staticObject[run]($dynamicArg)',
      isStatic: false,
    });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(stringLiteral('staticObject'), stringLiteral('run'), true), [
          stringLiteral('staticArg'),
        ]),
      ),
    ).toMatchObject({
      text: 'staticObject[run](staticArg)',
      isStatic: true,
    });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(identifier('api'), identifier('run')), [stringLiteral('staticArg')]),
      ),
    ).toMatchObject({
      text: '$api.run(staticArg)',
      isStatic: false,
    });
    expect(
      segmentFromExpression(
        callExpression(memberExpression(stringLiteral('staticObject'), identifier('run')), [identifier('dynamicArg')]),
      ),
    ).toMatchObject({
      text: 'staticObject.run($dynamicArg)',
      isStatic: false,
    });
    expect(
      resolveQueryKeyExpression(callExpression(identifier('createQueryKey'), [stringLiteral('replacement')]), {
        resolveReference: vi.fn(() => undefined),
        resolveCallResult: vi.fn((callee) =>
          callee.type === 'Identifier' && callee.name === 'createQueryKey' ? arrayExpression([null]) : undefined,
        ),
      }),
    ).toEqual(arrayExpression([stringLiteral('replacement')]));
    expect(
      resolveQueryKeyExpression(callExpression(identifier('queryOptions'), [identifier('unresolved')]), resolver),
    ).toEqual(identifier('unresolved'));
    expect(
      resolveQueryKeyExpression(objectExpression([objectProperty(identifier('queryKey'), identifier('deferredKey'))]), {
        resolveReference: vi.fn((node) =>
          node.type === 'Identifier' && node.name === 'deferredKey'
            ? arrayExpression([stringLiteral('deferred')])
            : undefined,
        ),
        resolveCallResult: vi.fn(() => undefined),
      }),
    ).toEqual(arrayExpression([stringLiteral('deferred')]));
    expect(
      resolveQueryKeyExpression(callExpression(identifier('factoryRef'), [stringLiteral('arg')]), {
        resolveReference: vi.fn((node) =>
          node.type === 'Identifier' && node.name === 'factoryRef'
            ? {
                type: 'ArrowFunctionExpression',
                params: [identifier('id')],
                body: arrayExpression([stringLiteral('factory-ref'), identifier('id')]),
                generator: false,
                async: false,
                expression: true,
              }
            : undefined,
        ),
        resolveCallResult: vi.fn(() => undefined),
      }),
    ).toEqual(arrayExpression([stringLiteral('factory-ref'), stringLiteral('arg')]));
    expect(
      resolveQueryKeyExpression(
        memberExpression(
          objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('member-direct')]))]),
          identifier('queryKey'),
        ),
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('member-direct')]));
    expect(
      resolveQueryKeyExpression(
        memberExpression(identifier('memberRef'), { type: 'PrivateName', id: identifier('secret') }, true),
        {
          resolveReference: vi.fn((node) =>
            node.type === 'MemberExpression' ? arrayExpression([stringLiteral('member-ref')]) : undefined,
          ),
          resolveCallResult: vi.fn(() => undefined),
        },
      ),
    ).toEqual(arrayExpression([stringLiteral('member-ref')]));
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('direct-fallback')])),
          ]),
        ],
        resolver,
      ),
    ).toMatchObject({ segments: ['direct-fallback'], matchMode: 'prefix' });
  });

  it('covers empty helper calls and direct action fallback objects', () => {
    const noReturnFn: ArrowFunctionExpression = {
      type: 'ArrowFunctionExpression',
      params: [],
      body: { type: 'BlockStatement', body: [] } as never,
      generator: false,
      async: false,
      expression: false,
    };
    const functionExpressionNoReturn = {
      type: 'FunctionExpression',
      id: null,
      params: [],
      body: { type: 'BlockStatement', body: [] },
      generator: false,
      async: false,
    } as never as Expression;
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'noReturn') {
          return noReturnFn;
        }
        if (node.type === 'Identifier' && node.name === 'functionNoReturn') {
          return functionExpressionNoReturn;
        }
        if (node.type === 'Identifier' && node.name === 'exprValue') {
          return { type: 'Super' } as never;
        }
        if (node.type === 'Identifier' && node.name === 'memberCallRef') {
          return callExpression(memberExpression(identifier('api'), identifier('run')), []);
        }
        if (node.type === 'Identifier' && node.name === 'optionalMemberCallRef') {
          return {
            type: 'CallExpression',
            callee: {
              type: 'OptionalMemberExpression',
              object: identifier('api'),
              property: identifier('run'),
              computed: false,
              optional: true,
            },
            arguments: [],
          };
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(segmentFromExpression(callExpression(identifier('queryOptions')), resolver)).toMatchObject({
      text: 'call(queryOptions)',
      isStatic: false,
    });
    expect(segmentFromExpression(callExpression(identifier('noReturn')), resolver)).toMatchObject({
      text: 'expr',
      isStatic: false,
    });
    expect(segmentFromExpression(callExpression(identifier('functionNoReturn')), resolver)).toMatchObject({
      text: 'expr',
      isStatic: false,
    });
    expect(segmentFromExpression(callExpression(identifier('exprValue')), resolver)).toMatchObject({
      text: 'expr',
      isStatic: false,
    });
    expect(segmentFromExpression(identifier('memberCallRef'), resolver)).toMatchObject({
      text: '$memberCallRef',
      isStatic: false,
    });
    expect(segmentFromExpression(identifier('optionalMemberCallRef'), resolver)).toMatchObject({
      text: '$optionalMemberCallRef',
      isStatic: false,
    });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          callExpression(identifier('wrap'), [
            objectExpression([
              objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('fallback-object')])),
              objectProperty(identifier('exact'), booleanLiteral(true)),
            ]),
          ]),
        ],
        resolver,
      ),
    ).toMatchObject({ segments: ['fallback-object'], matchMode: 'prefix' });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          callExpression(identifier('wrap'), [
            objectExpression([
              objectProperty(
                identifier('predicate'),
                arrowFunction({
                  type: 'BinaryExpression',
                  operator: '===',
                  left: memberExpression(
                    memberExpression(identifier('entry'), identifier('queryKey')),
                    numericLiteral(0),
                    true,
                  ),
                  right: stringLiteral('fallback-predicate'),
                } as BinaryExpression),
              ),
            ]),
          ]),
        ],
        resolver,
      ),
    ).toMatchObject({ segments: ['fallback-predicate'], matchMode: 'prefix' });
    expect(
      inferActionQueryKey(
        'invalidateQueries',
        [
          callExpression(identifier('wrap'), [
            objectExpression([objectProperty(identifier('predicate'), arrowFunction(booleanLiteral(true)))]),
          ]),
        ],
        resolver,
      ),
    ).toMatchObject({ matchMode: 'all', source: 'wildcard' });
    expect(
      inferActionQueryKey('invalidateQueries', [
        objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('direct-action')]))]),
      ]),
    ).toMatchObject({ segments: ['direct-action'], matchMode: 'prefix' });
    expect(
      inferActionQueryKey('invalidateQueries', [
        objectExpression([
          objectProperty(
            identifier('predicate'),
            arrowFunction({
              type: 'BinaryExpression',
              operator: '===',
              left: memberExpression(
                memberExpression(identifier('query'), identifier('queryKey')),
                numericLiteral(0),
                true,
              ),
              right: stringLiteral('direct-predicate'),
            } as BinaryExpression),
          ),
        ]),
      ]),
    ).toMatchObject({ segments: ['direct-predicate'], matchMode: 'prefix' });
  });

  it('covers query key formatting helpers directly', () => {
    expect(__queryKeyTestInternals.propertySegmentText(undefined)).toBe('?');
    expect(__queryKeyTestInternals.propertySegmentText({ value: 'select', isStatic: true })).toBe('select');
    expect(__queryKeyTestInternals.queryKeyId([])).toBe('empty');
    expect(__queryKeyTestInternals.queryKeyId(['todos', '$id'])).toBe('todos|$id');
    expect(__queryKeyTestInternals.queryKeySource('static')).toBe('literal');
    expect(__queryKeyTestInternals.queryKeySource('dynamic')).toBe('expression');
    expect(__queryKeyTestInternals.defaultMatchMode({}, 'prefix')).toBe('prefix');
    expect(__queryKeyTestInternals.defaultMatchMode({ defaultMode: 'exact' }, 'prefix')).toBe('exact');
    expect(__queryKeyTestInternals.actionModeFromExact(true)).toBe('exact');
    expect(__queryKeyTestInternals.actionModeFromExact(false)).toBe('prefix');
    expect(__queryKeyTestInternals.actionModeFromExact(undefined)).toBe('prefix');
    expect(__queryKeyTestInternals.predicateMatchMode(true, 'predicate')).toBe('exact');
    expect(__queryKeyTestInternals.predicateMatchMode(false, 'predicate')).toBe('predicate');
    expect(__queryKeyTestInternals.missingActionMode(true)).toBe('predicate');
    expect(__queryKeyTestInternals.missingActionMode(false)).toBe('all');
    expect(
      findObjectPropertyValue(
        objectExpression([objectProperty(stringLiteral('queryKey'), arrayExpression([stringLiteral('string-key')]))]),
        'queryKey',
      ),
    ).toEqual(arrayExpression([stringLiteral('string-key')]));
    expect(
      __queryKeyTestInternals.expressionContainsIdentifier(
        {
          type: 'FunctionDeclaration',
          id: identifier('fn'),
          params: [identifier('ignored')],
          body: { type: 'BlockStatement', body: [] },
          generator: false,
          async: false,
        } as never,
        'ignored',
      ),
    ).toBe(false);
    expect(
      __queryKeyTestInternals.resolveObjectPropertyExpression(
        objectExpression([spreadElement(identifier('notObject'))]),
        'queryKey',
        { resolveReference: vi.fn(() => stringLiteral('not-object')), resolveCallResult: vi.fn(() => undefined) },
        0,
      ),
    ).toBeUndefined();
    expect(
      __queryKeyTestInternals.resolveObjectPropertyExpression(
        objectExpression([spreadElement(identifier('nestedObject'))]),
        'queryKey',
        {
          resolveReference: vi.fn(() =>
            objectExpression([objectProperty(identifier('queryKey'), stringLiteral('nested-key'))]),
          ),
          resolveCallResult: vi.fn(() => undefined),
        },
        0,
      ),
    ).toEqual(stringLiteral('nested-key'));
    expect(
      __queryKeyTestInternals.simplifyCollectionMethodCallSegment(
        { text: 'getQueryCache', isStatic: false },
        { value: 'sort', isStatic: true },
      ),
    ).toEqual({ text: 'getQueryCache', isStatic: false });
    expect(
      __queryKeyTestInternals.normalizeActionKeyOrWildcard(identifier('queryKey'), { defaultMode: 'exact' }),
    ).toMatchObject({
      id: 'pass-through-query-key',
      matchMode: 'exact',
    });
  });

  it('covers direct resolver-assisted query key expression branches', () => {
    const returnedArray = arrayExpression([stringLiteral('returned')]);
    const nestedObject = objectExpression([objectProperty(identifier('target'), stringLiteral('nested'))]);
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'makeKey') {
          return arrowFunction(returnedArray);
        }
        if (node.type === 'Identifier' && node.name === 'resolvedCallee') {
          return stringLiteral('callee-value');
        }
        if (node.type === 'Identifier' && node.name === 'spreadObject') {
          return nestedObject;
        }
        if (node.type === 'MemberExpression') {
          return arrayExpression([stringLiteral('member-ref')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([null, stringLiteral('fallback')]);
        }
        return undefined;
      }),
    };
    const objectResolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'spreadObject') {
          return nestedObject;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(
      resolveQueryKeyExpression(
        objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('from-object')]))]),
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('from-object')]));
    expect(
      resolveQueryKeyExpression(
        callExpression(identifier('queryOptions'), [arrayExpression([stringLiteral('identity')])]),
        undefined,
      ),
    ).toEqual(arrayExpression([stringLiteral('identity')]));
    expect(resolveQueryKeyExpression(callExpression(identifier('makeKey'), [stringLiteral('id')]), resolver)).toEqual(
      returnedArray,
    );
    expect(
      resolveQueryKeyExpression(
        callExpression(identifier('createQueryKey'), [
          { type: 'SpreadElement', argument: identifier('args') },
          stringLiteral('second'),
        ]),
        resolver,
      ),
    ).toEqual(arrayExpression([null, stringLiteral('second')]));
    expect(
      resolveQueryKeyExpression(
        memberExpression(
          objectExpression([objectProperty(identifier('target'), stringLiteral('direct'))]),
          identifier('target'),
        ),
        objectResolver,
      ),
    ).toEqual(stringLiteral('direct'));
    expect(
      resolveQueryKeyExpression(memberExpression(identifier('spreadObject'), identifier('target')), objectResolver),
    ).toEqual(stringLiteral('nested'));
    expect(
      resolveQueryKeyExpression(
        memberExpression(identifier('unknown'), nonExpression('PrivateName') as never),
        resolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('member-ref')]));
    expect(segmentFromExpression(callExpression(identifier('resolvedCallee')), resolver)).toMatchObject({
      text: 'callee-value',
      isStatic: true,
    });
    expect(
      segmentFromExpression(callExpression(identifier('ref'), [stringLiteral('ref-value')]), resolver),
    ).toMatchObject({
      text: 'ref-value',
      isStatic: true,
    });
    expect(segmentFromExpression(callExpression(identifier('useState'), []), resolver)).toMatchObject({
      text: 'UNRESOLVED',
      isStatic: false,
    });
    expect(
      segmentFromExpression({
        type: 'OptionalMemberExpression',
        object: identifier('obj'),
        property: { type: 'PrivateName', id: identifier('secret') },
        computed: false,
        optional: true,
      } as never),
    ).toMatchObject({ text: '$obj?.?', isStatic: false });
    expect(
      segmentFromExpression({
        type: 'OptionalCallExpression',
        callee: {
          type: 'OptionalMemberExpression',
          object: identifier('obj'),
          property: stringLiteral('method'),
          computed: true,
          optional: true,
        },
        arguments: [stringLiteral('arg')],
        optional: true,
      } as never),
    ).toMatchObject({ text: '$obj?.[method](arg)' });
    expect(segmentFromExpression(arrowFunction(arrayExpression([])), resolver)).toMatchObject({
      text: 'UNRESOLVED',
      isStatic: false,
    });
    expect(
      segmentFromExpression(identifier('refWithoutArg'), {
        resolveReference: vi.fn(() => callExpression(identifier('ref'), [])),
        resolveCallResult: vi.fn(() => undefined),
      }),
    ).toMatchObject({ text: 'expr', isStatic: false });
    expect(
      segmentFromExpression(identifier('stateWithoutArg'), {
        resolveReference: vi.fn(() => callExpression(identifier('useState'), [])),
        resolveCallResult: vi.fn(() => undefined),
      }),
    ).toMatchObject({ text: 'expr', isStatic: false });
  });
});
