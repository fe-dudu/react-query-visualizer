export interface BaseNode {
  type: string;
  start?: number;
  end?: number;
  loc?: Loc;
}

export type Node = BaseNode;
export type Program = BaseNode & { type: 'Program'; body: Statement[] };
export type Expression = BaseNode;
export type Statement = BaseNode;
export type ArrayExpression = BaseNode & { elements: Array<Expression | SpreadElement | null> };
export type ObjectExpression = BaseNode & { properties: Array<ObjectProperty | SpreadElement> };
export type ObjectProperty = BaseNode & {
  type: 'Property';
  kind: ObjectPropertyKind;
  key: Expression | PrivateName;
  value: Expression;
  method: boolean;
  shorthand: boolean;
  computed: boolean;
  optional: boolean;
};
export type ObjectPropertyKind = 'init' | 'get' | 'set' | 'method' | string;
export type SpreadElement = BaseNode & { argument: Expression };
export type AssignmentPattern = BaseNode & { left: LVal; right: Expression };
export type ObjectPattern = BaseNode & {
  properties: Array<AssignmentTargetProperty | BindingProperty | RestElement>;
  typeAnnotation?: TSTypeAnnotation | null;
};
export type ArrayPattern = BaseNode & { elements: Array<Expression | Pattern | RestElement | null> };
export type VariableDeclarator = BaseNode & { id: LVal; init?: Expression | null; definite?: boolean };
export type VariableDeclaration = BaseNode & {
  declarations: VariableDeclarator[];
  kind: 'var' | 'let' | 'const' | 'using';
};
export type ArrowFunctionExpression = BaseNode & {
  params: Array<Pattern | RestElement | TSParameterProperty>;
  body: BlockStatement | Expression;
  generator: boolean;
  async: boolean;
  expression: boolean;
  returnType?: TypeAnnotation | null;
  typeParameters?: TSTypeParameterInstantiation | null;
};
export type CallExpression = BaseNode & {
  callee: Expression;
  arguments: Array<Argument>;
  optional?: boolean;
  typeParameters?: TSTypeParameterInstantiation | null;
  typeArguments?: TSTypeParameterInstantiation | null;
};
export type AssignmentExpression = BaseNode & { left: LVal; right: Expression; operator?: string };
export type ChainExpression = BaseNode & { expression: Expression };
export type MemberExpression = BaseNode & {
  object: Expression;
  property: Expression | PrivateName;
  computed: boolean;
  optional?: boolean;
};
export type NewExpression = BaseNode & { callee: Expression; arguments: Array<Argument> };
export type ConditionalExpression = BaseNode & { test: Expression; consequent: Expression; alternate: Expression };
export type LogicalExpression = BaseNode & { left: Expression; right: Expression; operator: string };
export type BinaryExpression = BaseNode & { left: Expression; right: Expression; operator: string };
export type UnaryExpression = BaseNode & { argument: Expression; operator: string; prefix?: boolean };
export type UpdateExpression = BaseNode & { argument: Expression; operator: string; prefix: boolean };
export type SequenceExpression = BaseNode & { expressions: Expression[] };
export type ParenthesizedExpression = BaseNode & { expression: Expression };
export type TSAsExpression = BaseNode & { expression: Expression; typeAnnotation: TSType };
export type TSSatisfiesExpression = BaseNode & { expression: Expression; typeAnnotation: TSType };
export type TSNonNullExpression = BaseNode & { expression: Expression };
export type TSTypeAssertion = BaseNode & { expression: Expression; typeAnnotation: TSType };
export type TSParenthesizedType = BaseNode & { typeAnnotation: TSType };
export type TSTypeLiteral = BaseNode & { members: unknown[] };
export type TSPropertySignature = BaseNode & { key: Expression; typeAnnotation?: TSTypeAnnotation | null };
export type TSTypeReference = BaseNode & {
  typeName: TSEntityName;
  typeArguments?: TSTypeParameterInstantiation | null;
  typeParameters?: TSTypeParameterInstantiation | null;
};
export type TSTypeParameterInstantiation = BaseNode & { params: TSType[] };
export type TSUnionType = BaseNode & { types: TSType[] };
export type TSIntersectionType = BaseNode & { types: TSType[] };
export type TSQualifiedName = BaseNode & { left: TSEntityName; right: IdentifierReference };
export type TSTypeQuery = BaseNode & { exprName: TSEntityName; typeArguments?: TSTypeParameterInstantiation | null };
export type TSImportType = BaseNode & { argument: StringLiteral };
export type ExportNamedDeclaration = BaseNode & {
  declaration?: Statement | null;
  specifiers: ExportSpecifier[];
  source?: StringLiteral | null;
};
export type ExportDefaultDeclaration = BaseNode & { declaration: Expression | Statement };
export type ImportDeclaration = BaseNode & {
  specifiers: Array<ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier>;
  source: StringLiteral;
};
export type ImportSpecifier = BaseNode & { imported: ModuleExportName; local: IdentifierReference };
export type ImportDefaultSpecifier = BaseNode & { local: IdentifierReference };
export type ImportNamespaceSpecifier = BaseNode & { local: IdentifierReference };
export type ExportSpecifier = BaseNode & { exported: ModuleExportName; local: ModuleExportName };
export type ReturnStatement = BaseNode & { argument?: Expression | null };
export type BlockStatement = BaseNode & { body: Statement[] };
export type IfStatement = BaseNode & { test: Expression; consequent: Statement; alternate?: Statement | null };
export type LabeledStatement = BaseNode & { label: LabelIdentifier; body: Statement };
export type ForStatement = BaseNode & {
  init?: VariableDeclaration | Expression | null;
  test?: Expression | null;
  update?: Expression | null;
  body: Statement;
};
export type ForInStatement = BaseNode & { left: VariableDeclaration | LVal; right: Expression; body: Statement };
export type ForOfStatement = BaseNode & { left: VariableDeclaration | LVal; right: Expression; body: Statement };
export type WhileStatement = BaseNode & { test: Expression; body: Statement };
export type DoWhileStatement = BaseNode & { test: Expression; body: Statement };
export type SwitchStatement = BaseNode & { discriminant: Expression; cases: Array<SwitchCase> };
export type TryStatement = BaseNode & {
  block: BlockStatement;
  handler?: CatchClause | null;
  finalizer?: BlockStatement | null;
};
export type ExpressionStatement = BaseNode & { expression: Expression };
export type PrivateIdentifier = BaseNode & { name: string };
export type IdentifierReference = BaseNode & {
  name: string;
  optional?: boolean;
  decorators?: unknown[];
  typeAnnotation?: TypeAnnotation | null;
};
export type BindingIdentifier = IdentifierReference;
export type IdentifierName = IdentifierReference;
export type LabelIdentifier = IdentifierReference;
export type StringLiteral = BaseNode & { value: string };
export type NumericLiteral = BaseNode & { value: number };
export type BooleanLiteral = BaseNode & { value: boolean };
export type NullLiteral = BaseNode & { value: null };
export type BigIntLiteral = BaseNode & { value: string };
export type TemplateElement = BaseNode & { value: { cooked?: string | null; raw: string }; tail: boolean };
export type TemplateLiteral = BaseNode & { quasis: TemplateElement[]; expressions: Expression[] };
export type JSXIdentifier = BaseNode & { name: string };
export type JSXExpressionContainer = BaseNode & { expression: Expression | JSXEmptyExpression };
export type JSXEmptyExpression = BaseNode;
export type JSXAttribute = BaseNode & { name: JSXIdentifier; value?: Expression | null };
export type AssignmentTargetProperty = BaseNode & {
  key?: Expression;
  value?: Expression;
  shorthand?: boolean;
  computed?: boolean;
};
export type BindingProperty = BaseNode & { key?: Expression; value?: Pattern | Expression; computed?: boolean };
export type PrivateInExpression = BaseNode & { left: PrivateName | Expression; right: Expression };
export type TSEntityName = IdentifierReference | TSQualifiedName;
export type TSType = BaseNode;
export type TypeAnnotation = BaseNode & { typeAnnotation?: TSType };
export type TSTypeAnnotation = TypeAnnotation;
export type TypeCastExpression = BaseNode & { expression: Expression; typeAnnotation: TSType };
export type FunctionDeclaration = BaseNode & {
  id?: IdentifierReference | null;
  params: Array<Pattern | RestElement | TSParameterProperty>;
  body: BlockStatement;
  generator: boolean;
  async: boolean;
  expression?: boolean;
  returnType?: TypeAnnotation | null;
  typeParameters?: TSTypeParameterInstantiation | null;
};
export type FunctionExpression = FunctionDeclaration;
export type LVal =
  | IdentifierReference
  | ArrayPattern
  | ObjectPattern
  | AssignmentPattern
  | MemberExpression
  | TSAsExpression
  | TSSatisfiesExpression
  | TSNonNullExpression
  | TSTypeAssertion
  | RestElement;
