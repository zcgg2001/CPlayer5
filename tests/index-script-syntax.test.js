import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';


test('inline player scripts have valid JavaScript syntax', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());

  assert.ok(inlineScripts.length > 0);
  for (const source of inlineScripts) {
    const withoutStaticImports = source.replace(/^\s*import\b[\s\S]*?;\s*$/gm, '');
    assert.doesNotThrow(() => new Function(withoutStaticImports));
  }
});
