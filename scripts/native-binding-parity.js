/**
 * [INPUT]: 依赖绑定生成器的 AST 契约、四端实现与 Harmony 统一宏表
 * [OUTPUT]: 提供只读 check(root)，校验生成物、参数类型、委托及同步异步展开
 * [POS]: scripts 的 T09 parity 内核，供既有命令入口和隔离负控测试复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs');
const path = require('path');
const {
  generate,
  javaParameters,
  parse,
  parameters,
  typeName,
} = require('./generate-native-bindings');

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function check(root) {
  const methods = generate(root, true);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const problems = [];
  const requireMatch = (source, re, message) => {
    if (!re.test(source)) problems.push(message);
  };
  for (const arch of ['oldarch', 'newarch']) {
    const source = stripComments(
      read(
        `android/src/${arch}/cn/reactnative/modules/update/UpdateModule.java`
      )
    );
    requireMatch(
      source,
      /class UpdateModule extends NativePaktaSpec\b/,
      `${arch}: generated Spec not inherited`
    );
    for (const method of methods) {
      if (method.name === 'getConstants') {
        requireMatch(
          source,
          arch === 'oldarch'
            ? /public Map<String, Object> getConstants\(\)/
            : /protected Map<String, Object> getTypedExportedConstants\(\)/,
          `${arch}: constants not exported`
        );
        continue;
      }
      const matches = [
        ...source.matchAll(
          new RegExp(
            `((?:@\\w+\\s+)*)public\\s+(\\w+)\\s+${method.name}\\s*\\(([^)]*)\\)\\s*\\{([^}]*?)\\}`,
            'g'
          )
        ),
      ];
      const found = matches[0];
      const expected = javaParameters(method, arch === 'oldarch');
      if (
        matches.length !== 1 ||
        found[2] !== 'void' ||
        found[3].replace(/\s+/g, ' ').trim() !== expected ||
        !/@(Override|ReactMethod)\b/.test(found[1])
      ) {
        problems.push(
          `${arch}: ${method.name} signature must be void (${expected}) with bridge annotation`
        );
        continue;
      }
      if (method.async) {
        const args = method.params.map((param) => param.name);
        if (method.name === 'restartApp') args.push('null');
        args.push('promise');
        const expectedCall = `impl.${method.name}(${args.join(', ')});`.replace(
          /\s/g,
          ''
        );
        if (found[4].replace(/\s/g, '') !== expectedCall)
          problems.push(`${arch}: ${method.name} delegate arguments drifted`);
      }
    }
  }

  const cpp = stripComments(
    read('harmony/pakta/src/main/cpp/PaktaTurboModule.cpp')
  );
  const compact = cpp.replace(/\\\r?\n/g, '').replace(/\s+/g, ' ');
  requireMatch(
    compact,
    /#define PAKTA_METHOD\(name, arity, mode\) PAKTA_##mode##_METHOD\(name\) #include "PaktaMethods.inc" #undef PAKTA_METHOD/,
    'harmony/cpp: HostFunction expansion drifted'
  );
  requireMatch(
    compact,
    /#define PAKTA_METHOD\(name, arity, mode\) registerMethod\(#name, arity, HostFunction_##name\); #include "PaktaMethods.inc" #undef PAKTA_METHOD/,
    'harmony/cpp: registration expansion drifted'
  );
  if (
    (cpp.match(/#include "PaktaMethods.inc"/g) || []).length !== 2 ||
    /registerMethod\(\s*"/.test(cpp)
  ) {
    problems.push(
      'harmony/cpp: method table must be expanded exactly twice without manual registrations'
    );
  }
  for (const mode of ['SYNC', 'ASYNC']) {
    requireMatch(
      compact,
      new RegExp(
        `#define PAKTA_${mode}_METHOD\\(method_name\\).*?return Call${mode === 'SYNC' ? 'Sync' : 'Async'}\\(rt, turboModule, #method_name, args, count\\);`
      ),
      `harmony/cpp: ${mode} dispatch drifted`
    );
  }
  const declarations = parse(
    read('harmony/pakta/src/main/ets/PaktaTurboModule.ts')
  ).body.map((node) => node.declaration || node);
  const cls = declarations.find(
    (node) =>
      node.type === 'ClassDeclaration' && node.id.name === 'PaktaTurboModule'
  );
  for (const method of methods) {
    const found =
      cls?.body.body.filter(
        (node) => node.type === 'ClassMethod' && node.key.name === method.name
      ) || [];
    if (found.length !== 1) {
      problems.push(`harmony/ets: ${method.name} missing or duplicated`);
      continue;
    }
    const actual = found[0];
    const actualParams = parameters(actual.params).map((param) => param.type);
    if (
      JSON.stringify(actualParams) !==
        JSON.stringify(method.params.map((param) => param.type)) ||
      typeName(actual.returnType?.typeAnnotation) !==
        (method.name === 'getConstants' ? 'Object' : method.returns) ||
      actual.async !== method.async
    ) {
      problems.push(
        `harmony/ets: ${method.name} parameter/return/async signature drifted`
      );
    }
  }

  const ios = stripComments(read('ios/RCTPakta/RCTPakta.mm'));
  for (const method of methods) {
    if (
      ['getConstants', 'addListener', 'removeListeners'].includes(method.name)
    )
      continue;
    const declarations = [
      ...ios.matchAll(
        new RegExp(
          `RCT_EXPORT_METHOD\\(\\s*${method.name}\\b([\\s\\S]*?)\\)\\s*\\{`,
          'g'
        )
      ),
    ];
    const types = [
      ...(declarations[0]?.[1] || '').matchAll(/:\s*\(([^)]+)\)/g),
    ].map((match) => match[1].replace(/\s/g, ''));
    const expected = method.params.map((param) =>
      param.type === 'string'
        ? 'NSString*'
        : param.type.startsWith('{')
          ? 'NSDictionary*'
          : 'double'
    );
    if (method.async)
      expected.push('RCTPromiseResolveBlock', 'RCTPromiseRejectBlock');
    if (
      declarations.length !== 1 ||
      JSON.stringify(types) !== JSON.stringify(expected)
    )
      problems.push(`ios: ${method.name} bridge signature drifted`);
    if (
      method.name === 'markSuccess' &&
      !/:\s*\(NSString\s*\*\)expectedHash\b/.test(declarations[0]?.[1] || '')
    ) {
      problems.push('ios: markSuccess expectedHash missing');
    }
  }
  requireMatch(
    ios,
    /-\s*\(NSDictionary\s*\*\)constantsToExport\b/,
    'ios: constants not exported'
  );
  if (problems.length)
    throw new Error(
      `check-native-spec-parity: ${problems.length} problem(s)\n${problems.join('\n')}`
    );
  return methods;
}

module.exports = { check };
