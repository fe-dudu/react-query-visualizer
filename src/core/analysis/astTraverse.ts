import * as t from '@babel/types';

type VisitorMap = Partial<Record<string, unknown>>;

export type BindingKind = 'const' | 'let' | 'var' | 'hoisted' | 'param' | 'module';

export interface Binding {
  identifier: t.Identifier;
  path: NodePath;
  kind: BindingKind;
  constant: boolean;
  constantViolations: Array<NodePath<t.AssignmentExpression>>;
}

interface WalkState {
  parentByNode: WeakMap<t.Node, t.Node>;
  pathByNode: WeakMap<t.Node, NodePath>;
  scopeByNode: WeakMap<t.Node, Scope>;
}

type SwcNodeLike = Record<string, unknown> & {
  type?: string;
  stmts?: unknown[];
  identifier?: unknown;
  orig?: unknown;
  typeParams?: unknown;
  function?: unknown;
  declaration?: unknown;
  decl?: unknown;
  expression?: unknown;
  key?: unknown;
  value?: unknown;
  computed?: boolean;
  shorthand?: boolean;
  params?: unknown[];
  arguments?: unknown[];
  elements?: unknown[];
  property?: unknown;
  src?: unknown;
  specifiers?: unknown[];
  body?: unknown;
  local?: unknown;
};

const CHILD_SKIP_KEYS = new Set([
  'type',
  'span',
  'loc',
  'start',
  'end',
  'raw',
  'ctxt',
  'comments',
  'leadingComments',
  'innerComments',
  'trailingComments',
]);

function isNode(value: unknown): value is t.Node {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

function shouldSkipAliasKey(node: SwcNodeLike, key: string, value: unknown): boolean {
  return (
    (key === 'body' && Array.isArray(node.stmts)) ||
    (key === 'id' && isNode(node.identifier)) ||
    (key === 'local' && isNode(node.orig)) ||
    (key === 'typeParameters' && isNode(node.typeParams)) ||
    (key === 'expression' && node.type === 'ExportDefaultDeclaration' && isNode(node.declaration)) ||
    (key === 'value' && node.type === 'ObjectProperty' && !!node.shorthand && value === node.key)
  );
}

function createChildNodes(node: t.Node): t.Node[] {
  const children: t.Node[] = [];
  const record = node as SwcNodeLike;

  for (const [key, value] of Object.entries(record)) {
    if (CHILD_SKIP_KEYS.has(key) || shouldSkipAliasKey(record, key, value)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item);
        }
      }
      continue;
    }

    if (isNode(value)) {
      children.push(value);
    }
  }

  return children;
}

function createsScope(node: t.Node): boolean {
  return (
    t.isProgram(node) ||
    t.isFunctionDeclaration(node) ||
    t.isFunctionExpression(node) ||
    t.isArrowFunctionExpression(node) ||
    t.isObjectMethod(node) ||
    t.isClassMethod(node) ||
    t.isClassPrivateMethod(node)
  );
}

function walkTree<TNode extends t.Node>(
  node: TNode,
  state: WalkState,
  parentPath: NodePath | null,
  visit: (path: NodePath) => void,
  shouldDescend: (path: NodePath) => boolean,
): void {
  if (parentPath) {
    state.parentByNode.set(node, parentPath.node);
  }

  let path = state.pathByNode.get(node) as NodePath<TNode> | undefined;
  if (!path) {
    path = new NodePath(node, parentPath, state);
    state.pathByNode.set(node, path);
  }

  visit(path);

  if (!shouldDescend(path)) {
    return;
  }

  for (const child of createChildNodes(node)) {
    walkTree(child, state, path, visit, shouldDescend);
  }
}

