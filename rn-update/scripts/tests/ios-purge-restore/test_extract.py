# [INPUT]: 依赖标准库 unittest 与 extract 的 declaration/exported_method/function/mask_literals/method/mutate
# [OUTPUT]: 提供 8 例提取器回归：偏移换行保真、原型跳过、ObjC 声明/定义、无参方法、RCT_EXPORT_METHOD、静态初始化与字符串、fail-closed、突变漂移
# [POS]: ios-purge-restore 的提取器守护测试，Linux 可跑（unittest discover），锁定 fail-closed 与字面量掩码契约
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import unittest

from extract import declaration, exported_method, function, mask_literals, method, mutate


class ExtractionTests(unittest.TestCase):
    def test_preserves_offsets_and_lines(self):
        source = '/* {\n} */ @"escaped \\" { }"; // }\nconst char *x = R"tag({"})tag";'
        masked = mask_literals(source)
        self.assertEqual(len(masked), len(source))
        self.assertEqual(masked.count('\n'), source.count('\n'))
        self.assertNotIn('{', masked)
        self.assertNotIn('}', masked)

    def test_skips_prototype_and_keeps_body_verbatim(self):
        body = 'static void run() {\n  auto block = ^{ @"}"; /* } */ };\n}'
        source = 'static void run();\n// static void run() {}\n' + body
        line, actual = function(source, 'run')
        self.assertEqual(line, 3)
        self.assertEqual(actual, body)

    def test_objc_declaration_and_definition(self):
        source = '+ (BOOL)restore:(id)value;\n+ (BOOL)restore:(id)value { return YES; }'
        self.assertEqual(method(source, 'restore'), (2, source.splitlines()[1]))

    def test_objc_no_argument_method(self):
        self.assertEqual(method('+ (id)bundleURL\n{ return nil; }', 'bundleURL')[0], 1)

    def test_exported_reset_method(self):
        source = 'RCT_EXPORT_METHOD(reset:(id)resolve\n rejecter:(id)reject)\n{ ^{ @"}"; }; }'
        self.assertEqual(exported_method(source, 'reset')[1], source)

    def test_static_initializers_and_string_contents(self):
        self.assertEqual(declaration('static std::atomic<bool> active{false};', 'active')[1],
                         'static std::atomic<bool> active{false};')
        text = 'static NSString *const key = @"value;with;semicolons";'
        self.assertEqual(declaration(text, 'key')[1], text)

    def test_missing_duplicate_or_unbalanced_source_fails_closed(self):
        for source in ('static void run();', 'static void run() {',
                       'static void run() {}\nstatic void run() {}'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                function(source, 'run')
        with self.assertRaises(ValueError):
            declaration('static bool other = false;', 'active')

    def test_mutations_fail_on_source_drift(self):
        self.assertEqual(mutate('activation = nil;', 'late-activation'), '(void)activation;')
        self.assertEqual(mutate('return YES;', 'skip-reresolve'), 'return !timedOut;')
        for source in ('', 'activation = nil; activation = nil;'):
            with self.assertRaises(ValueError):
                mutate(source, 'late-activation')


if __name__ == '__main__':
    unittest.main()