export type Pattern = LVal;
export type RestElement = BaseNode & { argument: LVal };
export type V8IntrinsicIdentifier = IdentifierReference;
export type Argument = Expression | SpreadElement;
export type TSParameterProperty = BaseNode & { parameter: IdentifierReference | AssignmentPattern | Pattern };
export type CatchClause = BaseNode & { param?: Pattern | null; body: BlockStatement };
export type SwitchCase = BaseNode & { test?: Expression | null; consequent: Statement[] };
export type ModuleExportName = IdentifierReference | StringLiteral;
export type Function = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;
export type Super = BaseNode & { type: 'Super' };
export type JSXOpeningElement = BaseNode & {
  name: JSXIdentifier | JSXMemberExpression | JSXNamespacedName;
  attributes: JSXAttribute[];
  selfClosing: boolean;
};
export type JSXMemberExpression = BaseNode & { object: JSXIdentifier | JSXMemberExpression; property: JSXIdentifier };
export type JSXNamespacedName = BaseNode & { namespace: JSXIdentifier; name: JSXIdentifier };
export type ExportAllDeclaration = BaseNode & { source: StringLiteral; exported?: ModuleExportName | null };
export type Noop = { type: 'Noop' };

export interface File {
  type: 'File';
  program: Program;
  comments: Array<Comment>;
  tokens: Array<unknown>;
}

