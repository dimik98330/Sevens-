#!/usr/bin/env node
// Compile the single TypeScript rules engine before tests or deployment.
// The API image needs only these JavaScript files, never the TypeScript compiler.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src', 'domain', 'routing');
const outputDir = path.join(root, 'dist', 'routing');
await mkdir(outputDir, { recursive: true });

for (const file of (await readdir(sourceDir)).filter((name) => name.endsWith('.ts')).sort()) {
  const name=file.slice(0,-3);
  const source = await readFile(path.join(sourceDir, `${name}.ts`), 'utf8');
  const result = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  });
  const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }));
  }
  const compiled = result.outputText.replace(
    /(from\s*|import\s*\()\s*(['"])(\.[^'"]*)\2/g,
    (_match, prefix, quote, specifier) =>
      `${prefix}${quote}${/\.[a-z]+$/i.test(specifier) ? specifier : `${specifier}.mjs`}${quote}`,
  );
  await writeFile(path.join(outputDir, `${name}.mjs`), compiled);
}
console.log('Built versioned routing engines');
