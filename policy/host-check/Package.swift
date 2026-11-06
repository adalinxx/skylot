// swift-tools-version: 6.0
import PackageDescription

// Lattice by path, for local use: point it at a Lattice checkout (the sibling
// ../../../Lattice by default). CI should pin it by tag instead:
//   .package(url: "https://github.com/adalinxx/Lattice.git", exact: "<version>")
let package = Package(
    name: "host-check",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(path: "../../../Lattice"),
    ],
    targets: [
        .executableTarget(
            name: "host-check",
            dependencies: [
                .product(name: "LatticePrimitives", package: "Lattice"),
                .product(name: "LatticeValidation", package: "Lattice"),
            ]
        ),
    ]
)
