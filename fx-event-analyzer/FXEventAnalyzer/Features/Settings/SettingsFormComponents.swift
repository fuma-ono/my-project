import SwiftUI

/// SCR-016 / SCR-018 / SCR-019 の選択肢。画面の部品は`SettingsListComponents.swift`。

struct SettingsOption<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    var id: Value { value }
}

extension Array {
    /// `current`が選択肢にない値(Backend側で別の値が保存されている場合)でも
    /// 表示・保持できるよう、末尾にそのまま追加する。
    func including<Value: Hashable>(_ current: Value, label: (Value) -> String) -> [SettingsOption<Value>] where Element == SettingsOption<Value> {
        contains { $0.value == current } ? self : self + [SettingsOption(value: current, label: label(current))]
    }
}
