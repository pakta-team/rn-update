const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hdiff = 'android/jni/HDiffPatch/';
const forbiddenNative = [
  /^android\/jni\/HDiffPatch\/(builds|test|libParallel)(\/|$)/,
  /^android\/jni\/HDiffPatch\/libHDiffPatch\/HDiff(\/|$)/,
  /^android\/jni\/HDiffPatch\/dirDiffPatch\/dir_diff(\/|$)/,
  /(^|\/)(__pycache__|\.pytest_cache)(\/|$)/,
  /\.(pyc|pyo)$/,
];
const includeDirs = [
  'cpp', 'cpp/patch_core', 'cpp/update_flow_core', 'android/jni',
  hdiff, `${hdiff}libHDiffPatch/HPatch`, 'android/jni/lzma/C',
  'harmony/pakta/src/main/cpp',
];

function sourceClosure() {
  const required = new Set([
    'android/jni/Android.mk', 'android/jni/Application.mk',
    'rn-update.podspec', 'harmony/pakta/src/main/cpp/CMakeLists.txt',
    `${hdiff}LICENSE`,
  ]);
  const read = (file) => readFileSync(path.join(root, file), 'utf8');
  const add = (file) => required.add(path.posix.normalize(file));
  const android = read('android/jni/Android.mk');
  for (const match of android.matchAll(/(?:^|\s)([\w./-]+\.(?:cpp|c))(?=\s|$)/g)) {
    add(`android/jni/${match[1]}`);
  }
  const variables = {
    CMAKE_CURRENT_SOURCE_DIR: 'harmony/pakta/src/main/cpp',
    PATCH_CORE_DIR: 'cpp/patch_core',
    UPDATE_FLOW_CORE_DIR: 'cpp/update_flow_core',
    ANDROID_JNI_DIR: 'android/jni',
    HDIFFPATCH_DIR: hdiff.slice(0, -1),
    LZMA_DIR: 'android/jni/lzma',
  };
  const cmake = read('harmony/pakta/src/main/cpp/CMakeLists.txt');
  for (const match of cmake.matchAll(/\$\{(\w+)\}\/([\w./-]+\.(?:cpp|c))/g)) {
    if (!variables[match[1]]) throw new Error(`unknown native source variable: ${match[1]}`);
    add(`${variables[match[1]]}/${match[2]}`);
  }
  const podspec = read('rn-update.podspec');
  for (const match of podspec.matchAll(/'([^']+)\.\{([^}]+)\}'/g)) {
    const directory = path.posix.dirname(match[1]).replace(/\/\*\*$/, '');
    const name = path.posix.basename(match[1]);
    const names = name === '*' ? readdirSync(path.join(root, directory), {
      recursive: match[1].includes('**/'),
    }).map((file) => file.split(path.sep).join('/')) :
      match[2].split(',').map((extension) => `${name}.${extension}`);
    for (const file of names) {
      if (match[2].split(',').some((extension) => file.endsWith(`.${extension}`))) {
        add(`${directory}/${file}`);
      }
    }
  }
  for (const directory of ['ios/RCTPakta', 'harmony/pakta/src/main/cpp']) {
    for (const file of readdirSync(path.join(root, directory))) {
      if (/\.(h|inc|mm|cpp)$/.test(file)) add(`${directory}/${file}`);
    }
  }
  for (const file of required) {
    if (!existsSync(path.join(root, file))) throw new Error(`native source missing from checkout: ${file}`);
    if (!/\.(c|cpp|h|mm|m|inc)$/.test(file)) continue;
    for (const match of read(file).matchAll(/^\s*#\s*(?:include|import)\s*"([^"]+)"/gm)) {
      const locations = [path.posix.dirname(file), ...includeDirs]
        .map((directory) => path.posix.normalize(`${directory}/${match[1]}`));
      const dependency = locations.find((location) => existsSync(path.join(root, location)));
      if (dependency) add(dependency);
    }
  }
  return [...required].sort();
}

function checkNativePacklist(files, candidate) {
  const packed = new Set(files);
  const closure = sourceClosure();
  const sameSource = new Set([
    ...closure,
    ...files.filter((file) => /^(android\/jni\/|cpp\/|ios\/|harmony\/pakta\/src\/main\/cpp\/)/.test(file) &&
      /(?:\.(?:c|cpp|h|hpp|m|mm|inc|mk)|\/CMakeLists\.txt)$/.test(file)),
  ]);
  return [
    ...files.filter((file) => forbiddenNative.some((pattern) => pattern.test(file)))
      .map((file) => `forbidden native development file: ${file}`),
    ...closure.filter((file) => !packed.has(file))
      .map((file) => `missing native source closure: ${file}`),
    ...[...sameSource].filter((file) => candidate && packed.has(file) &&
      (!existsSync(path.join(root, file)) ||
        !candidate.readFile(file).equals(readFileSync(path.join(root, file)))))
      .map((file) => `candidate native source differs from checkout: ${file}`),
  ];
}

module.exports = { sourceClosure, checkNativePacklist };
