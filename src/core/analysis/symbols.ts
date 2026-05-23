import * as path from 'node:path';

import type { FileSymbols, ReExportBinding, SymbolIndex } from './types';
import * as t from './ast';
import { type NodePath, traverseAst } from './astTraverse';

const DEFAULT_EXPORT_NAME = '__default_export__';

function toPosix(input: string): string {
  return input.split(path.sep).join('/');
}

function exportNameToString(name: t.Identifier | t.StringLiteral): string {
  if (t.isIdentifier(name)) {
    return name.name;
  }

  return name.value;
}

function moduleNameToString(name: t.Identifier | t.StringLiteral): string {
  if (t.isIdentifier(name)) {
    return name.name;
  }

  return name.value;
}

export function normalizeAnalyzerPath(filePath: string): string {
  return toPosix(path.resolve(filePath));
}

export function unwrapExpression(node: t.Expression): t.Expression {
  if (t.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression);
  }

  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTypeCastExpression(node)) {
    return unwrapExpression(node.expression);
  }

  if (t.isTSNonNullExpression(node)) {
    return unwrapExpression(node.expression);
  }

  return node;
}

function firstReturnExpressionFromStatement(statement: t.Statement): t.Expression | undefined {
  if (t.isReturnStatement(statement)) {
    if (!statement.argument || !t.isExpression(statement.argument)) {
      return undefined;
    }

    return unwrapExpression(statement.argument);
  }

  if (t.isBlockStatement(statement)) {
    return topLevelReturnExpression(statement.body);
  }

  if (t.isIfStatement(statement)) {
    const fromConsequent = firstReturnExpressionFromStatement(statement.consequent);
    if (fromConsequent) {
      return fromConsequent;
    }

    if (statement.alternate && t.isStatement(statement.alternate)) {
      return firstReturnExpressionFromStatement(statement.alternate);
    }

    return undefined;
  }

  if (t.isLabeledStatement(statement)) {
    return firstReturnExpressionFromStatement(statement.body);
  }

  if (
    t.isForStatement(statement) ||
    t.isForInStatement(statement) ||
    t.isForOfStatement(statement) ||
    t.isWhileStatement(statement) ||
    t.isDoWhileStatement(statement)
  ) {
    return firstReturnExpressionFromStatement(statement.body);
  }

  if (t.isSwitchStatement(statement)) {
    for (const switchCase of statement.cases) {
      for (const caseStatement of switchCase.consequent) {
        const fromCase = firstReturnExpressionFromStatement(caseStatement);
        if (fromCase) {
          return fromCase;
        }
      }
    }

    return undefined;
  }

  if (t.isTryStatement(statement)) {
    const fromTry = topLevelReturnExpression(statement.block.body);
    if (fromTry) {
      return fromTry;
    }

    if (statement.handler) {
      const fromCatch = topLevelReturnExpression(statement.handler.body.body);
      if (fromCatch) {
        return fromCatch;
      }
    }

    if (statement.finalizer) {
      return topLevelReturnExpression(statement.finalizer.body);
    }
  }

  return undefined;
}

