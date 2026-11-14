# Hermes base（`-base-bytecode`）等价校验：现状与待办

`pushy bundle` 在 `--hermesBase auto`（默认）下用上一版 HBC 作 base 编译，让字符串 id 跨版本稳定、热更 patch 变小。`--verifyHermesBase`（默认开）并行再做一次普通编译，把两份产物反汇编后比对；任何不一致或失败都回退到普通编译。

本文记录这套校验**防什么、怎么比、还缺什么**，供后续维护。代码在 `src/utils/hermes-base.ts`（`compareHermesBytecode`）、`src/utils/hermes-literals.ts`（二进制字面量缓冲区解码）、`src/utils/hermes-raw.ts`（原始操作数与完整二进制数据核对）与 `src/bundle-runner.ts`（`compileHermesByteCode`）。

## 1. 防什么

热更链路上的每一层校验（base 的 sha256、设备端 patch 重建后的 `bundleHash` 比对、HBC 头解析）验的都是**字节完整性**，没有一层验**程序语义**。一个合法但语义错误的 HBC 会一路绿灯，直到那个函数在用户设备上被执行。

`-base-bytecode` 的 bug 面集中在**引用映射**：字符串表合并错位（`GetById` 取到别的属性名）、字面量缓冲区偏移算错（数组内容变成别的常量）、function id 指错。这些错误的共同特征是**指令序列不变，只是操作数指向变了**——所以校验必须保留语义层（解析后的字符串、寄存器、指令序列），只折叠编码层（id 编号、操作数宽度、跳转距离、缓冲区偏移）。任何"只比指令骨架"或"只查文件格式"的简化都对这类 bug 失明。

## 2. 怎么比（当前实现）

校验分两遍：先各起一个 `hermesc -b -dump-bytecode -pretty-disassemble`，逐函数比较并提供易读诊断；这一步没有发现差异后，再各起一个带 `-pretty-disassemble=false` 的 raw dump 核对完整操作数。两遍顺序执行，不增加编译次数，同时最多两个 dump 进程。反汇编文本流式读取（不落盘，`PAKTA_HERMES_BASE_DEBUG=1` 时保留第一遍的 pretty 文本）。

| 区段 | 处理 |
|---|---|
| `Bytecode File Information` 等头部 | 文本头不比较；raw 核对从二进制比较运行时选项、全局函数索引、segment ID、模块与函数源码表 |
| `Global String Table` | 不比较死字符串；有效 HBC 的字符串按二进制表恢复完整内容，而非截断或转义后的显示文本 |
| `Array Buffer` / `Object Key Buffer` / `Object Value Buffer`（v98/v99：`Literal Value Buffer` / `Object Key Buffer`） | 文本段本身**不比较**（见下）；无法读二进制缓冲区时整段文本仅用于诊断，不能据此判定等价 |
| `Function<…>` / `NCFunction<…>` / `Constructor<…>` 各函数 | 头文本必须相同；正文逐行经 `normalizeDisassemblyLine` 归一化后比较；**按函数分段**，错位不级联 |
| `Debug *` / `Textified callees table` | 排掉（只服务调试器/性能工具） |

**字面量按指令比较（`src/utils/hermes-literals.ts`）**：`NewArrayWithBuffer rX, sizeHint, count, offset` / `NewObjectWithBuffer rX, sizeHint, count, keyOffset, valueOffset` 的 offset 是序列化字面量缓冲区里的**字节偏移**。校验先从两份 HBC 文件读出头部和三段缓冲区（`hbcTransform.ts` 的布局表），在每条指令处按 SLP 格式解码 `count` 个条目（tag 字节：bit 6..4 类型、bit 7 长度续字节、bit 3..0 长度低 4 位；值按类型定宽：double 8 字节、字符串 id 4/2/1 字节、int32 4 字节），字符串 id 经各自字符串表解析成文本后写进归一化后的指令行，两侧逐条比较。

两种布局：

