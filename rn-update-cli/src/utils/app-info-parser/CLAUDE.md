# app-info-parser/
> L2 | 父级: ../CLAUDE.md

原生归档的格式边界。业务身份与 bundleHash 在父级 utils/index 汇总，本目录只负责 ZIP/manifest/plist 的结构解析及 AAB 到 APK 的转换；不保留旧的通用 Parser 类与图标读取链。

成员清单

CLAUDE.md: 原生归档解析成员与业务身份边界地图
aab.ts: extractApk 调用 bundletool 或受控 npx 回退生成 universal APK，显式选择模块并清理中间 APKS，供 AAB 上传复用 APK 登记链
apk.ts: parseApkManifest 组合二进制 XML 与 resources.arsc，输出版本和 application 直接 meta-data，资源引用无法解析时保持 undefined
ipa.ts: parsePlist 以首字节选择 XML/binary 解码，延迟兼容 plist 的 CommonJS/ESM 入口，不读取 ZIP 或图标
resource-finder.ts: ResourceFinder 用有界 Buffer Reader 读取 Android 资源表，为 APK manifest 提供字符串/资源引用解析
zip.ts: readZipEntries 单次扫描原生归档和嵌套 HAP，按输入正则顺序返回 Buffer，兼容大小写与 NUL 尾填充
xml-parser/: Android binary XML 的节点树与类型化属性解码

法则: 格式解析不决定应用身份

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