export function normalizeSwcNodeShape(root: t.Node): void {
  const seen = new WeakSet<object>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);

    const record = node as SwcNodeLike;

    if (typeof record.type === 'string') {
      if (record.type === 'Module' || record.type === 'Script') {
        record.type = 'Program';
      } else if (record.type === 'ParenthesisExpression') {
        record.type = 'ParenthesizedExpression';
      } else if (record.type === 'ExportDeclaration') {
        record.type = 'ExportNamedDeclaration';
      } else if (record.type === 'ExportDefaultExpression') {
        record.type = 'ExportDefaultDeclaration';
        record.declaration ??= record.expression;
      } else if (
        record.type === 'KeyValueProperty' ||
        record.type === 'KeyValuePatternProperty' ||
        record.type === 'AssignmentPatternProperty'
      ) {
        record.type = 'ObjectProperty';
        if (record.value == null && record.key) {
          record.value = record.key;
          record.shorthand = true;
        }
      } else if (record.type === 'MethodProperty') {
        record.type = 'ObjectMethod';
      } else if (record.type === 'PrivateMethod') {
        record.type = 'ClassPrivateMethod';
      } else if (record.type === 'JsxIdentifier') {
        record.type = 'JSXIdentifier';
      } else if (record.type.startsWith('Ts')) {
        record.type = `TS${record.type.slice(2)}`;
      }
    }

    if (record.type === 'Identifier' && typeof record.name !== 'string' && typeof record.value === 'string') {
      record.name = record.value;
    }
    if (record.type === 'JSXIdentifier' && typeof record.name !== 'string' && typeof record.value === 'string') {
      record.name = record.value;
    }

    record.body ??= record.stmts;
    record.id ??= record.identifier;
    record.local ??= record.orig;
    record.typeParameters ??= record.typeParams;
    record.declaration ??= record.decl;
    record.source ??= record.src;
    if (record.type === 'SpreadElement' && record.argument === undefined && record.arguments !== undefined) {
      record.argument = record.arguments;
      record.arguments = undefined;
    }
    if (record.type === 'ClassMethod' || record.type === 'ClassPrivateMethod') {
      const method = record.function as
        | {
            params?: unknown;
            body?: unknown;
            typeParameters?: unknown;
            returnType?: unknown;
            generator?: boolean;
            async?: boolean;
          }
        | undefined;

      if (Array.isArray(method?.params)) {
        record.params = method.params;
      }
      record.body ??= method?.body;
      record.typeParameters ??= method?.typeParameters;
      record.returnType ??= method?.returnType;
      if (typeof method?.generator === 'boolean' && record.generator === undefined) {
        record.generator = method.generator;
      }
      if (typeof method?.async === 'boolean' && record.async === undefined) {
        record.async = method.async;
      }
    }
    if (record.type === 'ObjectExpression' && Array.isArray(record.properties)) {
      record.properties = record.properties.map((property) => {
        if (!property || typeof property !== 'object') {
          return property;
        }

        const propertyNode = property as SwcNodeLike;
        if (propertyNode.type !== 'Identifier') {
          return property;
        }

        const identifier = t.cloneNode(property as t.Identifier, true);
        return t.objectProperty(identifier, t.cloneNode(property as t.Identifier, true), false, true);
      });
    }
    if (
      (record.type === 'ImportDeclaration' || record.type === 'ExportNamedDeclaration') &&
      !Array.isArray(record.specifiers)
    ) {
      record.specifiers = [];
    }

    if (record.type === 'ImportSpecifier' && !record.imported) {
      record.imported = record.local;
    }
    if (record.type === 'ExportSpecifier' && !record.exported) {
      record.exported = record.local;
    }

    if (Array.isArray(record.params)) {
      record.params = record.params.map((param: unknown) => {
        if (!param || typeof param !== 'object') {
          return param;
        }

        const parameter = param as { pat?: unknown; pattern?: unknown };
        return parameter.pat ?? parameter.pattern ?? param;
      });
    }

    if (Array.isArray(record.arguments)) {
      record.arguments = record.arguments.map((arg: unknown) => {
        if (!arg || typeof arg !== 'object' || !('expression' in arg)) {
          return arg;
        }

        const expressionNode = arg as { expression?: unknown; spread?: boolean; loc?: unknown; span?: unknown };
        return expressionNode.spread
          ? {
              type: 'SpreadElement',
              argument: expressionNode.expression,
              loc: expressionNode.loc,
              span: expressionNode.span,
            }
          : expressionNode.expression;
      });
    }

    if (Array.isArray(record.elements)) {
      record.elements = record.elements.map((element: unknown) => {
        if (!element || typeof element !== 'object' || !('expression' in element)) {
          return element;
        }

        const expressionNode = element as { expression?: unknown; spread?: boolean; loc?: unknown; span?: unknown };
        return expressionNode.spread
          ? {
              type: 'SpreadElement',
              argument: expressionNode.expression,
              loc: expressionNode.loc,
              span: expressionNode.span,
            }
          : expressionNode.expression;
      });
    }

    const property = record.property as { type?: string; expression?: unknown } | undefined;
    if (property?.type === 'Computed') {
      record.computed = true;
      record.property = property.expression;
    } else if (record.computed === undefined) {
      record.computed = false;
    }

    if (record.type === 'TemplateElement' && !record.value) {
      record.value = {
        cooked: record.cooked,
        raw: record.raw,
      };
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }
        continue;
      }

      visit(value);
    }
  };

  visit(root);
}

