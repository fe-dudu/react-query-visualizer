import type { ParseContext, QueryKeyResolver } from './types';
import * as t from './ast';
import { type Binding, type NodePath, traverseAst } from './astTraverse';
import {
  extractLeafIdentifier,
  hookCallInfo,
  queryClientCtorCertainty,
  queryClientHookCallCertainty,
  queryClientObjectCertainty,
  queryClientTypeAnnotationCertainty,
} from './certainty';
import { ACTION_METHOD_TO_RELATION, QUERY_CLIENT_DECLARE_METHODS, QUERY_HOOKS } from './constants';
import { getCertainty, isQueryLikeModule, mergeResolution, setCertainty } from './context';
import {
  buildPassThroughActionKey,
  findObjectPropertyValue,
  inferActionQueryKey,
  inferHookQueryKeys,
  isHookCallDirectQueryKeyDeclaration,
  isOpaqueCollectionQueryKey,
  locationFromNode,
  normalizeQueryKey,
  readBooleanProperty,
  resolveQueryKeyExpression,
} from './queryKey';
import { extractFunctionReturnExpression, unwrapExpression } from './symbols';
import type { MatchMode, NormalizedQueryKey, QueryRecord, Resolution } from '../../shared/contracts';

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

function functionBindingName(
  functionPath: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
): string | undefined {
  const node = functionPath.node;

  if (t.isFunctionDeclaration(node) && node.id) {
    return node.id.name;
  }

  if (t.isFunctionExpression(node) && node.id) {
    return node.id.name;
  }

  const parentPath = functionPath.parentPath;
  if (parentPath?.isVariableDeclarator() && t.isIdentifier(parentPath.node.id)) {
    return parentPath.node.id.name;
  }

  if (parentPath?.isAssignmentExpression() && t.isIdentifier(parentPath.node.left)) {
    return parentPath.node.left.name;
  }

  return undefined;
}

function findBindingInAncestorScopes(path: NodePath, name: string): Binding | undefined {
  let current: NodePath | null = path;
  while (current) {
    const binding = current.scope.getBinding(name);
    if (binding) {
      return binding;
    }
    current = current.parentPath;
  }

  return undefined;
}

function resolveParamFromFunctionCallsite(
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  binding: Binding,
  resolver: QueryKeyResolver | undefined,
  depth: number,
  seen: Set<string>,
): t.Expression | undefined {
  const functionParent = binding.path.getFunctionParent();
  if (!functionParent) {
    return undefined;
  }

  const functionName = functionBindingName(
    functionParent as NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
  );
  if (!functionName) {
    return undefined;
  }

  let rootPath = functionParent;
  while (rootPath.parentPath) {
    rootPath = rootPath.parentPath;
  }

  const propName = binding.identifier.name;
  let resolvedValue: t.Expression | undefined;
  traverseAst(rootPath.node, {
    JSXOpeningElement(openingPath: NodePath<t.JSXOpeningElement>) {
      if (resolvedValue) {
        return;
      }

      const nameNode = openingPath.node.name;
      if (!t.isJSXIdentifier(nameNode) || nameNode.name !== functionName) {
        return;
      }

      const attribute = openingPath.node.attributes.find((attributeNode): attributeNode is t.JSXAttribute => {
        return (
          t.isJSXAttribute(attributeNode) &&
          t.isJSXIdentifier(attributeNode.name) &&
          attributeNode.name.name === propName
        );
      });

      if (!attribute) {
        return;
      }

      const value = attribute.value;
      if (!value || !t.isJSXExpressionContainer(value) || t.isJSXEmptyExpression(value.expression)) {
        return;
      }

      const callsiteFunction = openingPath.getFunctionParent();
      const callsitePath = (callsiteFunction ?? (callPath as unknown as NodePath<t.BaseNode>)) as unknown as NodePath<
        t.CallExpression | t.OptionalCallExpression
      >;
      const candidate = resolveLocalActionArgExpression(callsitePath, value.expression, resolver, depth + 1, seen);
      if (candidate) {
        resolvedValue = candidate;
      }
    },
  });

  return resolvedValue;
}

