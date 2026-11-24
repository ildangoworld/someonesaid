import SwiftUI
import UIKit

enum HaruDesign {
    static let paper = adaptive(light: 0xF7F5F0, dark: 0x171816)
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x222320)
    static let ink = adaptive(light: 0x20211F, dark: 0xF2F1EC)
    static let muted = adaptive(light: 0x686B66, dark: 0xA9ACA5)
    static let accent = adaptive(light: 0x955018, dark: 0xE6A25E)

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}