export class NodePath<TNode extends t.Node = t.Node> {
  readonly scope: Scope;

  constructor(
    readonly node: TNode,
    readonly parentPath: NodePath | null,
    state: WalkState,
  ) {
    if (createsScope(node)) {
      this.scope = new Scope(this, parentPath?.scope, state);
      state.scopeByNode.set(node, this.scope);
    } else {
      this.scope = parentPath?.scope ?? new Scope(this, undefined, state);
    }
  }

  isIdentifier(): this is NodePath<t.Identifier> {
    return t.isIdentifier(this.node);
  }

  isObjectProperty(): this is NodePath<t.ObjectProperty> {
    return t.isObjectProperty(this.node);
  }

  isObjectPattern(): this is NodePath<t.ObjectPattern> {
    return t.isObjectPattern(this.node);
  }

  isAssignmentPattern(): this is NodePath<t.AssignmentPattern> {
    return t.isAssignmentPattern(this.node);
  }

  isVariableDeclarator(): this is NodePath<t.VariableDeclarator> {
    return t.isVariableDeclarator(this.node);
  }

  isVariableDeclaration(): this is NodePath<t.VariableDeclaration> {
    return t.isVariableDeclaration(this.node);
  }

  isFunctionDeclaration(): this is NodePath<t.FunctionDeclaration> {
    return t.isFunctionDeclaration(this.node);
  }

  isFunctionExpression(): this is NodePath<t.FunctionExpression> {
    return t.isFunctionExpression(this.node);
  }

  isArrowFunctionExpression(): this is NodePath<t.ArrowFunctionExpression> {
    return t.isArrowFunctionExpression(this.node);
  }

  isProgram(): this is NodePath<t.Program> {
    return t.isProgram(this.node);
  }

  isExportNamedDeclaration(): this is NodePath<t.ExportNamedDeclaration> {
    return t.isExportNamedDeclaration(this.node);
  }

  isExportDefaultDeclaration(): this is NodePath<t.ExportDefaultDeclaration> {
    return t.isExportDefaultDeclaration(this.node);
  }

  isCallExpression(): this is NodePath<t.CallExpression> {
    return t.isCallExpression(this.node);
  }

  isOptionalCallExpression(): this is NodePath<t.OptionalCallExpression> {
    return t.isOptionalCallExpression(this.node);
  }

  isAssignmentExpression(): this is NodePath<t.AssignmentExpression> {
    return t.isAssignmentExpression(this.node);
  }

  getFunctionParent(): NodePath | null {
    let current: NodePath | null = this;
    while (current) {
      if (
        t.isFunctionDeclaration(current.node) ||
        t.isFunctionExpression(current.node) ||
        t.isArrowFunctionExpression(current.node) ||
        t.isObjectMethod(current.node) ||
        t.isClassMethod(current.node) ||
        t.isClassPrivateMethod(current.node)
      ) {
        return current;
      }
      current = current.parentPath;
    }

    return null;
  }
}

export class Scope {
  private initialized = false;
  private readonly bindings = new Map<string, Binding>();

  constructor(
    readonly path: NodePath,
    private readonly parent: Scope | undefined,
    readonly state: WalkState,
  ) {}

  getBinding(name: string): Binding | undefined {
    this.initialize();
    return this.bindings.get(name) ?? this.parent?.getBinding(name);
  }

  private initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    collectScopeBindings(this);
    collectConstantViolations(this);
  }

  addBinding(identifier: t.Identifier, path: NodePath, kind: BindingKind): void {
    if (this.bindings.has(identifier.name)) {
      return;
    }

    this.bindings.set(identifier.name, {
      identifier,
      path,
      kind,
      constant: kind === 'const' || kind === 'hoisted' || kind === 'module' || kind === 'param',
      constantViolations: [],
    });
  }

  markViolation(path: NodePath<t.AssignmentExpression>): void {
    const left = path.node.left;
    if (!t.isIdentifier(left)) {
      return;
    }

    const binding = this.bindings.get(left.name);
    if (!binding || binding.kind === 'module') {
      return;
    }

    binding.constant = false;
    binding.constantViolations.push(path);
  }
}

