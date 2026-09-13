"""
[INPUT]: 依赖 Buck 的 aar/jar 预编译库描述与 app 模块的 lib_deps 列表。
[OUTPUT]: 导出 create_aar_targets/create_jar_targets，生成可复用的预编译依赖目标。
[POS]: 历史 Buck 构建辅助层，与 Gradle 主路径并列但不参与 RN 运行时。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

def create_aar_targets(aarfiles):
    for aarfile in aarfiles:
        name = "aars__" + aarfile[aarfile.rindex("/") + 1:aarfile.rindex(".aar")]
        lib_deps.append(":" + name)
        android_prebuilt_aar(
            name = name,
            aar = aarfile,
        )

def create_jar_targets(jarfiles):
    for jarfile in jarfiles:
        name = "jars__" + jarfile[jarfile.rindex("/") + 1:jarfile.rindex(".jar")]
        lib_deps.append(":" + name)
        prebuilt_jar(
            name = name,
            binary_jar = jarfile,
        )