function topLevelReturnExpression(statements: t.BlockStatement['body']): t.Expression | undefined {
  for (const statement of statements) {
    const resolved = firstReturnExpressionFromStatement(statement);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function resolveReturnedIdentifierFromStatements(
  identifierName: string,
  statements: t.BlockStatement['body'],
  seen = new Set<string>(),
): t.Expression | undefined {
  if (seen.has(identifierName)) {
    return undefined;
  }
  seen.add(identifierName);

  for (let statementIndex = statements.length - 1; statementIndex >= 0; statementIndex -= 1) {
    const statement = statements[statementIndex];
    if (!t.isVariableDeclaration(statement)) {
      continue;
    }

    for (let declaratorIndex = statement.declarations.length - 1; declaratorIndex >= 0; declaratorIndex -= 1) {
      const declarator = statement.declarations[declaratorIndex];
      if (!t.isIdentifier(declarator.id) || declarator.id.name !== identifierName) {
        continue;
      }

      if (!declarator.init || !t.isExpression(declarator.init)) {
        return undefined;
      }

      const init = unwrapExpression(declarator.init);
      if (t.isIdentifier(init) && init.name !== identifierName) {
        return resolveReturnedIdentifierFromStatements(init.name, statements, seen) ?? init;
      }

      return init;
    }
  }

  return undefined;
}

export function extractFunctionReturnExpression(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
): t.Expression | undefined {
  if (t.isArrowFunctionExpression(node) && t.isExpression(node.body)) {
    return unwrapExpression(node.body);
  }

  if (!t.isBlockStatement(node.body)) {
    return undefined;
  }

  const returned = topLevelReturnExpression(node.body.body);
  if (!returned) {
    return undefined;
  }

  if (!t.isIdentifier(returned)) {
    return returned;
  }

  return resolveReturnedIdentifierFromStatements(returned.name, node.body.body) ?? returned;
}

function collectExportedNamesFromDeclaration(
  declaration: t.ExportNamedDeclaration['declaration'],
  table: FileSymbols,
): void {
  if (!declaration) {
    return;
  }

  if (t.isVariableDeclaration(declaration)) {
    for (const declarator of declaration.declarations) {
      if (!t.isIdentifier(declarator.id)) {
        continue;
      }

      table.exports.set(declarator.id.name, declarator.id.name);
    }
    return;
  }

  if (t.isFunctionDeclaration(declaration) && declaration.id) {
    table.exports.set(declaration.id.name, declaration.id.name);
  }
}

function collectExportedDeclarationSymbols(
  declaration: t.ExportNamedDeclaration['declaration'],
  table: FileSymbols,
): void {
  if (!declaration) {
    return;
  }

  if (t.isVariableDeclaration(declaration)) {
    for (const declarator of declaration.declarations) {
      if (!t.isIdentifier(declarator.id) || !declarator.init) {
        continue;
      }

      const value = t.isExpression(declarator.init)
        ? unwrapExpression(declarator.init)
        : (declarator.init as unknown as t.Expression);
      table.values.set(declarator.id.name, value);

      if (t.isFunctionExpression(value) || t.isArrowFunctionExpression(value)) {
        const returned = extractFunctionReturnExpression(value);
        if (returned) {
          table.functions.set(declarator.id.name, returned);
        }

        table.functionNodes.set(declarator.id.name, value);
      }
    }
    return;
  }

  if (t.isFunctionDeclaration(declaration) && declaration.id) {
    const returned = extractFunctionReturnExpression(declaration);
    if (returned) {
      table.functions.set(declaration.id.name, returned);
    }

    table.functionNodes.set(declaration.id.name, declaration);
  }
}

function collectDefaultExport(declaration: t.ExportDefaultDeclaration['declaration'], table: FileSymbols): void {
  if (t.isIdentifier(declaration)) {
    table.exports.set('default', declaration.name);
    return;
  }

  if (t.isFunctionDeclaration(declaration) && declaration.id) {
    const returned = extractFunctionReturnExpression(declaration);
    if (returned) {
      table.functions.set(declaration.id.name, returned);
    }

    table.functionNodes.set(declaration.id.name, declaration);

    table.exports.set('default', declaration.id.name);
    return;
  }

  if (t.isExpression(declaration)) {
    const unwrapped = unwrapExpression(declaration);
    table.values.set(DEFAULT_EXPORT_NAME, unwrapped);

    if (t.isFunctionExpression(unwrapped) || t.isArrowFunctionExpression(unwrapped)) {
      const returned = extractFunctionReturnExpression(unwrapped);
      if (returned) {
        table.functions.set(DEFAULT_EXPORT_NAME, returned);
      }

      table.functionNodes.set(DEFAULT_EXPORT_NAME, unwrapped);
    }

    table.exports.set('default', DEFAULT_EXPORT_NAME);
  }
}

function isIdentifierName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function propertyExpressionForName(name: string): { property: t.Expression; computed: boolean } {
  if (isIdentifierName(name)) {
    return {
      property: { type: 'Identifier', name } as t.Identifier,
      computed: false,
    };
  }

  return {
    property: { type: 'StringLiteral', value: name } as t.StringLiteral,
    computed: true,
  };
}

function propertyExpressionForIndex(index: number): { property: t.Expression; computed: boolean } {
  return {
    property: { type: 'NumericLiteral', value: index } as t.NumericLiteral,
    computed: true,
  };
}

function makeMemberExpression(object: t.Expression, property: string | number): t.Expression {
  const descriptor =
    typeof property === 'number' ? propertyExpressionForIndex(property) : propertyExpressionForName(property);

  return {
    type: 'MemberExpression',
    object: t.cloneNode(object, true),
    property: descriptor.property,
    computed: descriptor.computed,
    optional: false,
  } as t.MemberExpression;
}

function collectPatternBindings(target: t.Node, init: t.Expression, table: FileSymbols): void {
  if (t.isIdentifier(target)) {
    table.values.set(target.name, t.cloneNode(init, true));
    return;
  }

  if (t.isAssignmentPattern(target)) {
    collectPatternBindings(target.left, init, table);
    return;
  }

  if (t.isObjectPattern(target)) {
    for (const property of target.properties) {
      if (t.isRestElement(property)) {
        collectPatternBindings(property.argument, init, table);
        continue;
      }

      if (!t.isObjectProperty(property)) {
        continue;
      }

      let keyName: string | undefined;
      if (t.isIdentifier(property.key)) {
        keyName = property.key.name;
      } else if (t.isStringLiteral(property.key)) {
        keyName = property.key.value;
      } else if (t.isNumericLiteral(property.key)) {
        keyName = String(property.key.value);
      }

      if (!keyName) {
        continue;
      }

      const nextInit = makeMemberExpression(init, keyName);
      if (
        t.isIdentifier(property.value) ||
        t.isAssignmentPattern(property.value) ||
        t.isObjectPattern(property.value) ||
        t.isArrayPattern(property.value)
      ) {
        collectPatternBindings(property.value as t.Node, nextInit as t.Expression, table);
      }
    }
    return;
  }

  if (t.isArrayPattern(target)) {
    for (let index = 0; index < target.elements.length; index += 1) {
      const element = target.elements[index];
      if (!element) {
        continue;
      }

      const nextInit = makeMemberExpression(init, index);
      if (t.isRestElement(element)) {
        collectPatternBindings(element.argument, nextInit as t.Expression, table);
        continue;
      }

      if (
        t.isIdentifier(element) ||
        t.isAssignmentPattern(element) ||
        t.isObjectPattern(element) ||
        t.isArrayPattern(element)
      ) {
        collectPatternBindings(element as t.Node, nextInit as t.Expression, table);
      }
    }
  }
}

function collectLocalVariableSymbol(pathNode: NodePath<t.VariableDeclarator>, table: FileSymbols): void {
  const { id, init } = pathNode.node;
  if (!t.isIdentifier(id) || !init) {
    if (!init || !t.isExpression(init)) {
      return;
    }

    if (t.isObjectPattern(id) || t.isArrayPattern(id)) {
      collectPatternBindings(id, unwrapExpression(init), table);
    }
    return;
  }

  const value = t.isExpression(init) ? unwrapExpression(init) : (init as unknown as t.Expression);
  table.values.set(id.name, value);

  if (!t.isFunctionExpression(value) && !t.isArrowFunctionExpression(value)) {
    return;
  }

  const returned = extractFunctionReturnExpression(value);
  if (!returned) {
    return;
  }

  table.functions.set(id.name, returned);
  table.functionNodes.set(id.name, value as t.FunctionExpression | t.ArrowFunctionExpression);
}

function collectAssignedIdentifiers(target: t.Node, names: Set<string>): void {
  if (t.isIdentifier(target)) {
    names.add(target.name);
    return;
  }

  if (t.isObjectPattern(target)) {
    for (const property of target.properties) {
      if (t.isRestElement(property)) {
        collectAssignedIdentifiers(property.argument, names);
        continue;
      }

      if (t.isObjectProperty(property)) {
        collectAssignedIdentifiers(property.value as t.LVal, names);
      }
    }
    return;
  }

  if (t.isArrayPattern(target)) {
    for (const element of target.elements) {
      if (!element) {
        continue;
      }

      if (t.isRestElement(element)) {
        collectAssignedIdentifiers(element.argument, names);
        continue;
      }

      if (t.isLVal(element)) {
        collectAssignedIdentifiers(element, names);
      }
    }
    return;
  }

  if (t.isAssignmentPattern(target)) {
    collectAssignedIdentifiers(target.left, names);
  }
}

function isQueryKeySymbolName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized === 'querykey') {
    return false;
  }

  return normalized.includes('rqkey') || normalized.includes('querykey');
}

