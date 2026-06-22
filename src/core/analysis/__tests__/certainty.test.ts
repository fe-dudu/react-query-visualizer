import { describe, expect, it } from 'vitest';

import {
  extractLeafIdentifier,
  hookCallInfo,
  queryClientCtorCertainty,
  queryClientHookCallCertainty,
  queryClientObjectCertainty,
  queryClientTypeAnnotationCertainty,
} from '../certainty';
import { createParseContext } from '../context';

function identifier(name: string) {
  return { type: 'Identifier', name };
}

function memberExpression(object: unknown, property: unknown, computed = false) {
  return { type: 'MemberExpression', object, property, computed };
}

function _callExpression(callee: unknown) {
  return { type: 'CallExpression', callee, arguments: [] };
}

function typeReference(typeName: unknown) {
  return { type: 'TSTypeReference', typeName };
}

function parenthesizedType(typeAnnotation: unknown) {
  return { type: 'TSParenthesizedType', typeAnnotation };
}

describe('core/analysis/certainty', () => {
  it('classifies hooks, query clients, and type annotations', () => {
    const context = createParseContext();
    context.queryHooks.set('useQuery', 'static');
    context.queryHookKinds.set('useQuery', 'useFancyQuery');
    context.queryHooks.set('useMutation', 'dynamic');
    context.queryNamespaces.set('rq', 'dynamic');
    context.useQueryClientNames.set('useQueryClient', 'static');
    context.queryClientCtorNames.set('QueryClient', 'dynamic');
    context.queryClientTypeNames.set('QueryClient', 'static');
    context.queryClientVars.set('client', 'dynamic');

    expect(hookCallInfo(identifier('useQuery') as never, context)).toEqual({
      operation: 'useQuery',
      hook: 'useFancyQuery',
      resolution: 'static',
    });
    expect(hookCallInfo(identifier('useMutation') as never, context)).toEqual({
      operation: 'useMutation',
      hook: 'useMutation',
      resolution: 'dynamic',
    });
    expect(hookCallInfo(memberExpression(identifier('rq'), identifier('useQuery')) as never, context)).toEqual({
      operation: 'useQuery',
      hook: 'useQuery',
      resolution: 'dynamic',
    });
    expect(hookCallInfo(identifier('other') as never, context)).toBeUndefined();

    expect(queryClientHookCallCertainty(identifier('useQueryClient') as never, context)).toBe('static');
    expect(
      queryClientHookCallCertainty(memberExpression(identifier('rq'), identifier('useQueryClient')) as never, context),
    ).toBe('dynamic');
    expect(
      queryClientHookCallCertainty(memberExpression(identifier('rq'), identifier('other')) as never, context),
    ).toBeUndefined();

    expect(queryClientCtorCertainty(identifier('QueryClient') as never, context)).toBe('dynamic');
    expect(
      queryClientCtorCertainty(memberExpression(identifier('rq'), identifier('QueryClient')) as never, context),
    ).toBe('dynamic');
    expect(
      queryClientCtorCertainty(memberExpression(identifier('rq'), identifier('other')) as never, context),
    ).toBeUndefined();

    expect(queryClientTypeAnnotationCertainty({ type: 'Noop' } as never, context)).toBeUndefined();
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: typeReference(identifier('QueryClient')),
        } as never,
        context,
      ),
    ).toBe('static');
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: {
            type: 'TSUnionType',
            types: [
              { type: 'TSParenthesizedType', typeAnnotation: typeReference(identifier('Missing')) },
              typeReference({
                type: 'TSQualifiedName',
                left: identifier('rq'),
                right: identifier('QueryClient'),
              }),
            ],
          },
        } as never,
        context,
      ),
    ).toBe('dynamic');

    expect(extractLeafIdentifier(identifier('client') as never)).toBe('client');
    expect(extractLeafIdentifier(memberExpression(identifier('rq'), identifier('client')) as never)).toBe('client');
    expect(queryClientObjectCertainty(identifier('client') as never, context)).toBe('dynamic');
    expect(queryClientObjectCertainty(memberExpression(identifier('rq'), identifier('client')) as never, context)).toBe(
      'dynamic',
    );
    expect(queryClientObjectCertainty(identifier('other') as never, context)).toBeUndefined();
  });

  it('returns undefined for unsupported callee and type shapes', () => {
    const context = createParseContext();
    context.queryNamespaces.set('rq', 'dynamic');

    expect(
      hookCallInfo(memberExpression(identifier('rq'), identifier('notAQueryHook')) as never, context),
    ).toBeUndefined();
    expect(
      hookCallInfo(memberExpression(identifier('missing'), identifier('useQuery')) as never, context),
    ).toBeUndefined();
    expect(
      hookCallInfo({ type: 'CallExpression', callee: identifier('useQuery'), arguments: [] } as never, context),
    ).toBeUndefined();
    expect(
      queryClientHookCallCertainty(
        { type: 'CallExpression', callee: identifier('useQueryClient'), arguments: [] } as never,
        context,
      ),
    ).toBeUndefined();
    expect(
      queryClientCtorCertainty(
        { type: 'CallExpression', callee: identifier('QueryClient'), arguments: [] } as never,
        context,
      ),
    ).toBeUndefined();
    expect(queryClientTypeAnnotationCertainty(null, context)).toBeUndefined();
    expect(queryClientTypeAnnotationCertainty({ type: 'TypeAnnotation' } as never, context)).toBeUndefined();
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: { type: 'UnknownEntityName' },
          },
        } as never,
        context,
      ),
    ).toBeUndefined();
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: parenthesizedType(
            parenthesizedType(
              parenthesizedType(
                parenthesizedType(
                  parenthesizedType(
                    parenthesizedType(
                      parenthesizedType(parenthesizedType(parenthesizedType(typeReference(identifier('QueryClient'))))),
                    ),
                  ),
                ),
              ),
            ),
          ),
        } as never,
        context,
      ),
    ).toBeUndefined();
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: { type: 'TSArrayType' },
        } as never,
        context,
      ),
    ).toBeUndefined();
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: typeReference({
            type: 'TSQualifiedName',
            left: {
              type: 'TSQualifiedName',
              left: {
                type: 'TSQualifiedName',
                left: {
                  type: 'TSQualifiedName',
                  left: {
                    type: 'TSQualifiedName',
                    left: {
                      type: 'TSQualifiedName',
                      left: {
                        type: 'TSQualifiedName',
                        left: {
                          type: 'TSQualifiedName',
                          left: identifier('rq'),
                          right: identifier('QueryClient'),
                        },
                        right: identifier('QueryClient'),
                      },
                      right: identifier('QueryClient'),
                    },
                    right: identifier('QueryClient'),
                  },
                  right: identifier('QueryClient'),
                },
                right: identifier('QueryClient'),
              },
              right: identifier('QueryClient'),
            },
            right: identifier('QueryClient'),
          }),
        } as never,
        context,
      ),
    ).toBeUndefined();
    expect(
      queryClientTypeAnnotationCertainty(
        {
          type: 'TypeAnnotation',
          typeAnnotation: {
            type: 'TSTypeReference',
            typeName: {
              type: 'TSQualifiedName',
              left: {
                type: 'TSQualifiedName',
                left: identifier('rq'),
                right: identifier('nested'),
              },
              right: identifier('QueryClient'),
            },
          },
        } as never,
        context,
      ),
    ).toBeUndefined();
    expect(
      extractLeafIdentifier({ type: 'CallExpression', callee: identifier('client'), arguments: [] } as never),
    ).toBeUndefined();
    expect(
      queryClientObjectCertainty(
        memberExpression(identifier('client'), { type: 'StringLiteral', value: 'queryClient' }, true) as never,
        context,
      ),
    ).toBeUndefined();
  });
});
