#!/usr/bin/env node
/**
 * [INPUT]: 依赖本地 NativePakta.ts、已有 Babel TypeScript 解析器与 fs/path，不读取上游或 T08 常量
 * [OUTPUT]: 派生旧架构 NativePaktaSpec.java 与 Harmony PaktaMethods.inc；--check 只读检查完整生成物
 * [POS]: scripts 的 T09 绑定所有者；只生成桥声明和方法元数据，不生成业务实现或更改静态 JNI
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const outputs = {
  java: 'android/src/oldarch/cn/reactnative/modules/update/NativePaktaSpec.java',
  harmony: 'harmony/pakta/src/main/cpp/PaktaMethods.inc',
};

function parse(source) {
  return babel.parseSync(source, {
    configFile: false,
    babelrc: false,
    parserOpts: { sourceType: 'module', plugins: ['typescript'] },
  }).program;
}

function typeName(node) {
  const primitives = {
    TSStringKeyword: 'string',
    TSNumberKeyword: 'number',
    TSBooleanKeyword: 'boolean',
    TSVoidKeyword: 'void',
    TSObjectKeyword: 'Object',
  };
  if (primitives[node?.type]) return primitives[node.type];
  if (node?.type === 'TSTypeReference' && node.typeName.name === 'Object')
    return 'Object';
  if (node?.type === 'TSTypeReference' && node.typeName.name === 'Promise') {
    const args = node.typeParameters?.params;
    if (args?.length === 1) return `Promise<${typeName(args[0])}>`;
  }
  if (node?.type === 'TSTypeLiteral') {
    return `{${node.members
      .map((member) => {
        if (
          member.type !== 'TSPropertySignature' ||
          member.optional ||
          member.computed
        ) {
          throw new Error('Unsupported object member in NativePakta');
        }
        return `${member.key.name}:${typeName(member.typeAnnotation?.typeAnnotation)}`;
      })
      .sort()
      .join(';')}}`;
  }
  throw new Error(`Unsupported NativePakta type: ${node?.type}`);
}

function parameters(nodes) {
  return nodes.map((node) => {
    if (node.type !== 'Identifier' || node.optional) {
      throw new Error('Unsupported NativePakta parameter');
    }
    return {
      name: node.name,
      type: typeName(node.typeAnnotation?.typeAnnotation),
    };
  });
}

function readMethods(source) {
  const declarations = parse(source).body.map(
    (node) => node.declaration || node
  );
  const spec = declarations.find(
    (node) => node.type === 'TSInterfaceDeclaration' && node.id.name === 'Spec'
  );
  if (
    !spec ||
    spec.extends?.length !== 1 ||
    spec.extends[0].expression.name !== 'TurboModule'
  ) {
    throw new Error('NativePakta Spec must extend TurboModule');
  }
  const methods = spec.body.body.map((node) => {
    if (
      node.type === 'TSPropertySignature' &&
      node.key.name === 'getConstants' &&
      node.typeAnnotation?.typeAnnotation.type === 'TSFunctionType'
    ) {
      const fn = node.typeAnnotation.typeAnnotation;
      if (
        fn.parameters.length ||
        fn.typeAnnotation.typeAnnotation.type !== 'TSTypeLiteral'
      ) {
        throw new Error('Unsupported getConstants signature');
      }
      return {
        name: 'getConstants',
        params: [],
        returns: 'constants',
        async: false,
      };
    }
    if (
      node.type !== 'TSMethodSignature' ||
      node.optional ||
      node.computed ||
      node.typeParameters
    ) {
      throw new Error('Unsupported NativePakta member');
    }
    const returns = typeName(node.typeAnnotation?.typeAnnotation);
    if (
      returns !== 'void' &&
      !/^Promise<(void|string|boolean|number)>$/.test(returns)
    ) {
      throw new Error(`Unsupported NativePakta return: ${returns}`);
    }
    return {
      name: node.key.name,
      params: parameters(node.parameters),
      returns,
      async: returns.startsWith('Promise<'),
    };
  });
  if (new Set(methods.map((method) => method.name)).size !== methods.length) {
    throw new Error('Duplicate NativePakta method');
  }
  const success = methods.find((method) => method.name === 'markSuccess');
  if (
    JSON.stringify(success?.params) !==
      JSON.stringify([{ name: 'expectedHash', type: 'string' }]) ||
    success.returns !== 'Promise<boolean>'
  ) {
    throw new Error(
      'markSuccess must preserve expectedHash: string and Promise<boolean>'
    );
  }
  const listeners = methods.find((method) => method.name === 'removeListeners');
  if (
    listeners?.params.length !== 1 ||
    listeners.params[0].type !== 'number' ||
    listeners.returns !== 'void'
  ) {
    throw new Error(
      'removeListeners must preserve the legacy Integer count contract'
    );
  }
  if (!methods.some((method) => method.name === 'getConstants'))
    throw new Error('Missing getConstants');
  return methods;
}

function javaParameters(method, legacy = true) {
  const params = method.params.map(({ name, type }) => {
    const mapped =
      { string: 'String', boolean: 'boolean', number: 'double' }[type] ||
      (type.startsWith('{') ? 'ReadableMap' : null);
    if (!mapped) throw new Error(`Unsupported Java parameter: ${type}`);
    return `${legacy && method.name === 'removeListeners' ? 'Integer' : mapped} ${name}`;
  });
  if (method.async) params.push('Promise promise');
  return params.join(', ');
}

function renderJava(methods) {
  return `/**
 * [INPUT]: 依赖 src/NativePakta.ts，由 scripts/generate-native-bindings.js 生成，禁止手改
 * [OUTPUT]: 提供旧架构 NativePaktaSpec 抽象桥声明；保留 expectedHash 与 Integer count
 * [POS]: oldarch 的生成契约层，UpdateModule 负责委托共享实现，常量仍由实现提供
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

public abstract class NativePaktaSpec extends ReactContextBaseJavaModule {
    protected NativePaktaSpec(ReactApplicationContext reactContext) {
        super(reactContext);
    }

${methods
  .filter((method) => method.name !== 'getConstants')
  .map(
    (method) =>
      `    @ReactMethod\n    public abstract void ${method.name}(${javaParameters(method)});`
  )
  .join('\n\n')}
}
`;
}

function renderHarmony(methods) {
  return `/**
 * [INPUT]: 依赖 src/NativePakta.ts，由 scripts/generate-native-bindings.js 生成，禁止手改
 * [OUTPUT]: 提供 PAKTA_METHOD(name, arity, mode) 完整方法表，Promise 一律 ASYNC
 * [POS]: Harmony C++ 的单一方法清单，被 HostFunction 定义与注册两次展开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
${methods.map(({ name, params, async }) => `PAKTA_METHOD(${name}, ${params.length}, ${async ? 'ASYNC' : 'SYNC'})`).join('\n')}
`;
}

function generate(root, check = false) {
  const methods = readMethods(
    fs.readFileSync(path.join(root, 'src/NativePakta.ts'), 'utf8')
  );
  const files = [
    [outputs.java, renderJava(methods)],
    [outputs.harmony, renderHarmony(methods)],
  ];
  const stale = files.filter(([file, content]) => {
    const target = path.join(root, file);
    return (
      !fs.existsSync(target) ||
      fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== content
    );
  });
  if (check && stale.length)
    throw new Error(
      `Stale native bindings: ${stale.map(([file]) => file).join(', ')}; run node scripts/generate-native-bindings.js`
    );
  if (!check) {
    for (const [file, content] of stale)
      fs.writeFileSync(path.join(root, file), content);
  }
  return methods;
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--check'))
      throw new Error('Usage: generate-native-bindings.js [--check]');
    const methods = generate(
      path.resolve(__dirname, '..'),
      process.argv.includes('--check')
    );
    console.log(
      `generate-native-bindings: ${methods.length} methods ${process.argv.includes('--check') ? 'checked' : 'generated'}`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  generate,
  readMethods,
  javaParameters,
  parse,
  parameters,
  typeName,
  outputs,
};