function isTopLevelVariableDeclarator(pathNode: NodePath<t.VariableDeclarator>): boolean {
  const declarationPath = pathNode.parentPath;
  if (!declarationPath || !declarationPath.isVariableDeclaration()) {
    return false;
  }

  const statementPath = declarationPath.parentPath;
  if (!statementPath) {
    return false;
  }

  if (statementPath.isProgram()) {
    return true;
  }

  if (
    (statementPath.isExportNamedDeclaration() || statementPath.isExportDefaultDeclaration()) &&
    statementPath.parentPath
  ) {
    return statementPath.parentPath.isProgram();
  }

  return false;
}

function isTopLevelFunctionDeclaration(pathNode: NodePath<t.FunctionDeclaration>): boolean {
  const parentPath = pathNode.parentPath;
  if (!parentPath) {
    return false;
  }

  if (parentPath.isProgram()) {
    return true;
  }

  if ((parentPath.isExportNamedDeclaration() || parentPath.isExportDefaultDeclaration()) && parentPath.parentPath) {
    return parentPath.parentPath.isProgram();
  }

  return false;
}

function shouldCollectVariableDeclarator(pathNode: NodePath<t.VariableDeclarator>): boolean {
  if (isTopLevelVariableDeclarator(pathNode)) {
    return true;
  }

  if (t.isObjectPattern(pathNode.node.id) || t.isArrayPattern(pathNode.node.id)) {
    const names = new Set<string>();
    collectAssignedIdentifiers(pathNode.node.id, names);
    for (const name of names) {
      if (isQueryKeySymbolName(name)) {
        return true;
      }
    }

    if (pathNode.node.init && t.isExpression(pathNode.node.init) && names.has('queryKey')) {
      const init = unwrapExpression(pathNode.node.init);
      if (t.isCallExpression(init) || t.isObjectExpression(init) || t.isArrayExpression(init)) {
        return true;
      }
    }
  }

  return t.isIdentifier(pathNode.node.id) && isQueryKeySymbolName(pathNode.node.id.name);
}