function getQueriesDataQueryKeyExpression(
  callExpression: t.CallExpression,
  resolver: QueryKeyResolver | undefined,
  depth: number,
): t.Expression | undefined {
  const callee = unwrapExpression(callExpression.callee);
  if (!t.isMemberExpression(callee) || callee.computed || !t.isIdentifier(callee.property)) {
    return undefined;
  }

  if (callee.property.name !== 'getQueriesData') {
    return undefined;
  }

  const firstArg = callExpression.arguments[0];
  if (!firstArg || t.isSpreadElement(firstArg) || !t.isExpression(firstArg)) {
    return undefined;
  }

  const resolvedFirstArg = resolveQueryKeyExpression(firstArg, resolver, depth + 1) ?? unwrapExpression(firstArg);
  if (t.isObjectExpression(resolvedFirstArg)) {
    const queryKeyValue = findObjectPropertyValue(resolvedFirstArg, 'queryKey', resolver);
    if (queryKeyValue) {
      return resolveQueryKeyExpression(queryKeyValue, resolver, depth + 1) ?? queryKeyValue;
    }
  }

  if (t.isArrayExpression(resolvedFirstArg)) {
    return resolvedFirstArg;
  }

  return undefined;
}

function findNamedGetQueriesDataQueryKey(
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  bindingName: string,
  resolver: QueryKeyResolver | undefined,
): t.Expression | undefined {
  let rootPath: NodePath = callPath;
  while (rootPath.parentPath) {
    rootPath = rootPath.parentPath;
  }

  let resolved: t.Expression | undefined;
  traverseAst(rootPath.node, {
    VariableDeclarator(variablePath: NodePath<t.VariableDeclarator>) {
      if (resolved) {
        return;
      }

      if (!t.isIdentifier(variablePath.node.id) || variablePath.node.id.name !== bindingName) {
        return;
      }

      if (!variablePath.node.init || !t.isExpression(variablePath.node.init)) {
        return;
      }

      const initExpression = unwrapExpression(variablePath.node.init);
      if (t.isCallExpression(initExpression)) {
        const queryKey = getQueriesDataQueryKeyExpression(initExpression, resolver, 0);
        if (queryKey) {
          resolved = queryKey;
        }
      }
    },
  });

  return resolved;
}

