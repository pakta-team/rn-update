# [INPUT]: 依赖 Bazel 的 AAR/JAR 目标声明能力，接收 Android 构建输入文件集合
# [OUTPUT]: 对外提供 create_aar_targets 与 create_jar_targets，生成可被应用模块引用的预构建依赖目标
# [POS]: e2etest Android 构建层的依赖适配器，把本地制品路径转换为 Bazel 标签
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

"""Helper definitions to glob .aar and .jar targets"""

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