export type Identifier = IdentifierReference | BindingIdentifier | IdentifierName | LabelIdentifier;
export type PrivateName = BaseNode & { type: 'PrivateName'; id: IdentifierReference };
export type OptionalCallExpression = CallExpression & { type: 'OptionalCallExpression'; optional: true };
export type OptionalMemberExpression = MemberExpression & { type: 'OptionalMemberExpression'; optional: true };
export type ObjectMethod = BaseNode & {
  type: 'ObjectMethod';
  method: true;
  params: Array<Pattern | RestElement | TSParameterProperty>;
  body: BlockStatement;
  generator: boolean;
  async: boolean;
  typeParameters?: TSTypeParameterInstantiation | null;
  returnType?: TypeAnnotation | null;
};
export type ClassMethod = BaseNode & {
  type: 'ClassMethod';
  params: Array<Pattern | RestElement | TSParameterProperty>;
  body: BlockStatement;
  generator: boolean;
  async: boolean;
  typeParameters?: TSTypeParameterInstantiation | null;
  returnType?: TypeAnnotation | null;
};
export type ClassPrivateMethod = BaseNode & {
  type: 'ClassPrivateMethod';
  params: Array<Pattern | RestElement | TSParameterProperty>;
  body: BlockStatement;
  generator: boolean;
  async: boolean;
  typeParameters?: TSTypeParameterInstantiation | null;
  returnType?: TypeAnnotation | null;
};

export interface Comment {
  type: 'Line' | 'Block';
  value: string;
  start: number;
  end: number;
  loc?: Loc;
}

export interface LocPosition {
  line: number;
  column: number;
}

export interface Loc {
  start: LocPosition;
  end: LocPosition;
}