function shouldCollectFunctionDeclaration(pathNode: NodePath<t.FunctionDeclaration>): boolean {
  if (isTopLevelFunctionDeclaration(pathNode)) {
    return true;
  }

  const identifier = pathNode.node.id;
  if (!identifier) {
    return false;
  }

  return isQueryKeySymbolName(identifier.name);
}

function collectNamedReExports(
  declaration: t.ExportNamedDeclaration,
  table: FileSymbols,
  list: ReExportBinding[],
): void {
  if (!declaration.source) {
    for (const specifier of declaration.specifiers) {
      if (!t.isExportSpecifier(specifier)) {
        continue;
      }

      const exported = exportNameToString(specifier.exported);
      const local = moduleNameToString(specifier.local);
      table.exports.set(exported, local);
    }

    return;
  }

  const source = declaration.source.value;
  for (const specifier of declaration.specifiers) {
    if (!t.isExportSpecifier(specifier)) {
      continue;
    }

    list.push({
      source,
      imported: moduleNameToString(specifier.local),
      exported: exportNameToString(specifier.exported),
      all: false,
    });
  }
}

export function buildFileSymbols(filePath: string, ast: t.File): FileSymbols {
  const table: FileSymbols = {
    filePath,
    values: new Map(),
    functions: new Map(),
    functionNodes: new Map(),
    mutableValues: new Set(),
    imports: new Map(),
    exports: new Map(),
    reExports: [],
  };

  traverseAst(ast, {
    ImportDeclaration(importPath: NodePath<t.ImportDeclaration>) {
      const source = importPath.node.source.value;

      for (const specifier of importPath.node.specifiers) {
        if (t.isImportSpecifier(specifier)) {
          table.imports.set(specifier.local.name, {
            kind: 'named',
            source,
            imported: moduleNameToString(specifier.imported),
          });
          continue;
        }

        if (t.isImportDefaultSpecifier(specifier)) {
          table.imports.set(specifier.local.name, {
            kind: 'default',
            source,
            imported: 'default',
          });
          continue;
        }

        if (t.isImportNamespaceSpecifier(specifier)) {
          const namespaceSpecifier = specifier as t.ImportNamespaceSpecifier;
          table.imports.set(namespaceSpecifier.local.name, {
            kind: 'namespace',
            source,
          });
        }
      }
    },

    VariableDeclarator(variablePath: NodePath<t.VariableDeclarator>) {
      if (!shouldCollectVariableDeclarator(variablePath)) {
        return;
      }
      collectLocalVariableSymbol(variablePath, table);
    },

    FunctionDeclaration(functionPath: NodePath<t.FunctionDeclaration>) {
      if (!shouldCollectFunctionDeclaration(functionPath)) {
        return;
      }
      const identifier = functionPath.node.id;
      if (!identifier) {
        return;
      }

      const returned = extractFunctionReturnExpression(functionPath.node);
      if (!returned) {
        return;
      }

      table.functions.set(identifier.name, returned);
      table.functionNodes.set(identifier.name, functionPath.node);
    },

    UpdateExpression(updatePath: NodePath<t.UpdateExpression>) {
      if (t.isIdentifier(updatePath.node.argument) || t.isMemberExpression(updatePath.node.argument)) {
        collectAssignedIdentifiers(updatePath.node.argument, table.mutableValues);
      }
    },

    AssignmentExpression(assignmentPath: NodePath<t.AssignmentExpression>) {
      collectAssignedIdentifiers(assignmentPath.node.left, table.mutableValues);
    },

    ExportNamedDeclaration(exportPath: NodePath<t.ExportNamedDeclaration>) {
      const declaration = exportPath.node;
      collectExportedNamesFromDeclaration(declaration.declaration, table);
      collectExportedDeclarationSymbols(declaration.declaration, table);
      collectNamedReExports(declaration, table, table.reExports);
    },

    ExportDefaultDeclaration(exportPath: NodePath<t.ExportDefaultDeclaration>) {
      collectDefaultExport(exportPath.node.declaration, table);
    },

    ExportAllDeclaration(exportPath: NodePath<t.ExportAllDeclaration>) {
      table.reExports.push({
        source: exportPath.node.source.value,
        all: true,
      });
    },
  });

  return table;
}

export function buildSymbolIndex(parsedFiles: Map<string, t.File>): SymbolIndex {
  const files = new Map<string, FileSymbols>();
  for (const [filePath, ast] of parsedFiles) {
    files.set(filePath, buildFileSymbols(filePath, ast));
  }

  return {
    files,
    fileSet: new Set(files.keys()),
  };
}
