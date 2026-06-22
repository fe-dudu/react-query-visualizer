import { describe, expect, it } from 'vitest';

import type * as t from '../ast';
import { type NodePath, normalizeSwcNodeShape, traverseAst } from '../astTraverse';
import { parseSource } from '../sourceParser';

describe('core/analysis/astTraverse', () => {
  it('tracks parent paths, scopes, bindings, and constant violations', () => {
    const ast = parseSource(
      `
        import defaultValue, { namedValue } from '../dep';
        const stable = 1;
        let mutable = 1;
        mutable = 2;
        missing = 3;
        defaultValue = 4;

        function outer(param = stable, ...rest) {
          var legacy = 1;
          var duplicate = 1;
          var duplicate = 2;
          const { queryKey, nested: { item }, ...objectRest } = makeSource();
          const [first, , third] = rest;
          ({ item } = makeSource());
          source.member = 1;
          const expression = function namedExpression() {
            return queryKey;
          };
          const objectWithMethod = {
            method(methodParam) {
              const methodLocal = methodParam;
              return methodLocal;
            },
          };
          const optionalResult = objectWithMethod.method?.(queryKey);
          class Example {
            method(classParam) {
              const classLocal = classParam;
              return classLocal;
            }
            #privateMethod(privateParam) {
              return privateParam;
            }
          }
          const inner = () => {
            const local = queryKey;
            return local;
          };
          return inner(first, item, third, param, defaultValue, namedValue, expression, legacy, objectWithMethod, Example, optionalResult);
        }
        export { outer };
        export default outer;
      `,
      '/repo/src/traverse.ts',
    );
    const seenTypes: string[] = [];
    let outerPath: NodePath | undefined;
    let innerPath: NodePath | undefined;
    let functionExpressionPath: NodePath | undefined;
    let objectMethodPath: NodePath | undefined;
    let classMethodPath: NodePath | undefined;
    let mutablePath: NodePath | undefined;
    let legacyPath: NodePath | undefined;
    let objectPropertyPath: NodePath | undefined;
    let assignmentPatternPath: NodePath | undefined;
    let objectPatternPath: NodePath | undefined;
    let variableDeclaratorPath: NodePath | undefined;
    let variableDeclarationPath: NodePath | undefined;
    let exportNamedPath: NodePath | undefined;
    let exportDefaultPath: NodePath | undefined;
    let callExpressionPath: NodePath | undefined;
    let optionalCallExpressionPath: NodePath | undefined;
    let assignmentExpressionPath: NodePath | undefined;

    normalizeSwcNodeShape(ast.program);
    traverseAst(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        if (path.node.type === 'FunctionDeclaration' && path.node.id?.name === 'outer') {
          outerPath = path;
        }
      },
      ArrowFunctionExpression(path: NodePath<t.ArrowFunctionExpression>) {
        innerPath = path;
      },
      FunctionExpression(path: NodePath<t.FunctionExpression>) {
        functionExpressionPath = path;
      },
      ObjectMethod(path: NodePath) {
        objectMethodPath = path;
      },
      ClassMethod(path: NodePath) {
        classMethodPath = path;
      },
      ObjectPattern(path: NodePath) {
        objectPatternPath = path;
      },
      VariableDeclarator(path: NodePath) {
        variableDeclaratorPath = path;
      },
      VariableDeclaration(path: NodePath) {
        variableDeclarationPath = path;
      },
      ExportNamedDeclaration(path: NodePath) {
        exportNamedPath = path;
      },
      ExportDefaultDeclaration(path: NodePath) {
        exportDefaultPath = path;
      },
      CallExpression(path: NodePath) {
        callExpressionPath = path;
      },
      OptionalCallExpression(path: NodePath) {
        optionalCallExpressionPath = path;
      },
      AssignmentExpression(path: NodePath) {
        assignmentExpressionPath = path;
      },
      Identifier(path: NodePath<t.Identifier>) {
        seenTypes.push(path.node.type);
        if (path.node.type === 'Identifier' && path.node.name === 'mutable') {
          mutablePath = path;
        }
        if (path.node.type === 'Identifier' && path.node.name === 'legacy') {
          legacyPath = path;
        }
        if (!objectPropertyPath && path.parentPath?.isObjectProperty()) {
          objectPropertyPath = path.parentPath;
        }
        if (!assignmentPatternPath && path.parentPath?.isAssignmentPattern()) {
          assignmentPatternPath = path.parentPath;
        }
      },
    });

    expect(seenTypes.length).toBeGreaterThan(0);
    expect(outerPath?.isFunctionDeclaration()).toBe(true);
    expect(functionExpressionPath?.isFunctionExpression()).toBe(true);
    expect(innerPath?.isArrowFunctionExpression()).toBe(true);
    expect(innerPath?.getFunctionParent()).toBe(innerPath);
    expect(objectMethodPath?.getFunctionParent()).toBe(objectMethodPath);
    expect(classMethodPath?.getFunctionParent()).toBe(classMethodPath);
    expect(mutablePath?.scope.getBinding('stable')?.kind).toBe('const');
    expect(mutablePath?.scope.getBinding('mutable')?.constant).toBe(false);
    expect(mutablePath?.scope.getBinding('mutable')?.constantViolations).toHaveLength(1);
    expect(mutablePath?.scope.getBinding('mutable')?.constantViolations).toHaveLength(1);
    expect(legacyPath?.scope.getBinding('legacy')?.kind).toBe('var');
    expect(outerPath?.scope.getBinding('duplicate')?.kind).toBe('var');
    expect(outerPath?.scope.getBinding('param')?.kind).toBe('param');
    expect(outerPath?.scope.getBinding('rest')?.kind).toBe('param');
    expect(outerPath?.scope.getBinding('queryKey')?.kind).toBe('const');
    expect(outerPath?.scope.getBinding('item')?.kind).toBe('const');
    expect(outerPath?.scope.getBinding('objectRest')?.kind).toBe('const');
    expect(outerPath?.scope.getBinding('first')?.kind).toBe('const');
    expect(outerPath?.scope.getBinding('third')?.kind).toBe('const');
    expect(outerPath?.scope.getBinding('defaultValue')?.kind).toBe('module');
    expect(outerPath?.parentPath?.isProgram()).toBe(true);
    expect(objectPropertyPath?.isObjectProperty()).toBe(true);
    expect(assignmentPatternPath?.isAssignmentPattern()).toBe(true);
    expect(objectPatternPath?.isObjectPattern()).toBe(true);
    expect(variableDeclaratorPath?.isVariableDeclarator()).toBe(true);
    expect(variableDeclarationPath?.isVariableDeclaration()).toBe(true);
    expect(exportNamedPath?.isExportNamedDeclaration()).toBe(true);
    expect(exportDefaultPath?.isExportDefaultDeclaration()).toBe(true);
    expect(callExpressionPath?.isCallExpression()).toBe(true);
    expect(optionalCallExpressionPath?.isOptionalCallExpression()).toBe(true);
    expect(assignmentExpressionPath?.isAssignmentExpression()).toBe(true);
    expect(outerPath?.parentPath?.getFunctionParent()).toBeNull();
  });

  it('exposes isIdentifier and resolves bindings for varied declaration kinds', () => {
    const ast = parseSource(
      `
        using resource = acquire();
        for (const loopConst of items) {
          consume(loopConst);
        }
        for (let loopLet in obj) {
          consume(loopLet);
        }
        function host() {
          const local = 1;
          return local;
        }
      `,
      '/repo/src/kinds.ts',
    );

    let identifierPath: NodePath<t.Identifier> | undefined;
    let resourcePath: NodePath | undefined;
    traverseAst(ast, {
      Identifier(path: NodePath<t.Identifier>) {
        if (!identifierPath) {
          identifierPath = path;
        }
        if (path.node.type === 'Identifier' && path.node.name === 'resource') {
          resourcePath = path;
        }
      },
    });

    expect(identifierPath?.isIdentifier()).toBe(true);
    // `using` declarations are neither let nor var, so they resolve to const.
    expect(resourcePath?.scope.getBinding('resource')?.kind).toBe('const');
    expect(resourcePath?.scope.getBinding('loopConst')?.kind).toBe('const');
    expect(resourcePath?.scope.getBinding('loopLet')?.kind).toBe('let');
  });

  it('handles anonymous default function declarations and program/non-program roots', () => {
    const ast = parseSource(
      `
        export default function () {
          return 1;
        }
      `,
      '/repo/src/anon.ts',
    );

    // Traversing the Program directly exercises the non-File branch of traverseAst.
    let sawFunction = false;
    let programScopeBinding: unknown;
    traverseAst(ast.program, {
      Program(path: NodePath) {
        // Force lazy scope initialization so collectScopeBindings runs and visits
        // the anonymous (id-less) default function declaration.
        programScopeBinding = path.scope.getBinding('nonexistent');
      },
      FunctionDeclaration() {
        sawFunction = true;
      },
    });
    expect(sawFunction).toBe(true);
    expect(programScopeBinding).toBeUndefined();

    // Traversing a non-scope-creating statement root exercises the scope fallback.
    const statement = ast.program.body[0] as t.Node;
    let visited = false;
    traverseAst(statement, {
      ExportDefaultDeclaration() {
        visited = true;
      },
    });
    expect(visited).toBe(true);
  });
});