function pathForNode<TNode extends t.Node>(node: TNode, state: WalkState): NodePath<TNode> {
  const cached = state.pathByNode.get(node) as NodePath<TNode> | undefined;
  if (cached) {
    return cached;
  }

  const parentNode = state.parentByNode.get(node);
  const parentPath = parentNode ? pathForNode(parentNode, state) : null;
  const path = new NodePath(node, parentPath, state);
  state.pathByNode.set(node, path);
  return path;
}

function addPatternBindings(
  pattern: t.Node,
  bindingPath: NodePath,
  kind: BindingKind,
  scope: Scope,
  state: WalkState,
): void {
  if (t.isIdentifier(pattern)) {
    scope.addBinding(pattern, bindingPath, kind);
    return;
  }

  if (t.isRestElement(pattern)) {
    addPatternBindings(pattern.argument, pathForNode(pattern.argument, state), kind, scope, state);
    return;
  }

  if (t.isAssignmentPattern(pattern)) {
    addPatternBindings(pattern.left, pathForNode(pattern.left, state), kind, scope, state);
    return;
  }

  if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) {
      if (element) {
        addPatternBindings(element, pathForNode(element, state), kind, scope, state);
      }
    }
    return;
  }

  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isRestElement(property)) {
        addPatternBindings(property.argument, pathForNode(property.argument, state), kind, scope, state);
        continue;
      }

      if (t.isObjectProperty(property)) {
        addPatternBindings(property.value as t.Node, pathForNode(property, state), kind, scope, state);
      }
    }
  }
}

function collectFunctionParams(scope: Scope): void {
  const node = scope.path.node;
  if (
    !t.isFunctionDeclaration(node) &&
    !t.isFunctionExpression(node) &&
    !t.isArrowFunctionExpression(node) &&
    !t.isObjectMethod(node) &&
    !t.isClassMethod(node) &&
    !t.isClassPrivateMethod(node)
  ) {
    return;
  }

  for (const param of node.params) {
    addPatternBindings(param as t.Node, pathForNode(param as t.Node, scope.state), 'param', scope, scope.state);
  }
}

function collectScopeBindings(scope: Scope): void {
  const state = scope.state;
  const rootNode = scope.path.node;
  collectFunctionParams(scope);

  walkTree(
    rootNode,
    state,
    null,
    (path) => {
      const node = path.node;

      if (t.isImportDeclaration(node)) {
        for (const specifier of node.specifiers) {
          if ('local' in specifier && t.isIdentifier(specifier.local)) {
            scope.addBinding(specifier.local, pathForNode(specifier.local, state), 'module');
          }
        }
        return;
      }

      if (t.isFunctionDeclaration(node)) {
        if (node.id) {
          scope.addBinding(node.id, pathForNode(node, state), 'hoisted');
        }
        return;
      }

      if (t.isVariableDeclarator(node)) {
        addPatternBindings(node.id as t.Node, pathForNode(node, state), variableKind(node, state), scope, state);
      }
    },
    (path) => path.node === rootNode || !createsScope(path.node),
  );
}

function variableKind(declarator: t.VariableDeclarator, state: WalkState): BindingKind {
  const parent = state.parentByNode.get(declarator);
  if (!t.isVariableDeclaration(parent)) {
    return 'const';
  }

  return parent.kind === 'let' || parent.kind === 'var' ? parent.kind : 'const';
}

function collectConstantViolations(scope: Scope): void {
  const state = scope.state;
  const rootNode = scope.path.node;

  walkTree(
    rootNode,
    state,
    null,
    (path) => {
      if (t.isAssignmentExpression(path.node)) {
        scope.markViolation(pathForNode(path.node, state));
      }
    },
    (path) => path.node === rootNode || !createsScope(path.node),
  );
}

function createWalkState(root: t.Node): WalkState {
  const state: WalkState = {
    parentByNode: new WeakMap(),
    pathByNode: new WeakMap(),
    scopeByNode: new WeakMap(),
  };

  walkTree(
    root,
    state,
    null,
    () => {},
    () => true,
  );
  return state;
}

export function traverseAst(ast: t.File | t.Program | t.Node, visitors: VisitorMap): void {
  const root = t.isFile(ast as t.Node) ? (ast as t.File).program : (ast as t.Node);
  const state = createWalkState(root);

  walkTree(
    root,
    state,
    null,
    (path) => {
      const visitor = visitors[path.node.type] as ((path: NodePath) => void) | undefined;
      visitor?.(path);
    },
    () => true,
  );
}
