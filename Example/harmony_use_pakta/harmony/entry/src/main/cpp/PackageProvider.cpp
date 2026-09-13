/**
 * [INPUT]: 依赖 RNOH PackageProvider 接口与 PaktaPackage 实现。
 * [OUTPUT]: 实现 getPackages，向 RNOH 返回当前 Ability 可用的 PaktaPackage。
 * [POS]: Harmony 原生包注册点，连接 C++ app 动态库与 ArkTS RNPackagesFactory 的同一能力。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include "RNOH/PackageProvider.h"
#include "PaktaPackage.h"
using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {
         std::make_shared<PaktaPackage>(ctx)
    };
}