const EXPRESSION_TYPES = new Set([
  'Identifier',
  'Literal',
  'BooleanLiteral',
  'NullLiteral',
  'NumericLiteral',
  'BigIntLiteral',
  'RegExpLiteral',
  'StringLiteral',
  'TemplateLiteral',
  'MetaProperty',
  'Super',
  'ArrayExpression',
  'ArrowFunctionExpression',
  'AssignmentExpression',
  'AwaitExpression',
  'BinaryExpression',
  'CallExpression',
  'ChainExpression',
  'ClassExpression',
  'ConditionalExpression',
  'FunctionExpression',
  'ImportExpression',
  'LogicalExpression',
  'NewExpression',
  'ObjectExpression',
  'ParenthesizedExpression',
  'SequenceExpression',
  'TaggedTemplateExpression',
  'ThisExpression',
  'UnaryExpression',
  'UpdateExpression',
  'YieldExpression',
  'PrivateInExpression',
  'JSXElement',
  'JSXFragment',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSInstantiationExpression',
  'V8IntrinsicExpression',
  'MemberExpression',
]);

const STATEMENT_TYPES = new Set([
  'BlockStatement',
  'BreakStatement',
  'ContinueStatement',
  'DebuggerStatement',
  'DoWhileStatement',
  'EmptyStatement',
  'ExpressionStatement',
  'ForInStatement',
  'ForOfStatement',
  'ForStatement',
  'IfStatement',
  'LabeledStatement',
  'ReturnStatement',
  'SwitchStatement',
  'ThrowStatement',
  'TryStatement',
  'WhileStatement',
  'WithStatement',
  'FunctionDeclaration',
  'ClassDeclaration',
  'VariableDeclaration',
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportDefaultDeclaration',
  'ExportNamedDeclaration',
  'TSExportAssignment',
  'TSNamespaceExportDeclaration',
]);

const LVAL_TYPES = new Set([
  'Identifier',
  'ArrayPattern',
  'ObjectPattern',
  'AssignmentPattern',
  'RestElement',
  'MemberExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

export const VISITOR_KEYS: Record<string, readonly string[]> = {};

const NODE_CHILD_SKIP_KEYS = new Set(['comments', 'loc', 'parent', 'range', 'start', 'end', 'tokens']);

export function getNodeChildren(node: Node): Node[] {
  const children: Node[] = [];
  forEachNodeChild(node, (child) => {
    children.push(child);
  });
  return children;
}

export function forEachNodeChild(node: Node, visit: (child: Node, key: string) => void): void {
  for (const [key, value] of Object.entries(node as unknown as Record<string, unknown>)) {
    if (NODE_CHILD_SKIP_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          visit(item as Node, key);
        }
      }
      continue;
    }

    if (isNode(value)) {
      visit(value as Node, key);
    }
  }
}

