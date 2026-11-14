import { describe, expect, test } from 'bun:test';
import cli from '../cli.json';
import { commandNames, loadCommandHandler } from '../src/commands';

// `help` and `list` are handled by bin.ts itself
const declared = Object.keys(cli.commands).filter(
  (name) => name !== 'help' && name !== 'list',
);

describe('command registry', () => {
  test('every command declared in cli.json resolves to a handler', () => {
    for (const name of declared) {
      expect(typeof loadCommandHandler(name)).toBe('function');
    }
  });

  test('every registered command is declared in cli.json', () => {
    expect([...commandNames].sort()).toEqual([...declared].sort());
  });

  test('unknown commands resolve to nothing', () => {
    expect(loadCommandHandler('doesNotExist')).toBeUndefined();
  });
});
