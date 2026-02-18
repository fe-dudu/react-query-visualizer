import * as t from '@babel/types';

import type { QueryKeyResolver, SegmentResult } from './types';
import { extractFunctionReturnExpression, unwrapExpression } from './symbols';
import type { MatchMode, NormalizedQueryKey } from '../../types';

const MAX_RESOLVE_DEPTH = 25;
const MAX_HOOK_DIRECT_CHECK_DEPTH = 16;
const ALL_QUERY_CACHE_ID = 'all-query-cache';
const ALL_QUERY_CACHE_SEGMENT = 'ALL_QUERY_CACHE';
const UNRESOLVED_SEGMENT = 'UNRESOLVED';
const UNRESOLVED_QUERY_KEY = 'UNRESOLVED_QUERY_KEY';
const QUERY_OPTIONS_HELPER_NAMES = new Set(['queryOptions', 'infiniteQueryOptions']);
const COLLECTION_TRANSFORM_METHODS = new Set([
  'join',
  'sort',
  'slice',
  'map',
  'filter',
  'flat',
  'flatMap',
  'concat',
  'reverse',
  'toSorted',
]);
const QUERY_COLLECTION_PASSTHROUGH_METHODS = new Set(['filter', 'slice', 'sort', 'reverse', 'toSorted', 'flat']);

function buildAllQueryCacheKey(
  resolution: NormalizedQueryKey['resolution'],
  display = ALL_QUERY_CACHE_SEGMENT,
): NormalizedQueryKey {
  return {
    id: ALL_QUERY_CACHE_ID,
    display,
    segments: [ALL_QUERY_CACHE_SEGMENT],
    matchMode: 'all',
    resolution,
    source: 'wildcard',
  };
}

function isObjectFreezeCall(callee: t.CallExpression['callee']): boolean {
  return (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.object) &&
    callee.object.name === 'Object' &&
    t.isIdentifier(callee.property) &&
    callee.property.name === 'freeze'
  );
}

function isQueryOptionsLikeCall(callee: t.CallExpression['callee']): boolean {
  if (t.isIdentifier(callee)) {
    return QUERY_OPTIONS_HELPER_NAMES.has(callee.name);
  }

  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
    return QUERY_OPTIONS_HELPER_NAMES.has(callee.property.name);
  }

  return false;
}

function isIdentityWrapperCall(callee: t.CallExpression['callee']): boolean {
  return isQueryOptionsLikeCall(callee) || isObjectFreezeCall(callee);
}

function resolveWithResolver(
  node: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression | undefined {
  if (!resolver || depth >= MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  if (t.isCallExpression(node)) {
    const firstArg = firstExpressionArgument(node.arguments);
    if (firstArg && node.arguments.length === 1) {
      if (isIdentityWrapperCall(node.callee)) {
        return firstArg;
      }

      if (t.isObjectExpression(firstArg) || t.isArrayExpression(firstArg)) {
        return firstArg;
      }
    }

    const callResult = resolver.resolveCallResult(node.callee);
    if (callResult) {
      return callResult;
    }

    if (t.isExpression(node.callee)) {
      return resolver.resolveReference(node.callee);
    }
  }

  if (t.isIdentifier(node) || t.isMemberExpression(node)) {
    return resolver.resolveReference(node);
  }

  return undefined;
}

function inferPropertyName(
  property: t.Expression | t.PrivateName,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): { value: string; isStatic: boolean } | undefined {
  if (t.isIdentifier(property)) {
    return { value: property.name, isStatic: true };
  }

  if (t.isStringLiteral(property)) {
    return { value: property.value, isStatic: true };
  }

  if (t.isNumericLiteral(property)) {
    return { value: String(property.value), isStatic: true };
  }

  if (t.isExpression(property)) {
    const evaluated = segmentFromExpression(property, resolver, depth + 1);
    return {
      value: evaluated.text,
      isStatic: evaluated.isStatic,
    };
  }

  return undefined;
}

function firstExpressionArgument(args: t.CallExpression['arguments']): t.Expression | undefined {
  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return undefined;
  }

  return unwrapExpression(first);
}

function callCalleeName(callee: t.CallExpression['callee']): string | undefined {
  if (t.isIdentifier(callee)) {
    return callee.name;
  }

  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)) {
    return callee.property.name;
  }

  return undefined;
}

function isMemoLikeCall(node: t.CallExpression): boolean {
  const calleeName = callCalleeName(node.callee);
  return calleeName === 'useMemo' || calleeName === 'useCallback';
}

function memoLikeCallReturnExpression(node: t.CallExpression): t.Expression | undefined {
  if (!isMemoLikeCall(node)) {
    return undefined;
  }

  const firstArg = firstExpressionArgument(node.arguments);
  if (!firstArg) {
    return undefined;
  }

  if (t.isFunctionExpression(firstArg) || t.isArrowFunctionExpression(firstArg)) {
    return extractFunctionReturnExpression(firstArg);
  }

  return firstArg;
}

function objectPropertyKeySegment(
  property: t.ObjectProperty,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): SegmentResult {
  const keyNode = property.key;

  if (!property.computed && t.isIdentifier(keyNode)) {
    return { text: keyNode.name, isStatic: true };
  }

  if (t.isPrivateName(keyNode)) {
    return { text: `#${keyNode.id.name}`, isStatic: false };
  }

  if (t.isIdentifier(keyNode) || t.isStringLiteral(keyNode) || t.isNumericLiteral(keyNode)) {
    return normalizeSegmentResult(segmentFromExpression(keyNode, resolver, depth + 1));
  }

  if (t.isBigIntLiteral(keyNode)) {
    return { text: String(keyNode.value), isStatic: true };
  }

  if (t.isExpression(keyNode)) {
    return normalizeSegmentResult(segmentFromExpression(keyNode, resolver, depth + 1));
  }

  return { text: UNRESOLVED_SEGMENT, isStatic: false };
}

function objectEntryText(key: string, value: string): string {
  return `${key}: ${value}`;
}

function isUndefinedObjectValue(segment: SegmentResult): boolean {
  return segment.isStatic && segment.text === 'undefined';
}

function segmentFromObjectExpression(
  objectNode: t.ObjectExpression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): SegmentResult {
  const entries: string[] = [];
  const sortableEntries: Array<{ key: string; value: SegmentResult }> = [];
  let isStatic = true;
  let canCanonicalizeOrder = true;

  for (const property of objectNode.properties) {
    if (!property) {
      continue;
    }

    if (t.isSpreadElement(property)) {
      canCanonicalizeOrder = false;
      if (!t.isExpression(property.argument)) {
        entries.push('...UNRESOLVED');
        isStatic = false;
        continue;
      }

      const spreadSource =
        resolveQueryKeyExpression(property.argument, resolver, depth + 1) ?? unwrapExpression(property.argument);
      if (t.isObjectExpression(spreadSource)) {
        const spreadSegment = segmentFromObjectExpression(spreadSource, resolver, depth + 1);
        const spreadText = spreadSegment.text.trim();
        if (spreadText.startsWith('{') && spreadText.endsWith('}')) {
          const inner = spreadText.slice(1, -1).trim();
          if (inner) {
            entries.push(inner);
          }
        } else {
          entries.push(`...${spreadSegment.text}`);
        }
        isStatic = isStatic && spreadSegment.isStatic;
        continue;
      }

      const spreadSegment = normalizeSegmentResult(segmentFromExpression(spreadSource, resolver, depth + 1));
      entries.push(`...${spreadSegment.text}`);
      isStatic = false;
      continue;
    }

    if (!t.isObjectProperty(property)) {
      canCanonicalizeOrder = false;
      entries.push('[method]');
      isStatic = false;
      continue;
    }

    const keySegment = objectPropertyKeySegment(property, resolver, depth + 1);
    const valueSegment = t.isExpression(property.value)
      ? normalizeSegmentResult(segmentFromExpression(property.value, resolver, depth + 1))
      : { text: UNRESOLVED_SEGMENT, isStatic: false };

    const keyText = property.computed ? `[${keySegment.text}]` : keySegment.text;
    entries.push(objectEntryText(keyText, valueSegment.text));
    sortableEntries.push({ key: keyText, value: valueSegment });
    isStatic = isStatic && keySegment.isStatic && valueSegment.isStatic;
  }

  if (entries.length === 0) {
    return { text: '{}', isStatic: true };
  }

  if (canCanonicalizeOrder) {
    const canonicalEntries = new Map<string, SegmentResult>();
    for (const entry of sortableEntries) {
      if (isUndefinedObjectValue(entry.value)) {
        canonicalEntries.delete(entry.key);
        continue;
      }
      canonicalEntries.set(entry.key, entry.value);
    }

    const sortedEntryText = [...canonicalEntries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => objectEntryText(key, value.text));

    if (sortedEntryText.length === 0) {
      return { text: '{}', isStatic };
    }

    return {
      text: `{${sortedEntryText.join(', ')}}`,
      isStatic,
    };
  }

  return {
    text: `{${entries.join(', ')}}`,
    isStatic,
  };
}

