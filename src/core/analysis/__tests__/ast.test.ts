import { describe, expect, it } from 'vitest';

import * as ast from '../ast';

type Guard = (node: unknown) => boolean;

const node = (type: string, extra: Record<string, unknown> = {}): unknown => ({ type, ...extra });

describe('core/analysis/ast', () => {
  it('recognizes supported AST node shapes', () => {
    const cases: Array<[Guard, unknown]> = [
      [ast.isFile, node('File')],
      [ast.isProgram, node('Program')],
      [ast.isIdentifier, node('Identifier')],
      [ast.isStringLiteral, node('StringLiteral')],
      [ast.isStringLiteral, node('Literal', { value: 'text' })],
      [ast.isNumericLiteral, node('NumericLiteral')],
      [ast.isNumericLiteral, node('Literal', { value: 1 })],
      [ast.isBooleanLiteral, node('BooleanLiteral')],
      [ast.isBooleanLiteral, node('Literal', { value: true })],
      [ast.isNullLiteral, node('NullLiteral')],
      [ast.isNullLiteral, node('Literal', { value: null })],
      [ast.isBigIntLiteral, node('BigIntLiteral')],
      [ast.isTemplateLiteral, node('TemplateLiteral')],
      [ast.isJSXIdentifier, node('JSXIdentifier')],
      [ast.isJSXExpressionContainer, node('JSXExpressionContainer')],
      [ast.isJSXEmptyExpression, node('JSXEmptyExpression')],
      [ast.isJSXAttribute, node('JSXAttribute')],
      [ast.isExpression, node('CallExpression')],
      [ast.isExpression, node('OptionalMemberExpression')],
      [ast.isStatement, node('IfStatement')],
      [ast.isLVal, node('ObjectPattern')],
      [ast.isArrayExpression, node('ArrayExpression')],
      [ast.isObjectExpression, node('ObjectExpression')],
      [ast.isObjectProperty, node('Property', { method: false })],
      [ast.isObjectMethod, node('ObjectMethod')],
      [ast.isObjectMethod, node('Property', { method: true })],
      [ast.isObjectMethodLike, node('ObjectMethod')],
      [ast.isSpreadElement, node('SpreadElement')],
      [ast.isRestElement, node('RestElement')],
      [ast.isAssignmentPattern, node('AssignmentPattern')],
      [ast.isObjectPattern, node('ObjectPattern')],
      [ast.isArrayPattern, node('ArrayPattern')],
      [ast.isVariableDeclarator, node('VariableDeclarator')],
      [ast.isVariableDeclaration, node('VariableDeclaration')],
      [ast.isFunctionDeclaration, node('FunctionDeclaration')],
      [ast.isFunctionExpression, node('FunctionExpression')],
      [ast.isArrowFunctionExpression, node('ArrowFunctionExpression')],
      [ast.isClassMethod, node('ClassMethod')],
      [ast.isClassMethod, node('MethodDefinition', { key: node('Identifier') })],
      [ast.isClassPrivateMethod, node('ClassPrivateMethod')],
      [ast.isClassPrivateMethod, node('MethodDefinition', { key: node('PrivateIdentifier') })],
      [ast.isCallExpression, node('CallExpression')],
      [ast.isCallExpression, node('OptionalCallExpression')],
      [ast.isOptionalCallExpression, node('OptionalCallExpression')],
      [ast.isOptionalCallExpression, node('ChainExpression', { expression: node('CallExpression') })],
      [ast.isOptionalCallExpression, node('CallExpression', { optional: true })],
      [ast.isMemberExpression, node('MemberExpression')],
      [ast.isMemberExpression, node('OptionalMemberExpression')],
      [ast.isOptionalMemberExpression, node('OptionalMemberExpression')],
      [ast.isOptionalMemberExpression, node('ChainExpression', { expression: node('MemberExpression') })],
      [ast.isOptionalMemberExpression, node('MemberExpression', { optional: true })],
      [ast.isNewExpression, node('NewExpression')],
      [ast.isConditionalExpression, node('ConditionalExpression')],
      [ast.isLogicalExpression, node('LogicalExpression')],
      [ast.isBinaryExpression, node('BinaryExpression')],
      [ast.isUnaryExpression, node('UnaryExpression')],
      [ast.isUpdateExpression, node('UpdateExpression')],
      [ast.isSequenceExpression, node('SequenceExpression')],
      [ast.isAssignmentExpression, node('AssignmentExpression')],
      [ast.isParenthesizedExpression, node('ParenthesizedExpression')],
      [ast.isTSAsExpression, node('TSAsExpression')],
      [ast.isTSSatisfiesExpression, node('TSSatisfiesExpression')],
      [ast.isTSNonNullExpression, node('TSNonNullExpression')],
      [ast.isTSTypeAssertion, node('TSTypeAssertion')],
      [ast.isTypeCastExpression, node('TSTypeAssertion')],
      [ast.isTSParenthesizedType, node('TSParenthesizedType')],
      [ast.isTSTypeLiteral, node('TSTypeLiteral')],
      [ast.isTSPropertySignature, node('TSPropertySignature')],
      [ast.isTSTypeReference, node('TSTypeReference')],
      [ast.isTSTypeParameterInstantiation, node('TSTypeParameterInstantiation')],
      [ast.isTSUnionType, node('TSUnionType')],
      [ast.isTSIntersectionType, node('TSIntersectionType')],
      [ast.isTSQualifiedName, node('TSQualifiedName')],
      [ast.isTSTypeQuery, node('TSTypeQuery')],
      [ast.isTSImportType, node('TSImportType')],
      [ast.isPrivateName, node('PrivateIdentifier')],
      [ast.isPrivateName, node('PrivateName')],
      [ast.isTypeAnnotation, node('TSTypeAnnotation')],
      [ast.isNoop, node('Noop')],
      [ast.isExportNamedDeclaration, node('ExportNamedDeclaration')],
      [ast.isExportDefaultDeclaration, node('ExportDefaultDeclaration')],
      [ast.isImportDeclaration, node('ImportDeclaration')],
      [ast.isImportSpecifier, node('ImportSpecifier')],
      [ast.isImportDefaultSpecifier, node('ImportDefaultSpecifier')],
      [ast.isImportNamespaceSpecifier, node('ImportNamespaceSpecifier')],
      [ast.isExportSpecifier, node('ExportSpecifier')],
      [ast.isReturnStatement, node('ReturnStatement')],
      [ast.isBlockStatement, node('BlockStatement')],
      [ast.isIfStatement, node('IfStatement')],
      [ast.isLabeledStatement, node('LabeledStatement')],
      [ast.isForStatement, node('ForStatement')],
      [ast.isForInStatement, node('ForInStatement')],
      [ast.isForOfStatement, node('ForOfStatement')],
      [ast.isWhileStatement, node('WhileStatement')],
      [ast.isDoWhileStatement, node('DoWhileStatement')],
      [ast.isSwitchStatement, node('SwitchStatement')],
      [ast.isTryStatement, node('TryStatement')],
      [ast.isExpressionStatement, node('ExpressionStatement')],
      [ast.isPrivateIdentifier, node('PrivateIdentifier')],
      [ast.isFileLike, node('File')],
    ];

    for (const [guard, value] of cases) {
      expect(guard(value)).toBe(true);
      expect(guard({ type: 'DifferentNode' })).toBe(false);
    }
  });

  it('walks, clones, normalizes, and builds nodes', () => {
    const child = ast.identifier('child');
    const parent = {
      type: 'ObjectExpression',
      properties: [ast.objectProperty(ast.identifier('key'), child), ast.spreadElement(child)],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    };

    const visited: string[] = [];
    ast.forEachNodeChild(parent, (entry, key) => {
      visited.push(`${key}:${entry.type}`);
    });

    expect(ast.getNodeChildren(parent)).toHaveLength(2);
    expect(visited).toEqual(['properties:Property', 'properties:SpreadElement']);
    expect(ast.cloneNode(parent, false)).not.toBe(parent);
    expect(ast.cloneNode([child], false)).toEqual([child]);
    expect(ast.cloneNode('literal', false)).toBe('literal');
    expect(ast.cloneNode(parent)).toEqual(parent);
    expect(ast.cloneNode({ type: 'Identifier', parent })).toEqual({ type: 'Identifier' });

    const cyclic: { type: string; self?: unknown } = { type: 'Program' };
    cyclic.self = cyclic;
    expect(ast.cloneNode(cyclic)).toMatchObject({ type: 'Program' });

    const normalized = {
      type: 'Program',
      body: [
        {
          type: 'Property',
          method: true,
          value: { type: 'FunctionExpression', params: [], body: node('BlockStatement'), async: true },
        },
        {
          type: 'Property',
          method: true,
          value: { type: 'FunctionExpression', body: node('BlockStatement') },
        },
        {
          type: 'Property',
          method: true,
          value: null,
        },
        {
          type: 'MethodDefinition',
          key: node('Identifier'),
          value: { type: 'FunctionExpression', params: [], body: node('BlockStatement') },
        },
        {
          type: 'MethodDefinition',
          key: node('Identifier'),
          value: { type: 'FunctionExpression', body: node('BlockStatement') },
        },
        {
          type: 'MethodDefinition',
          key: node('Identifier'),
          value: null,
        },
        {
          type: 'MethodDefinition',
          key: node('PrivateIdentifier'),
          value: { type: 'FunctionExpression', params: [], body: node('BlockStatement') },
        },
        { type: 'ChainExpression', expression: { type: 'CallExpression', callee: ast.identifier('run') } },
        {
          type: 'ChainExpression',
          expression: { type: 'MemberExpression', object: ast.identifier('api'), property: ast.identifier('value') },
        },
        { type: 'ChainExpression', expression: { type: 'Identifier', name: 'plain' } },
        { type: 'ChainExpression', expression: null },
        {
          type: 'PrivateIdentifier',
          name: 'secret',
          start: 7,
          end: 14,
          loc: { start: { line: 2, column: 1 }, end: { line: 2, column: 8 } },
        },
      ],
    };

    ast.normalizeAstShape(normalized);

    expect(normalized.body.map((entry) => entry.type)).toEqual([
      'ObjectMethod',
      'ObjectMethod',
      'Property',
      'ClassMethod',
      'ClassMethod',
      'MethodDefinition',
      'ClassPrivateMethod',
      'OptionalCallExpression',
      'OptionalMemberExpression',
      'ChainExpression',
      'ChainExpression',
      'PrivateName',
    ]);
    expect(ast.objectExpression([])).toMatchObject({ start: 0, end: 0 });
  });
});