export function isNode(value: unknown): value is Record<string, unknown> & { type: string } {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

function hasType<T extends string>(node: unknown, type: T): node is Record<string, unknown> & { type: T } {
  return isNode(node) && node.type === type;
}

export function isFile(node: unknown): node is File {
  return hasType(node, 'File');
}

export function isProgram(node: unknown): node is Program {
  return hasType(node, 'Program');
}

export function isIdentifier(
  node: unknown,
): node is IdentifierReference | BindingIdentifier | IdentifierName | LabelIdentifier {
  return hasType(node, 'Identifier');
}

export function isStringLiteral(node: unknown): node is StringLiteral {
  return (
    hasType(node, 'StringLiteral') ||
    (hasType(node, 'Literal') && typeof (node as { value?: unknown }).value === 'string')
  );
}

export function isNumericLiteral(node: unknown): node is NumericLiteral {
  return (
    hasType(node, 'NumericLiteral') ||
    (hasType(node, 'Literal') && typeof (node as { value?: unknown }).value === 'number')
  );
}

export function isBooleanLiteral(node: unknown): node is BooleanLiteral {
  return (
    hasType(node, 'BooleanLiteral') ||
    (hasType(node, 'Literal') && typeof (node as { value?: unknown }).value === 'boolean')
  );
}

export function isNullLiteral(node: unknown): node is NullLiteral {
  return hasType(node, 'NullLiteral') || (hasType(node, 'Literal') && (node as { value?: unknown }).value === null);
}

export function isBigIntLiteral(node: unknown): node is BigIntLiteral {
  return hasType(node, 'BigIntLiteral');
}

export function isTemplateLiteral(node: unknown): node is TemplateLiteral {
  return hasType(node, 'TemplateLiteral');
}

export function isJSXIdentifier(node: unknown): node is JSXIdentifier {
  return hasType(node, 'JSXIdentifier');
}

export function isJSXExpressionContainer(node: unknown): node is JSXExpressionContainer {
  return hasType(node, 'JSXExpressionContainer');
}

export function isJSXEmptyExpression(node: unknown): node is JSXEmptyExpression {
  return hasType(node, 'JSXEmptyExpression');
}

export function isJSXAttribute(node: unknown): node is JSXAttribute {
  return hasType(node, 'JSXAttribute');
}

export function isExpression(node: unknown): node is Expression {
  return (
    isNode(node) &&
    (EXPRESSION_TYPES.has(node.type) ||
      node.type === 'OptionalCallExpression' ||
      node.type === 'OptionalMemberExpression')
  );
}

export function isStatement(node: unknown): node is Statement {
  return isNode(node) && STATEMENT_TYPES.has(node.type);
}

export function isLVal(node: unknown): node is LVal {
  return isNode(node) && LVAL_TYPES.has(node.type);
}

export function isArrayExpression(node: unknown): node is ArrayExpression {
  return hasType(node, 'ArrayExpression');
}

export function isObjectExpression(node: unknown): node is ObjectExpression {
  return hasType(node, 'ObjectExpression');
}

export function isObjectProperty(node: unknown): node is ObjectProperty | AssignmentTargetProperty | BindingProperty {
  return hasType(node, 'Property') && !(node as { method?: boolean }).method;
}

export function isObjectMethod(node: unknown): node is ObjectMethod {
  return hasType(node, 'ObjectMethod') || (hasType(node, 'Property') && Boolean((node as { method?: boolean }).method));
}

export function isSpreadElement(node: unknown): node is SpreadElement {
  return hasType(node, 'SpreadElement');
}

export function isRestElement(node: unknown): node is RestElement {
  return hasType(node, 'RestElement');
}

export function isAssignmentPattern(node: unknown): node is AssignmentPattern {
  return hasType(node, 'AssignmentPattern');
}

export function isObjectPattern(node: unknown): node is ObjectPattern {
  return hasType(node, 'ObjectPattern');
}

export function isArrayPattern(node: unknown): node is ArrayPattern {
  return hasType(node, 'ArrayPattern');
}

export function isVariableDeclarator(node: unknown): node is VariableDeclarator {
  return hasType(node, 'VariableDeclarator');
}

export function isVariableDeclaration(node: unknown): node is VariableDeclaration {
  return hasType(node, 'VariableDeclaration');
}

export function isFunctionDeclaration(node: unknown): node is FunctionDeclaration {
  return hasType(node, 'FunctionDeclaration');
}

export function isFunctionExpression(node: unknown): node is FunctionExpression {
  return hasType(node, 'FunctionExpression');
}

export function isArrowFunctionExpression(node: unknown): node is ArrowFunctionExpression {
  return hasType(node, 'ArrowFunctionExpression');
}

export function isObjectMethodLike(node: unknown): node is ObjectMethod {
  return isObjectMethod(node);
}

export function isClassMethod(node: unknown): node is ClassMethod {
  return (
    hasType(node, 'ClassMethod') ||
    (hasType(node, 'MethodDefinition') && (node as { key?: { type?: string } }).key?.type !== 'PrivateIdentifier')
  );
}

export function isClassPrivateMethod(node: unknown): node is ClassPrivateMethod {
  return (
    hasType(node, 'ClassPrivateMethod') ||
    (hasType(node, 'MethodDefinition') && (node as { key?: { type?: string } }).key?.type === 'PrivateIdentifier')
  );
}

export function isCallExpression(node: unknown): node is CallExpression {
  return hasType(node, 'CallExpression') || hasType(node, 'OptionalCallExpression');
}

export function isOptionalCallExpression(node: unknown): node is OptionalCallExpression {
  const record = node as Record<string, unknown>;
  return (
    hasType(node, 'OptionalCallExpression') ||
    (hasType(node, 'ChainExpression') && isCallExpression(record.expression)) ||
    (hasType(node, 'CallExpression') && Boolean(record.optional))
  );
}

export function isMemberExpression(node: unknown): node is MemberExpression {
  return hasType(node, 'MemberExpression') || hasType(node, 'OptionalMemberExpression');
}

export function isOptionalMemberExpression(node: unknown): node is OptionalMemberExpression {
  const record = node as Record<string, unknown>;
  return (
    hasType(node, 'OptionalMemberExpression') ||
    (hasType(node, 'ChainExpression') && isMemberExpression(record.expression)) ||
    (hasType(node, 'MemberExpression') && Boolean(record.optional))
  );
}

export function isNewExpression(node: unknown): node is NewExpression {
  return hasType(node, 'NewExpression');
}

export function isConditionalExpression(node: unknown): node is ConditionalExpression {
  return hasType(node, 'ConditionalExpression');
}

export function isLogicalExpression(node: unknown): node is LogicalExpression {
  return hasType(node, 'LogicalExpression');
}

export function isBinaryExpression(node: unknown): node is BinaryExpression {
  return hasType(node, 'BinaryExpression');
}

export function isUnaryExpression(node: unknown): node is UnaryExpression {
  return hasType(node, 'UnaryExpression');
}

export function isUpdateExpression(node: unknown): node is UpdateExpression {
  return hasType(node, 'UpdateExpression');
}

export function isSequenceExpression(node: unknown): node is SequenceExpression {
  return hasType(node, 'SequenceExpression');
}

export function isAssignmentExpression(node: unknown): node is AssignmentExpression {
  return hasType(node, 'AssignmentExpression');
}

export function isParenthesizedExpression(node: unknown): node is ParenthesizedExpression {
  return hasType(node, 'ParenthesizedExpression');
}

export function isTSAsExpression(node: unknown): node is TSAsExpression {
  return hasType(node, 'TSAsExpression');
}

export function isTSSatisfiesExpression(node: unknown): node is TSSatisfiesExpression {
  return hasType(node, 'TSSatisfiesExpression');
}

export function isTSNonNullExpression(node: unknown): node is TSNonNullExpression {
  return hasType(node, 'TSNonNullExpression');
}

export function isTSTypeAssertion(node: unknown): node is TSTypeAssertion {
  return hasType(node, 'TSTypeAssertion');
}

export function isTypeCastExpression(node: unknown): node is TypeCastExpression {
  return isTSTypeAssertion(node);
}

export function isTSParenthesizedType(node: unknown): node is TSParenthesizedType {
  return hasType(node, 'TSParenthesizedType');
}

export function isTSTypeLiteral(node: unknown): node is TSTypeLiteral {
  return hasType(node, 'TSTypeLiteral');
}

export function isTSPropertySignature(node: unknown): node is TSPropertySignature {
  return hasType(node, 'TSPropertySignature');
}

export function isTSTypeReference(node: unknown): node is TSTypeReference {
  return hasType(node, 'TSTypeReference');
}

export function isTSTypeParameterInstantiation(node: unknown): node is TSTypeParameterInstantiation {
  return hasType(node, 'TSTypeParameterInstantiation');
}

export function isTSUnionType(node: unknown): node is TSUnionType {
  return hasType(node, 'TSUnionType');
}

export function isTSIntersectionType(node: unknown): node is TSIntersectionType {
  return hasType(node, 'TSIntersectionType');
}

export function isTSQualifiedName(node: unknown): node is TSQualifiedName {
  return hasType(node, 'TSQualifiedName');
}

export function isTSTypeQuery(node: unknown): node is TSTypeQuery {
  return hasType(node, 'TSTypeQuery');
}

export function isTSImportType(node: unknown): node is TSImportType {
  return hasType(node, 'TSImportType');
}

export function isPrivateName(node: unknown): node is PrivateName {
  return hasType(node, 'PrivateIdentifier') || hasType(node, 'PrivateName');
}

export function isTypeAnnotation(node: unknown): node is TypeAnnotation {
  return hasType(node, 'TSTypeAnnotation');
}

export function isNoop(node: unknown): node is Noop {
  return hasType(node, 'Noop');
}

export function isExportNamedDeclaration(node: unknown): node is ExportNamedDeclaration {
  return hasType(node, 'ExportNamedDeclaration');
}

export function isExportDefaultDeclaration(node: unknown): node is ExportDefaultDeclaration {
  return hasType(node, 'ExportDefaultDeclaration');
}

export function isImportDeclaration(node: unknown): node is ImportDeclaration {
  return hasType(node, 'ImportDeclaration');
}

export function isImportSpecifier(node: unknown): node is ImportSpecifier {
  return hasType(node, 'ImportSpecifier');
}

export function isImportDefaultSpecifier(node: unknown): node is ImportDefaultSpecifier {
  return hasType(node, 'ImportDefaultSpecifier');
}

export function isImportNamespaceSpecifier(node: unknown): node is ImportNamespaceSpecifier {
  return hasType(node, 'ImportNamespaceSpecifier');
}

export function isExportSpecifier(node: unknown): node is ExportSpecifier {
  return hasType(node, 'ExportSpecifier');
}

export function isReturnStatement(node: unknown): node is ReturnStatement {
  return hasType(node, 'ReturnStatement');
}

export function isBlockStatement(node: unknown): node is BlockStatement {
  return hasType(node, 'BlockStatement');
}

export function isIfStatement(node: unknown): node is IfStatement {
  return hasType(node, 'IfStatement');
}

export function isLabeledStatement(node: unknown): node is LabeledStatement {
  return hasType(node, 'LabeledStatement');
}

export function isForStatement(node: unknown): node is ForStatement {
  return hasType(node, 'ForStatement');
}

export function isForInStatement(node: unknown): node is ForInStatement {
  return hasType(node, 'ForInStatement');
}

export function isForOfStatement(node: unknown): node is ForOfStatement {
  return hasType(node, 'ForOfStatement');
}

export function isWhileStatement(node: unknown): node is WhileStatement {
  return hasType(node, 'WhileStatement');
}

export function isDoWhileStatement(node: unknown): node is DoWhileStatement {
  return hasType(node, 'DoWhileStatement');
}

export function isSwitchStatement(node: unknown): node is SwitchStatement {
  return hasType(node, 'SwitchStatement');
}

export function isTryStatement(node: unknown): node is TryStatement {
  return hasType(node, 'TryStatement');
}

export function isExpressionStatement(node: unknown): node is ExpressionStatement {
  return hasType(node, 'ExpressionStatement');
}

export function isPrivateIdentifier(node: unknown): node is PrivateIdentifier {
  return hasType(node, 'PrivateIdentifier');
}

export function isFileLike(node: unknown): node is File {
  return isFile(node);
}

function shallowClone<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return (Array.isArray(value) ? [...value] : { ...(value as Record<string, unknown>) }) as T;
}