function isEmptyFallbackExpression(node: t.Expression): boolean {
  const unwrapped = unwrapExpression(node);
  if (t.isStringLiteral(unwrapped)) {
    return unwrapped.value === '';
  }

  if (t.isTemplateLiteral(unwrapped)) {
    return (
      unwrapped.expressions.length === 0 &&
      unwrapped.quasis.length === 1 &&
      (unwrapped.quasis[0]?.value.cooked ?? '') === ''
    );
  }

  if (t.isObjectExpression(unwrapped)) {
    return unwrapped.properties.length === 0;
  }

  if (t.isArrayExpression(unwrapped)) {
    return unwrapped.elements.length === 0;
  }

  if (t.isNullLiteral(unwrapped)) {
    return true;
  }

  if (t.isIdentifier(unwrapped) && unwrapped.name === 'undefined') {
    return true;
  }

  return false;
}

function callArgumentsSegment(
  args: t.CallExpression['arguments'],
  resolver: QueryKeyResolver | undefined,
  depth: number,
): SegmentResult {
  const segments: SegmentResult[] = [];

  for (const arg of args) {
    if (!arg) {
      segments.push({ text: UNRESOLVED_SEGMENT, isStatic: false });
      continue;
    }

    if (t.isSpreadElement(arg)) {
      if (!t.isExpression(arg.argument)) {
        segments.push({ text: `...${UNRESOLVED_SEGMENT}`, isStatic: false });
        continue;
      }

      const spread = normalizeSegmentResult(segmentFromExpression(arg.argument, resolver, depth + 1));
      segments.push({ text: `...${spread.text}`, isStatic: spread.isStatic });
      continue;
    }

    if (t.isExpression(arg)) {
      segments.push(normalizeSegmentResult(segmentFromExpression(arg, resolver, depth + 1)));
      continue;
    }

    segments.push({ text: UNRESOLVED_SEGMENT, isStatic: false });
  }

  return {
    text: segments.map((segment) => segment.text).join(', '),
    isStatic: segments.every((segment) => segment.isStatic),
  };
}

function simplifyCollectionMethodCallSegment(
  objectSegment: SegmentResult,
  propertySegment: { value: string; isStatic: boolean } | undefined,
): SegmentResult | undefined {
  if (!propertySegment) {
    return undefined;
  }

  if (!COLLECTION_TRANSFORM_METHODS.has(propertySegment.value)) {
    return undefined;
  }

  // Keep query-key display concise for value-transform chains like dids.slice().sort() or interests?.join(',')
  // by surfacing the originating variable expression instead of call(...) text.
  return objectSegment;
}

function substituteIdentifierInExpression(
  expression: t.Expression,
  identifierName: string,
  replacement: t.Expression,
): t.Expression {
  const replaceExpression = (node: t.Expression): t.Expression => {
    if (t.isIdentifier(node)) {
      if (node.name === identifierName) {
        return t.cloneNode(replacement, true);
      }
      return node;
    }

    if (t.isArrayExpression(node)) {
      const cloned = t.cloneNode(node, false);
      cloned.elements = cloned.elements.map((element) => {
        if (!element) {
          return null;
        }

        if (t.isSpreadElement(element)) {
          if (!t.isExpression(element.argument)) {
            return t.cloneNode(element, true);
          }
          return t.spreadElement(replaceExpression(element.argument));
        }

        return t.isExpression(element) ? replaceExpression(element) : t.cloneNode(element, true);
      });
      return cloned;
    }

    if (t.isObjectExpression(node)) {
      const cloned = t.cloneNode(node, false);
      cloned.properties = cloned.properties.map((property) => {
        if (t.isSpreadElement(property)) {
          if (!t.isExpression(property.argument)) {
            return t.cloneNode(property, true);
          }
          return t.spreadElement(replaceExpression(property.argument));
        }

        if (t.isObjectProperty(property) && t.isExpression(property.value)) {
          const nextValue = replaceExpression(property.value);
          const next = t.objectProperty(
            t.cloneNode(property.key, true),
            nextValue,
            property.computed,
            property.shorthand &&
              t.isIdentifier(property.key) &&
              t.isIdentifier(nextValue) &&
              property.key.name === nextValue.name,
          );
          return next;
        }

        return t.cloneNode(property, true);
      });
      return cloned;
    }

    if (t.isMemberExpression(node)) {
      const cloned = t.cloneNode(node, false);
      if (t.isExpression(cloned.object)) {
        cloned.object = replaceExpression(cloned.object);
      }
      if (cloned.computed && t.isExpression(cloned.property)) {
        cloned.property = replaceExpression(cloned.property);
      }
      return cloned;
    }

    if (t.isCallExpression(node)) {
      const cloned = t.cloneNode(node, false);
      if (t.isExpression(cloned.callee)) {
        cloned.callee = replaceExpression(cloned.callee);
      }
      cloned.arguments = cloned.arguments.map((arg) => {
        if (t.isSpreadElement(arg) && t.isExpression(arg.argument)) {
          return t.spreadElement(replaceExpression(arg.argument));
        }
        return t.isExpression(arg) ? replaceExpression(arg) : t.cloneNode(arg, true);
      });
      return cloned;
    }

    if (t.isTemplateLiteral(node)) {
      const cloned = t.cloneNode(node, false);
      cloned.expressions = cloned.expressions.map((expr) =>
        t.isExpression(expr) ? replaceExpression(expr) : t.cloneNode(expr, true),
      );
      return cloned;
    }

    if (t.isUnaryExpression(node) || t.isUpdateExpression(node)) {
      const cloned = t.cloneNode(node, false);
      if (t.isExpression(cloned.argument)) {
        cloned.argument = replaceExpression(cloned.argument);
      }
      return cloned;
    }

    if (t.isBinaryExpression(node) || t.isLogicalExpression(node) || t.isAssignmentExpression(node)) {
      const cloned = t.cloneNode(node, false);
      if (t.isExpression(cloned.left)) {
        cloned.left = replaceExpression(cloned.left);
      }
      if (t.isExpression(cloned.right)) {
        cloned.right = replaceExpression(cloned.right);
      }
      return cloned;
    }

    if (t.isConditionalExpression(node)) {
      const cloned = t.cloneNode(node, false);
      cloned.test = replaceExpression(cloned.test);
      cloned.consequent = replaceExpression(cloned.consequent);
      cloned.alternate = replaceExpression(cloned.alternate);
      return cloned;
    }

    if (t.isSequenceExpression(node)) {
      const cloned = t.cloneNode(node, false);
      cloned.expressions = cloned.expressions.map((expr) => replaceExpression(expr));
      return cloned;
    }

    if (t.isParenthesizedExpression(node)) {
      const cloned = t.cloneNode(node, false);
      cloned.expression = replaceExpression(cloned.expression);
      return cloned;
    }

    return t.cloneNode(node, true);
  };

  return replaceExpression(expression);
}

function expressionContainsIdentifier(node: t.Expression, identifierName: string): boolean {
  const stack: Array<{ node: t.Node; asReference: boolean }> = [{ node, asReference: true }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const { node: currentNode, asReference } = current;

    if (asReference && t.isIdentifier(currentNode) && currentNode.name === identifierName) {
      return true;
    }

    const visitorKeys = t.VISITOR_KEYS[currentNode.type];
    if (!visitorKeys) {
      continue;
    }

    for (const key of visitorKeys) {
      let childIsReference = asReference;
      if (t.isObjectProperty(currentNode) && key === 'key' && !currentNode.computed) {
        childIsReference = false;
      }
      if (t.isMemberExpression(currentNode) && key === 'property' && !currentNode.computed) {
        childIsReference = false;
      }
      if (
        (t.isFunctionExpression(currentNode) ||
          t.isArrowFunctionExpression(currentNode) ||
          t.isFunctionDeclaration(currentNode)) &&
        key === 'params'
      ) {
        childIsReference = false;
      }

      const value = (currentNode as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const nested of value) {
          if (nested && typeof nested === 'object' && 'type' in nested) {
            stack.push({ node: nested as t.Node, asReference: childIsReference });
          }
        }
        continue;
      }

      if (value && typeof value === 'object' && 'type' in value) {
        stack.push({ node: value as t.Node, asReference: childIsReference });
      }
    }
  }

  return false;
}

