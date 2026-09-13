/**
 * [INPUT]: 依赖 Foundation 与静态 Swift Pod 链接器
 * [OUTPUT]: 对外提供无行为 Swift 类型，强制目标启用 Swift 链接
 * [POS]: e2etest iOS 构建兼容垫片，不承载运行时业务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import Foundation

// Keep the app target Swift-aware so static Swift pods are linked by the Swift toolchain.
final class SwiftLinking {}
