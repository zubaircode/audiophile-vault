// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AudiophileVault",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "AudiophileVault", targets: ["AudiophileVault"])
    ],
    targets: [
        .executableTarget(
            name: "AudiophileVault",
            path: "Sources/AudiophileVault",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("ImageIO"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("CryptoKit"),
                .linkedFramework("Network")
            ]
        )
    ]
)