function propertyNameFromExpression(
  property: t.Expression | t.PrivateName,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): string | undefined {
  const inferred = inferPropertyName(property, resolver, depth);
  if (!inferred) {
    return undefined;
  }

  return inferred.value;
}

function resolveObjectPropertyExpression(
  objectNode: t.ObjectExpression,
  propertyName: string,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression | undefined {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  for (let index = objectNode.properties.length - 1; index >= 0; index -= 1) {
    const property = objectNode.properties[index];
    if (!property) {
      continue;
    }

    if (t.isObjectProperty(property)) {
      const keyName = propertyNameFromExpression(property.key, resolver, depth + 1);
      if (keyName === propertyName && t.isExpression(property.value)) {
        return unwrapExpression(property.value);
      }
      continue;
    }

    if (!t.isSpreadElement(property) || !t.isExpression(property.argument)) {
      continue;
    }

    const spreadSource =
      resolveQueryKeyExpression(property.argument, resolver, depth + 1) ?? unwrapExpression(property.argument);
    if (!t.isObjectExpression(spreadSource)) {
      continue;
    }

    const nested = resolveObjectPropertyExpression(spreadSource, propertyName, resolver, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function collectObjectArgumentSubstitutions(
  objectNode: t.ObjectExpression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
  target: Map<string, t.Expression>,
): void {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return;
  }

  for (const property of objectNode.properties) {
    if (!property) {
      continue;
    }

    if (t.isObjectProperty(property)) {
      const key = propertyNameFromExpression(property.key, resolver, depth + 1);
      if (!key || !t.isExpression(property.value)) {
        continue;
      }

      target.set(key, unwrapExpression(property.value));
      continue;
    }

    if (!t.isSpreadElement(property) || !t.isExpression(property.argument)) {
      continue;
    }

    const spreadSource =
      resolveQueryKeyExpression(property.argument, resolver, depth + 1) ?? unwrapExpression(property.argument);
    if (!t.isObjectExpression(spreadSource)) {
      continue;
    }

    collectObjectArgumentSubstitutions(spreadSource, resolver, depth + 1, target);
  }
}

function applyObjectArgumentIdentifierHints(
  expression: t.Expression,
  objectNode: t.ObjectExpression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression {
  const substitutions = new Map<string, t.Expression>();
  collectObjectArgumentSubstitutions(objectNode, resolver, depth + 1, substitutions);
  if (substitutions.size === 0) {
    return expression;
  }

  let nextExpression = expression;
  for (const [identifierName, replacement] of substitutions) {
    if (!expressionContainsIdentifier(nextExpression, identifierName)) {
      continue;
    }

    nextExpression = substituteIdentifierInExpression(nextExpression, identifierName, replacement);
  }

  return nextExpression;
}

function applyCallArgumentHints(
  callNode: t.CallExpression,
  resolvedCall: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression {
  const firstArg = firstExpressionArgument(callNode.arguments);
  if (!firstArg) {
    return resolvedCall;
  }

  const calleeName = callCalleeName(callNode.callee);
  if (
    t.isIdentifier(resolvedCall) &&
    /^query.?keys?$/i.test(resolvedCall.name) &&
    calleeName &&
    /^query.?keys?$/i.test(calleeName)
  ) {
    return resolveQueryKeyExpression(firstArg, resolver, depth + 1) ?? firstArg;
  }

  const resolvedFirstArg = resolveQueryKeyExpression(firstArg, resolver, depth + 1) ?? firstArg;
  if (t.isObjectExpression(resolvedFirstArg)) {
    const hintedByObjectArg = applyObjectArgumentIdentifierHints(resolvedCall, resolvedFirstArg, resolver, depth + 1);
    if (hintedByObjectArg !== resolvedCall) {
      return hintedByObjectArg;
    }
  }

  if (!expressionContainsIdentifier(resolvedCall, 'queryKey')) {
    return resolvedCall;
  }

  return substituteIdentifierInExpression(resolvedCall, 'queryKey', firstArg);
}

function resolveActionOptionsObject(
  node: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth = 0,
): t.ObjectExpression | undefined {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  const unwrapped = unwrapExpression(node);
  if (t.isObjectExpression(unwrapped)) {
    return unwrapped;
  }

  if (t.isCallExpression(unwrapped)) {
    const firstArg = firstExpressionArgument(unwrapped.arguments);
    if (firstArg && unwrapped.arguments.length === 1) {
      if (isIdentityWrapperCall(unwrapped.callee)) {
        return resolveActionOptionsObject(firstArg, resolver, depth + 1);
      }
    }

    const resolvedCall = resolver?.resolveCallResult(unwrapped.callee);
    if (resolvedCall) {
      const hintedCall = applyCallArgumentHints(unwrapped, resolvedCall, resolver, depth + 1);
      return resolveActionOptionsObject(hintedCall, resolver, depth + 1);
    }

    return undefined;
  }

  if (t.isIdentifier(unwrapped) || t.isMemberExpression(unwrapped)) {
    const resolved = resolver?.resolveReference(unwrapped);
    if (resolved) {
      return resolveActionOptionsObject(resolved, resolver, depth + 1);
    }
  }

  return undefined;
}

function resolveQueryKeyExpression(
  node: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth = 0,
): t.Expression | undefined {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  const unwrapped = unwrapExpression(node);

  if (t.isObjectExpression(unwrapped)) {
    const queryKey = findObjectPropertyValue(unwrapped, 'queryKey');
    if (queryKey) {
      return resolveQueryKeyExpression(queryKey, resolver, depth + 1) ?? queryKey;
    }
    return unwrapped;
  }

  if (t.isCallExpression(unwrapped)) {
    const firstArg = firstExpressionArgument(unwrapped.arguments);
    const resolvedFirstArg =
      firstArg && unwrapped.arguments.length === 1
        ? (resolveQueryKeyExpression(firstArg, resolver, depth + 1) ?? firstArg)
        : undefined;

    if (firstArg && unwrapped.arguments.length === 1) {
      if (resolvedFirstArg && t.isObjectExpression(resolvedFirstArg)) {
        const queryKey = findObjectPropertyValue(resolvedFirstArg, 'queryKey');
        if (queryKey) {
          return resolveQueryKeyExpression(queryKey, resolver, depth + 1) ?? queryKey;
        }
      }

      if (isIdentityWrapperCall(unwrapped.callee)) {
        return (
          resolveQueryKeyExpression(resolvedFirstArg ?? firstArg, resolver, depth + 1) ?? resolvedFirstArg ?? firstArg
        );
      }
    }

    const resolvedCall = resolver?.resolveCallResult(unwrapped.callee);
    if (resolvedCall) {
      const hintedCall = applyCallArgumentHints(unwrapped, resolvedCall, resolver, depth + 1);
      return resolveQueryKeyExpression(hintedCall, resolver, depth + 1) ?? hintedCall;
    }

    if (resolvedFirstArg && (t.isObjectExpression(resolvedFirstArg) || t.isArrayExpression(resolvedFirstArg))) {
      return resolvedFirstArg;
    }

    return unwrapped;
  }

  if (t.isIdentifier(unwrapped) || t.isMemberExpression(unwrapped)) {
    const resolved = resolver?.resolveReference(unwrapped);
    if (resolved) {
      return resolveQueryKeyExpression(resolved, resolver, depth + 1) ?? resolved;
    }
  }

  if (t.isMemberExpression(unwrapped) && t.isObjectExpression(unwrapped.object)) {
    const propertyName = propertyNameFromExpression(unwrapped.property, resolver, depth + 1);
    if (!propertyName) {
      return unwrapped;
    }

    const resolved = resolveObjectPropertyExpression(unwrapped.object, propertyName, resolver, depth + 1);
    if (resolved) {
      return resolveQueryKeyExpression(resolved, resolver, depth + 1) ?? resolved;
    }
  }

  if (t.isMemberExpression(unwrapped) && t.isExpression(unwrapped.object)) {
    const propertyName = propertyNameFromExpression(unwrapped.property, resolver, depth + 1);
    if (!propertyName) {
      return unwrapped;
    }

    const resolvedObject = resolveQueryKeyExpression(unwrapped.object, resolver, depth + 1);
    if (resolvedObject && t.isObjectExpression(resolvedObject)) {
      const resolved = resolveObjectPropertyExpression(resolvedObject, propertyName, resolver, depth + 1);
      if (resolved) {
        return resolveQueryKeyExpression(resolved, resolver, depth + 1) ?? resolved;
      }
    }
  }

  return unwrapped;
}

function normalizedUnknownKey(defaultMode: MatchMode): NormalizedQueryKey {
  return {
    id: UNRESOLVED_QUERY_KEY.toLowerCase(),
    display: UNRESOLVED_QUERY_KEY,
    segments: [UNRESOLVED_SEGMENT],
    matchMode: defaultMode,
    resolution: 'dynamic',
    source: 'expression',
  };
}

function normalizeSegmentResult(segment: SegmentResult): SegmentResult {
  const text = segment.text || UNRESOLVED_SEGMENT;
  if (text === '...spread' || text === 'expr' || text === 'call(expr)') {
    return { text: UNRESOLVED_SEGMENT, isStatic: false };
  }

  if (/^\$querykey(s)?$/i.test(text)) {
    return { text: UNRESOLVED_SEGMENT, isStatic: false };
  }

  return {
    text,
    isStatic: segment.isStatic,
  };
}

function shouldTreatAsWildcardActionKey(key: NormalizedQueryKey): boolean {
  if (key.id === 'empty' && key.segments.length === 0) {
    return true;
  }

  if (key.id === UNRESOLVED_QUERY_KEY.toLowerCase()) {
    return true;
  }

  return key.segments.length === 1 && key.segments[0] === UNRESOLVED_SEGMENT;
}

function isPassThroughQueryKeyReference(node: t.Expression | undefined): boolean {
  if (!node) {
    return false;
  }

  const unwrapped = unwrapExpression(node);
  if (t.isIdentifier(unwrapped)) {
    return /^querykeys?$/i.test(unwrapped.name);
  }

  if (!t.isMemberExpression(unwrapped) || unwrapped.computed || !t.isIdentifier(unwrapped.property)) {
    return false;
  }

  return /^querykeys?$/i.test(unwrapped.property.name);
}

function buildPassThroughActionKey(mode: MatchMode): NormalizedQueryKey {
  return {
    id: 'pass-through-query-key',
    display: '$queryKey',
    segments: ['$queryKey'],
    matchMode: mode,
    resolution: 'dynamic',
    source: 'expression',
  };
}

function normalizeActionKeyOrWildcard(
  node: t.Expression | undefined,
  options: { defaultMode?: MatchMode; wildcardIfMissing?: boolean } = {},
  resolver?: QueryKeyResolver,
): NormalizedQueryKey {
  const normalized = normalizeQueryKey(node, options, resolver);
  const mode = options.defaultMode ?? normalized.matchMode;
  const unresolvedQueryKeyReference =
    isPassThroughQueryKeyReference(node) &&
    normalized.source === 'expression' &&
    normalized.segments.length === 1 &&
    !normalized.display.startsWith('[');
  if (unresolvedQueryKeyReference) {
    return buildPassThroughActionKey(mode);
  }

  if (shouldTreatAsWildcardActionKey(normalized)) {
    if (isPassThroughQueryKeyReference(node)) {
      return buildPassThroughActionKey(mode);
    }

    return buildAllQueryCacheKey('dynamic', 'ALL_QUERY_CACHE (unresolved key)');
  }

  return normalized;
}

function segmentsFromArrayElement(
  segment: t.ArrayExpression['elements'][number],
  resolver: QueryKeyResolver | undefined,
  depth: number,
): SegmentResult[] {
  if (!segment) {
    return [{ text: UNRESOLVED_SEGMENT, isStatic: false }];
  }

  if (!t.isSpreadElement(segment)) {
    return [normalizeSegmentResult(segmentFromExpression(segment, resolver, depth + 1))];
  }

  if (!t.isExpression(segment.argument)) {
    return [{ text: UNRESOLVED_SEGMENT, isStatic: false }];
  }

  const spreadSource =
    resolveQueryKeyExpression(segment.argument, resolver, depth + 1) ?? unwrapExpression(segment.argument);
  if (t.isArrayExpression(spreadSource)) {
    const expanded = spreadSource.elements.flatMap((element) => segmentsFromArrayElement(element, resolver, depth + 1));
    if (expanded.length > 0) {
      return expanded;
    }
    return [{ text: UNRESOLVED_SEGMENT, isStatic: false }];
  }

  return [normalizeSegmentResult(segmentFromExpression(spreadSource, resolver, depth + 1))];
}

export function locationFromNode(node: t.Node): { line: number; column: number } {
  if (!node.loc) {
    return { line: 1, column: 1 };
  }

  return {
    line: node.loc.start.line,
    column: node.loc.start.column + 1,
  };
}

export function segmentFromExpression(
  node: t.Expression | t.SpreadElement | t.PrivateName,
  resolver?: QueryKeyResolver,
  depth = 0,
): SegmentResult {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return { text: 'expr', isStatic: false };
  }

  if (t.isSpreadElement(node)) {
    return { text: '...spread', isStatic: false };
  }

  if (t.isPrivateName(node)) {
    return { text: `#${node.id.name}`, isStatic: false };
  }

  const unwrapped = unwrapExpression(node);
  if (t.isIdentifier(unwrapped)) {
    if (unwrapped.name === 'undefined') {
      return { text: 'undefined', isStatic: true };
    }

    const resolvedIdentifier = resolver?.resolveReference(unwrapped);
    if (resolvedIdentifier) {
      const resolvedValue = unwrapExpression(resolvedIdentifier);
      if (t.isCallExpression(resolvedValue)) {
        if (isMemoLikeCall(resolvedValue)) {
          return { text: `$${unwrapped.name}`, isStatic: false };
        }

        if (t.isMemberExpression(resolvedValue.callee) || t.isOptionalMemberExpression(resolvedValue.callee)) {
          return { text: `$${unwrapped.name}`, isStatic: false };
        }

        return segmentFromExpression(resolvedValue, resolver, depth + 1);
      }

      if (t.isMemberExpression(resolvedValue) || t.isOptionalMemberExpression(resolvedValue)) {
        return { text: `$${unwrapped.name}`, isStatic: false };
      }

      return segmentFromExpression(resolvedValue, resolver, depth + 1);
    }

    return { text: `$${unwrapped.name}`, isStatic: false };
  }

  const resolved = resolveWithResolver(unwrapped, resolver, depth);
  if (resolved) {
    return segmentFromExpression(resolved, resolver, depth + 1);
  }

  if (t.isStringLiteral(unwrapped)) {
    return { text: unwrapped.value, isStatic: true };
  }

  if (t.isNumericLiteral(unwrapped) || t.isBooleanLiteral(unwrapped) || t.isBigIntLiteral(unwrapped)) {
    return { text: String(unwrapped.value), isStatic: true };
  }

  if (t.isNullLiteral(unwrapped)) {
    return { text: 'null', isStatic: true };
  }

  if (t.isTemplateLiteral(unwrapped)) {
    const pieces: string[] = [];
    let isStatic = true;

    for (let index = 0; index < unwrapped.quasis.length; index += 1) {
      const quasi = unwrapped.quasis[index];
      if (quasi?.value.cooked) {
        pieces.push(quasi.value.cooked);
      }

      const expr = unwrapped.expressions[index];
      if (!expr) {
        continue;
      }

      const segment = t.isExpression(expr)
        ? segmentFromExpression(expr, resolver, depth + 1)
        : { text: 'type', isStatic: false };
      pieces.push(`\${${segment.text}}`);
      isStatic = isStatic && segment.isStatic;
    }

    return {
      text: pieces.join(''),
      isStatic,
    };
  }

  if (t.isFunctionExpression(unwrapped) || t.isArrowFunctionExpression(unwrapped)) {
    const returned = extractFunctionReturnExpression(unwrapped);
    if (!returned) {
      return { text: 'expr', isStatic: false };
    }

    const resolvedReturn = resolveQueryKeyExpression(returned, resolver, depth + 1) ?? unwrapExpression(returned);
    if (t.isArrayExpression(resolvedReturn)) {
      const first = resolvedReturn.elements[0];
      if (!first) {
        return { text: UNRESOLVED_SEGMENT, isStatic: false };
      }

      const [firstSegment] = segmentsFromArrayElement(first, resolver, depth + 1);
      if (firstSegment) {
        return normalizeSegmentResult(firstSegment);
      }

      return { text: UNRESOLVED_SEGMENT, isStatic: false };
    }

    return segmentFromExpression(resolvedReturn, resolver, depth + 1);
  }

  if (t.isOptionalMemberExpression(unwrapped)) {
    const object = segmentFromExpression(unwrapped.object as t.Expression, resolver, depth + 1);
    const inferredProperty = inferPropertyName(unwrapped.property as t.Expression | t.PrivateName, resolver, depth + 1);

    if (!inferredProperty) {
      return { text: `${object.text}?.?`, isStatic: false };
    }

    if (unwrapped.computed) {
      return {
        text: `${object.text}?.[${inferredProperty.value}]`,
        isStatic: object.isStatic && inferredProperty.isStatic,
      };
    }

    return {
      text: `${object.text}?.${inferredProperty.value}`,
      isStatic: object.isStatic && inferredProperty.isStatic,
    };
  }

  if (t.isMemberExpression(unwrapped)) {
    const propertyName = propertyNameFromExpression(unwrapped.property, resolver, depth + 1);
    let objectExpression: t.ObjectExpression | null = null;
    if (t.isObjectExpression(unwrapped.object)) {
      objectExpression = unwrapped.object;
    } else if (t.isExpression(unwrapped.object)) {
      const resolvedObject = resolveQueryKeyExpression(unwrapped.object, resolver, depth + 1);
      if (resolvedObject && t.isObjectExpression(resolvedObject)) {
        objectExpression = resolvedObject;
      }
    }

    if (propertyName && objectExpression) {
      const resolved = resolveObjectPropertyExpression(objectExpression, propertyName, resolver, depth + 1);
      if (resolved) {
        return segmentFromExpression(resolved, resolver, depth + 1);
      }
    }

    const object = segmentFromExpression(unwrapped.object as t.Expression, resolver, depth + 1);
    const property = propertyName
      ? { value: propertyName, isStatic: true }
      : inferPropertyName(unwrapped.property, resolver, depth + 1);

    if (!property) {
      return { text: `${object.text}.?`, isStatic: false };
    }

    return {
      text: `${object.text}.${property.value}`,
      isStatic: object.isStatic && property.isStatic,
    };
  }

  if (t.isOptionalCallExpression(unwrapped)) {
    if (t.isOptionalMemberExpression(unwrapped.callee)) {
      const objectSegment = t.isExpression(unwrapped.callee.object)
        ? segmentFromExpression(unwrapped.callee.object, resolver, depth + 1)
        : { text: 'expr', isStatic: false };
      const propertySegment = inferPropertyName(unwrapped.callee.property, resolver, depth + 1);
      const simplified = simplifyCollectionMethodCallSegment(objectSegment, propertySegment);
      if (simplified) {
        return simplified;
      }

      const argsSegment = callArgumentsSegment(unwrapped.arguments, resolver, depth + 1);
      const propertyText = propertySegment?.value ?? '?';
      const targetText = unwrapped.callee.computed
        ? `${objectSegment.text}?.[${propertyText}]`
        : `${objectSegment.text}?.${propertyText}`;

      return {
        text: `${targetText}(${argsSegment.text})`,
        isStatic: objectSegment.isStatic && (propertySegment?.isStatic ?? false) && argsSegment.isStatic,
      };
    }

    if (t.isIdentifier(unwrapped.callee)) {
      return { text: `call(${unwrapped.callee.name})`, isStatic: false };
    }

    if (t.isMemberExpression(unwrapped.callee)) {
      const objectSegment = t.isExpression(unwrapped.callee.object)
        ? segmentFromExpression(unwrapped.callee.object, resolver, depth + 1)
        : { text: 'expr', isStatic: false };
      const propertySegment = inferPropertyName(unwrapped.callee.property, resolver, depth + 1);
      const simplified = simplifyCollectionMethodCallSegment(objectSegment, propertySegment);
      if (simplified) {
        return simplified;
      }

      const argsSegment = callArgumentsSegment(unwrapped.arguments, resolver, depth + 1);
      const propertyText = propertySegment?.value ?? '?';
      const targetText = unwrapped.callee.computed
        ? `${objectSegment.text}[${propertyText}]`
        : `${objectSegment.text}.${propertyText}`;

      return {
        text: `${targetText}(${argsSegment.text})`,
        isStatic: objectSegment.isStatic && (propertySegment?.isStatic ?? false) && argsSegment.isStatic,
      };
    }

    return { text: 'call(expr)', isStatic: false };
  }

  if (t.isCallExpression(unwrapped)) {
    const memoReturn = memoLikeCallReturnExpression(unwrapped);
    if (memoReturn) {
      return segmentFromExpression(memoReturn, resolver, depth + 1);
    }

    if (t.isExpression(unwrapped.callee)) {
      const resolvedCallee = resolver?.resolveReference(unwrapped.callee);
      if (resolvedCallee) {
        if (t.isFunctionExpression(resolvedCallee) || t.isArrowFunctionExpression(resolvedCallee)) {
          const returned = extractFunctionReturnExpression(resolvedCallee);
          if (returned) {
            return segmentFromExpression(returned, resolver, depth + 1);
          }
        }

        const resolvedValue = segmentFromExpression(resolvedCallee, resolver, depth + 1);
        if (resolvedValue.text !== 'expr') {
          return resolvedValue;
        }
      }
    }

    if (t.isIdentifier(unwrapped.callee)) {
      return { text: `call(${unwrapped.callee.name})`, isStatic: false };
    }

    if (t.isMemberExpression(unwrapped.callee)) {
      const objectSegment = t.isExpression(unwrapped.callee.object)
        ? segmentFromExpression(unwrapped.callee.object, resolver, depth + 1)
        : { text: 'expr', isStatic: false };
      const propertySegment = inferPropertyName(unwrapped.callee.property, resolver, depth + 1);
      const simplified = simplifyCollectionMethodCallSegment(objectSegment, propertySegment);
      if (simplified) {
        return simplified;
      }

      const argsSegment = callArgumentsSegment(unwrapped.arguments, resolver, depth + 1);
      const propertyText = propertySegment?.value ?? '?';
      const targetText = unwrapped.callee.computed
        ? `${objectSegment.text}[${propertyText}]`
        : `${objectSegment.text}.${propertyText}`;

      return {
        text: `${targetText}(${argsSegment.text})`,
        isStatic: objectSegment.isStatic && (propertySegment?.isStatic ?? false) && argsSegment.isStatic,
      };
    }

    return { text: 'call(expr)', isStatic: false };
  }

  if (t.isArrayExpression(unwrapped)) {
    const childSegments = unwrapped.elements.map((value) => {
      if (!value) {
        return { text: 'undefined', isStatic: true };
      }

      return segmentFromExpression(value, resolver, depth + 1);
    });

    return {
      text: `[${childSegments.map((seg) => seg.text).join(', ')}]`,
      isStatic: childSegments.every((seg) => seg.isStatic),
    };
  }

  if (t.isObjectExpression(unwrapped)) {
    const queryKeyNode = findObjectPropertyValue(unwrapped, 'queryKey');
    if (queryKeyNode) {
      return segmentFromExpression(queryKeyNode, resolver, depth + 1);
    }

    return segmentFromObjectExpression(unwrapped, resolver, depth + 1);
  }

  if (t.isUnaryExpression(unwrapped)) {
    const arg = segmentFromExpression(unwrapped.argument, resolver, depth + 1);
    return { text: `${unwrapped.operator}${arg.text}`, isStatic: arg.isStatic };
  }

  if (t.isLogicalExpression(unwrapped)) {
    const left = normalizeSegmentResult(segmentFromExpression(unwrapped.left, resolver, depth + 1));
    const right = normalizeSegmentResult(segmentFromExpression(unwrapped.right, resolver, depth + 1));

    if (
      (unwrapped.operator === '||' || unwrapped.operator === '??') &&
      (isEmptyFallbackExpression(unwrapped.right) || right.text === UNRESOLVED_SEGMENT)
    ) {
      return left;
    }

    return {
      text: `${left.text} ${unwrapped.operator} ${right.text}`,
      isStatic: left.isStatic && right.isStatic,
    };
  }

  if (t.isConditionalExpression(unwrapped)) {
    return { text: 'cond(...)', isStatic: false };
  }

  return { text: 'expr', isStatic: false };
}

export function readBooleanProperty(objectNode: t.ObjectExpression, propName: string): boolean | undefined {
  const prop = objectNode.properties.find((value) => {
    if (!t.isObjectProperty(value)) {
      return false;
    }

    if (t.isIdentifier(value.key)) {
      return value.key.name === propName;
    }

    if (t.isStringLiteral(value.key)) {
      return value.key.value === propName;
    }

    return false;
  });

  if (!prop || !t.isObjectProperty(prop)) {
    return undefined;
  }

  if (t.isBooleanLiteral(prop.value)) {
    return prop.value.value;
  }

  return undefined;
}

export function findObjectPropertyValue(objectNode: t.ObjectExpression, propName: string): t.Expression | undefined {
  const prop = objectNode.properties.find((value) => {
    if (!t.isObjectProperty(value)) {
      return false;
    }

    if (t.isIdentifier(value.key)) {
      return value.key.name === propName;
    }

    if (t.isStringLiteral(value.key)) {
      return value.key.value === propName;
    }

    return false;
  });

  if (!prop || !t.isObjectProperty(prop) || !t.isExpression(prop.value)) {
    return undefined;
  }

  return unwrapExpression(prop.value);
}

export function normalizeQueryKey(
  node: t.Expression | undefined,
  options: { defaultMode?: MatchMode; wildcardIfMissing?: boolean } = {},
  resolver?: QueryKeyResolver,
): NormalizedQueryKey {
  if (!node) {
    if (options.wildcardIfMissing) {
      return buildAllQueryCacheKey('dynamic', 'ALL_QUERY_CACHE');
    }

    return normalizedUnknownKey(options.defaultMode ?? 'unknown');
  }

  const resolved = resolveQueryKeyExpression(node, resolver) ?? unwrapExpression(node);

  if (t.isArrayExpression(resolved)) {
    const segments = resolved.elements.flatMap((segment) => segmentsFromArrayElement(segment, resolver, 0));

    const resolution = segments.every((seg) => seg.isStatic) ? 'static' : 'dynamic';
    const rawSegments = segments.map((seg) => seg.text || UNRESOLVED_SEGMENT);

    return {
      id: rawSegments.join('|') || 'empty',
      display: `[${rawSegments.join(', ')}]`,
      segments: rawSegments,
      matchMode: options.defaultMode ?? 'prefix',
      resolution,
      source: resolution === 'static' ? 'literal' : 'expression',
    };
  }

  const segment = normalizeSegmentResult(segmentFromExpression(resolved, resolver));
  const resolution = segment.isStatic ? 'static' : 'dynamic';
  return {
    id: segment.text || UNRESOLVED_SEGMENT,
    display: segment.text || UNRESOLVED_SEGMENT,
    segments: [segment.text || UNRESOLVED_SEGMENT],
    matchMode: options.defaultMode ?? 'exact',
    resolution,
    source: resolution === 'static' ? 'literal' : 'expression',
  };
}

export function inferHookQueryKey(
  args: t.CallExpression['arguments'],
  resolver?: QueryKeyResolver,
): NormalizedQueryKey {
  if (args.length === 0) {
    return normalizeQueryKey(undefined, { defaultMode: 'unknown' }, resolver);
  }

  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return normalizeQueryKey(undefined, { defaultMode: 'unknown' }, resolver);
  }

  const resolved = resolveQueryKeyExpression(first, resolver) ?? unwrapExpression(first);
  if (t.isObjectExpression(resolved)) {
    const keyNode = findObjectPropertyValue(resolved, 'queryKey');
    return normalizeQueryKey(keyNode, { defaultMode: 'exact' }, resolver);
  }

  return normalizeQueryKey(resolved, { defaultMode: 'exact' }, resolver);
}

function collectQueryKeyExpressionsFromQueryOptionEntry(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression[] {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return [];
  }

  const resolved = resolveQueryKeyExpression(expression, resolver, depth + 1) ?? unwrapExpression(expression);
  if (t.isConditionalExpression(resolved)) {
    return [
      ...collectQueryKeyExpressionsFromQueryOptionEntry(resolved.consequent, resolver, depth + 1),
      ...collectQueryKeyExpressionsFromQueryOptionEntry(resolved.alternate, resolver, depth + 1),
    ];
  }

  if (t.isLogicalExpression(resolved)) {
    if (resolved.operator === '&&') {
      return collectQueryKeyExpressionsFromQueryOptionEntry(resolved.right, resolver, depth + 1);
    }

    return [
      ...collectQueryKeyExpressionsFromQueryOptionEntry(resolved.left, resolver, depth + 1),
      ...collectQueryKeyExpressionsFromQueryOptionEntry(resolved.right, resolver, depth + 1),
    ];
  }

  if (t.isObjectExpression(resolved)) {
    const queryKeyNode = findObjectPropertyValue(resolved, 'queryKey');
    if (queryKeyNode) {
      return [queryKeyNode];
    }

    const nestedQueriesNode = findObjectPropertyValue(resolved, 'queries');
    if (nestedQueriesNode) {
      return collectQueryKeyExpressionsFromQueriesCollection(nestedQueriesNode, resolver, depth + 1);
    }

    return [];
  }

  if (t.isArrayExpression(resolved)) {
    // `queryOptions(...)` / `infiniteQueryOptions(...)` can resolve directly to a queryKey array.
    return [resolved];
  }

  if (t.isCallExpression(resolved)) {
    return collectQueryKeyExpressionsFromQueryCollectionCall(resolved, resolver, depth + 1);
  }

  return [];
}

function collectQueryKeyExpressionsFromQueriesCollection(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression[] {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return [];
  }

  const resolved = resolveQueryKeyExpression(expression, resolver, depth + 1) ?? unwrapExpression(expression);
  if (t.isConditionalExpression(resolved)) {
    return [
      ...collectQueryKeyExpressionsFromQueriesCollection(resolved.consequent, resolver, depth + 1),
      ...collectQueryKeyExpressionsFromQueriesCollection(resolved.alternate, resolver, depth + 1),
    ];
  }

  if (t.isLogicalExpression(resolved)) {
    if (resolved.operator === '&&') {
      return collectQueryKeyExpressionsFromQueriesCollection(resolved.right, resolver, depth + 1);
    }

    return [
      ...collectQueryKeyExpressionsFromQueriesCollection(resolved.left, resolver, depth + 1),
      ...collectQueryKeyExpressionsFromQueriesCollection(resolved.right, resolver, depth + 1),
    ];
  }

  if (t.isCallExpression(resolved)) {
    return collectQueryKeyExpressionsFromQueryCollectionCall(resolved, resolver, depth + 1);
  }

  if (!t.isArrayExpression(resolved)) {
    return collectQueryKeyExpressionsFromQueryOptionEntry(resolved, resolver, depth + 1);
  }

  const queryKeyNodes: t.Expression[] = [];
  for (const element of resolved.elements) {
    if (!element) {
      continue;
    }

    if (t.isSpreadElement(element)) {
      if (!t.isExpression(element.argument)) {
        continue;
      }

      queryKeyNodes.push(...collectQueryKeyExpressionsFromQueriesCollection(element.argument, resolver, depth + 1));
      continue;
    }

    if (!t.isExpression(element)) {
      continue;
    }

    queryKeyNodes.push(...collectQueryKeyExpressionsFromQueryOptionEntry(element, resolver, depth + 1));
  }

  return queryKeyNodes;
}

function resolveCollectionMapperResult(
  mapperArg: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression | undefined {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  if (t.isFunctionExpression(mapperArg) || t.isArrowFunctionExpression(mapperArg)) {
    return extractFunctionReturnExpression(mapperArg);
  }

  if (!t.isIdentifier(mapperArg) && !t.isMemberExpression(mapperArg)) {
    return undefined;
  }

  const resolved = resolver?.resolveReference(mapperArg);
  if (!resolved) {
    return undefined;
  }

  if (t.isFunctionExpression(resolved) || t.isArrowFunctionExpression(resolved)) {
    return extractFunctionReturnExpression(resolved);
  }

  return resolved;
}

function collectQueryKeyExpressionsFromQueryCollectionCall(
  callNode: t.CallExpression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression[] {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return [];
  }

  if (!t.isMemberExpression(callNode.callee) && !t.isOptionalMemberExpression(callNode.callee)) {
    return [];
  }

  if (callNode.callee.computed || !t.isIdentifier(callNode.callee.property)) {
    return [];
  }

  const method = callNode.callee.property.name;
  const source = t.isExpression(callNode.callee.object)
    ? collectQueryKeyExpressionsFromQueriesCollection(callNode.callee.object, resolver, depth + 1)
    : undefined;

  if (method === 'map') {
    const mapperArg = firstExpressionArgument(callNode.arguments);
    const mapperResult = mapperArg ? resolveCollectionMapperResult(mapperArg, resolver, depth + 1) : undefined;
    if (mapperResult) {
      return collectQueryKeyExpressionsFromQueryOptionEntry(mapperResult, resolver, depth + 1);
    }

    return source ?? [];
  }

  if (method === 'flatMap') {
    const mapperArg = firstExpressionArgument(callNode.arguments);
    const mapperResult = mapperArg ? resolveCollectionMapperResult(mapperArg, resolver, depth + 1) : undefined;
    if (mapperResult) {
      return collectQueryKeyExpressionsFromQueriesCollection(mapperResult, resolver, depth + 1);
    }

    return source ?? [];
  }

  if (QUERY_COLLECTION_PASSTHROUGH_METHODS.has(method)) {
    return source ?? [];
  }

  if (method === 'concat') {
    const combined: t.Expression[] = [...(source ?? [])];
    for (const arg of callNode.arguments) {
      if (!arg || t.isSpreadElement(arg) || !t.isExpression(arg)) {
        continue;
      }
      combined.push(...collectQueryKeyExpressionsFromQueriesCollection(arg, resolver, depth + 1));
    }
    return combined;
  }

  return [];
}

function isQueryCollectionHook(hookName: string): boolean {
  const normalized = hookName.toLowerCase();
  return normalized === 'usequeries' || normalized === 'usesuspensequeries';
}

export function inferHookQueryKeys(
  hookName: string,
  args: t.CallExpression['arguments'],
  resolver?: QueryKeyResolver,
): NormalizedQueryKey[] {
  if (!isQueryCollectionHook(hookName)) {
    return [inferHookQueryKey(args, resolver)];
  }

  if (args.length === 0) {
    return [normalizeQueryKey(undefined, { defaultMode: 'unknown' }, resolver)];
  }

  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return [normalizeQueryKey(undefined, { defaultMode: 'unknown' }, resolver)];
  }

  const resolvedFirst = resolveQueryKeyExpression(first, resolver) ?? unwrapExpression(first);

  let queryKeyExpressions: t.Expression[] = [];
  if (t.isObjectExpression(resolvedFirst)) {
    const queriesNode = findObjectPropertyValue(resolvedFirst, 'queries');
    if (queriesNode) {
      queryKeyExpressions = collectQueryKeyExpressionsFromQueriesCollection(queriesNode, resolver, 0);
    }
  } else if (t.isArrayExpression(resolvedFirst)) {
    queryKeyExpressions = collectQueryKeyExpressionsFromQueriesCollection(resolvedFirst, resolver, 0);
  }

  if (queryKeyExpressions.length === 0) {
    return [inferHookQueryKey(args, resolver)];
  }

  const deduped = new Map<string, NormalizedQueryKey>();
  for (const expression of queryKeyExpressions) {
    const normalized = normalizeQueryKey(expression, { defaultMode: 'exact' }, resolver);
    const dedupeKey = `${normalized.id}|${normalized.display}|${normalized.matchMode}|${normalized.resolution}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, normalized);
    }
  }

  if (deduped.size === 0) {
    return [inferHookQueryKey(args, resolver)];
  }

  return [...deduped.values()];
}

function isInlineQueryKeyObject(expression: t.Expression, depth: number): boolean {
  if (depth >= MAX_HOOK_DIRECT_CHECK_DEPTH) {
    return false;
  }

  const unwrapped = unwrapExpression(expression);
  if (!t.isObjectExpression(unwrapped)) {
    return false;
  }

  if (findObjectPropertyValue(unwrapped, 'queryKey')) {
    return true;
  }

  const queriesNode = findObjectPropertyValue(unwrapped, 'queries');
  if (queriesNode && isInlineQueryKeyCollection(queriesNode, depth + 1)) {
    return true;
  }

  return false;
}

function isInlineQueryKeyCollection(expression: t.Expression, depth: number): boolean {
  if (depth >= MAX_HOOK_DIRECT_CHECK_DEPTH) {
    return false;
  }

  const unwrapped = unwrapExpression(expression);
  if (!t.isArrayExpression(unwrapped)) {
    if (t.isConditionalExpression(unwrapped)) {
      return (
        isInlineQueryKeyCollection(unwrapped.consequent, depth + 1) ||
        isInlineQueryKeyCollection(unwrapped.alternate, depth + 1)
      );
    }

    if (t.isLogicalExpression(unwrapped)) {
      return (
        isInlineQueryKeyCollection(unwrapped.left, depth + 1) || isInlineQueryKeyCollection(unwrapped.right, depth + 1)
      );
    }

    return isInlineQueryKeyObject(unwrapped, depth + 1);
  }

  for (const element of unwrapped.elements) {
    if (!element || t.isSpreadElement(element) || !t.isExpression(element)) {
      continue;
    }

    if (isInlineQueryKeyObject(element, depth + 1)) {
      return true;
    }
  }

  return false;
}

export function isHookCallDirectQueryKeyDeclaration(args: t.CallExpression['arguments'], hookName: string): boolean {
  if (args.length === 0) {
    return false;
  }

  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return false;
  }

  const normalizedHookName = hookName.toLowerCase();
  const unwrapped = unwrapExpression(first);

  if (t.isObjectExpression(unwrapped)) {
    if (findObjectPropertyValue(unwrapped, 'queryKey')) {
      return true;
    }

    const queriesNode = findObjectPropertyValue(unwrapped, 'queries');
    if (queriesNode && isInlineQueryKeyCollection(queriesNode, 0)) {
      return true;
    }

    return false;
  }

  if (t.isArrayExpression(unwrapped)) {
    if (normalizedHookName === 'usequeries') {
      return isInlineQueryKeyCollection(unwrapped, 0);
    }

    return true;
  }

  if (t.isStringLiteral(unwrapped) || t.isTemplateLiteral(unwrapped)) {
    return true;
  }

  return false;
}

function queryKeyIndexFromAccessExpression(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): number | undefined {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  if (!t.isMemberExpression(unwrapped) && !t.isOptionalMemberExpression(unwrapped)) {
    return undefined;
  }

  if (!unwrapped.computed || !t.isExpression(unwrapped.object)) {
    return undefined;
  }

  const object = unwrapExpression(unwrapped.object);
  if (!t.isMemberExpression(object) && !t.isOptionalMemberExpression(object)) {
    return undefined;
  }

  if (object.computed) {
    return undefined;
  }

  const property = inferPropertyName(object.property as t.Expression | t.PrivateName, resolver, depth + 1);
  if (!property || property.value !== 'queryKey') {
    return undefined;
  }

  const indexExpression = unwrapped.property as t.Expression | t.PrivateName;
  let rawIndex: number | undefined;
  if (t.isNumericLiteral(indexExpression)) {
    rawIndex = indexExpression.value;
  } else if (t.isStringLiteral(indexExpression)) {
    rawIndex = Number.parseInt(indexExpression.value, 10);
  } else if (t.isExpression(indexExpression)) {
    const resolvedIndex =
      resolveQueryKeyExpression(indexExpression, resolver, depth + 1) ?? unwrapExpression(indexExpression);
    if (t.isNumericLiteral(resolvedIndex)) {
      rawIndex = resolvedIndex.value;
    } else if (t.isStringLiteral(resolvedIndex)) {
      rawIndex = Number.parseInt(resolvedIndex.value, 10);
    } else {
      const indexSegment = normalizeSegmentResult(segmentFromExpression(resolvedIndex, resolver, depth + 1));
      rawIndex = Number.parseInt(indexSegment.text, 10);
    }
  }

  if (typeof rawIndex !== 'number' || !Number.isFinite(rawIndex) || !Number.isInteger(rawIndex) || rawIndex < 0) {
    return undefined;
  }

  return rawIndex;
}

function setPredicateQueryKeyConstraint(
  constraints: Map<number, SegmentResult>,
  index: number,
  segment: SegmentResult,
): void {
  const normalized = normalizeSegmentResult(segment);
  if (normalized.text === UNRESOLVED_SEGMENT) {
    return;
  }

  const existing = constraints.get(index);
  if (!existing) {
    constraints.set(index, normalized);
    return;
  }

  if (existing.text === normalized.text) {
    constraints.set(index, { text: existing.text, isStatic: existing.isStatic && normalized.isStatic });
    return;
  }

  if (existing.text === UNRESOLVED_SEGMENT) {
    constraints.set(index, normalized);
  }
}

function collectPredicateQueryKeyConstraints(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
  constraints: Map<number, SegmentResult>,
): void {
  if (depth >= MAX_RESOLVE_DEPTH) {
    return;
  }

  const unwrapped = unwrapExpression(expression);
  if (t.isUnaryExpression(unwrapped)) {
    if (t.isExpression(unwrapped.argument)) {
      collectPredicateQueryKeyConstraints(unwrapped.argument, resolver, depth + 1, constraints);
    }
    return;
  }

  if (t.isLogicalExpression(unwrapped)) {
    if (unwrapped.operator === '&&') {
      collectPredicateQueryKeyConstraints(unwrapped.left, resolver, depth + 1, constraints);
      collectPredicateQueryKeyConstraints(unwrapped.right, resolver, depth + 1, constraints);
    }
    return;
  }

  if (!t.isBinaryExpression(unwrapped) || (unwrapped.operator !== '===' && unwrapped.operator !== '==')) {
    return;
  }

  const leftIndex = t.isExpression(unwrapped.left)
    ? queryKeyIndexFromAccessExpression(unwrapped.left, resolver, depth + 1)
    : undefined;
  const rightIndex = t.isExpression(unwrapped.right)
    ? queryKeyIndexFromAccessExpression(unwrapped.right, resolver, depth + 1)
    : undefined;
  if (typeof leftIndex === 'number' && typeof rightIndex === 'number') {
    return;
  }

  if (typeof leftIndex === 'number') {
    if (!t.isExpression(unwrapped.right)) {
      return;
    }
    const resolvedValue =
      resolveQueryKeyExpression(unwrapped.right, resolver, depth + 1) ?? unwrapExpression(unwrapped.right);
    setPredicateQueryKeyConstraint(
      constraints,
      leftIndex,
      normalizeSegmentResult(segmentFromExpression(resolvedValue, resolver, depth + 1)),
    );
    return;
  }

  if (typeof rightIndex === 'number') {
    if (!t.isExpression(unwrapped.left)) {
      return;
    }
    const resolvedValue =
      resolveQueryKeyExpression(unwrapped.left, resolver, depth + 1) ?? unwrapExpression(unwrapped.left);
    setPredicateQueryKeyConstraint(
      constraints,
      rightIndex,
      normalizeSegmentResult(segmentFromExpression(resolvedValue, resolver, depth + 1)),
    );
  }
}

function inferActionQueryKeyFromPredicate(
  predicateNode: t.Expression,
  resolver: QueryKeyResolver | undefined,
): NormalizedQueryKey | undefined {
  const resolvedPredicate = resolveQueryKeyExpression(predicateNode, resolver) ?? unwrapExpression(predicateNode);

  let conditionExpression: t.Expression | undefined;
  if (t.isFunctionExpression(resolvedPredicate) || t.isArrowFunctionExpression(resolvedPredicate)) {
    conditionExpression = extractFunctionReturnExpression(resolvedPredicate);
  } else {
    conditionExpression = resolvedPredicate;
  }

  if (!conditionExpression) {
    return undefined;
  }

  const constraints = new Map<number, SegmentResult>();
  collectPredicateQueryKeyConstraints(conditionExpression, resolver, 0, constraints);
  if (constraints.size === 0) {
    return undefined;
  }

  const segments: SegmentResult[] = [];
  for (let index = 0; ; index += 1) {
    const segment = constraints.get(index);
    if (!segment) {
      break;
    }
    segments.push(normalizeSegmentResult(segment));
  }

  if (segments.length === 0) {
    return undefined;
  }

  const rawSegments = segments.map((segment) => segment.text || UNRESOLVED_SEGMENT);
  const resolution = segments.every((segment) => segment.isStatic) ? 'static' : 'dynamic';
  return {
    id: rawSegments.join('|') || 'empty',
    display: `[${rawSegments.join(', ')}]`,
    segments: rawSegments,
    matchMode: 'prefix',
    resolution,
    source: resolution === 'static' ? 'literal' : 'expression',
  };
}

export function inferActionQueryKey(
  method: string,
  args: t.CallExpression['arguments'],
  resolver?: QueryKeyResolver,
): NormalizedQueryKey {
  if (method === 'clear') {
    return buildAllQueryCacheKey('static', 'ALL_QUERY_CACHE (clear all)');
  }

  if (args.length === 0) {
    return normalizeQueryKey(undefined, { defaultMode: 'all', wildcardIfMissing: true }, resolver);
  }

  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return normalizeQueryKey(undefined, { defaultMode: 'unknown' }, resolver);
  }

  if (method === 'setQueryData') {
    const resolvedFirst = resolveQueryKeyExpression(first, resolver) ?? unwrapExpression(first);
    const normalized = normalizeQueryKey(resolvedFirst, { defaultMode: 'exact' }, resolver);
    const unresolvedPassThroughReference =
      isPassThroughQueryKeyReference(first) &&
      normalized.source === 'expression' &&
      normalized.segments.length === 1 &&
      !normalized.display.startsWith('[');

    if (shouldTreatAsWildcardActionKey(normalized) || unresolvedPassThroughReference) {
      return buildPassThroughActionKey('exact');
    }

    return normalized;
  }

  const resolvedActionOptions = resolveActionOptionsObject(first, resolver);
  if (resolvedActionOptions) {
    const keyNode = findObjectPropertyValue(resolvedActionOptions, 'queryKey');
    const exact = readBooleanProperty(resolvedActionOptions, 'exact');
    const mode: MatchMode = exact === true ? 'exact' : 'prefix';

    if (keyNode) {
      return normalizeActionKeyOrWildcard(keyNode, { defaultMode: mode }, resolver);
    }

    const predicateNode = findObjectPropertyValue(resolvedActionOptions, 'predicate');
    if (predicateNode) {
      const inferredFromPredicate = inferActionQueryKeyFromPredicate(predicateNode, resolver);
      if (inferredFromPredicate) {
        return {
          ...inferredFromPredicate,
          matchMode: exact === true ? 'exact' : inferredFromPredicate.matchMode,
        };
      }
    }

    return normalizeQueryKey(undefined, {
      defaultMode: predicateNode ? 'predicate' : 'all',
      wildcardIfMissing: true,
    });
  }

  const resolved = resolveQueryKeyExpression(first, resolver) ?? unwrapExpression(first);
  if (!t.isObjectExpression(resolved)) {
    return normalizeActionKeyOrWildcard(resolved, { defaultMode: 'prefix' }, resolver);
  }

  const keyNode = findObjectPropertyValue(resolved, 'queryKey');
  const exact = readBooleanProperty(resolved, 'exact');
  const mode: MatchMode = exact === true ? 'exact' : 'prefix';

  if (keyNode) {
    return normalizeActionKeyOrWildcard(keyNode, { defaultMode: mode }, resolver);
  }

  const predicateNode = findObjectPropertyValue(resolved, 'predicate');
  if (predicateNode) {
    const inferredFromPredicate = inferActionQueryKeyFromPredicate(predicateNode, resolver);
    if (inferredFromPredicate) {
      return {
        ...inferredFromPredicate,
        matchMode: exact === true ? 'exact' : inferredFromPredicate.matchMode,
      };
    }
  }

  const hasPredicate = !!predicateNode;
  return normalizeQueryKey(undefined, {
    defaultMode: hasPredicate ? 'predicate' : 'all',
    wildcardIfMissing: true,
  });
}
