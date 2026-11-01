import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import ts from 'typescript';

test('core module graph imports only files within core, with no dynamic loading', async () => {
  const root = resolve('src/core');
  for (const file of await readdir(root)) {
    if (!file.endsWith('.ts')) continue;
    const path = resolve(root, file);
    const ast = ts.createSourceFile(file, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        assert.ok(specifier.startsWith('.'), `${file} imports external module ${specifier}`);
        assert.ok(resolve(dirname(path), specifier).startsWith(root + sep), `${file} imports outside core`);
      }
      if (ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, `${file} uses dynamic import`);
        assert.ok(!ts.isIdentifier(node.expression) || node.expression.text !== 'require', `${file} uses require`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});
