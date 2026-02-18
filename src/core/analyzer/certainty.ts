import * as t from '@babel/types';

import type { ParseContext } from './types';
import { QUERY_HOOKS } from './constants';
import { getCertainty } from './context';
import type { Resolution } from '../../types';

export function hookCallInfo(
  callee: t.CallExpression['callee'],
  context: ParseContext,
): { operation: string; hook: string; resolution: Resolution } | undefined {
  if (t.isIdentifier(callee)) {
    const certainty = getCertainty(context.queryHooks, callee.name);
    if (certainty) {
      return {
        operation: callee.name,
        hook: context.queryHookKinds.get(callee.name) ?? callee.name,
        resolution: certainty,
      };
    }
    return undefined;
  }

  if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property) || !t.isIdentifier(callee.object)) {
    return undefined;
  }

  if (!QUERY_HOOKS.has(callee.property.name)) {
    return undefined;
  }

  const namespaceCertainty = getCertainty(context.queryNamespaces, callee.object.name);
  if (!namespaceCertainty) {
    return undefined;
  }

  return {
    operation: callee.property.name,
    hook: callee.property.name,
    resolution: namespaceCertainty,
  };
}

export function queryClientHookCallCertainty(
  callee: t.CallExpression['callee'],
  context: ParseContext,
): Resolution | undefined {
  if (t.isIdentifier(callee)) {
    return getCertainty(context.useQueryClientNames, callee.name);
  }

  if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && t.isIdentifier(callee.property)) {
    if (callee.property.name !== 'useQueryClient') {
      return undefined;
    }

    return getCertainty(context.queryNamespaces, callee.object.name);
  }

  return undefined;
}

export function queryClientCtorCertainty(
  callee: t.NewExpression['callee'],
  context: ParseContext,
): Resolution | undefined {
  if (t.isIdentifier(callee)) {
    return getCertainty(context.queryClientCtorNames, callee.name);
  }

  if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && t.isIdentifier(callee.property)) {
    if (callee.property.name !== 'QueryClient') {
      return undefined;
    }

    return getCertainty(context.queryNamespaces, callee.object.name);
  }

  return undefined;
}

function certaintyFromTypeName(typeName: t.TSEntityName, context: ParseContext, depth: number): Resolution | undefined {
  if (depth > 6) {
    return undefined;
  }

  if (t.isIdentifier(typeName)) {
    return getCertainty(context.queryClientTypeNames, typeName.name);
  }

  if (!t.isTSQualifiedName(typeName)) {
    return undefined;
  }

  if (!t.isIdentifier(typeName.right) || typeName.right.name !== 'QueryClient') {
    return undefined;
  }

  const left = typeName.left;
  if (t.isIdentifier(left)) {
    return getCertainty(context.queryNamespaces, left.name);
  }

  return certaintyFromTypeName(left, context, depth + 1);
}

function queryClientTypeNodeCertainty(
  typeNode: t.TSType,
  context: ParseContext,
  depth: number,
): Resolution | undefined {
  if (depth > 8) {
    return undefined;
  }

  if (t.isTSTypeReference(typeNode)) {
    return certaintyFromTypeName(typeNode.typeName, context, depth + 1);
  }

  if (t.isTSParenthesizedType(typeNode)) {
    return queryClientTypeNodeCertainty(typeNode.typeAnnotation, context, depth + 1);
  }

  if (t.isTSUnionType(typeNode) || t.isTSIntersectionType(typeNode)) {
    for (const item of typeNode.types) {
      const certainty = queryClientTypeNodeCertainty(item, context, depth + 1);
      if (certainty) {
        return certainty;
      }
    }
  }

  return undefined;
}

export function queryClientTypeAnnotationCertainty(
  annotation: t.TSTypeAnnotation | t.TypeAnnotation | t.Noop | null | undefined,
  context: ParseContext,
): Resolution | undefined {
  if (!annotation || t.isNoop(annotation) || t.isTypeAnnotation(annotation)) {
    return undefined;
  }

  return queryClientTypeNodeCertainty(annotation.typeAnnotation, context, 0);
}

export function extractLeafIdentifier(node: t.Expression | t.Super | t.V8IntrinsicIdentifier): string | undefined {
  if (t.isIdentifier(node)) {
    return node.name;
  }

  if (t.isMemberExpression(node) && t.isIdentifier(node.property)) {
    return node.property.name;
  }

  return undefined;
}

export function queryClientObjectCertainty(
  node: t.Expression | t.Super | t.V8IntrinsicIdentifier,
  context: ParseContext,
): Resolution | undefined {
  const leafName = extractLeafIdentifier(node);
  if (!leafName) {
    return undefined;
  }

  const fromTrackedVar = getCertainty(context.queryClientVars, leafName);
  if (fromTrackedVar) {
    return fromTrackedVar;
  }

  return undefined;
}
