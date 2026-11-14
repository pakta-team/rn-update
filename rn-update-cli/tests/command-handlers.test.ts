import { describe, expect, test } from 'bun:test';
import * as parser from '@babel/parser';
import fs from 'fs';
import path from 'path';

const commandFiles = [
  'src/app.ts',
  'src/bundle.ts',
  'src/diff.ts',
  'src/install.ts',
  'src/package.ts',
  'src/user.ts',
  'src/versions.ts',
];

function findThisUsagesInCommandMaps(filePath: string): string[] {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(sourceText, {
    sourceType: 'module',
    plugins: ['typescript'],
  });
  const errors: string[] = [];

  function traverse(node: any, visit: (node: any) => void) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const key in node) {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          for (const child of node[key]) {
            traverse(child, visit);
          }
        } else if (node[key].type) {
          traverse(node[key], visit);
        }
      }
    }
  }

  function scanForThis(startNode: any): void {
    traverse(startNode, (child) => {
      if (child.type === 'ThisExpression') {
        const line = child.loc?.start?.line ?? 0;
        const column = child.loc?.start?.column ?? 0;
        errors.push(`${filePath}:${line}:${column + 1}`);
      }
    });
  }

  traverse(ast, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name.endsWith('Commands') &&
      node.init
    ) {
      scanForThis(node.init);
    }

    if (
      node.type === 'FunctionDeclaration' &&
      node.id &&
      node.id.type === 'Identifier' &&
      node.id.name.startsWith('get') &&
      node.id.name.endsWith('Commands') &&
      node.body
    ) {
      scanForThis(node.body);
    }
  });

  return errors;
}

describe('cli command maps', () => {
  test('do not depend on receiver this binding', () => {
    const projectRoot = path.resolve(import.meta.dir, '..');
    const thisUsages = commandFiles.flatMap((file) =>
      findThisUsagesInCommandMaps(path.join(projectRoot, file)),
    );

    expect(thisUsages).toEqual([]);
  });
});
