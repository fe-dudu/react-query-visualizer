import traverse, { type Binding, type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

import type { ParseContext, QueryKeyResolver } from './types';
import {
  extractLeafIdentifier,
  hookCallInfo,
  queryClientCtorCertainty,
  queryClientHookCallCertainty,
  queryClientObjectCertainty,
  queryClientTypeAnnotationCertainty,
} from './certainty';
import { ACTION_METHOD_TO_RELATION, QUERY_CLIENT_DECLARE_METHODS, QUERY_HOOKS } from './constants';
import { isQueryLikeModule, mergeResolution, setCertainty } from './context';
import {
  findObjectPropertyValue,
  inferActionQueryKey,
  inferHookQueryKey,
  inferHookQueryKeys,
  isHookCallDirectQueryKeyDeclaration,
  locationFromNode,
  normalizeQueryKey,
  readBooleanProperty,
} from './queryKey';
import { extractFunctionReturnExpression, unwrapExpression } from './symbols';
import type { MatchMode, NormalizedQueryKey, QueryRecord, Resolution } from '../../types';

function addRecord(records: QueryRecord[], input: QueryRecord): void {
  records.push(input);
}

const MAX_JSX_PROP_RESOLVE_DEPTH = 16;
const QUERY_KEYS_TO_INVALIDATE_PROP = 'queryKeysToInvalidate';
const MAX_LOCAL_ACTION_ARG_RESOLVE_DEPTH = 12;

interface QueryKeyExpressionCandidate {
  expression: t.Expression;
  locNode: t.Node;
}

function resolveJsxPropExpression(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth = 0,
): t.Expression {
  if (depth >= MAX_JSX_PROP_RESOLVE_DEPTH) {
    return unwrapExpression(expression);
  }

  const unwrapped = unwrapExpression(expression);

  if (t.isIdentifier(unwrapped) || t.isMemberExpression(unwrapped)) {
    const resolved = resolver?.resolveReference(unwrapped);
    if (resolved) {
      return resolveJsxPropExpression(resolved, resolver, depth + 1);
    }
    return unwrapped;
  }

  if (t.isCallExpression(unwrapped)) {
    if (t.isExpression(unwrapped.callee)) {
      const resolvedCallee = resolver?.resolveReference(unwrapped.callee);
      if (resolvedCallee) {
        return resolveJsxPropExpression(resolvedCallee, resolver, depth + 1);
      }
    }

    const resolvedCall = resolver?.resolveCallResult(unwrapped.callee);
    if (resolvedCall) {
      return resolveJsxPropExpression(resolvedCall, resolver, depth + 1);
    }
  }

  return unwrapped;
}

function isUnresolvedNormalizedKey(key: QueryRecord['queryKey']): boolean {
  if (key.segments.length === 1 && key.segments[0] === 'UNRESOLVED') {
    return true;
  }

  return key.id === 'unresolved_query_key';
}

function looksLikeArrayQueryKeyItem(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): boolean {
  if (depth >= MAX_JSX_PROP_RESOLVE_DEPTH) {
    return false;
  }

  const resolved = resolveJsxPropExpression(expression, resolver, depth + 1);
  if (t.isArrayExpression(resolved)) {
    return true;
  }

  const normalized = normalizeQueryKey(expression, { defaultMode: 'prefix' }, resolver);
  if (isUnresolvedNormalizedKey(normalized) || normalized.source === 'wildcard') {
    return false;
  }

  return normalized.display.startsWith('[') && normalized.display.endsWith(']');
}

function isLikelyQueryKeyCollection(
  arrayNode: t.ArrayExpression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): boolean {
  if (depth >= MAX_JSX_PROP_RESOLVE_DEPTH) {
    return false;
  }

  let comparableCount = 0;
  let arrayLikeCount = 0;

  for (const element of arrayNode.elements) {
    if (!element || t.isSpreadElement(element) || !t.isExpression(element)) {
      continue;
    }

    comparableCount += 1;
    if (looksLikeArrayQueryKeyItem(element, resolver, depth + 1)) {
      arrayLikeCount += 1;
    }
  }

  if (comparableCount === 0) {
    return true;
  }

  return arrayLikeCount > 0;
}

function collectQueryKeyExpressionsFromProp(
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth = 0,
): QueryKeyExpressionCandidate[] {
  if (depth >= MAX_JSX_PROP_RESOLVE_DEPTH) {
    return [{ expression, locNode: expression }];
  }

  if (t.isConditionalExpression(expression)) {
    return [
      ...collectQueryKeyExpressionsFromProp(expression.consequent, resolver, depth + 1),
      ...collectQueryKeyExpressionsFromProp(expression.alternate, resolver, depth + 1),
    ];
  }

  if (t.isLogicalExpression(expression)) {
    if (expression.operator === '&&') {
      return collectQueryKeyExpressionsFromProp(expression.right, resolver, depth + 1);
    }

    return [
      ...collectQueryKeyExpressionsFromProp(expression.left, resolver, depth + 1),
      ...collectQueryKeyExpressionsFromProp(expression.right, resolver, depth + 1),
    ];
  }

  const resolvedCollection = resolveJsxPropExpression(expression, resolver, depth + 1);
  if (
    !t.isArrayExpression(resolvedCollection) ||
    !isLikelyQueryKeyCollection(resolvedCollection, resolver, depth + 1)
  ) {
    return [{ expression, locNode: expression }];
  }

  const collected: QueryKeyExpressionCandidate[] = [];
  const useOriginalLocForElements = resolvedCollection !== expression;

  for (const element of resolvedCollection.elements) {
    if (!element) {
      continue;
    }

    if (t.isSpreadElement(element)) {
      if (!t.isExpression(element.argument)) {
        continue;
      }

      const spreadResolved = resolveJsxPropExpression(element.argument, resolver, depth + 1);
      if (t.isArrayExpression(spreadResolved) && isLikelyQueryKeyCollection(spreadResolved, resolver, depth + 1)) {
        const nested = collectQueryKeyExpressionsFromProp(spreadResolved, resolver, depth + 1);
        const locNode = useOriginalLocForElements ? expression : element.argument;
        collected.push(
          ...nested.map((candidate) => ({
            expression: candidate.expression,
            locNode,
          })),
        );
        continue;
      }

      collected.push({
        expression: element.argument,
        locNode: useOriginalLocForElements ? expression : element.argument,
      });
      continue;
    }

    if (!t.isExpression(element)) {
      continue;
    }

    const itemResolved = resolveJsxPropExpression(element, resolver, depth + 1);
    if (t.isArrayExpression(itemResolved) && isLikelyQueryKeyCollection(itemResolved, resolver, depth + 1)) {
      const nested = collectQueryKeyExpressionsFromProp(itemResolved, resolver, depth + 1);
      const locNode = useOriginalLocForElements ? expression : element;
      collected.push(
        ...nested.map((candidate) => ({
          expression: candidate.expression,
          locNode,
        })),
      );
      continue;
    }

    collected.push({
      expression: element,
      locNode: useOriginalLocForElements ? expression : element,
    });
  }

  return collected;
}

function shouldSkipPassThroughUnresolvedAction(
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  queryKey: QueryRecord['queryKey'],
): boolean {
  const node = callPath.node;
  const dynamicUnknown =
    isUnresolvedNormalizedKey(queryKey) || queryKey.source === 'wildcard' || queryKey.id === 'all-query-cache';
  if (!dynamicUnknown) {
    return false;
  }

  const first = node.arguments[0];
  if (!first || !t.isExpression(first)) {
    return false;
  }

  const objectArg = unwrapExpression(first);
  if (!t.isObjectExpression(objectArg)) {
    return false;
  }

  const queryKeyValue = findObjectPropertyValue(objectArg, 'queryKey');
  if (!queryKeyValue) {
    return false;
  }

  const value = unwrapExpression(queryKeyValue);
  if (t.isIdentifier(value)) {
    const binding = callPath.scope.getBinding(value.name);
    // Keep pass-through parameters (`fn(queryKey: QueryKey)`) as action records.
    if (binding?.kind === 'param') {
      return false;
    }

    return true;
  }

  if (t.isMemberExpression(value) && !value.computed && t.isIdentifier(value.property)) {
    if (t.isIdentifier(value.object)) {
      const binding = callPath.scope.getBinding(value.object.name);
      if (binding?.kind === 'param') {
        return false;
      }
    }

    return true;
  }

  return false;
}

function propertyNameFromObjectPropertyKey(key: t.ObjectProperty['key']): string | undefined {
  if (t.isIdentifier(key)) {
    return key.name;
  }

  if (t.isStringLiteral(key)) {
    return key.value;
  }

  if (t.isNumericLiteral(key)) {
    return String(key.value);
  }

  return undefined;
}

function propertyNameFromTypeLiteralKey(key: t.TSPropertySignature['key']): string | undefined {
  if (t.isIdentifier(key)) {
    return key.name;
  }

  if (t.isStringLiteral(key)) {
    return key.value;
  }

  if (t.isNumericLiteral(key)) {
    return String(key.value);
  }

  return undefined;
}

function returnTypeFactoryNameFromEntity(entity: t.TSEntityName): string | undefined {
  if (t.isIdentifier(entity)) {
    return entity.name;
  }

  return entity.right.name;
}

function returnTypeFactoryNameFromType(typeNode: t.TSType | undefined): string | undefined {
  if (!typeNode) {
    return undefined;
  }

  if (t.isTSParenthesizedType(typeNode)) {
    return returnTypeFactoryNameFromType(typeNode.typeAnnotation);
  }

  if (!t.isTSTypeReference(typeNode) || !t.isIdentifier(typeNode.typeName) || typeNode.typeName.name !== 'ReturnType') {
    return undefined;
  }

  const [firstParam] = typeNode.typeParameters?.params ?? [];
  if (!firstParam || !t.isTSTypeQuery(firstParam)) {
    return undefined;
  }

  if (t.isTSImportType(firstParam.exprName)) {
    return undefined;
  }

  return returnTypeFactoryNameFromEntity(firstParam.exprName);
}

function typeAnnotationNodeFromIdentifier(identifier: t.Identifier): t.TSType | undefined {
  const annotation = identifier.typeAnnotation;
  if (!annotation || t.isNoop(annotation) || t.isTypeAnnotation(annotation)) {
    return undefined;
  }

  return annotation.typeAnnotation;
}

function objectPatternPropertyTypeNode(objectPattern: t.ObjectPattern, propertyName: string): t.TSType | undefined {
  const annotation = objectPattern.typeAnnotation;
  if (!annotation || t.isNoop(annotation) || t.isTypeAnnotation(annotation)) {
    return undefined;
  }

  const typeNode = annotation.typeAnnotation;
  if (!t.isTSTypeLiteral(typeNode)) {
    return undefined;
  }

  for (const member of typeNode.members) {
    if (!t.isTSPropertySignature(member) || !member.typeAnnotation) {
      continue;
    }

    const keyName = propertyNameFromTypeLiteralKey(member.key);
    if (keyName !== propertyName) {
      continue;
    }

    return member.typeAnnotation.typeAnnotation;
  }

  return undefined;
}

function objectPatternPropertyNameForBinding(objectPattern: t.ObjectPattern, bindingName: string): string | undefined {
  for (const property of objectPattern.properties) {
    if (!t.isObjectProperty(property)) {
      continue;
    }

    let localName: string | undefined;
    if (t.isIdentifier(property.value)) {
      localName = property.value.name;
    } else if (t.isAssignmentPattern(property.value) && t.isIdentifier(property.value.left)) {
      localName = property.value.left.name;
    }

    if (localName !== bindingName) {
      continue;
    }

    return propertyNameFromObjectPropertyKey(property.key);
  }

  return undefined;
}

function paramBindingTypeNode(binding: Binding): t.TSType | undefined {
  if (binding.path.isIdentifier()) {
    const fromIdentifier = typeAnnotationNodeFromIdentifier(binding.path.node);
    if (fromIdentifier) {
      return fromIdentifier;
    }

    const parentPath = binding.path.parentPath;
    if (!parentPath?.isObjectProperty()) {
      return undefined;
    }

    const keyName = propertyNameFromObjectPropertyKey(parentPath.node.key);
    if (!keyName) {
      return undefined;
    }

    const objectPatternPath = parentPath.parentPath;
    if (!objectPatternPath?.isObjectPattern()) {
      return undefined;
    }

    return objectPatternPropertyTypeNode(objectPatternPath.node, keyName);
  }

  if (binding.path.isObjectPattern()) {
    const bindingName = binding.identifier.name;
    const keyName = objectPatternPropertyNameForBinding(binding.path.node, bindingName) ?? bindingName;
    return objectPatternPropertyTypeNode(binding.path.node, keyName);
  }

  if (binding.path.isObjectProperty()) {
    const keyName = propertyNameFromObjectPropertyKey(binding.path.node.key);
    if (!keyName) {
      return undefined;
    }

    const objectPatternPath = binding.path.parentPath;
    if (!objectPatternPath?.isObjectPattern()) {
      return undefined;
    }

    return objectPatternPropertyTypeNode(objectPatternPath.node, keyName);
  }

  if (binding.path.isAssignmentPattern() && t.isIdentifier(binding.path.node.left)) {
    return typeAnnotationNodeFromIdentifier(binding.path.node.left);
  }

  return undefined;
}

function resolveQueryKeyFactoryReturnFromParam(
  binding: Binding,
  resolver: QueryKeyResolver | undefined,
): t.Expression | undefined {
  if (!resolver) {
    return undefined;
  }

  const typeNode = paramBindingTypeNode(binding);
  const factoryName = returnTypeFactoryNameFromType(typeNode);
  if (!factoryName) {
    return undefined;
  }

  return resolver.resolveCallResult(t.identifier(factoryName));
}

function queryKeyFactoryCandidatesFromMemberProperty(propertyName: string): string[] {
  if (!propertyName.endsWith('QueryKey') || /^querykeys?$/i.test(propertyName)) {
    return [];
  }

  const base = propertyName.slice(0, -'QueryKey'.length);
  if (!base) {
    return [];
  }

  const capitalizedBase = `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
  return [`create${capitalizedBase}QueryKey`, `${base}QueryKey`];
}

function resolveQueryKeyFactoryReturnFromMemberProperty(
  propertyName: string,
  resolver: QueryKeyResolver | undefined,
): t.Expression | undefined {
  if (!resolver) {
    return undefined;
  }

  for (const candidate of queryKeyFactoryCandidatesFromMemberProperty(propertyName)) {
    const resolved = resolver.resolveCallResult(t.identifier(candidate));
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function memberPropertyName(node: t.MemberExpression): string | undefined {
  if (!node.computed && t.isIdentifier(node.property)) {
    return node.property.name;
  }

  if (t.isStringLiteral(node.property)) {
    return node.property.value;
  }

  if (t.isNumericLiteral(node.property)) {
    return String(node.property.value);
  }

  return undefined;
}

function resolveObjectPropertyValue(objectNode: t.ObjectExpression, propertyName: string): t.Expression | undefined {
  for (let index = objectNode.properties.length - 1; index >= 0; index -= 1) {
    const property = objectNode.properties[index];
    if (!property) {
      continue;
    }

    if (t.isObjectProperty(property)) {
      const keyName = propertyNameFromObjectPropertyKey(property.key);
      if (keyName === propertyName && t.isExpression(property.value)) {
        return unwrapExpression(property.value);
      }
      continue;
    }

    if (!t.isSpreadElement(property) || !t.isExpression(property.argument)) {
      continue;
    }

    const spreadSource = unwrapExpression(property.argument);
    if (!t.isObjectExpression(spreadSource)) {
      continue;
    }

    const nested = resolveObjectPropertyValue(spreadSource, propertyName);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function resolveMemberFromExpression(
  node: t.MemberExpression,
  objectExpression: t.Expression,
): t.Expression | undefined {
  const propertyName = memberPropertyName(node);
  if (!propertyName) {
    return undefined;
  }

  if (t.isObjectExpression(objectExpression)) {
    return resolveObjectPropertyValue(objectExpression, propertyName);
  }

  if (!t.isArrayExpression(objectExpression)) {
    return undefined;
  }

  const numericIndex = Number.parseInt(propertyName, 10);
  if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= objectExpression.elements.length) {
    return undefined;
  }

  const element = objectExpression.elements[numericIndex];
  if (!element || !t.isExpression(element)) {
    return undefined;
  }

  return unwrapExpression(element);
}

function substituteIdentifierInExpressionTopLevel(
  expression: t.Expression,
  identifierName: string,
  replacement: t.Expression,
): t.Expression {
  const replaceExpression = (node: t.Expression): t.Expression => {
    if (t.isIdentifier(node)) {
      if (node.name === identifierName) {
        return t.cloneNode(replacement, true);
      }

      return t.cloneNode(node, true);
    }

    if (t.isArrayExpression(node)) {
      const cloned = t.cloneNode(node, true);
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
      const cloned = t.cloneNode(node, true);
      cloned.properties = cloned.properties.map((property) => {
        if (t.isSpreadElement(property)) {
          if (!t.isExpression(property.argument)) {
            return t.cloneNode(property, true);
          }
          return t.spreadElement(replaceExpression(property.argument));
        }

        if (t.isObjectProperty(property)) {
          const key =
            property.computed && t.isExpression(property.key) ? replaceExpression(property.key) : property.key;
          const value = t.isExpression(property.value) ? replaceExpression(property.value) : property.value;
          return t.objectProperty(
            t.cloneNode(key, true),
            t.cloneNode(value, true),
            property.computed,
            property.shorthand && t.isIdentifier(key) && t.isIdentifier(value) && key.name === value.name,
          );
        }

        return t.cloneNode(property, true);
      });
      return cloned;
    }

    if (t.isMemberExpression(node)) {
      const cloned = t.cloneNode(node, true);
      if (t.isExpression(cloned.object)) {
        cloned.object = replaceExpression(cloned.object);
      }
      if (cloned.computed && t.isExpression(cloned.property)) {
        cloned.property = replaceExpression(cloned.property);
      }
      return cloned;
    }

    if (t.isOptionalMemberExpression(node)) {
      const cloned = t.cloneNode(node, true);
      if (t.isExpression(cloned.object)) {
        cloned.object = replaceExpression(cloned.object);
      }
      if (cloned.computed && t.isExpression(cloned.property)) {
        cloned.property = replaceExpression(cloned.property);
      }
      return cloned;
    }

    if (t.isCallExpression(node)) {
      const cloned = t.cloneNode(node, true);
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

    if (t.isOptionalCallExpression(node)) {
      const cloned = t.cloneNode(node, true);
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
      const cloned = t.cloneNode(node, true);
      cloned.expressions = cloned.expressions.map((expr) =>
        t.isExpression(expr) ? replaceExpression(expr) : t.cloneNode(expr, true),
      );
      return cloned;
    }

    if (t.isUnaryExpression(node) || t.isUpdateExpression(node)) {
      const cloned = t.cloneNode(node, true);
      if (t.isExpression(cloned.argument)) {
        cloned.argument = replaceExpression(cloned.argument);
      }
      return cloned;
    }

    if (t.isBinaryExpression(node) || t.isLogicalExpression(node) || t.isAssignmentExpression(node)) {
      const cloned = t.cloneNode(node, true);
      if (t.isExpression(cloned.left)) {
        cloned.left = replaceExpression(cloned.left);
      }
      if (t.isExpression(cloned.right)) {
        cloned.right = replaceExpression(cloned.right);
      }
      return cloned;
    }

    if (t.isConditionalExpression(node)) {
      const cloned = t.cloneNode(node, true);
      cloned.test = replaceExpression(cloned.test);
      cloned.consequent = replaceExpression(cloned.consequent);
      cloned.alternate = replaceExpression(cloned.alternate);
      return cloned;
    }

    if (t.isSequenceExpression(node)) {
      const cloned = t.cloneNode(node, true);
      cloned.expressions = cloned.expressions.map((expr) => replaceExpression(expr));
      return cloned;
    }

    if (t.isParenthesizedExpression(node)) {
      const cloned = t.cloneNode(node, true);
      cloned.expression = replaceExpression(cloned.expression);
      return cloned;
    }

    return t.cloneNode(node, true);
  };

  return replaceExpression(expression);
}

function resolveLocalActionArgExpression(
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  expression: t.Expression,
  resolver: QueryKeyResolver | undefined,
  depth = 0,
  seen = new Set<string>(),
): t.Expression | undefined {
  if (depth >= MAX_LOCAL_ACTION_ARG_RESOLVE_DEPTH) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  if (t.isMemberExpression(unwrapped) && t.isExpression(unwrapped.object)) {
    const propertyName = memberPropertyName(unwrapped);
    const resolvedObject = resolveLocalActionArgExpression(callPath, unwrapped.object, resolver, depth + 1, seen);
    if (resolvedObject) {
      const resolvedMember = resolveMemberFromExpression(unwrapped, resolvedObject);
      if (resolvedMember) {
        const chained = resolveLocalActionArgExpression(callPath, resolvedMember, resolver, depth + 1, seen);
        return chained ?? resolvedMember;
      }
    }

    if (propertyName) {
      const hintedFromFactory = resolveQueryKeyFactoryReturnFromMemberProperty(propertyName, resolver);
      if (hintedFromFactory) {
        const chained = resolveLocalActionArgExpression(callPath, hintedFromFactory, resolver, depth + 1, seen);
        return chained ?? hintedFromFactory;
      }
    }

    const directMemberReference = resolver?.resolveReference(unwrapped);
    if (directMemberReference) {
      const chained = resolveLocalActionArgExpression(callPath, directMemberReference, resolver, depth + 1, seen);
      return chained ?? directMemberReference;
    }

    return undefined;
  }

  if (t.isCallExpression(unwrapped) && t.isExpression(unwrapped.callee)) {
    const isQueryOptionsIdentityCall = (): boolean => {
      if (t.isIdentifier(unwrapped.callee)) {
        return unwrapped.callee.name === 'queryOptions' || unwrapped.callee.name === 'infiniteQueryOptions';
      }

      if (t.isMemberExpression(unwrapped.callee) && !unwrapped.callee.computed) {
        return (
          t.isIdentifier(unwrapped.callee.object) &&
          unwrapped.callee.object.name === 'Object' &&
          t.isIdentifier(unwrapped.callee.property) &&
          unwrapped.callee.property.name === 'freeze'
        );
      }

      return false;
    };

    const firstArg = unwrapped.arguments[0];
    if (isQueryOptionsIdentityCall() && firstArg && !t.isSpreadElement(firstArg) && t.isExpression(firstArg)) {
      const resolvedIdentityArg = unwrapExpression(firstArg);
      const chained = resolveLocalActionArgExpression(callPath, resolvedIdentityArg, resolver, depth + 1, seen);
      return chained ?? resolvedIdentityArg;
    }

    const inlineWithParams = (
      params: Array<t.Identifier | t.Pattern | t.RestElement | t.TSParameterProperty>,
      returned: t.Expression,
    ): t.Expression => {
      let inlined = returned;
      for (let index = 0; index < params.length; index += 1) {
        const param = params[index];
        const arg = unwrapped.arguments[index];
        if (!t.isIdentifier(param) || !arg || t.isSpreadElement(arg) || !t.isExpression(arg)) {
          continue;
        }

        inlined = substituteIdentifierInExpressionTopLevel(inlined, param.name, arg);
      }

      return inlined;
    };

    const inlineCallResult = (
      functionNode: t.FunctionExpression | t.ArrowFunctionExpression,
      fallbackNode?: t.Expression,
    ): t.Expression | undefined => {
      const returned = extractFunctionReturnExpression(functionNode);
      if (!returned) {
        return fallbackNode;
      }

      return inlineWithParams(functionNode.params, returned);
    };

    if (t.isFunctionExpression(unwrapped.callee) || t.isArrowFunctionExpression(unwrapped.callee)) {
      const inlined = inlineCallResult(unwrapped.callee);
      if (inlined) {
        const chained = resolveLocalActionArgExpression(callPath, inlined, resolver, depth + 1, seen);
        return chained ?? inlined;
      }
    }

    if (t.isIdentifier(unwrapped.callee) && !isLikelyQueryKeyFactoryName(unwrapped.callee.name)) {
      const binding = callPath.scope.getBinding(unwrapped.callee.name);
      if (binding?.path.isFunctionDeclaration()) {
        const returned = extractFunctionReturnExpression(binding.path.node);
        if (returned) {
          const inlined = inlineWithParams(binding.path.node.params, returned);
          const chained = resolveLocalActionArgExpression(callPath, inlined, resolver, depth + 1, seen);
          return chained ?? inlined;
        }
      }

      if (binding?.path.isVariableDeclarator()) {
        const init = binding.path.node.init;
        if ((t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) && t.isExpression(init)) {
          const inlined = inlineCallResult(init);
          if (inlined) {
            const chained = resolveLocalActionArgExpression(callPath, inlined, resolver, depth + 1, seen);
            return chained ?? inlined;
          }
        }
      }
    }

    let canInlineResolvedCalleeReference = true;
    if (t.isIdentifier(unwrapped.callee)) {
      if (isLikelyQueryKeyFactoryName(unwrapped.callee.name)) {
        canInlineResolvedCalleeReference = false;
      }

      const calleeBinding = callPath.scope.getBinding(unwrapped.callee.name);
      if (calleeBinding?.kind === 'module') {
        canInlineResolvedCalleeReference = false;
      }
    }

    if (canInlineResolvedCalleeReference) {
      const resolvedCalleeReference = resolver?.resolveReference(unwrapped.callee);
      if (resolvedCalleeReference) {
        const resolvedCalleeExpression = unwrapExpression(resolvedCalleeReference);
        if (t.isFunctionExpression(resolvedCalleeExpression) || t.isArrowFunctionExpression(resolvedCalleeExpression)) {
          const inlined = inlineCallResult(resolvedCalleeExpression);
          if (inlined) {
            const chained = resolveLocalActionArgExpression(callPath, inlined, resolver, depth + 1, seen);
            return chained ?? inlined;
          }
        }
      }
    }

    const resolvedCall = resolver?.resolveCallResult(unwrapped.callee);
    if (!resolvedCall) {
      return undefined;
    }

    const chained = resolveLocalActionArgExpression(callPath, resolvedCall, resolver, depth + 1, seen);
    return chained ?? resolvedCall;
  }

  if (!t.isIdentifier(unwrapped)) {
    return undefined;
  }

  const seenKey = `id:${unwrapped.name}`;
  if (seen.has(seenKey)) {
    return undefined;
  }
  seen.add(seenKey);

  const binding = callPath.scope.getBinding(unwrapped.name);
  if (!binding) {
    return undefined;
  }

  if (binding.kind === 'param') {
    const hintedFromType = resolveQueryKeyFactoryReturnFromParam(binding, resolver);
    if (!hintedFromType) {
      return undefined;
    }

    const chained = resolveLocalActionArgExpression(callPath, hintedFromType, resolver, depth + 1, seen);
    return chained ?? hintedFromType;
  }

  if (binding.kind === 'module' || !binding.constant) {
    return undefined;
  }

  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.node.init;
    if (!init || !t.isExpression(init)) {
      return undefined;
    }

    const resolvedInit = unwrapExpression(init);
    const chained = resolveLocalActionArgExpression(callPath, resolvedInit, resolver, depth + 1, seen);
    return chained ?? resolvedInit;
  }

  if (binding.path.isFunctionDeclaration()) {
    const returned = extractFunctionReturnExpression(binding.path.node);
    if (!returned) {
      return undefined;
    }

    const chained = resolveLocalActionArgExpression(callPath, returned, resolver, depth + 1, seen);
    return chained ?? returned;
  }

  if (binding.path.isAssignmentPattern() && t.isExpression(binding.path.node.right)) {
    const right = unwrapExpression(binding.path.node.right);
    const chained = resolveLocalActionArgExpression(callPath, right, resolver, depth + 1, seen);
    return chained ?? right;
  }

  return undefined;
}

function resolveActionArgsWithLocalBindings(
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  args: t.CallExpression['arguments'],
  resolver: QueryKeyResolver | undefined,
): t.CallExpression['arguments'] {
  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return args;
  }

  const resolvedFirst = resolveLocalActionArgExpression(callPath, first, resolver);
  const candidateFirst = resolvedFirst ?? unwrapExpression(first);
  if (t.isObjectExpression(candidateFirst)) {
    const nextProperties = candidateFirst.properties.map((property) => {
      if (!t.isObjectProperty(property) || !t.isExpression(property.value)) {
        return property;
      }

      const keyName = propertyNameFromObjectPropertyKey(property.key);
      if (keyName !== 'queryKey') {
        return property;
      }

      const resolvedQueryKeyValue = resolveLocalActionArgExpression(callPath, property.value, resolver);
      if (!resolvedQueryKeyValue) {
        return property;
      }

      return t.objectProperty(
        t.cloneNode(property.key, true),
        resolvedQueryKeyValue,
        property.computed,
        property.shorthand &&
          t.isIdentifier(property.key) &&
          t.isIdentifier(resolvedQueryKeyValue) &&
          property.key.name === resolvedQueryKeyValue.name,
      );
    });

    const rewrittenFirst = t.objectExpression(nextProperties);
    return [rewrittenFirst, ...args.slice(1)] as t.CallExpression['arguments'];
  }

  if (!resolvedFirst) {
    return args;
  }

  return [resolvedFirst, ...args.slice(1)] as t.CallExpression['arguments'];
}

function isIgnorablePropQueryKey(key: QueryRecord['queryKey']): boolean {
  if (key.segments.length !== 1) {
    return false;
  }

  const segment = key.segments[0];
  return segment === 'undefined' || segment === '$undefined' || segment === 'null' || segment === '$null';
}

function isLikelyQueryKeyFactoryName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }

  const normalized = name.toLowerCase();
  return normalized.includes('querykey') || normalized.includes('rqkey');
}

export function scanImports(ast: t.File, context: ParseContext): void {
  traverse(ast, {
    ImportDeclaration(importPath: NodePath<t.ImportDeclaration>) {
      const source = importPath.node.source.value;
      const isTanstack = source === '@tanstack/react-query';
      const sourceCertainty: Resolution = isTanstack ? 'static' : 'dynamic';

      for (const specifier of importPath.node.specifiers) {
        if (t.isImportSpecifier(specifier)) {
          const importedName = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
          const localName = specifier.local.name;

          if (QUERY_HOOKS.has(importedName)) {
            setCertainty(context.queryHooks, localName, sourceCertainty);
            context.queryHookKinds.set(localName, importedName);
          }

          if (importedName === 'useQueryClient') {
            setCertainty(context.useQueryClientNames, localName, sourceCertainty);
          }

          if (importedName === 'QueryClient') {
            setCertainty(context.queryClientCtorNames, localName, sourceCertainty);
            setCertainty(context.queryClientTypeNames, localName, sourceCertainty);
          }

          continue;
        }

        if (t.isImportNamespaceSpecifier(specifier) && isQueryLikeModule(source)) {
          setCertainty(context.queryNamespaces, specifier.local.name, sourceCertainty);
          continue;
        }

        if (t.isImportDefaultSpecifier(specifier) && isTanstack) {
          setCertainty(context.queryNamespaces, specifier.local.name, sourceCertainty);
        }
      }
    },
  });
}

export function scanLocalBindings(ast: t.File, context: ParseContext, resolver?: QueryKeyResolver): void {
  function trackIdentifierIfTypedQueryClient(identifier: t.Identifier): void {
    const typeCertainty = queryClientTypeAnnotationCertainty(identifier.typeAnnotation, context);
    if (!typeCertainty) {
      return;
    }

    setCertainty(context.queryClientVars, identifier.name, typeCertainty);
  }

  function objectPatternBindingNameByProperty(pattern: t.ObjectPattern, propertyName: string): string | undefined {
    for (const property of pattern.properties) {
      if (!t.isObjectProperty(property)) {
        continue;
      }

      const keyName = propertyNameFromObjectPropertyKey(property.key);

      if (keyName !== propertyName) {
        continue;
      }

      if (t.isIdentifier(property.value)) {
        return property.value.name;
      }

      if (t.isAssignmentPattern(property.value) && t.isIdentifier(property.value.left)) {
        return property.value.left.name;
      }

      return undefined;
    }

    return undefined;
  }

  function trackObjectPatternIfTypedQueryClient(pattern: t.ObjectPattern): void {
    const annotation = pattern.typeAnnotation;
    if (!annotation || t.isNoop(annotation) || t.isTypeAnnotation(annotation)) {
      return;
    }

    const typeNode = annotation.typeAnnotation;
    if (!t.isTSTypeLiteral(typeNode)) {
      return;
    }

    for (const member of typeNode.members) {
      if (!t.isTSPropertySignature(member) || !member.typeAnnotation) {
        continue;
      }

      const keyName = propertyNameFromTypeLiteralKey(member.key);
      if (!keyName) {
        continue;
      }

      const certainty = queryClientTypeAnnotationCertainty(member.typeAnnotation, context);
      if (!certainty) {
        continue;
      }

      const localBindingName = objectPatternBindingNameByProperty(pattern, keyName);
      if (!localBindingName) {
        continue;
      }

      setCertainty(context.queryClientVars, localBindingName, certainty);
    }
  }

  function trackParamIfTypedQueryClient(param: t.Function['params'][number]): void {
    if (t.isIdentifier(param)) {
      trackIdentifierIfTypedQueryClient(param);
      return;
    }

    if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      trackIdentifierIfTypedQueryClient(param.left);
      return;
    }

    if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      trackIdentifierIfTypedQueryClient(param.argument);
      return;
    }

    if (t.isObjectPattern(param)) {
      trackObjectPatternIfTypedQueryClient(param);
      return;
    }

    if (t.isAssignmentPattern(param) && t.isObjectPattern(param.left)) {
      trackObjectPatternIfTypedQueryClient(param.left);
    }
  }

  function localBindingNameFromObjectPatternProperty(property: t.ObjectProperty): string | undefined {
    if (t.isIdentifier(property.value)) {
      return property.value.name;
    }

    if (t.isAssignmentPattern(property.value) && t.isIdentifier(property.value.left)) {
      return property.value.left.name;
    }

    return undefined;
  }

  function callCalleePropertyName(callee: t.Expression | t.Super | t.V8IntrinsicIdentifier): string | undefined {
    if (t.isIdentifier(callee)) {
      return callee.name;
    }

    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      return callee.property.name;
    }

    if (t.isOptionalMemberExpression(callee) && t.isIdentifier(callee.property)) {
      return callee.property.name;
    }

    return undefined;
  }

  function isHookLikeCallCallee(callee: t.CallExpression['callee']): boolean {
    const name = callCalleePropertyName(callee);
    return !!name && /^use[A-Z0-9_]/.test(name);
  }

  function looksLikeQueryClientPropertyName(name: string | undefined): boolean {
    if (!name) {
      return false;
    }

    return name.toLowerCase() === 'queryclient';
  }

  function typeNameLooksLikeQueryClient(typeName: t.TSEntityName): boolean {
    if (t.isIdentifier(typeName)) {
      return typeName.name.toLowerCase() === 'queryclient';
    }

    if (!t.isTSQualifiedName(typeName)) {
      return false;
    }

    return typeName.right.name.toLowerCase() === 'queryclient';
  }

  function typeLooksLikeQueryClient(typeNode: t.TSType | undefined, depth = 0): boolean {
    if (!typeNode || depth >= 8) {
      return false;
    }

    if (t.isTSParenthesizedType(typeNode)) {
      return typeLooksLikeQueryClient(typeNode.typeAnnotation, depth + 1);
    }

    if (t.isTSTypeReference(typeNode)) {
      return typeNameLooksLikeQueryClient(typeNode.typeName);
    }

    if (t.isTSUnionType(typeNode) || t.isTSIntersectionType(typeNode)) {
      return typeNode.types.some((item) => typeLooksLikeQueryClient(item, depth + 1));
    }

    return false;
  }

  function queryClientCertaintyFromCreateContextCall(callNode: t.CallExpression): Resolution | undefined {
    const calleeName = callCalleePropertyName(callNode.callee);
    if (calleeName !== 'createContext') {
      return undefined;
    }

    const typeParams = callNode.typeParameters;
    if (typeParams && t.isTSTypeParameterInstantiation(typeParams)) {
      const [firstTypeParam] = typeParams.params;
      if (firstTypeParam) {
        if (t.isTSTypeLiteral(firstTypeParam)) {
          for (const member of firstTypeParam.members) {
            if (!t.isTSPropertySignature(member) || !member.typeAnnotation) {
              continue;
            }

            const keyName = propertyNameFromTypeLiteralKey(member.key);
            if (!looksLikeQueryClientPropertyName(keyName)) {
              continue;
            }

            if (typeLooksLikeQueryClient(member.typeAnnotation.typeAnnotation)) {
              return 'static';
            }

            const certaintyFromType = queryClientTypeAnnotationCertainty(member.typeAnnotation, context);
            if (certaintyFromType) {
              return certaintyFromType;
            }
          }
        }

        if (typeLooksLikeQueryClient(firstTypeParam)) {
          return 'static';
        }
      }
    }

    const firstArg = callNode.arguments[0];
    if (!firstArg || t.isSpreadElement(firstArg) || !t.isExpression(firstArg)) {
      return undefined;
    }

    const initialValue = unwrapExpression(firstArg);
    if (!t.isObjectExpression(initialValue)) {
      return undefined;
    }

    const queryClientValue = resolveObjectPropertyValue(initialValue, 'queryClient');
    if (!queryClientValue) {
      return undefined;
    }

    return queryClientCertaintyFromExpression(queryClientValue);
  }

  function queryClientCertaintyFromExpression(expression: t.Expression, depth = 0): Resolution | undefined {
    if (depth >= 8) {
      return undefined;
    }

    const unwrapped = unwrapExpression(expression);

    if (t.isCallExpression(unwrapped)) {
      const calleeName = callCalleePropertyName(unwrapped.callee);
      if (calleeName === 'createContext') {
        const fromCreateContext = queryClientCertaintyFromCreateContextCall(unwrapped);
        if (fromCreateContext) {
          return fromCreateContext;
        }
      }

      if (calleeName === 'useContext') {
        const firstArg = unwrapped.arguments[0];
        if (firstArg && !t.isSpreadElement(firstArg) && t.isExpression(firstArg)) {
          const contextRef = resolver?.resolveReference(firstArg) ?? unwrapExpression(firstArg);
          const fromContext = queryClientCertaintyFromExpression(contextRef, depth + 1);
          if (fromContext) {
            return fromContext;
          }
        }
      }

      const hookCertainty = queryClientHookCallCertainty(unwrapped.callee, context);
      if (hookCertainty) {
        return hookCertainty;
      }

      const resolvedCall = resolver?.resolveCallResult(unwrapped.callee);
      if (resolvedCall) {
        return queryClientCertaintyFromExpression(resolvedCall, depth + 1);
      }

      return undefined;
    }

    if (t.isNewExpression(unwrapped)) {
      return queryClientCtorCertainty(unwrapped.callee, context);
    }

    if (t.isIdentifier(unwrapped) || t.isMemberExpression(unwrapped)) {
      const tracked = queryClientObjectCertainty(unwrapped, context);
      if (tracked) {
        return tracked;
      }

      const resolved = resolver?.resolveReference(unwrapped);
      if (resolved) {
        return queryClientCertaintyFromExpression(resolved, depth + 1);
      }
    }

    if (t.isConditionalExpression(unwrapped)) {
      return (
        queryClientCertaintyFromExpression(unwrapped.consequent, depth + 1) ??
        queryClientCertaintyFromExpression(unwrapped.alternate, depth + 1)
      );
    }

    if (t.isLogicalExpression(unwrapped)) {
      return (
        queryClientCertaintyFromExpression(unwrapped.left, depth + 1) ??
        queryClientCertaintyFromExpression(unwrapped.right, depth + 1)
      );
    }

    return undefined;
  }

  function trackDestructuredQueryClientFromCall(pattern: t.ObjectPattern, initCall: t.CallExpression): void {
    const resolvedCallResult = resolver?.resolveCallResult(initCall.callee);

    for (const property of pattern.properties) {
      if (!t.isObjectProperty(property)) {
        continue;
      }

      const keyName = propertyNameFromObjectPropertyKey(property.key);
      const localName = localBindingNameFromObjectPatternProperty(property);
      if (!localName) {
        continue;
      }

      let certainty: Resolution | undefined;
      if (keyName && resolvedCallResult && t.isObjectExpression(resolvedCallResult)) {
        const resolvedPropertyValue = resolveObjectPropertyValue(resolvedCallResult, keyName);
        if (resolvedPropertyValue) {
          certainty = queryClientCertaintyFromExpression(resolvedPropertyValue);
        }
      }

      const isQueryClientLikeProperty =
        looksLikeQueryClientPropertyName(keyName) || looksLikeQueryClientPropertyName(localName);

      if (!certainty && isQueryClientLikeProperty && resolvedCallResult) {
        certainty = queryClientCertaintyFromExpression(resolvedCallResult);
      }

      if (!certainty && isQueryClientLikeProperty) {
        if (isHookLikeCallCallee(initCall.callee)) {
          certainty = 'dynamic';
        }
      }

      if (certainty) {
        setCertainty(context.queryClientVars, localName, certainty);
      }
    }
  }

  traverse(ast, {
    FunctionDeclaration(functionPath: NodePath<t.FunctionDeclaration>) {
      for (const param of functionPath.node.params) {
        trackParamIfTypedQueryClient(param);
      }
    },

    FunctionExpression(functionPath: NodePath<t.FunctionExpression>) {
      for (const param of functionPath.node.params) {
        trackParamIfTypedQueryClient(param);
      }
    },

    ArrowFunctionExpression(functionPath: NodePath<t.ArrowFunctionExpression>) {
      for (const param of functionPath.node.params) {
        trackParamIfTypedQueryClient(param);
      }
    },

    ObjectMethod(methodPath: NodePath<t.ObjectMethod>) {
      for (const param of methodPath.node.params) {
        trackParamIfTypedQueryClient(param);
      }
    },

    ClassMethod(methodPath: NodePath<t.ClassMethod>) {
      for (const param of methodPath.node.params) {
        trackParamIfTypedQueryClient(param);
      }
    },

    ClassPrivateMethod(methodPath: NodePath<t.ClassPrivateMethod>) {
      for (const param of methodPath.node.params) {
        trackParamIfTypedQueryClient(param);
      }
    },

    VariableDeclarator(variablePath: NodePath<t.VariableDeclarator>) {
      if (t.isIdentifier(variablePath.node.id)) {
        trackIdentifierIfTypedQueryClient(variablePath.node.id);
      }

      const init = variablePath.node.init;
      if (!init) {
        return;
      }

      if (t.isCallExpression(init)) {
        const useClientCertainty = queryClientHookCallCertainty(init.callee, context);
        if (useClientCertainty && t.isIdentifier(variablePath.node.id)) {
          setCertainty(context.queryClientVars, variablePath.node.id.name, useClientCertainty);
        }

        if (t.isObjectPattern(variablePath.node.id)) {
          trackDestructuredQueryClientFromCall(variablePath.node.id, init);
        }
      }

      if (t.isNewExpression(init)) {
        const ctorCertainty = queryClientCtorCertainty(init.callee, context);
        if (ctorCertainty && t.isIdentifier(variablePath.node.id)) {
          setCertainty(context.queryClientVars, variablePath.node.id.name, ctorCertainty);
        }
      }

      if (!t.isCallExpression(init)) {
        return;
      }

      const hook = hookCallInfo(init.callee, context);
      if (!hook) {
        return;
      }

      const hookQueryKey = inferHookQueryKey(init.arguments, resolver);

      if (t.isObjectPattern(variablePath.node.id)) {
        for (const property of variablePath.node.id.properties) {
          if (!t.isObjectProperty(property)) {
            continue;
          }

          if (t.isIdentifier(property.key) && property.key.name === 'refetch' && t.isIdentifier(property.value)) {
            context.refetchFnNames.add(property.value.name);
            context.refetchFnQueryKeys.set(property.value.name, hookQueryKey);
          }
        }
      }

      if (t.isIdentifier(variablePath.node.id)) {
        context.refetchObjectNames.add(variablePath.node.id.name);
        context.refetchObjectQueryKeys.set(variablePath.node.id.name, hookQueryKey);
      }
    },
  });
}

export function scanCalls(
  ast: t.File,
  filePath: string,
  context: ParseContext,
  records: QueryRecord[],
  resolver?: QueryKeyResolver,
): void {
  function memberCallParts(
    callee: t.Expression | t.Super | t.V8IntrinsicIdentifier,
  ): { method: string; object: t.Expression | t.Super | t.V8IntrinsicIdentifier } | undefined {
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      return {
        method: callee.property.name,
        object: callee.object,
      };
    }

    if (t.isOptionalMemberExpression(callee) && t.isIdentifier(callee.property)) {
      return {
        method: callee.property.name,
        object: callee.object,
      };
    }

    return undefined;
  }

  function collectParamIdentifierNames(
    expression: t.Expression,
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  ): string[] {
    const names = new Set<string>();
    const stack: Array<{ node: t.Node; asReference: boolean }> = [{ node: expression, asReference: true }];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const { node: currentNode, asReference } = current;

      if (asReference && t.isIdentifier(currentNode)) {
        const binding = callPath.scope.getBinding(currentNode.name);
        if (binding?.kind === 'param') {
          names.add(currentNode.name);
        }
      }

      const visitorKeys = t.VISITOR_KEYS[currentNode.type];
      if (!visitorKeys) {
        continue;
      }

      for (const key of visitorKeys) {
        let childAsReference = asReference;
        if (t.isObjectProperty(currentNode) && key === 'key' && !currentNode.computed) {
          childAsReference = false;
        }
        if (t.isMemberExpression(currentNode) && key === 'property' && !currentNode.computed) {
          childAsReference = false;
        }
        if (t.isOptionalMemberExpression(currentNode) && key === 'property' && !currentNode.computed) {
          childAsReference = false;
        }
        if (
          (t.isFunctionExpression(currentNode) ||
            t.isArrowFunctionExpression(currentNode) ||
            t.isFunctionDeclaration(currentNode)) &&
          key === 'params'
        ) {
          childAsReference = false;
        }

        const value = (currentNode as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const nested of value) {
            if (nested && typeof nested === 'object' && 'type' in nested) {
              stack.push({ node: nested as t.Node, asReference: childAsReference });
            }
          }
          continue;
        }

        if (value && typeof value === 'object' && 'type' in value) {
          stack.push({ node: value as t.Node, asReference: childAsReference });
        }
      }
    }

    return [...names];
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

        return t.cloneNode(node, true);
      }

      if (t.isArrayExpression(node)) {
        const cloned = t.cloneNode(node, true);
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
        const cloned = t.cloneNode(node, true);
        cloned.properties = cloned.properties.map((property) => {
          if (t.isSpreadElement(property)) {
            if (!t.isExpression(property.argument)) {
              return t.cloneNode(property, true);
            }
            return t.spreadElement(replaceExpression(property.argument));
          }

          if (t.isObjectProperty(property)) {
            const key =
              property.computed && t.isExpression(property.key) ? replaceExpression(property.key) : property.key;
            const value = t.isExpression(property.value) ? replaceExpression(property.value) : property.value;
            return t.objectProperty(
              t.cloneNode(key, true),
              t.cloneNode(value, true),
              property.computed,
              property.shorthand && t.isIdentifier(key) && t.isIdentifier(value) && key.name === value.name,
            );
          }

          return t.cloneNode(property, true);
        });
        return cloned;
      }

      if (t.isMemberExpression(node)) {
        const cloned = t.cloneNode(node, true);
        if (t.isExpression(cloned.object)) {
          cloned.object = replaceExpression(cloned.object);
        }
        if (cloned.computed && t.isExpression(cloned.property)) {
          cloned.property = replaceExpression(cloned.property);
        }
        return cloned;
      }

      if (t.isOptionalMemberExpression(node)) {
        const cloned = t.cloneNode(node, true);
        if (t.isExpression(cloned.object)) {
          cloned.object = replaceExpression(cloned.object);
        }
        if (cloned.computed && t.isExpression(cloned.property)) {
          cloned.property = replaceExpression(cloned.property);
        }
        return cloned;
      }

      if (t.isCallExpression(node)) {
        const cloned = t.cloneNode(node, true);
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

      if (t.isOptionalCallExpression(node)) {
        const cloned = t.cloneNode(node, true);
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
        const cloned = t.cloneNode(node, true);
        cloned.expressions = cloned.expressions.map((expr) =>
          t.isExpression(expr) ? replaceExpression(expr) : t.cloneNode(expr, true),
        );
        return cloned;
      }

      if (t.isUnaryExpression(node) || t.isUpdateExpression(node)) {
        const cloned = t.cloneNode(node, true);
        if (t.isExpression(cloned.argument)) {
          cloned.argument = replaceExpression(cloned.argument);
        }
        return cloned;
      }

      if (t.isBinaryExpression(node) || t.isLogicalExpression(node) || t.isAssignmentExpression(node)) {
        const cloned = t.cloneNode(node, true);
        if (t.isExpression(cloned.left)) {
          cloned.left = replaceExpression(cloned.left);
        }
        if (t.isExpression(cloned.right)) {
          cloned.right = replaceExpression(cloned.right);
        }
        return cloned;
      }

      if (t.isConditionalExpression(node)) {
        const cloned = t.cloneNode(node, true);
        cloned.test = replaceExpression(cloned.test);
        cloned.consequent = replaceExpression(cloned.consequent);
        cloned.alternate = replaceExpression(cloned.alternate);
        return cloned;
      }

      if (t.isSequenceExpression(node)) {
        const cloned = t.cloneNode(node, true);
        cloned.expressions = cloned.expressions.map((expr) => replaceExpression(expr));
        return cloned;
      }

      if (t.isParenthesizedExpression(node)) {
        const cloned = t.cloneNode(node, true);
        cloned.expression = replaceExpression(cloned.expression);
        return cloned;
      }

      return t.cloneNode(node, true);
    };

    return replaceExpression(expression);
  }

  function resolveStaticIterableValues(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    expression: t.Expression,
    depth = 0,
  ): t.Expression[] | undefined {
    if (depth >= 12) {
      return undefined;
    }

    const unwrapped = unwrapExpression(expression);

    if (t.isArrayExpression(unwrapped)) {
      const output: t.Expression[] = [];
      for (const element of unwrapped.elements) {
        if (!element) {
          continue;
        }

        if (t.isSpreadElement(element)) {
          if (!t.isExpression(element.argument)) {
            continue;
          }

          const spreadValues = resolveStaticIterableValues(callPath, element.argument, depth + 1);
          if (!spreadValues) {
            continue;
          }
          output.push(...spreadValues);
          continue;
        }

        if (!t.isExpression(element)) {
          continue;
        }

        const resolvedElement =
          resolveLocalActionArgExpression(callPath, element, resolver, depth + 1, new Set()) ??
          resolver?.resolveReference(element) ??
          unwrapExpression(element);
        output.push(unwrapExpression(resolvedElement));
      }

      return output;
    }

    if (t.isIdentifier(unwrapped) || t.isMemberExpression(unwrapped)) {
      const resolved =
        resolveLocalActionArgExpression(callPath, unwrapped, resolver, depth + 1, new Set()) ??
        resolver?.resolveReference(unwrapped);
      if (!resolved) {
        return undefined;
      }

      return resolveStaticIterableValues(callPath, resolved, depth + 1);
    }

    if (t.isCallExpression(unwrapped)) {
      const resolvedCall = resolver?.resolveCallResult(unwrapped.callee);
      if (!resolvedCall) {
        return undefined;
      }

      return resolveStaticIterableValues(callPath, resolvedCall, depth + 1);
    }

    if (t.isConditionalExpression(unwrapped)) {
      const fromConsequent = resolveStaticIterableValues(callPath, unwrapped.consequent, depth + 1);
      const fromAlternate = resolveStaticIterableValues(callPath, unwrapped.alternate, depth + 1);
      if (!fromConsequent || !fromAlternate) {
        return undefined;
      }

      return [...fromConsequent, ...fromAlternate];
    }

    if (t.isLogicalExpression(unwrapped) && (unwrapped.operator === '||' || unwrapped.operator === '??')) {
      return (
        resolveStaticIterableValues(callPath, unwrapped.left, depth + 1) ??
        resolveStaticIterableValues(callPath, unwrapped.right, depth + 1)
      );
    }

    return undefined;
  }

  function resolveIteratorParamValues(
    binding: Binding,
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  ): t.Expression[] | undefined {
    if (binding.kind !== 'param') {
      return undefined;
    }

    const functionPath = binding.path.getFunctionParent();
    if (!functionPath) {
      return undefined;
    }

    const parentPath = functionPath.parentPath;
    if (!parentPath || (!parentPath.isCallExpression() && !parentPath.isOptionalCallExpression())) {
      return undefined;
    }

    const callbackNode = functionPath.node;
    const iteratorCallNode = parentPath.node;
    const hasCallbackArgument = iteratorCallNode.arguments.some((arg) => {
      return arg === callbackNode;
    });
    if (!hasCallbackArgument) {
      return undefined;
    }

    const iteratorMember = memberCallParts(iteratorCallNode.callee);
    if (!iteratorMember) {
      return undefined;
    }

    if (!['forEach', 'map', 'flatMap'].includes(iteratorMember.method)) {
      return undefined;
    }

    if (!t.isExpression(iteratorMember.object)) {
      return undefined;
    }

    return resolveStaticIterableValues(callPath, iteratorMember.object);
  }

  function expandedQueryKeysFromIteratorParam(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    method: string,
    actionArgs: t.CallExpression['arguments'],
  ): NormalizedQueryKey[] | undefined {
    const first = actionArgs[0];
    if (!first || !t.isExpression(first)) {
      return undefined;
    }

    let queryKeyExpression: t.Expression | undefined;
    let matchMode: MatchMode = method === 'setQueryData' ? 'exact' : 'prefix';

    if (method === 'setQueryData') {
      queryKeyExpression = unwrapExpression(first);
    } else {
      const resolvedFirst = unwrapExpression(first);
      if (!t.isObjectExpression(resolvedFirst)) {
        return undefined;
      }

      queryKeyExpression = findObjectPropertyValue(resolvedFirst, 'queryKey');
      if (!queryKeyExpression) {
        return undefined;
      }

      const exact = readBooleanProperty(resolvedFirst, 'exact');
      matchMode = exact === true ? 'exact' : 'prefix';
    }

    if (!queryKeyExpression) {
      return undefined;
    }

    const paramNames = collectParamIdentifierNames(queryKeyExpression, callPath);
    if (paramNames.length !== 1) {
      return undefined;
    }

    const [paramName] = paramNames;
    const binding = callPath.scope.getBinding(paramName);
    if (!binding) {
      return undefined;
    }

    const values = resolveIteratorParamValues(binding, callPath);
    if (!values || values.length === 0) {
      return undefined;
    }

    const deduped = new Map<string, NormalizedQueryKey>();
    for (const value of values) {
      const replaced = substituteIdentifierInExpression(queryKeyExpression, paramName, value);
      const normalized = normalizeQueryKey(replaced, { defaultMode: matchMode }, resolver);
      if (normalized.source === 'wildcard' || isUnresolvedNormalizedKey(normalized)) {
        continue;
      }

      const dedupeKey = `${normalized.id}:${normalized.display}:${normalized.matchMode}`;
      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, normalized);
      }
    }

    if (deduped.size === 0) {
      return undefined;
    }

    return [...deduped.values()];
  }

  function isQueryCollectionHookName(hookName: string): boolean {
    const normalized = hookName.toLowerCase();
    return normalized === 'usequeries' || normalized === 'usesuspensequeries';
  }

  function isQueryOptionsLikeCall(callee: t.Expression | t.Super | t.V8IntrinsicIdentifier): boolean {
    if (t.isIdentifier(callee)) {
      return callee.name === 'queryOptions' || callee.name === 'infiniteQueryOptions';
    }

    if ((t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) && t.isIdentifier(callee.property)) {
      return callee.property.name === 'queryOptions' || callee.property.name === 'infiniteQueryOptions';
    }

    return false;
  }

  function resolveHookCollectionExpression(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    expression: t.Expression,
    depth: number,
  ): t.Expression {
    if (depth >= 12) {
      return unwrapExpression(expression);
    }

    const localResolved = resolveLocalActionArgExpression(callPath, expression, resolver, depth + 1, new Set());
    if (localResolved) {
      return unwrapExpression(localResolved);
    }

    const resolvedByReference = resolver?.resolveReference(expression);
    if (resolvedByReference) {
      return unwrapExpression(resolvedByReference);
    }

    return unwrapExpression(expression);
  }

  function collectHookQueryKeyTemplatesFromOptionEntry(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    expression: t.Expression,
    depth = 0,
  ): t.Expression[] {
    if (depth >= 12) {
      return [];
    }

    const resolved = resolveHookCollectionExpression(callPath, expression, depth + 1);
    if (t.isConditionalExpression(resolved)) {
      return [
        ...collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved.consequent, depth + 1),
        ...collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved.alternate, depth + 1),
      ];
    }

    if (t.isLogicalExpression(resolved)) {
      if (resolved.operator === '&&') {
        return collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved.right, depth + 1);
      }

      return [
        ...collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved.left, depth + 1),
        ...collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved.right, depth + 1),
      ];
    }

    if (t.isObjectExpression(resolved)) {
      const queryKeyNode = findObjectPropertyValue(resolved, 'queryKey');
      if (queryKeyNode) {
        return [queryKeyNode];
      }

      const queriesNode = findObjectPropertyValue(resolved, 'queries');
      if (queriesNode) {
        return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, queriesNode, depth + 1);
      }

      return [];
    }

    if (t.isArrayExpression(resolved)) {
      // queryOptions()/infiniteQueryOptions() can resolve directly to queryKey arrays.
      return [resolved];
    }

    if (t.isCallExpression(resolved)) {
      if (isQueryOptionsLikeCall(resolved.callee)) {
        const firstArg = resolved.arguments[0];
        if (!firstArg || t.isSpreadElement(firstArg) || !t.isExpression(firstArg)) {
          return [];
        }

        return collectHookQueryKeyTemplatesFromOptionEntry(callPath, firstArg, depth + 1);
      }

      return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, resolved, depth + 1);
    }

    return [];
  }

  function mapperReturnExpression(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    mapperArg: t.Expression,
    depth: number,
  ): t.Expression | undefined {
    if (depth >= 12) {
      return undefined;
    }

    if (t.isFunctionExpression(mapperArg) || t.isArrowFunctionExpression(mapperArg)) {
      return extractFunctionReturnExpression(mapperArg);
    }

    if (!t.isIdentifier(mapperArg) && !t.isMemberExpression(mapperArg)) {
      return undefined;
    }

    const resolved = resolveHookCollectionExpression(callPath, mapperArg, depth + 1);
    if (t.isFunctionExpression(resolved) || t.isArrowFunctionExpression(resolved)) {
      return extractFunctionReturnExpression(resolved);
    }

    return undefined;
  }

  function collectHookQueryKeyTemplatesFromQueriesCollection(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    expression: t.Expression,
    depth = 0,
  ): t.Expression[] {
    if (depth >= 12) {
      return [];
    }

    const resolved = resolveHookCollectionExpression(callPath, expression, depth + 1);
    if (t.isConditionalExpression(resolved)) {
      return [
        ...collectHookQueryKeyTemplatesFromQueriesCollection(callPath, resolved.consequent, depth + 1),
        ...collectHookQueryKeyTemplatesFromQueriesCollection(callPath, resolved.alternate, depth + 1),
      ];
    }

    if (t.isLogicalExpression(resolved)) {
      if (resolved.operator === '&&') {
        return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, resolved.right, depth + 1);
      }

      return [
        ...collectHookQueryKeyTemplatesFromQueriesCollection(callPath, resolved.left, depth + 1),
        ...collectHookQueryKeyTemplatesFromQueriesCollection(callPath, resolved.right, depth + 1),
      ];
    }

    if (t.isCallExpression(resolved)) {
      const member = memberCallParts(resolved.callee);
      if (!member || !t.isExpression(member.object)) {
        return collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved, depth + 1);
      }

      const method = member.method;
      if (method === 'map' || method === 'flatMap') {
        const mapperArg = resolved.arguments[0];
        if (!mapperArg || t.isSpreadElement(mapperArg) || !t.isExpression(mapperArg)) {
          return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, member.object, depth + 1);
        }

        const mappedReturn = mapperReturnExpression(callPath, mapperArg, depth + 1);
        if (!mappedReturn) {
          return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, member.object, depth + 1);
        }

        if (method === 'flatMap') {
          return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, mappedReturn, depth + 1);
        }

        return collectHookQueryKeyTemplatesFromOptionEntry(callPath, mappedReturn, depth + 1);
      }

      if (['filter', 'slice', 'sort', 'reverse', 'toSorted', 'flat'].includes(method)) {
        return collectHookQueryKeyTemplatesFromQueriesCollection(callPath, member.object, depth + 1);
      }

      if (method === 'concat') {
        const combined = collectHookQueryKeyTemplatesFromQueriesCollection(callPath, member.object, depth + 1);
        for (const arg of resolved.arguments) {
          if (!arg || t.isSpreadElement(arg) || !t.isExpression(arg)) {
            continue;
          }

          combined.push(...collectHookQueryKeyTemplatesFromQueriesCollection(callPath, arg, depth + 1));
        }
        return combined;
      }
    }

    if (t.isArrayExpression(resolved)) {
      const queryKeys: t.Expression[] = [];
      for (const element of resolved.elements) {
        if (!element) {
          continue;
        }

        if (t.isSpreadElement(element)) {
          if (!t.isExpression(element.argument)) {
            continue;
          }

          queryKeys.push(...collectHookQueryKeyTemplatesFromQueriesCollection(callPath, element.argument, depth + 1));
          continue;
        }

        if (!t.isExpression(element)) {
          continue;
        }

        queryKeys.push(...collectHookQueryKeyTemplatesFromOptionEntry(callPath, element, depth + 1));
      }
      return queryKeys;
    }

    return collectHookQueryKeyTemplatesFromOptionEntry(callPath, resolved, depth + 1);
  }

  interface HookIteratorExpansionCandidate {
    iterableExpression: t.Expression;
    iteratorParamName: string;
    queryKeyTemplate: t.Expression;
  }

  function collectHookIteratorExpansionCandidates(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    expression: t.Expression,
    depth = 0,
  ): HookIteratorExpansionCandidate[] {
    if (depth >= 12) {
      return [];
    }

    const resolved = resolveHookCollectionExpression(callPath, expression, depth + 1);
    if (t.isConditionalExpression(resolved)) {
      return [
        ...collectHookIteratorExpansionCandidates(callPath, resolved.consequent, depth + 1),
        ...collectHookIteratorExpansionCandidates(callPath, resolved.alternate, depth + 1),
      ];
    }

    if (t.isLogicalExpression(resolved)) {
      if (resolved.operator === '&&') {
        return collectHookIteratorExpansionCandidates(callPath, resolved.right, depth + 1);
      }

      return [
        ...collectHookIteratorExpansionCandidates(callPath, resolved.left, depth + 1),
        ...collectHookIteratorExpansionCandidates(callPath, resolved.right, depth + 1),
      ];
    }

    if (t.isObjectExpression(resolved)) {
      const queriesNode = findObjectPropertyValue(resolved, 'queries');
      if (queriesNode) {
        return collectHookIteratorExpansionCandidates(callPath, queriesNode, depth + 1);
      }
      return [];
    }

    if (t.isArrayExpression(resolved)) {
      const output: HookIteratorExpansionCandidate[] = [];
      for (const element of resolved.elements) {
        if (!element || t.isSpreadElement(element) || !t.isExpression(element)) {
          continue;
        }

        output.push(...collectHookIteratorExpansionCandidates(callPath, element, depth + 1));
      }
      return output;
    }

    if (!t.isCallExpression(resolved)) {
      return [];
    }

    const member = memberCallParts(resolved.callee);
    if (!member || !t.isExpression(member.object)) {
      return [];
    }

    if (member.method === 'map' || member.method === 'flatMap') {
      const mapperArg = resolved.arguments[0];
      if (!mapperArg || t.isSpreadElement(mapperArg) || !t.isExpression(mapperArg)) {
        return [];
      }

      let paramName: string | undefined;
      let mapperReturn: t.Expression | undefined;
      if (t.isFunctionExpression(mapperArg) || t.isArrowFunctionExpression(mapperArg)) {
        const [firstParam] = mapperArg.params;
        if (firstParam && t.isIdentifier(firstParam)) {
          paramName = firstParam.name;
        }
        mapperReturn = extractFunctionReturnExpression(mapperArg);
      } else {
        mapperReturn = mapperReturnExpression(callPath, mapperArg, depth + 1);
      }

      if (!paramName || !mapperReturn) {
        return [];
      }

      const templates =
        member.method === 'flatMap'
          ? collectHookQueryKeyTemplatesFromQueriesCollection(callPath, mapperReturn, depth + 1)
          : collectHookQueryKeyTemplatesFromOptionEntry(callPath, mapperReturn, depth + 1);

      const iterableExpression = member.object;
      return templates.map((template) => ({
        iterableExpression,
        iteratorParamName: paramName,
        queryKeyTemplate: template,
      }));
    }

    if (['filter', 'slice', 'sort', 'reverse', 'toSorted', 'flat'].includes(member.method)) {
      return collectHookIteratorExpansionCandidates(callPath, member.object, depth + 1);
    }

    if (member.method === 'concat') {
      const output = collectHookIteratorExpansionCandidates(callPath, member.object, depth + 1);
      for (const arg of resolved.arguments) {
        if (!arg || t.isSpreadElement(arg) || !t.isExpression(arg)) {
          continue;
        }
        output.push(...collectHookIteratorExpansionCandidates(callPath, arg, depth + 1));
      }
      return output;
    }

    return [];
  }

  function expandedHookQueryKeysFromIteratorParam(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    hookName: string,
    hookArgs: t.CallExpression['arguments'],
  ): NormalizedQueryKey[] | undefined {
    if (!isQueryCollectionHookName(hookName)) {
      return undefined;
    }

    const first = hookArgs[0];
    if (!first || !t.isExpression(first)) {
      return undefined;
    }

    const candidates = collectHookIteratorExpansionCandidates(callPath, first);
    if (candidates.length === 0) {
      return undefined;
    }

    const deduped = new Map<string, NormalizedQueryKey>();
    for (const candidate of candidates) {
      const values = resolveStaticIterableValues(callPath, candidate.iterableExpression);
      if (!values || values.length === 0) {
        continue;
      }

      for (const value of values) {
        const replaced = substituteIdentifierInExpression(
          candidate.queryKeyTemplate,
          candidate.iteratorParamName,
          value,
        );
        const normalized = normalizeQueryKey(replaced, { defaultMode: 'exact' }, resolver);
        if (normalized.source === 'wildcard' || isUnresolvedNormalizedKey(normalized)) {
          continue;
        }

        const dedupeKey = `${normalized.id}:${normalized.display}:${normalized.matchMode}`;
        if (!deduped.has(dedupeKey)) {
          deduped.set(dedupeKey, normalized);
        }
      }
    }

    if (deduped.size === 0) {
      return undefined;
    }

    return [...deduped.values()];
  }

  function expandedHookQueryKeysFromStaticCollection(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    hookName: string,
    hookArgs: t.CallExpression['arguments'],
  ): NormalizedQueryKey[] | undefined {
    if (!isQueryCollectionHookName(hookName)) {
      return undefined;
    }

    const first = hookArgs[0];
    if (!first || !t.isExpression(first)) {
      return undefined;
    }

    const templates = collectHookQueryKeyTemplatesFromQueriesCollection(callPath, first);
    if (templates.length === 0) {
      return undefined;
    }

    const deduped = new Map<string, NormalizedQueryKey>();
    for (const template of templates) {
      const normalized = normalizeQueryKey(template, { defaultMode: 'exact' }, resolver);
      if (normalized.source === 'wildcard' || isUnresolvedNormalizedKey(normalized)) {
        continue;
      }

      const dedupeKey = `${normalized.id}:${normalized.display}:${normalized.matchMode}`;
      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, normalized);
      }
    }

    if (deduped.size === 0) {
      return undefined;
    }

    return [...deduped.values()];
  }

  function handleMemberClientCall(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    callee: t.Expression | t.Super | t.V8IntrinsicIdentifier,
    args: t.CallExpression['arguments'],
    loc: { line: number; column: number },
  ): boolean {
    const member = memberCallParts(callee);
    if (!member) {
      return false;
    }

    const { method, object } = member;

    if (method === 'refetch') {
      const objectName = extractLeafIdentifier(object);
      if (objectName && context.refetchObjectNames.has(objectName)) {
        const queryKey =
          context.refetchObjectQueryKeys.get(objectName) ??
          normalizeQueryKey(undefined, { wildcardIfMissing: true, defaultMode: 'all' }, resolver);
        addRecord(records, {
          relation: 'refetches',
          operation: 'refetch',
          file: filePath,
          loc,
          queryKey,
          resolution: 'dynamic',
        });
        return true;
      }
    }

    if (QUERY_CLIENT_DECLARE_METHODS.has(method)) {
      const certainty = queryClientObjectCertainty(object, context);
      if (!certainty) {
        return false;
      }

      const actionArgs = resolveActionArgsWithLocalBindings(callPath, args, resolver);
      const queryKey = inferActionQueryKey(method, actionArgs, resolver);
      const declaresDirectly = isHookCallDirectQueryKeyDeclaration(args, method);
      addRecord(records, {
        relation: 'declares',
        operation: method,
        file: filePath,
        loc,
        queryKey,
        resolution: mergeResolution(certainty, queryKey.resolution),
        declaresDirectly,
      });
      return true;
    }

    const relation = ACTION_METHOD_TO_RELATION.get(method);
    if (!relation) {
      return false;
    }

    const certainty = queryClientObjectCertainty(object, context);
    if (!certainty) {
      return false;
    }

    const actionArgs = resolveActionArgsWithLocalBindings(callPath, args, resolver);
    const queryKey = inferActionQueryKey(method, actionArgs, resolver);
    const expandedQueryKeys = expandedQueryKeysFromIteratorParam(callPath, method, actionArgs);
    const queryKeys = expandedQueryKeys && expandedQueryKeys.length > 0 ? expandedQueryKeys : [queryKey];

    for (const candidate of queryKeys) {
      if (shouldSkipPassThroughUnresolvedAction(callPath, candidate)) {
        continue;
      }

      addRecord(records, {
        relation,
        operation: method,
        file: filePath,
        loc,
        queryKey: candidate,
        resolution: mergeResolution(certainty, candidate.resolution),
      });
    }

    return true;
  }

  traverse(ast, {
    CallExpression(callPath: NodePath<t.CallExpression>) {
      const { node } = callPath;
      const loc = locationFromNode(node);

      const hook = hookCallInfo(node.callee, context);
      if (hook) {
        const hookArgs = resolveActionArgsWithLocalBindings(callPath, node.arguments, resolver);
        const inferredQueryKeys = inferHookQueryKeys(hook.hook, hookArgs, resolver);
        const expandedByIterator = expandedHookQueryKeysFromIteratorParam(callPath, hook.hook, hookArgs);
        const expandedByStaticCollection = expandedHookQueryKeysFromStaticCollection(callPath, hook.hook, hookArgs);
        let queryKeys = inferredQueryKeys;
        if (expandedByIterator && expandedByIterator.length > 0) {
          queryKeys = expandedByIterator;
        } else if (expandedByStaticCollection && expandedByStaticCollection.length > 0) {
          queryKeys = expandedByStaticCollection;
        }
        const declaresDirectly = isHookCallDirectQueryKeyDeclaration(node.arguments, hook.hook);
        for (const queryKey of queryKeys) {
          addRecord(records, {
            relation: 'declares',
            operation: hook.operation,
            file: filePath,
            loc,
            queryKey,
            resolution: mergeResolution(queryKey.resolution, hook.resolution),
            declaresDirectly,
          });
        }
        return;
      }

      if (t.isIdentifier(node.callee) && context.refetchFnNames.has(node.callee.name)) {
        const queryKey =
          context.refetchFnQueryKeys.get(node.callee.name) ??
          normalizeQueryKey(undefined, { wildcardIfMissing: true, defaultMode: 'all' }, resolver);
        addRecord(records, {
          relation: 'refetches',
          operation: 'refetch',
          file: filePath,
          loc,
          queryKey,
          resolution: 'dynamic',
        });
        return;
      }

      handleMemberClientCall(callPath, node.callee, node.arguments, loc);
    },

    OptionalCallExpression(optionalCallPath: NodePath<t.OptionalCallExpression>) {
      const { node } = optionalCallPath;
      const loc = locationFromNode(node);
      handleMemberClientCall(optionalCallPath, node.callee, node.arguments, loc);
    },

    JSXOpeningElement(jsxPath: NodePath<t.JSXOpeningElement>) {
      const prop = jsxPath.node.attributes.find((attribute) => {
        return (
          t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name) &&
          attribute.name.name === QUERY_KEYS_TO_INVALIDATE_PROP
        );
      });
      if (!prop || !t.isJSXAttribute(prop)) {
        return;
      }

      const value = prop.value;
      if (!value || !t.isJSXExpressionContainer(value) || t.isJSXEmptyExpression(value.expression)) {
        return;
      }

      const queryKeyExpressions = collectQueryKeyExpressionsFromProp(value.expression, resolver);
      if (queryKeyExpressions.length === 0) {
        return;
      }

      const emitted = new Set<string>();

      for (const queryKeyExpression of queryKeyExpressions) {
        const itemLoc = locationFromNode(queryKeyExpression.locNode);
        const queryKey = normalizeQueryKey(queryKeyExpression.expression, { defaultMode: 'prefix' }, resolver);
        if (
          queryKey.source === 'wildcard' ||
          isUnresolvedNormalizedKey(queryKey) ||
          isIgnorablePropQueryKey(queryKey)
        ) {
          continue;
        }

        const dedupeKey = `${queryKey.id}:${queryKey.display}:${itemLoc.line}:${itemLoc.column}`;
        if (emitted.has(dedupeKey)) {
          continue;
        }
        emitted.add(dedupeKey);

        addRecord(records, {
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: filePath,
          loc: itemLoc,
          queryKey,
          resolution: 'dynamic',
        });
      }
    },
  });
}