| | v87–96（`split`） | v98/v99（`shaped`） |
|---|---|---|
| 缓冲区 | `arrayBuffer` / `objKeyBuffer` / `objValueBuffer` | `literalValueBuffer`（数组元素与对象值共用）/ `objKeyBuffer` / `objShapeTable`（8 字节项：keyOffset u32、numProps u32） |
| 数组 | `NewArrayWithBuffer rX, sizeHint, count, offset` | 同左，offset 指向值缓冲区 |
| 对象 | `NewObjectWithBuffer rX, sizeHint, count, keyOffset, valueOffset` | `NewObjectWithBuffer rX, shapeIndex, valueOffset`；`NewObjectWithBufferAndParent rX, rParent, shapeIndex, valueOffset` |
| tag 类型 6 | 1 字节字符串 id | `undefined`（无值字节）；字符串 id 只用 2/4 字节 |

v98/v99 的 shape 索引和 offset 一样只用于定位（delta 可能重排 shape 表），归一化后只留 shape 指向的键与值；`AndParent` 的父对象寄存器原样保留比较。

为什么不能按 dump 的整段文本比：Hermes 的缓冲区构建器会**重叠/去重**序列化后的字面量——一个字面量的最后一个值字节可以同时是下一个字面量的 tag 字节（模糊测试实测：`61 52 | cd 09 b3 05 11`，前一段以 `[String 82]` 结尾，后一条指令的 offset 正指向 `52`）。顺序解析整段缓冲区（hermesc 的 dump 就是这么打印的）从这里开始失步，之后的条目全是噪声；delta 构建的 id 宽度不同，重叠位置也不同，于是两段"噪声"在某处不一致就被判为差异。2026-09-10 的 20 轮冒烟模糊测试里 3 次误杀全部源于此，改按指令比较后全部等价。无法读二进制缓冲区（文件结构不识别）时两侧一起比较整段文本，仅辅助诊断；即使文本相等也返回 `dump-failed` 并回退 plain，不能以丢失 offset/count 的文本确认等价。结果里 `literals: 'buffer'` 标明这一点。

`normalizeDisassemblyLine` 只折叠表示层差异：按指令解析后的字面量地址、已知宽度后缀、引号外的列对齐空白、switch 表的物理偏移（含经典 `SwitchImm`）、debug 偏移、`DefineOwnById*` 的字符串操作数。字符串内部的连续空格、跳转目标标签、寄存器均保留。

**`DefineOwnById*` 的字符串操作数为什么只能丢给 raw**：Hermes 的 `BytecodeList.def` 只给 `DefineOwnByIdLong` 标了字符串操作数，短形式没标。于是同一条指令有两种 pretty 打印：普通编译 id 小、走短形式，打印**裸 id**；base 编译继承了 base 的字符串表，id 溢出 16 位后改用 Long 形式，打印**文本**，而 pretty 的文本又按显示预算截断（`equivalenceCheckPropertyName` 打成 `"equivalenceCheckP"...`）。两种表示互相还原不了——这个预算对非 ASCII 还会静默截断且不加 `...`（实测 `ab中` 打成 `"ab"`、`abcdefghijklmnop中` 打成 `"abcdefghi"`），所以还原出的完整名字永远等不上打印出来的名字。归一化因此把该操作数整个折成 `<str>`，属性名交给 raw 核对按二进制字符串表全量比较（`hermes-raw.ts` 的 `STRING_OPERANDS` 正是为此显式补了 `DefineOwnById`）。2026-09-22 之前这里会把任何超过显示预算的属性名判成差异，线上因此误杀过 base。未知 string ID、无法解码的字面量、未知 buffer 操作数形态直接失败；两侧都无法解析也不等价。

**原始操作数核对**：`hermes-raw.ts` 从 raw dump 读取指令起点和操作数类型，并检查操作数与 HBC 字节一致、指令覆盖完整函数体。字符串从 small/overflow string table 与 string storage 按完整 ASCII/UTF-16 code unit 解码；BigInt、正则和 double 读取真实字节（保留 `-0` 和尾部精度）；函数引用保留索引，与顺序对齐的函数表共同检查，同名函数不能互换。地址映射为目标指令序号；整数和字符串 switch 从二进制恢复 case 值与目的地。函数运行时 flags 和参数/寄存器等字段也参与比较，剔除的仅是物理地址、debug presence 与 compact/overflow 表示。

这不是一个可以忽略所有新指令的通用语义证明器。已验证的函数头范围为 HBC v87–96、`hermes-compiler@250829098.0.16/.17` 的 v98 快照，以及 `hermes-compiler@260318099.0.4` 的 v99 快照；升级布局或引入新的字符串/shape 引用指令时，需要复核 `hermes-raw.ts` 的解码规则及测试，不可仅扩展 diff-transform 的布局表。

