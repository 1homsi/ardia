// swift-tools-version:6.2
import PackageDescription

let package = Package(
  name: "PhoneMotion",
  platforms: [.iOS("27.0"), .macOS("27.0")],
  products: [
    .library(name: "PhoneMotion", targets: ["PhoneMotion"]),
  ],
  targets: [
    .target(name: "PhoneMotion", swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(name: "PhoneMotionTests", dependencies: ["PhoneMotion"], swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
