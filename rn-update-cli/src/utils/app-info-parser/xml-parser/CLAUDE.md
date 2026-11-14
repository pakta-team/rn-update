# xml-parser/
> L2 | 父级: ../CLAUDE.md

Android binary XML 的纯 Buffer 解析层，只产出元素树和类型化属性；业务属性选择及资源引用解码由父级 apk.ts 负责。

成员清单

CLAUDE.md: binary XML 解析层成员与父级职责地图
binary.ts: parseBinaryXml 读取 AAPT 字符串池和元素块，输出 XmlElement 树，保留引用标识并解码字符串/整数/布尔属性

法则: 结构解析与业务字段分离

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