结果三态：`equivalent` / `different`（带第一处差异：函数、行号、两侧内容，或缓冲区条目）/ `dump-failed`（无法解析完整语义数据、dump 进程失败/超时/提前结束；带原因或 stderr 末行）。后两种都放弃 base，但日志分开。

**零长度函数**：Static Hermes 的真实 Metro 产物可能保留 `bytecodeSizeInBytes == 0` 的死函数。raw 校验要求实际指令字节总长等于函数头声明长度，而不是要求每个函数至少有一条指令；空函数仍比较运行时元数据，遗漏整个函数头仍由总函数数检查拒绝。非空函数的指令被截断仍为 `dump-failed`。

**v98 函数头快照边界**：当前大头按 37 字节、flags 位于 `[36]` 读取，小头 cache 位域为 6/1/1，绑定 `250829098` 稳定快照。上游 [7193d4485b](https://github.com/facebook/hermes/commit/7193d4485beeb87cd7a3b6ca8b6b5d97a1a433c4) 删除 `NumCacheNewObject` 后，仍报 v98 的构建曾使用 36 字节 / flags `[35]`、cache 位域 7/1。`hbcTransform` 的两套 v98 文件头布局不能识别这次**函数头**变化；本轮不宣称支持该后续快照，也不能仅凭文件头或版本号选择它。更换编译器时必须补对应的大头、小头和真实 Metro 测试；未审核的 v98 构建应使用 `--hermesBase none`。

**v99 函数头**：`hermes-compiler@260318099.0.4`（RN 0.88）是上述删除之后的首次版本号升级，文件头与段布局同晚期 v98（`hbcTransform` 共用一条布局），函数头一律是删除后的形态：大头 36 字节、flags 位于 `[35]`，小头 cache 位域 7/1。v99 新增的 typed 模式 `NewTypedObjectWithBuffer` 的字面量操作数尚未解码，遇到即 `dump-failed` 回退 plain。

pretty 输出本身会截断长字符串与 BigInt、用函数名替代函数索引，并可能把 `-0` 显示为 `0`，因此不再以 pretty 相等作为最终结论。新增归一化规则时必须同时添加真实 HBC 负例，确保没有把语义差异折叠掉。

## 3. 已完成与待办

### 3.1 服务端上报校验结果 —— 已完成

CLI（`26764b1`）在 `version/create` 附带 `hermesBaseOutcome: 'used' | 'rejected' | 'dump-failed' | 'none'` 与可选 `hermesBaseDetail`（首处差异或失败原因，≤ 500 个码点）。规则同其它链路字段：只发已知值、绝不发 JSON null、未知就省略字段（单独 `pushy publish` 一个 ppk 时没有校验结果，字段不出现）。outcome 从 `HermesCompileResult.outcome` 带出，与 `base` 分开：base 被拒时 `base` 仍为 null，但 outcome 说明是被拒而不是没找到。base 编译本身失败记为 `none` 并附 `base compile failed: …`。

上报前 detail 会经 `src/utils/failure-fingerprint.ts` 的 `redactFailureDetail` 脱敏：引号内的字符串操作数、`Function<…>` 的函数名、编译器 stderr 里的路径都换成 `str#<hash8>/<长度>` / `fn#<hash8>` / `path#<hash8>.<ext>`，指令形态、寄存器、计数原样保留。本地控制台仍打印未脱敏的原文——属性名在本机排查时才有用；离开这台机器的那份不该带客户代码。同时上报 `hermesBaseFingerprint`（脱敏后再抹掉寄存器号/id/偏移，取 SHA-256 前 16 字节，32 个十六进制字符），同一个缺陷在不同 app、不同寄存器分配下归到同一组。**这个指纹函数只有一份实现**：上报、`scripts/fuzz-hermes-base.ts` 的去重、以后的线上语料回放共用它和同一套测试，否则聚合出来的次数是假的。

服务端（pushy-go 分支 `hermes-base-outcome`，提交 `9208c24`）新增可空列 `versions.hermesBaseOutcome` / `hermesBaseDetail`，解析器接受缺字段与 JSON null，只拒绝类型错误与未知枚举值；版本列表接口一并透出。全体应用的拒绝率：

```sql
SELECT hermesBaseOutcome, COUNT(*) FROM versions
 WHERE hermesBaseOutcome IS NOT NULL GROUP BY hermesBaseOutcome;
```

旧版服务端忽略未知字段，CLI 先于服务端发布也安全。

### 3.2 指令级缓冲区偏移 —— 已完成（v87–96、v98、v99）

见 §2"字面量按指令比较"。v98 最初按 v96 的 tag 语义解码，模糊测试（300 轮，RN 0.87 的 hermes-compiler）报出 259 次对象值不一致——全部源于 tag 类型 6 在 v98 表示 `undefined` 而非 1 字节字符串 id；修正后 v98 两个种子共 800 轮：0 次差异、75 处植入差异全部抓到。

### 3.3 差分模糊测试 —— 已完成

`scripts/fuzz-hermes-base.ts`（`HERMESC=<path> bun run fuzz:hermes-base --rounds N --seed S [--out DIR] [--verbose]`）：按种子生成随机 JS（大量标识符/字符串字面量、嵌套数组对象字面量、整数与字符串 switch、闭包、try/catch、正则、模板字符串、Babel 形态的类、解构、寄存器压力大的函数），base 取池中另一份或当前程序的变异副本，真实 hermesc 编三次（base、plain、delta），跑 `compareHermesBytecode`；`different` 的 detail 去数字/寄存器/函数名后去重输出，失败轮次的源码与 HBC 留在 `--out`。每 10 轮另植入一处字面量改动并断言校验能抓到（防止归一化折叠过头）。首次运行（2026-09-10，20 轮）找到的三处误杀就是 §2 的缓冲区重叠问题，已由 3.2 修复；修复后种子 2（300 轮）、种子 3（200 轮）、种子 7（40 轮）共 519 轮有效编译：0 次差异、0 次 dump 失败、53 处植入差异全部抓到（生成器早期版本另有 21 轮 hermesc 拒绝编译，属生成器问题，已修）。生成器产出 hermesc 不接受的程序时按"生成器 bug"计数并保留现场，不算校验结果。植入的字面量若落在被优化掉的代码里（`!'x'`、不可达的 switch 分支——Static Hermes 的常量折叠比经典 hermesc 激进得多），产物里根本没有这个字符串，两侧确实等价；这类轮次按产物字符串存储里是否出现新字符串判定（不经被测校验），记为"optimized away"，不计入检出统计。

### 3.4 函数身份与无损操作数 —— 已补充

raw 核对保留函数引用索引，与出现顺序对齐的函数体及二进制函数头联合比较。定向测试会只修改 HBC 中的引用，将两个同名闭包之一指向另一个：pretty 文本完全相同，但 raw 核对必须拒绝。另有 `-0`/`+0`、长字符串、UTF-16、长 BigInt 和 strict-mode flags 的回归用例。

仍未实现任意函数重排下的身份映射；遇到合法的函数重排会保守回退 plain，不通过删除函数索引来规避。

### 3.5 其它

- **`hermesBasePlainCompileFailed` 的语义** —— 已统一（`914514f`）：用于校验的普通编译失败时放弃 base、重编 plain 作为产物，上报 `dump-failed` + `plain compile failed: …`；真正的编译器故障会在重编时以构建错误暴露。
- **资源开销**：base/plain 编译并发完成后，执行 pretty 和 raw 两遍 dump；每遍两个进程，raw 不增加编译。二进制元数据读取目前持有两份 HBC、完整字符串映射及字面量缓冲区，反汇编仅保留当前函数；这是完整数据核对的额外内存和时间开销。不要以删除验证数据来优化内存，可后续改为按段读取或降低并行度。
- **进程期限**：版本探测默认 30 秒（`PAKTA_HERMES_PROBE_TIMEOUT_MS`），完整校验两遍合计默认 120 秒（`PAKTA_HERMES_VERIFY_TIMEOUT_MS`），单个编译/源码映射子进程默认 300 秒（`PAKTA_HERMES_COMPILE_TIMEOUT_MS`）。环境变量单位均为毫秒，必须是 1–2147483647 的整数，否则用默认值。超时终止子进程，优化失败回退 plain；真正的 plain 编译或最终 sourcemap 失败仍使构建失败。校验函数还接受 `AbortSignal`；base 下载任务的取消传播尚未统一。
- **源码映射竞态**：推测执行的 base sourcemap 合成任务启动时立即观察拒绝，之后再根据最终采用哪份字节码决定抛出错误还是为 plain 重做合成。
- **CI**：`hermes-hbc-96` / `hermes-hbc-98` / `hermes-hbc-98-patch17` / `hermes-hbc-99` 分别安装固定的 `react-native@0.77.3` / `hermes-compiler@250829098.0.16` / `.17` / `hermes-compiler@260318099.0.4`。除小程序回归与 50 轮固定种子 fuzz 外，四组都执行真实 Metro bundle 的自比和 base/plain 比较；v98 测试断言产物确实包含零长度函数。缺编译器或指定的 fixture 缺失/哈希不符会失败，不静默跳过。
- **真实 Metro 数据**：[hbc-diff-benchmark](https://github.com/sunnylqm/hbc-diff-benchmark/tree/e6a870a1c26c4b64c7860d7e1aa575707d22ad88) 的 `base.jsbundle` 和 `s3-medium-feature.jsbundle`（MIT，保留其 LICENSE；来源与生成步骤见该仓库 `fixtures/GENERATION.md`）。CI 固定提交和 SHA256，不运行下载的 JS，仅交给固定编译器。离线运行：`HERMESC=<hermesc> HERMES_METRO_FIXTURES=<fixtures目录> bun test tests/hermes-metro.test.ts`；普通单元测试不联网下载。
- **调试输出异常回归**：`tests/hermes-blockers.test.ts` 在独立进程覆盖带 `dumpTo` 的超时、运行中取消、预取消、ENOENT，同时检查返回标记、退出状态和晚到的异步错误。错误处理立即 unpipe 全部目的地并结束 debug 文件，避免 `finish()` 等待一个只会在后续 `kill()` 中结束的流；Node 18 CI 也执行相同场景。
- **不要删掉 pretty 这一遍**：raw 指令归一化不覆盖异常处理表等信息，pretty 对比仍是必要的一层（PR #85 评审结论）。
- **`hbcdump`/`hbc-diff`**：Hermes 仓库自带的工具，RN 的 hermesc 不随附；如果将来 hermes-compiler 包里带上，可替代文本 dump 解析。

## 4. 明确接受的剩余风险

即使全部待办完成，这仍是"没找到差异"而非"证明等价"。覆盖不到：identifier hash 存储错误（hash 由内容确定性生成，概率极低）、调试信息层错误（可能影响符号化，但不属于这里的执行等价检查）、两侧被同一个 hermesc bug 同时影响。这些是选择 `--verifyHermesBase`（默认）与 `--hermesBase none` 之间时应知道的边界。

## 5. 排查一次拒绝

1. 看日志里的 detail：函数 + 行号 + 两侧内容，或缓冲区条目，或 dump 失败原因。
2. 两行只差宽度后缀/数字 id/偏移：先核对解析后的完整值与控制流目标。只有证明是表示差异后才能补归一化规则，不能直接删除操作数；同时添加负例与 fuzz。
3. 指令数量/顺序/opcode 不同，或某条 `New*WithBuffer` 解析后的字面量不同（detail 形如 `NewArrayWithBuffer r2 size=44 n=44 entry 7: [String "a"] vs [String "b"]`）→ 真差异，回退正确，向 Hermes 上游报告。detail 带 `undecodable` 说明无法解码，归为 `dump-failed`；可能是损坏的 HBC，也可能是验证器尚不支持的布局，不能直接断言上游错误。
   detail 形如 `Array Buffer entry N: … vs …` 时，说明文件结构未被识别、缓冲区是按整段 dump 文本比的（比较结果的 `literals` 为 `buffer`，该字段不进日志），差异可能是 §2 的重叠误杀，需人工用二进制解码核对。
4. `dump-failed` → 校验无法完成；检查解析原因、编译器版本、超时与 stderr。它不是等价证据，也不必然是与字节码无关的进程错误。
5. 需要完整现场：`PAKTA_HERMES_BASE_DEBUG=1 pushy bundle …`，两份反汇编在中间目录旁 `hermes-base-dump-{base,plain}.txt`。
