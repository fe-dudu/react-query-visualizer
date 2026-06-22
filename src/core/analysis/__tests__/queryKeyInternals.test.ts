import { describe, expect, it, vi } from 'vitest';

import {
  __queryKeyTestInternals,
  buildPassThroughActionKey,
  inferActionQueryKey,
  inferHookQueryKey,
  normalizeQueryKey,
  resolveQueryKeyExpression,
  segmentFromExpression,
} from '../queryKey';
import type { QueryKeyResolver, SegmentResult } from '../types';

function identifier(name: string) {
  return { type: 'Identifier', name } as never;
}

function stringLiteral(value: string) {
  return { type: 'StringLiteral', value } as never;
}

function numericLiteral(value: number) {
  return { type: 'NumericLiteral', value } as never;
}

function arrayExpression(elements: Array<unknown>) {
  return { type: 'ArrayExpression', elements } as never;
}

function objectProperty(key: unknown, value: unknown, computed = false) {
  return {
    type: 'Property',
    kind: 'init',
    key,
    value,
    method: false,
    shorthand: false,
    computed,
    optional: false,
  } as never;
}

function objectExpression(properties: Array<unknown>) {
  return { type: 'ObjectExpression', properties } as never;
}

function spreadElement(argument: unknown) {
  return { type: 'SpreadElement', argument } as never;
}

function memberExpression(object: unknown, property: unknown, computed = false) {
  return { type: 'MemberExpression', object, property, computed } as never;
}

function callExpression(callee: unknown, args: Array<unknown> = []) {
  return { type: 'CallExpression', callee, arguments: args } as never;
}

function arrowFunction(params: Array<unknown>, body: unknown) {
  return {
    type: 'ArrowFunctionExpression',
    params,
    body,
    generator: false,
    async: false,
    expression: true,
  } as never;
}

function binaryExpression(left: unknown, right: unknown, operator: string) {
  return { type: 'BinaryExpression', operator, left, right } as never;
}

function logicalExpression(left: unknown, right: unknown, operator: string) {
  return { type: 'LogicalExpression', operator, left, right } as never;
}

function conditionalExpression(test: unknown, consequent: unknown, alternate: unknown) {
  return { type: 'ConditionalExpression', test, consequent, alternate } as never;
}

function unaryExpression(argument: unknown, operator: string) {
  return { type: 'UnaryExpression', operator, prefix: true, argument } as never;
}

function sequenceExpression(expressions: Array<unknown>) {
  return { type: 'SequenceExpression', expressions } as never;
}

function parenthesizedExpression(expression: unknown) {
  return { type: 'ParenthesizedExpression', expression } as never;
}

function templateLiteral(expression: unknown) {
  return {
    type: 'TemplateLiteral',
    quasis: [
      {
        type: 'TemplateElement',
        value: { raw: 'start-', cooked: 'start-' },
        tail: false,
      },
      {
        type: 'TemplateElement',
        value: { raw: '-end', cooked: '-end' },
        tail: true,
      },
    ],
    expressions: [expression],
  } as never;
}

