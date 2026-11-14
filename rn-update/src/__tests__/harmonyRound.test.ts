import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import vectors from '../../cpp/update_flow_core/tests/round-engine-vectors.json';

const runtime = (name: string) =>
  new Bun.Transpiler({ loader: 'ts' }).transformSync(
    readFileSync(
      new URL(`../../harmony/pakta/src/main/ets/${name}.ts`, import.meta.url),
      'utf8'
    )
      .replace(/^import[\s\S]*?;\r?\n/gm, '')
      .replace(/^export /gm, '')
  );
const run = runInNewContext(`${runtime('HarmonyRound')}\nrunHarmonyRound`, {
  ...runInNewContext(
    `${runtime('NativeUpdateResult')}\n({nativeUpdateResult})`
  ),
  getErrorMessage: (e: Error) => e.message,
  parseErrorCodePrefix: (s: string) => /^\[([^\]]+)\]/.exec(s)?.[1] ?? '',
  setInterval,
  clearInterval,
});

function expand(value: any): any {
  if (typeof value === 'string' && value.startsWith('@'))
    return (vectors.fixtures as any)[value.slice(1)];
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, expand(v)])
    );
  return value;
}

let count = 0;
for (const round of vectors.rounds) {
  const steps = expand(round.steps);
  if (
    round.name.includes('internal_error') ||
    steps.some(
      ({ event: e }: any, i: number) =>
        (i === 0) !== (e.type === 'start') ||
        e.forceActivate ||
        e.crashHold ||
        'activated' in e ||
        (e.type === 'download' && !e.ok && !e.timedOut && !e.code)
    )
  )
    continue;
  count++;
  test(`Harmony StepRound replay: ${round.name}`, async () => {
    let next = 0;
    let marked = false;
    let commits = false;
    let commandClock = false;
    const actual: any[] = [];
    const expected: any[] = [];
    const event = () => steps[next]?.event ?? {};
    const start = steps[0].event;
    const result = await run(
      {
        now: () => {
          if (commandClock) {
            commandClock = false;
            return steps[next - 1].event.now;
          }
          return event().now ?? steps[next - 1]?.event.now ?? 0;
        },
        resetGeneration: () => start.resetGeneration,
        configGeneration: () =>
          start.configGeneration +
          (commits && event().reason === 'config_changed' ? 1 : 0),
        config: () => start.config,
        marker: async (value: boolean) => {
          marked = value;
        },
        cancelHttp: () => {},
        step: (_state: string, text: string) => {
          const sent = JSON.parse(text);
          const want = steps[next++];
          commandClock = want.commands.some((c: any) => c.type === 'download');
          for (const key of [
            'type',
            'text',
            'installed',
            'code',
            'timedOut',
            'reason',
            'error',
          ])
            expect(sent[key]).toEqual(want.event[key]);
          expect(Boolean(sent.ok)).toBe(Boolean(want.event.ok));
          expect(sent.now).toBe(want.event.now);
          for (const command of want.commands)
            if (
              ['http', 'download', 'commit', 'checkInstalled'].includes(
                command.type
              )
            )
              expected.push(command);
          return JSON.stringify({ state: { next }, commands: want.commands });
        },
        environment: async () => event().env,
        http: async (command: any) => {
          actual.push(command);
          return event().text;
        },
        installed: (hash: string) => {
          actual.push({ type: 'checkInstalled', hash });
          return event().installed;
        },
        download: async (command: any) => {
          actual.push(command);
          if (event().timedOut) return new Promise(() => {});
          if (!event().ok) throw new Error(`[${event().code}] failure`);
        },
        commit: async (command: any) => {
          actual.push(command);
          commits = true;
          if (event().error) throw new Error('commit failure');
          return event().ok;
        },
      },
      start.deadline
    );
    const finish = steps.at(-1).commands.at(-1);
    expect(next).toBe(steps.length);
    expect(actual).toEqual(expected);
    expect(marked).toBe(false);
    expect(result.result.status).toBe(finish.status);
    expect(result.result.reason).toBe(finish.reason ?? '');
    expect(result.result.hash).toBe(finish.hash ?? '');
    expect(result.result.activated).toBe(finish.activated ?? false);
  });
}
test('Harmony replay coverage is explicit', () =>
  expect(count).toBeGreaterThanOrEqual(24));
