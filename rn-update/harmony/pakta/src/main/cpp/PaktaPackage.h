/**
 * [INPUT]: 依赖 RNOH Package/TurboModuleFactoryDelegate 与 PaktaTurboModule 声明
 * [OUTPUT]: 对外提供 PaktaPackage 和 PaktaTurboModuleFactoryDelegate，按模块名创建 Pakta C++ 桥
 * [POS]: Harmony RNOH 注册边界，只负责模块发现和构造，不承载更新状态或文件 IO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * MIT License
 *
 * Copyright (C) 2023 Huawei Device Co., Ltd.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

#ifndef PAKTA_PACKAGE_H
#define PAKTA_PACKAGE_H

#include "RNOH/Package.h"
#include "PaktaTurboModule.h"

using namespace rnoh;
using namespace facebook;

class PaktaTurboModuleFactoryDelegate : public TurboModuleFactoryDelegate {
public:
    SharedTurboModule createTurboModule(Context ctx, const std::string &name) const override
    {
        if (name == "Pakta") {
        return std::make_shared<PaktaTurboModule>(ctx, name);
        }
        return nullptr;
    };
};

namespace rnoh {
class PaktaPackage : public Package {
public:
    PaktaPackage(Package::Context ctx) : Package(ctx){}
    std::unique_ptr<TurboModuleFactoryDelegate> createTurboModuleFactoryDelegate() override
    {
    return std::make_unique<PaktaTurboModuleFactoryDelegate>();
    }
};
} // namespace rnoh
#endif
