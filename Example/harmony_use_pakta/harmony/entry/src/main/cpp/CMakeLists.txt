# [INPUT]: 依赖 RNOH C++ 源树、仓库内 PaktaTurboModule、生成 codegen 文件和 PackageProvider.cpp。
# [OUTPUT]: 构建 rnoh_app 动态库，并把 Pakta glue 链入 Harmony HAP。
# [POS]: Harmony 原生构建入口；仅负责链接边界，不改变 JS 更新协议。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
cmake_minimum_required(VERSION 3.16)
project(rnapp)
# RNOH 会展开大量 include 目录，Windows 下必须使用 response file 避免 CreateProcess 参数超限。
set(CMAKE_NINJA_FORCE_RESPONSE_FILE ON CACHE BOOL "Use response files for Ninja commands" FORCE)
set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(OH_MODULE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
set(RNOH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules/@rnoh/react-native-openharmony/src/main/cpp")
set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
set(LOG_VERBOSITY_LEVEL 1)
set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
set(CMAKE_CXX_FLAGS "-fstack-protector-strong -Wl,-z,relro,-z,now,-z,noexecstack -s -fPIE -pie")
set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
set(WITH_HITRACE_SYSTRACE 1) # for other CMakeLists.txt files to use
add_compile_definitions(WITH_HITRACE_SYSTRACE)

# 从分叉仓库内直接消费 Pakta native glue，避免依赖历史 node_modules 同步。
set(PAKTA_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../../harmony/pakta/src/main/cpp")
add_subdirectory("${RNOH_CPP_DIR}" ./rn)

file(GLOB GENERATED_CPP_FILES "${CMAKE_CURRENT_SOURCE_DIR}/generated/*.cpp") # this line is needed by codegen v1

add_library(rnoh_app SHARED
    ${GENERATED_CPP_FILES}
    "./PackageProvider.cpp"
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
)
target_include_directories(rnoh_app PRIVATE "${PAKTA_CPP_DIR}")
# Pakta's RNOH glue is compiled into rnoh_app directly. librnupdate.so comes from pakta.har.
target_sources(rnoh_app PRIVATE "${PAKTA_CPP_DIR}/PaktaTurboModule.cpp")
target_link_libraries(rnoh_app PUBLIC rnoh)