function resolveNamedGetQueriesDataQueryKeyFromBinding(
  callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
  bindingName: string,
  resolver: QueryKeyResolver | undefined,
): t.Expression | undefined {
  const binding = findBindingInAncestorScopes(callPath, bindingName);
  if (!binding || !binding.path.isVariableDeclarator()) {
    return undefined;
  }

  const init = binding.path.node.init;
  if (!init || !t.isExpression(init) || !t.isCallExpression(init)) {
    return undefined;
  }

  return getQueriesDataQueryKeyExpression(init, resolver, 0);
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

function propertyNameFromObjectPropertyKey(key: t.Node | t.PrivateName | undefined): string | undefined {
  if (!key) {
    return undefined;
  }

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

function propertyNameFromTypeLiteralKey(key: t.Node | t.PrivateName | undefined): string | undefined {
  if (!key) {
    return undefined;
  }

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

function locationFromCallNode(node: t.CallExpression | t.OptionalCallExpression): { line: number; column: number } {
  const callLocation = locationFromNode(node);
  const callee = node.callee;

  if (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) {
    const property = callee.property;
    if ((t.isIdentifier(property) || t.isStringLiteral(property) || t.isNumericLiteral(property)) && property.loc) {
      const propertyLocation = locationFromNode(property);
      if (propertyLocation.line === callLocation.line) {
        return propertyLocation;
      }
    }
  }

  if ('loc' in callee && callee.loc) {
    const calleeLocation = locationFromNode(callee as t.Node);
    if (calleeLocation.line === callLocation.line) {
      return calleeLocation;
    }
  }

  return callLocation;
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

  const [firstParam] = typeNode.typeParameters?.params ?? typeNode.typeArguments?.params ?? [];
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
  if (!annotation || t.isNoop(annotation)) {
    return undefined;
  }

  return (annotation as t.TypeAnnotation).typeAnnotation;
}

function typeNodePropertyTypeNode(typeNode: t.TSType | undefined, propertyName: string): t.TSType | undefined {
  if (!typeNode) {
    return undefined;
  }

  if (t.isTSParenthesizedType(typeNode)) {
    return typeNodePropertyTypeNode(typeNode.typeAnnotation, propertyName);
  }

  if (t.isTSTypeLiteral(typeNode)) {
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

  if (t.isTSIntersectionType(typeNode) || t.isTSUnionType(typeNode)) {
    for (const memberType of typeNode.types) {
      const resolved = typeNodePropertyTypeNode(memberType, propertyName);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  return undefined;
}

function objectPatternPropertyTypeNode(objectPattern: t.ObjectPattern, propertyName: string): t.TSType | undefined {
  const annotation = objectPattern.typeAnnotation;
  if (!annotation || t.isNoop(annotation)) {
    return undefined;
  }

  const typeNode = (annotation as t.TypeAnnotation).typeAnnotation;
  return typeNodePropertyTypeNode(typeNode, propertyName);
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
  if (t.isFunctionExpression(unwrapped) || t.isArrowFunctionExpression(unwrapped)) {
    const returned = extractFunctionReturnExpression(unwrapped);
    if (!returned) {
      return unwrapped;
    }

    const resolvedReturned = resolveLocalActionArgExpression(callPath, returned, resolver, depth + 1, seen);
    return resolvedReturned ?? returned;
  }

  if (t.isArrayExpression(unwrapped)) {
    let changed = false;
    const elements = unwrapped.elements.map((element) => {
      if (!element) {
        return null;
      }

      if (t.isSpreadElement(element) && t.isExpression(element.argument)) {
        const resolvedSpread =
          resolveLocalActionArgExpression(callPath, element.argument, resolver, depth + 1, seen) ??
          unwrapExpression(element.argument);
        if (resolvedSpread !== element.argument) {
          changed = true;
        }
        return t.spreadElement(resolvedSpread);
      }

      if (!t.isExpression(element)) {
        return t.cloneNode(element, true);
      }

      const resolvedElement = resolveLocalActionArgExpression(callPath, element, resolver, depth + 1, seen);
      if (resolvedElement && resolvedElement !== element) {
        changed = true;
        return t.cloneNode(resolvedElement, true);
      }

      return t.cloneNode(element, true);
    });

    if (!changed) {
      return unwrapped;
    }

    const cloned = t.cloneNode(unwrapped, false);
    cloned.elements = elements;
    return cloned;
  }

  if (t.isObjectExpression(unwrapped)) {
    let changed = false;
    const properties = unwrapped.properties.flatMap((property) => {
      if (t.isSpreadElement(property) && t.isExpression(property.argument)) {
        const resolvedSpread =
          resolveLocalActionArgExpression(callPath, property.argument, resolver, depth + 1, seen) ??
          unwrapExpression(property.argument);
        if (t.isObjectExpression(resolvedSpread)) {
          changed = true;
          const nested = resolveLocalActionArgExpression(callPath, resolvedSpread, resolver, depth + 1, seen);
          if (nested && t.isObjectExpression(nested)) {
            return nested.properties;
          }
          return resolvedSpread.properties;
        }
      }

      if (t.isObjectProperty(property) && t.isExpression(property.value)) {
        const resolvedValue = resolveLocalActionArgExpression(callPath, property.value, resolver, depth + 1, seen);
        if (resolvedValue && resolvedValue !== property.value) {
          changed = true;
          return [
            t.objectProperty(
              t.cloneNode(property.key, true),
              resolvedValue,
              property.computed,
              property.shorthand &&
                t.isIdentifier(property.key) &&
                t.isIdentifier(resolvedValue) &&
                property.key.name === resolvedValue.name,
            ),
          ];
        }
      }

      return [property];
    });

    if (changed) {
      return t.objectExpression(properties);
    }

    return unwrapped;
  }

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
    let calleeName: string | undefined;
    if (t.isIdentifier(unwrapped.callee)) {
      calleeName = unwrapped.callee.name;
    } else if (
      t.isMemberExpression(unwrapped.callee) &&
      !unwrapped.callee.computed &&
      t.isIdentifier(unwrapped.callee.property)
    ) {
      calleeName = unwrapped.callee.property.name;
    }

    if (calleeName === 'useState' || calleeName === 'useReducer') {
      const firstArg = unwrapped.arguments[0];
      if (!firstArg || t.isSpreadElement(firstArg) || !t.isExpression(firstArg)) {
        return undefined;
      }
      const resolvedFirstArg = resolveLocalActionArgExpression(callPath, firstArg, resolver, depth + 1, seen);
      return resolvedFirstArg ?? firstArg;
    }

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

    const queryResolved = resolveQueryKeyExpression(unwrapped, resolver, depth + 1);
    if (queryResolved && (t.isArrayExpression(queryResolved) || t.isObjectExpression(queryResolved))) {
      return queryResolved;
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

    if (t.isIdentifier(unwrapped.callee)) {
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
  const resolvedBinding = binding ?? findBindingInAncestorScopes(callPath, unwrapped.name);
  if (!resolvedBinding) {
    return undefined;
  }

  if (resolvedBinding.kind === 'param') {
    const hintedFromType = resolveQueryKeyFactoryReturnFromParam(resolvedBinding, resolver);
    if (hintedFromType) {
      const chained = resolveLocalActionArgExpression(callPath, hintedFromType, resolver, depth + 1, seen);
      return chained ?? hintedFromType;
    }

    const hintedFromCallsite = resolveParamFromFunctionCallsite(callPath, resolvedBinding, resolver, depth, seen);
    if (hintedFromCallsite) {
      const chained = resolveLocalActionArgExpression(callPath, hintedFromCallsite, resolver, depth + 1, seen);
      return chained ?? hintedFromCallsite;
    }

    return undefined;
  }

  if (resolvedBinding.path.parentPath?.node.type === 'ArrayPattern') {
    const arrayPattern = resolvedBinding.path.parentPath.node as t.ArrayPattern;
    const patternParent = resolvedBinding.path.parentPath.parentPath;
    let sourceExpression: t.Expression | undefined;

    if (patternParent?.isVariableDeclarator() && patternParent.node.init && t.isExpression(patternParent.node.init)) {
      sourceExpression = unwrapExpression(patternParent.node.init);
    } else if (patternParent?.isVariableDeclarator()) {
      const declarationParent = patternParent.parentPath;
      const loopParent = declarationParent?.parentPath;
      if (
        declarationParent?.isVariableDeclaration() &&
        loopParent &&
        t.isForOfStatement(loopParent.node) &&
        t.isExpression(loopParent.node.right)
      ) {
        sourceExpression = unwrapExpression(loopParent.node.right);
      }
    } else if (patternParent && t.isForOfStatement(patternParent.node) && t.isExpression(patternParent.node.right)) {
      sourceExpression = unwrapExpression(patternParent.node.right);
    }

    if (sourceExpression) {
      const elementIndex = arrayPattern.elements.findIndex((element) => {
        if (element === resolvedBinding.path.node) {
          return true;
        }

        return t.isIdentifier(element) && element.name === resolvedBinding.identifier.name;
      });

      if (elementIndex >= 0) {
        if (elementIndex === 0) {
          const localCollectionKey = t.isCallExpression(sourceExpression)
            ? getQueriesDataQueryKeyExpression(sourceExpression, resolver, depth + 1)
            : undefined;
          if (localCollectionKey) {
            return localCollectionKey;
          }

          if (t.isIdentifier(sourceExpression) || t.isMemberExpression(sourceExpression)) {
            const collectionName = t.isIdentifier(sourceExpression)
              ? sourceExpression.name
              : memberPropertyName(sourceExpression);
            if (collectionName) {
              const namedCollectionKey =
                resolveNamedGetQueriesDataQueryKeyFromBinding(callPath, collectionName, resolver) ??
                findNamedGetQueriesDataQueryKey(callPath, collectionName, resolver);
              if (namedCollectionKey) {
                return namedCollectionKey;
              }
            }
          }
        }

        const resolvedInit = resolveLocalActionArgExpression(callPath, sourceExpression, resolver, depth + 1, seen);
        return resolvedInit ?? sourceExpression;
      }
    }
  }

  if (resolvedBinding.kind === 'module' || !resolvedBinding.constant) {
    if (resolvedBinding.kind === 'module') {
      return undefined;
    }

    const assignedExpressions: t.Expression[] = [];
    for (const violation of resolvedBinding.constantViolations) {
      if (!violation.isAssignmentExpression()) {
        return undefined;
      }

      const left = violation.node.left;
      if (!t.isIdentifier(left) || left.name !== resolvedBinding.identifier.name) {
        return undefined;
      }

      if (!t.isExpression(violation.node.right)) {
        return undefined;
      }

      assignedExpressions.push(unwrapExpression(violation.node.right));
    }

    const functionParent = resolvedBinding.path.getFunctionParent();
    if (functionParent) {
      let scopedAssignedExpression: t.Expression | undefined;
      const visit = (current: t.Node): void => {
        if (
          t.isAssignmentExpression(current) &&
          t.isIdentifier(current.left) &&
          current.left.name === resolvedBinding.identifier.name &&
          t.isExpression(current.right)
        ) {
          scopedAssignedExpression = unwrapExpression(current.right);
        }

        t.forEachNodeChild(current, (child) => {
          visit(child);
        });
      };

      visit(functionParent.node);
      if (scopedAssignedExpression) {
        const scopedResolved = resolveLocalActionArgExpression(
          callPath,
          scopedAssignedExpression,
          resolver,
          depth + 1,
          seen,
        );
        return scopedResolved ?? scopedAssignedExpression;
      }
    }

    const assignedExpression = assignedExpressions[assignedExpressions.length - 1];

    if (assignedExpression) {
      const mutableResolved = resolveLocalActionArgExpression(callPath, assignedExpression, resolver, depth + 1, seen);
      return mutableResolved ?? assignedExpression;
    }

    return undefined;
  }

  if (resolvedBinding.path.isVariableDeclarator()) {
    const init = resolvedBinding.path.node.init;
    if (!init || !t.isExpression(init)) {
      return undefined;
    }

    const resolvedInit = unwrapExpression(init);
    const chained = resolveLocalActionArgExpression(callPath, resolvedInit, resolver, depth + 1, seen);
    return chained ?? resolvedInit;
  }

  if (resolvedBinding.path.isFunctionDeclaration()) {
    const returned = extractFunctionReturnExpression(resolvedBinding.path.node);
    if (!returned) {
      return undefined;
    }

    const chained = resolveLocalActionArgExpression(callPath, returned, resolver, depth + 1, seen);
    return chained ?? returned;
  }

  if (resolvedBinding.path.isAssignmentPattern() && t.isExpression(resolvedBinding.path.node.right)) {
    const right = unwrapExpression(resolvedBinding.path.node.right);
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

  const candidateFirst = unwrapExpression(first);
  if (t.isObjectExpression(candidateFirst)) {
    const nextProperties = candidateFirst.properties.map((property) => {
      if (!t.isObjectProperty(property)) {
        return property;
      }

      if (!t.isExpression(property.value)) {
        return property;
      }

      const keyName = propertyNameFromObjectPropertyKey(property.key);
      const resolvedValue =
        keyName === 'queryKey'
          ? (() => {
              const queryResolved = resolveQueryKeyExpression(property.value, resolver);
              if (queryResolved) {
                const chainedResolved = resolveLocalActionArgExpression(callPath, queryResolved, resolver);
                return chainedResolved ?? queryResolved;
              }

              return resolveLocalActionArgExpression(callPath, property.value, resolver);
            })()
          : resolveLocalActionArgExpression(callPath, property.value, resolver);

      if (!resolvedValue) {
        return property;
      }

      return t.objectProperty(
        t.cloneNode(property.key, true),
        resolvedValue,
        property.computed,
        property.shorthand &&
          t.isIdentifier(property.key) &&
          t.isIdentifier(resolvedValue) &&
          property.key.name === resolvedValue.name,
      );
    });

    const rewrittenFirst = t.objectExpression(nextProperties);
    return [rewrittenFirst, ...args.slice(1)] as t.CallExpression['arguments'];
  }

  const resolvedFirst = resolveLocalActionArgExpression(callPath, first, resolver);
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

export function scanImports(ast: t.File, context: ParseContext): void {
  traverseAst(ast, {
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

export function scanLocalBindings(
  ast: t.File,
  context: ParseContext,
  resolver?: QueryKeyResolver,
  filePath = '',
): void {
  function bindingScopeId(binding: Binding): string | undefined {
    const loc = binding.identifier.loc?.start;
    if (!loc) {
      return undefined;
    }

    return `${filePath}:${loc.line}:${loc.column + 1}:${binding.identifier.name}`;
  }

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
    if (!annotation || t.isNoop(annotation)) {
      return;
    }

    const typeNode = (annotation as t.TypeAnnotation).typeAnnotation;
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

  function localBindingNameFromObjectPatternProperty(
    property: t.ObjectProperty | t.AssignmentTargetProperty | t.BindingProperty,
  ): string | undefined {
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

  traverseAst(ast, {
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

      const resolvedHookArgs = resolveActionArgsWithLocalBindings(
        variablePath as unknown as NodePath<t.CallExpression | t.OptionalCallExpression>,
        init.arguments,
        resolver,
      );
      const [hookQueryKey] = inferHookQueryKeys(hook.hook, resolvedHookArgs, resolver);
      if (!hookQueryKey) {
        return;
      }

      if (t.isObjectPattern(variablePath.node.id)) {
        for (const property of variablePath.node.id.properties) {
          if (!t.isObjectProperty(property)) {
            continue;
          }

          if (t.isIdentifier(property.key) && property.key.name === 'refetch' && t.isIdentifier(property.value)) {
            context.refetchFnNames.add(property.value.name);
            context.refetchFnQueryKeys.set(property.value.name, hookQueryKey);
            const binding = variablePath.scope.getBinding(property.value.name);
            const scopeId = binding ? bindingScopeId(binding) : undefined;
            if (scopeId) {
              context.refetchFnScopeQueryKeys.set(scopeId, hookQueryKey);
            }
          }
        }
      }

      if (t.isIdentifier(variablePath.node.id)) {
        context.refetchObjectNames.add(variablePath.node.id.name);
        context.refetchObjectQueryKeys.set(variablePath.node.id.name, hookQueryKey);
        const binding = variablePath.scope.getBinding(variablePath.node.id.name);
        const scopeId = binding ? bindingScopeId(binding) : undefined;
        if (scopeId) {
          context.refetchObjectScopeQueryKeys.set(scopeId, hookQueryKey);
        }
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
  function bindingScopeId(binding: Binding): string | undefined {
    const loc = binding.identifier.loc?.start;
    if (!loc) {
      return undefined;
    }

    return `${filePath}:${loc.line}:${loc.column + 1}:${binding.identifier.name}`;
  }

  function callbackScopeIdFromPath(pathNode: NodePath<t.Node>): string | undefined {
    let current: NodePath<t.Node> | null = pathNode;
    while (current) {
      if ((current.isCallExpression() || current.isOptionalCallExpression()) && t.isExpression(current.node.callee)) {
        const callee = current.node.callee;
        let calleeName: string | undefined;
        if (t.isIdentifier(callee)) {
          calleeName = callee.name;
        } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          calleeName = callee.property.name;
        }

        if (calleeName && ['it', 'test'].includes(calleeName)) {
          const loc = current.node.loc?.start;
          if (loc) {
            return `${filePath}:${loc.line}:${loc.column + 1}:${calleeName}`;
          }
        }
      }

      current = current.parentPath;
    }

    return undefined;
  }

  function suiteScopeIdFromPath(pathNode: NodePath<t.Node>): string | undefined {
    let current: NodePath<t.Node> | null = pathNode;
    while (current) {
      if ((current.isCallExpression() || current.isOptionalCallExpression()) && t.isExpression(current.node.callee)) {
        const callee = current.node.callee;
        let calleeName: string | undefined;
        if (t.isIdentifier(callee)) {
          calleeName = callee.name;
        } else if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          calleeName = callee.property.name;
        }

        if (calleeName === 'describe') {
          const loc = current.node.loc?.start;
          if (loc) {
            return `${filePath}:${loc.line}:${loc.column + 1}:${calleeName}`;
          }
        }
      }

      current = current.parentPath;
    }

    return callbackScopeIdFromPath(pathNode);
  }

  function queryClientScopeIdFromExpression(
    callPath: NodePath<t.CallExpression | t.OptionalCallExpression>,
    expression: t.Expression | t.Super | t.V8IntrinsicIdentifier,
    depth = 0,
  ): string | undefined {
    if (depth >= 8) {
      return undefined;
    }

    if (t.isIdentifier(expression)) {
      const binding = callPath.scope.getBinding(expression.name);
      if (binding && getCertainty(context.queryClientVars, expression.name)) {
        return bindingScopeId(binding);
      }

      const resolved = resolver?.resolveReference(expression);
      if (resolved) {
        return queryClientScopeIdFromExpression(callPath, resolved, depth + 1);
      }

      return undefined;
    }

    if (t.isMemberExpression(expression) && t.isExpression(expression.object)) {
      const fromObject = queryClientScopeIdFromExpression(callPath, expression.object, depth + 1);
      if (fromObject) {
        return fromObject;
      }

      const resolved = resolver?.resolveReference(expression);
      if (resolved) {
        return queryClientScopeIdFromExpression(callPath, resolved, depth + 1);
      }

      return undefined;
    }

    return undefined;
  }

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

      t.forEachNodeChild(currentNode, (child, key) => {
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

        stack.push({ node: child, asReference: childAsReference });
      });
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

      queryKeyExpression = findObjectPropertyValue(resolvedFirst, 'queryKey', resolver);
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

    const dedupedValues = [...deduped.values()];
    if (dedupedValues.every(isOpaqueCollectionQueryKey)) {
      return [buildPassThroughActionKey('exact')];
    }

    return dedupedValues;
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
      const unwrappedResolved = unwrapExpression(resolvedByReference);
      if (t.isFunctionExpression(unwrappedResolved) || t.isArrowFunctionExpression(unwrappedResolved)) {
        return extractFunctionReturnExpression(unwrappedResolved) ?? unwrappedResolved;
      }
      return unwrappedResolved;
    }

    const unwrappedExpression = unwrapExpression(expression);
    if (t.isFunctionExpression(unwrappedExpression) || t.isArrowFunctionExpression(unwrappedExpression)) {
      return extractFunctionReturnExpression(unwrappedExpression) ?? unwrappedExpression;
    }

    return unwrappedExpression;
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
      const queryKeyNode = findObjectPropertyValue(resolved, 'queryKey', resolver);
      if (queryKeyNode) {
        return [queryKeyNode];
      }

      const queriesNode = findObjectPropertyValue(resolved, 'queries', resolver);
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
      const queriesNode = findObjectPropertyValue(resolved, 'queries', resolver);
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

    const dedupedValues = [...deduped.values()];
    if (dedupedValues.every(isOpaqueCollectionQueryKey)) {
      return [buildPassThroughActionKey('exact')];
    }

    return dedupedValues;
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

    const dedupedValues = [...deduped.values()];
    if (dedupedValues.every(isOpaqueCollectionQueryKey)) {
      return [buildPassThroughActionKey('exact')];
    }

    return dedupedValues;
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
    const clientScopeId = t.isExpression(object) ? queryClientScopeIdFromExpression(callPath, object) : undefined;
    const executionScopeId = callbackScopeIdFromPath(callPath);
    const suiteScopeId = suiteScopeIdFromPath(callPath);

    if (method === 'refetch') {
      const objectName = extractLeafIdentifier(object);
      if (objectName && context.refetchObjectNames.has(objectName)) {
        const objectBinding = t.isIdentifier(object) ? callPath.scope.getBinding(object.name) : undefined;
        const objectScopeId = objectBinding ? bindingScopeId(objectBinding) : undefined;
        const queryKey =
          (objectScopeId ? context.refetchObjectScopeQueryKeys.get(objectScopeId) : undefined) ??
          context.refetchObjectQueryKeys.get(objectName) ??
          normalizeQueryKey(undefined, { wildcardIfMissing: true, defaultMode: 'all' }, resolver);
        addRecord(records, {
          relation: 'refetches',
          operation: 'refetch',
          file: filePath,
          loc,
          queryKey,
          resolution: 'dynamic',
          clientScopeId,
          executionScopeId,
          suiteScopeId,
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
        clientScopeId,
        executionScopeId,
        suiteScopeId,
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
        clientScopeId,
        executionScopeId,
        suiteScopeId,
      });
    }

    return true;
  }

  traverseAst(ast, {
    CallExpression(callPath: NodePath<t.CallExpression>) {
      const { node } = callPath;
      const loc = locationFromCallNode(node);

      const hook = hookCallInfo(node.callee, context);
      if (hook) {
        const secondArg = node.arguments[1];
        const clientScopeId =
          secondArg && !t.isSpreadElement(secondArg) && t.isExpression(secondArg)
            ? queryClientScopeIdFromExpression(callPath, secondArg)
            : undefined;
        const executionScopeId = callbackScopeIdFromPath(callPath);
        const suiteScopeId = suiteScopeIdFromPath(callPath);
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
            clientScopeId,
            executionScopeId,
            suiteScopeId,
          });
        }
        return;
      }

      if (t.isIdentifier(node.callee) && context.refetchFnNames.has(node.callee.name)) {
        const executionScopeId = callbackScopeIdFromPath(callPath);
        const suiteScopeId = suiteScopeIdFromPath(callPath);
        const fnBinding = callPath.scope.getBinding(node.callee.name);
        const fnScopeId = fnBinding ? bindingScopeId(fnBinding) : undefined;
        const queryKey =
          (fnScopeId ? context.refetchFnScopeQueryKeys.get(fnScopeId) : undefined) ??
          context.refetchFnQueryKeys.get(node.callee.name) ??
          normalizeQueryKey(undefined, { wildcardIfMissing: true, defaultMode: 'all' }, resolver);
        addRecord(records, {
          relation: 'refetches',
          operation: 'refetch',
          file: filePath,
          loc,
          queryKey,
          resolution: 'dynamic',
          executionScopeId,
          suiteScopeId,
        });
        return;
      }

      handleMemberClientCall(callPath, node.callee, node.arguments, loc);
    },

    OptionalCallExpression(optionalCallPath: NodePath<t.OptionalCallExpression>) {
      const { node } = optionalCallPath;
      const loc = locationFromCallNode(node);
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
