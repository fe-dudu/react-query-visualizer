import * as path from 'node:path';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

import type { FileSymbols, ReExportBinding, SymbolIndex } from './types';

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
    }

    table.exports.set('default', DEFAULT_EXPORT_NAME);
  }
}

function collectLocalVariableSymbol(pathNode: NodePath<t.VariableDeclarator>, table: FileSymbols): void {
  const { id, init } = pathNode.node;
  if (!t.isIdentifier(id) || !init || !t.isExpression(init)) {
    return;
  }

  const value = unwrapExpression(init);
  table.values.set(id.name, value);

  if (!t.isFunctionExpression(value) && !t.isArrowFunctionExpression(value)) {
    return;
  }

  const returned = extractFunctionReturnExpression(value);
  if (!returned) {
    return;
  }

  table.functions.set(id.name, returned);
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
    imports: new Map(),
    exports: new Map(),
    reExports: [],
  };

  traverse(ast, {
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
          table.imports.set(specifier.local.name, {
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
    },

    ExportNamedDeclaration(exportPath: NodePath<t.ExportNamedDeclaration>) {
      const declaration = exportPath.node;
      collectExportedNamesFromDeclaration(declaration.declaration, table);
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
