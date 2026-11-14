import { describe, expect, test } from 'bun:test';
import { SourceMapConsumer, SourceMapGenerator } from 'source-map';
import { symbolicateStack } from '../src/symbolicate';

// generated:line:column(0-based) -> src/App.tsx:line:column(0-based)
const buildConsumer = () => {
  const generator = new SourceMapGenerator({ file: 'index.bundlejs' });
  generator.addMapping({
    generated: { line: 1, column: 100 },
    original: { line: 10, column: 4 },
    source: 'src/App.tsx',
    name: 'render',
  });
  generator.addMapping({
    generated: { line: 12, column: 0 },
    original: { line: 3, column: 0 },
    source: 'src/util.ts',
  });
  return new SourceMapConsumer(generator.toString());
};

describe('symbolicateStack', () => {
  test('maps engine frames (1-based columns) and hermes frames (bytecode offsets)', () => {
    const consumer = buildConsumer();
    const stack = [
      'Error: boom',
      '    at render (index.bundlejs:1:101)',
      '    at util (address at index.android.bundle:1:100)',
      '    at helper (index.bundlejs:12:1)',
      '    at native (native)',
    ].join('\n');
    const { text, mapped } = symbolicateStack(stack, consumer);
    expect(mapped).toBe(3);
    expect(text).toContain('at render (src/App.tsx:10:5 (render))');
    expect(text).toContain('at util (src/App.tsx:10:5 (render))');
    expect(text).toContain('at helper (src/util.ts:3:1)');
    expect(text).toContain('at native (native)');
  });

  test('leaves frames the map does not cover untouched', () => {
    const consumer = buildConsumer();
    const { text, mapped } = symbolicateStack(
      'at nowhere (main.jsbundle:999:9)',
      consumer,
    );
    expect(mapped).toBe(0);
    expect(text).toBe('at nowhere (main.jsbundle:999:9)');
  });

  test('handles bundle paths with query strings and directories', () => {
    const consumer = buildConsumer();
    const { text } = symbolicateStack(
      'at f (http://localhost:8081/build/index.bundlejs?platform=ios:1:101)',
      consumer,
    );
    expect(text).toContain('src/App.tsx:10:5');
  });
});