describe('core/analysis/queryKey internals', () => {
  it('covers low-level fallback branches and direct resolver handoffs', () => {
    const resolver: QueryKeyResolver = {
      resolveReference: vi.fn(() => undefined),
      resolveCallResult: vi.fn(() => undefined),
    };

    expect(__queryKeyTestInternals.defaultMatchMode({}, 'exact')).toBe('exact');
    expect(__queryKeyTestInternals.actionModeFromExact(undefined)).toBe('prefix');
    expect(__queryKeyTestInternals.predicateMatchMode(true, 'prefix')).toBe('exact');
    expect(__queryKeyTestInternals.missingActionMode(true)).toBe('predicate');
    expect(__queryKeyTestInternals.queryKeyId([])).toBe('empty');
    expect(__queryKeyTestInternals.queryKeySource('static')).toBe('literal');
    expect(__queryKeyTestInternals.segmentTextOrUnresolved({ text: '', isStatic: false })).toBe('UNRESOLVED');
    expect(__queryKeyTestInternals.isDisplayableResolvedSegment({ text: 'expr', isStatic: false })).toBe(false);

    expect(segmentFromExpression(callExpression({ type: 'Super' } as never), resolver)).toMatchObject({
      text: 'call(expr)',
      isStatic: false,
    });
    expect(segmentFromExpression(arrayExpression([]), resolver)).toMatchObject({
      text: '[]',
      isStatic: true,
    });
    expect(segmentFromExpression(arrowFunction([], arrayExpression([])), resolver)).toMatchObject({
      text: 'UNRESOLVED',
      isStatic: false,
    });
    expect(
      segmentFromExpression(objectExpression([spreadElement({ type: 'Super' } as never)]), resolver),
    ).toMatchObject({
      text: '{...UNRESOLVED}',
      isStatic: false,
    });

    const resolvedByReference = arrayExpression([stringLiteral('resolved')]);
    const memberResolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'MemberExpression') {
          return resolvedByReference;
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };
    expect(
      resolveQueryKeyExpression(memberExpression(identifier('source'), identifier('dynamic'), true), memberResolver),
    ).toBe(resolvedByReference);

    const objectResolver: QueryKeyResolver = {
      resolveReference: vi.fn(() => undefined),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'factory') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('from-factory')])),
          ]);
        }
        return undefined;
      }),
    };
    expect(inferHookQueryKey([callExpression(identifier('factory'))], objectResolver)).toMatchObject({
      segments: ['from-factory'],
      matchMode: 'exact',
      resolution: 'static',
    });
  });

  it('covers substitution, collection, and predicate helper branches', () => {
    const substitutionObject = objectExpression([
      objectProperty(identifier('queryKey'), stringLiteral('replacement')),
      objectProperty(identifier('tail'), stringLiteral('tail')),
      objectProperty(
        identifier('spreadObject'),
        objectExpression([objectProperty(identifier('nested'), stringLiteral('nested'))]),
      ),
      objectProperty(identifier('fallback'), stringLiteral('fallback')),
      objectProperty(identifier('source'), stringLiteral('source')),
    ]);

    const complexExpression = objectExpression([
      objectProperty(
        identifier('array'),
        arrayExpression([
          identifier('queryKey'),
          spreadElement(identifier('tail')),
          spreadElement({ type: 'Super' } as never),
        ]),
      ),
      objectProperty(
        identifier('object'),
        objectExpression([
          objectProperty(identifier('nested'), identifier('queryKey')),
          spreadElement(identifier('spreadObject')),
          spreadElement({ type: 'Super' } as never),
        ]),
      ),
      objectProperty(identifier('member'), memberExpression(identifier('source'), identifier('queryKey'))),
      objectProperty(
        identifier('call'),
        callExpression(identifier('fn'), [identifier('queryKey'), spreadElement({ type: 'Super' } as never)]),
      ),
      objectProperty(identifier('unary'), unaryExpression(identifier('queryKey'), '!')),
      objectProperty(identifier('binary'), binaryExpression(identifier('queryKey'), identifier('fallback'), '+')),
      objectProperty(identifier('logical'), logicalExpression(identifier('queryKey'), identifier('fallback'), '||')),
      objectProperty(
        identifier('conditional'),
        conditionalExpression(identifier('queryKey'), identifier('queryKey'), identifier('fallback')),
      ),
      objectProperty(identifier('sequence'), sequenceExpression([identifier('queryKey'), identifier('fallback')])),
      objectProperty(identifier('paren'), parenthesizedExpression(identifier('queryKey'))),
      objectProperty(identifier('template'), templateLiteral(identifier('queryKey'))),
    ]);

    const hintedExpression = __queryKeyTestInternals.applyObjectArgumentIdentifierHints(
      complexExpression,
      substitutionObject,
      {
        resolveReference: vi.fn(() => undefined),
        resolveCallResult: vi.fn(() => undefined),
      },
      0,
    );
    const hintedSegment = segmentFromExpression(hintedExpression, undefined);
    expect(hintedSegment.text).toContain('replacement');
    expect(hintedSegment.text).toContain('nested');
    expect(hintedSegment.text).toContain('fallback');

    const queryObject = objectExpression([
      objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('object-query')])),
    ]);
    expect(__queryKeyTestInternals.collectQueryKeyExpressionsFromQueryOptionEntry(queryObject, undefined, 0)).toEqual([
      arrayExpression([stringLiteral('object-query')]),
    ]);
    expect(
      __queryKeyTestInternals.collectQueryKeyExpressionsFromQueriesCollection(
        arrayExpression([
          queryObject,
          objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('nested')]))]),
        ]),
        undefined,
        0,
      ),
    ).toHaveLength(2);
    expect(__queryKeyTestInternals.isInlineQueryKeyObject(queryObject, 0)).toBe(true);
    expect(
      __queryKeyTestInternals.isInlineQueryKeyObject(
        objectExpression([objectProperty(identifier('stale'), stringLiteral('x'))]),
        0,
      ),
    ).toBe(false);
    expect(__queryKeyTestInternals.isInlineQueryKeyCollection(arrayExpression([queryObject]), 0)).toBe(true);
    expect(__queryKeyTestInternals.isInlineQueryKeyCollection(arrayExpression([stringLiteral('nope')]), 0)).toBe(false);

    expect(
      __queryKeyTestInternals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), numericLiteral(0), true),
        undefined,
        0,
      ),
    ).toBe(0);
    expect(
      __queryKeyTestInternals.queryKeyIndexFromAccessExpression(
        memberExpression(
          memberExpression(identifier('entry'), stringLiteral('queryKey'), true),
          stringLiteral('-1'),
          true,
        ),
        undefined,
        0,
      ),
    ).toBeUndefined();
    expect(
      __queryKeyTestInternals.queryKeyIndexFromAccessExpression(
        memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), identifier('index'), true),
        undefined,
        0,
      ),
    ).toBeUndefined();

    const positionalResult = __queryKeyTestInternals.applyPositionalArgumentHints(
      callExpression(identifier('factory'), [stringLiteral('left')]),
      arrayExpression([identifier('first'), spreadElement({ type: 'Super' } as never)]),
      undefined,
      0,
    );
    expect(segmentFromExpression(positionalResult, undefined).text).toContain('$first');

    const objectSubstitutions = new Map<string, unknown>();
    __queryKeyTestInternals.collectObjectArgumentSubstitutions(
      objectExpression([
        objectProperty(identifier('queryKey'), identifier('queryKey')),
        spreadElement({ type: 'Super' } as never),
        spreadElement(identifier('spreadObject')),
      ]),
      {
        resolveReference: vi.fn((node) => {
          if (node.type === 'Identifier' && node.name === 'spreadObject') {
            return objectExpression([objectProperty(identifier('queryKey'), stringLiteral('spread'))]);
          }
          return undefined;
        }),
        resolveCallResult: vi.fn(() => undefined),
      },
      0,
      objectSubstitutions,
    );
    expect(objectSubstitutions.get('queryKey')).toBeDefined();

    const constraints = new Map<number, SegmentResult>();
    __queryKeyTestInternals.setPredicateQueryKeyConstraint(constraints, 0, { text: 'alpha', isStatic: true });
    __queryKeyTestInternals.setPredicateQueryKeyConstraint(constraints, 0, { text: 'alpha', isStatic: false });
    __queryKeyTestInternals.setPredicateQueryKeyConstraint(constraints, 0, { text: 'beta', isStatic: true });
    __queryKeyTestInternals.setPredicateQueryKeyConstraint(constraints, 1, { text: 'UNRESOLVED', isStatic: false });
    expect(constraints.get(0)).toEqual({ text: 'alpha', isStatic: false });
    expect(constraints.has(1)).toBe(false);

    const predicate = arrowFunction(
      [identifier('entry')],
      logicalExpression(
        binaryExpression(
          memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), numericLiteral(0), true),
          stringLiteral('alpha'),
          '===',
        ),
        binaryExpression(
          memberExpression(memberExpression(identifier('entry'), identifier('queryKey')), stringLiteral('1'), true),
          stringLiteral('beta'),
          '==',
        ),
        '&&',
      ),
    );
    expect(__queryKeyTestInternals.inferActionQueryKeyFromPredicate(predicate, undefined)).toMatchObject({
      segments: ['alpha', 'beta'],
      matchMode: 'prefix',
      resolution: 'static',
    });

    expect(
      __queryKeyTestInternals.normalizeActionKeyOrWildcard(identifier('queryKey'), { defaultMode: 'exact' }, undefined),
    ).toEqual(buildPassThroughActionKey('exact'));
    expect(__queryKeyTestInternals.shouldTreatAsWildcardActionKey(buildPassThroughActionKey('exact'))).toBe(false);
    expect(
      __queryKeyTestInternals.shouldTreatAsWildcardActionKey(normalizeQueryKey(undefined, { defaultMode: 'unknown' })),
    ).toBe(true);

    const unresolvedResolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'resolvedOptions') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('resolved')])),
          ]);
        }
        if (node.type === 'MemberExpression') {
          return arrayExpression([stringLiteral('member-resolved')]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn(() => undefined),
    };
    expect(
      resolveQueryKeyExpression(
        memberExpression(identifier('resolvedOptions'), identifier('queryKey')),
        unresolvedResolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('member-resolved')]));
    expect(
      resolveQueryKeyExpression(
        memberExpression(identifier('resolvedOptions'), identifier('dynamic'), true),
        unresolvedResolver,
      ),
    ).toEqual(arrayExpression([stringLiteral('member-resolved')]));
    expect(__queryKeyTestInternals.isQueryCacheLookupCall(stringLiteral('x') as never, unresolvedResolver, 0)).toBe(
      false,
    );
  });

  it('covers function argument and query collection inference branches', () => {
    const functionNode = arrowFunction(
      [
        identifier('first'),
        {
          type: 'AssignmentPattern',
          left: identifier('second'),
          right: stringLiteral('fallback'),
        } as never,
        {
          type: 'TSParameterProperty',
          parameter: identifier('third'),
        } as never,
      ],
      objectExpression([
        objectProperty(identifier('array'), arrayExpression([identifier('first'), identifier('second')])),
        objectProperty(identifier('member'), memberExpression(identifier('third'), identifier('first'))),
        objectProperty(
          identifier('queryKey'),
          arrayExpression([identifier('first'), identifier('second'), identifier('third')]),
        ),
      ]),
    );
    const callNode = callExpression(identifier('factory'), [
      stringLiteral('one'),
      stringLiteral('two'),
      stringLiteral('three'),
    ]);

    const hinted = __queryKeyTestInternals.applyFunctionArgumentHints(
      callNode,
      functionNode,
      functionNode.body,
      {
        resolveReference: vi.fn(() => undefined),
        resolveCallResult: vi.fn(() => undefined),
      },
      0,
    );
    expect(segmentFromExpression(hinted, undefined).text).toContain('one');
    expect(segmentFromExpression(hinted, undefined).text).toContain('two');
    expect(segmentFromExpression(hinted, undefined).text).toContain('three');

    const queryCollection = arrayExpression([
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('object-query')]))]),
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('a')]))]),
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('b')]))]),
      objectExpression([objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('a')]))]),
    ]);
    expect(
      __queryKeyTestInternals.collectQueryKeyExpressionsFromQueriesCollection(queryCollection, undefined, 0),
    ).toHaveLength(4);
    expect(
      inferHookQueryKey([queryCollection.elements[0]], {
        resolveReference: vi.fn(() => undefined),
        resolveCallResult: vi.fn(() => undefined),
      }),
    ).toMatchObject({
      segments: ['object-query'],
      matchMode: 'exact',
    });
    expect(
      normalizeQueryKey(callExpression(identifier('createQueryKey'), [stringLiteral('left'), stringLiteral('right')]), {
        defaultMode: 'exact',
      }),
    ).toMatchObject({
      segments: ['left', 'right', 'UNRESOLVED'],
    });

    const queryKeyResolver: QueryKeyResolver = {
      resolveReference: vi.fn((node) => {
        if (node.type === 'Identifier' && node.name === 'resolvedOptions') {
          return objectExpression([
            objectProperty(identifier('queryKey'), arrayExpression([stringLiteral('resolved')])),
          ]);
        }
        return undefined;
      }),
      resolveCallResult: vi.fn((callee) => {
        if (callee.type === 'Identifier' && callee.name === 'createQueryKey') {
          return arrayExpression([identifier('first'), identifier('second')]);
        }
        return undefined;
      }),
    };
    expect(inferActionQueryKey('invalidateQueries', [identifier('resolvedOptions')], queryKeyResolver)).toMatchObject({
      segments: ['resolved'],
      matchMode: 'prefix',
    });
    expect(
      segmentFromExpression(
        callExpression(identifier('createQueryKey'), [stringLiteral('left'), stringLiteral('right')]),
        queryKeyResolver,
      ),
    ).toMatchObject({
      text: '[$first, $second]',
      isStatic: false,
    });
  });
});