function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return seen.get(value as object) as T;
  }

  const cloned: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value as object, cloned);

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'parent') {
      continue;
    }

    (cloned as Record<string, unknown>)[key] = deepClone(nested, seen);
  }

  return cloned as T;
}

export function cloneNode<T>(node: T, deep = true): T {
  return deep ? deepClone(node) : shallowClone(node);
}

export function normalizeAstShape(root: Node): void {
  const seen = new WeakSet<object>();

  const visit = (node: unknown): void => {
    if (!isNode(node) || seen.has(node)) {
      return;
    }
    seen.add(node);

    const record = node as Record<string, unknown>;

    if (record.type === 'Property' && Boolean(record.method)) {
      const methodValue = record.value as Record<string, unknown> | undefined;
      if (isNode(methodValue)) {
        record.type = 'ObjectMethod';
        record.params = Array.isArray(methodValue.params) ? methodValue.params : [];
        record.body = methodValue.body;
        record.generator = Boolean(methodValue.generator);
        record.async = Boolean(methodValue.async);
        record.typeParameters = methodValue.typeParameters ?? null;
        record.returnType = methodValue.returnType ?? null;
        record.value = undefined;
      }
    }

    if (record.type === 'MethodDefinition') {
      const methodValue = record.value as Record<string, unknown> | undefined;
      if (isNode(methodValue)) {
        const isPrivate = (record.key as { type?: string } | undefined)?.type === 'PrivateIdentifier';
        record.type = isPrivate ? 'ClassPrivateMethod' : 'ClassMethod';
        record.params = Array.isArray(methodValue.params) ? methodValue.params : [];
        record.body = methodValue.body;
        record.generator = Boolean(methodValue.generator);
        record.async = Boolean(methodValue.async);
        record.typeParameters = methodValue.typeParameters ?? null;
        record.returnType = methodValue.returnType ?? null;
        record.value = undefined;
      }
    }

    if (record.type === 'ChainExpression') {
      const expression = record.expression as Record<string, unknown> | undefined;
      if (isNode(expression)) {
        if (expression.type === 'CallExpression') {
          record.type = 'OptionalCallExpression';
          record.callee = expression.callee;
          record.arguments = Array.isArray(expression.arguments) ? expression.arguments : [];
          record.typeArguments = expression.typeArguments ?? null;
          record.optional = true;
        } else if (expression.type === 'MemberExpression') {
          record.type = 'OptionalMemberExpression';
          record.object = expression.object;
          record.property = expression.property;
          record.computed = Boolean(expression.computed);
          record.optional = true;
        }
        record.expression = undefined;
      }
    }

    if (record.type === 'PrivateIdentifier') {
      record.type = 'PrivateName';
      const privateName = identifier(String(record.name));
      record.id = privateName;
      const privateId = record.id as { start?: number; end?: number; loc?: Loc };
      if ('start' in record && typeof record.start === 'number') {
        privateId.start = record.start as number;
      }
      if ('end' in record && typeof record.end === 'number') {
        privateId.end = record.end as number;
      }
      if ('loc' in record && record.loc) {
        privateId.loc = record.loc as Loc;
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'parent' || key === 'loc') {
        continue;
      }

      if (Array.isArray(value)) {
        for (const child of value) {
          visit(child);
        }
        continue;
      }

      visit(value);
    }
  };

  visit(root);
}

export function identifier(name: string): IdentifierReference {
  return {
    type: 'Identifier',
    name,
    optional: false,
    decorators: [],
    typeAnnotation: null,
    start: 0,
    end: 0,
  };
}

export function objectProperty(key: BaseNode, value: Expression, computed = false, shorthand = false): ObjectProperty {
  const start = typeof key.start === 'number' ? key.start : 0;
  const end = typeof key.end === 'number' ? key.end : (value.end ?? start);
  return {
    type: 'Property',
    kind: 'init',
    key: key as Expression | PrivateName,
    value,
    method: false,
    shorthand,
    computed,
    optional: false,
    start,
    end,
  };
}

export function spreadElement(argument: Expression): SpreadElement {
  return {
    type: 'SpreadElement',
    argument,
    start: argument.start,
    end: argument.end,
  };
}

export function objectExpression(properties: Array<ObjectProperty | SpreadElement>): ObjectExpression {
  const first = properties[0] as { start?: number } | undefined;
  const last = properties[properties.length - 1] as { end?: number } | undefined;

  return {
    type: 'ObjectExpression',
    properties,
    start: first?.start ?? 0,
    end: last?.end ?? 0,
  };
}
