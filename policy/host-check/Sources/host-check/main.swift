// Runs the policy module through Lattice's own host: the validation genesis
// applies (determinism scan, exports), then every recorded context from the JS
// suite, comparing the host's verdict with the recorded one. With a spec, it
// also checks that the spec's policy names this module's CID.
//
//   host-check <module.wasm> <contexts directory> [spec.json]
//
// Context files are named `<n>-accept.bin` or `<n>-reject.bin`.
import Foundation
import LatticePrimitives
import LatticeValidation

let arguments = CommandLine.arguments
guard arguments.count == 3 || arguments.count == 4 else {
    FileHandle.standardError.write(Data("usage: host-check <module.wasm> <contexts directory> [spec.json]\n".utf8))
    exit(2)
}
let moduleBytes = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
let moduleCID = try WasmPolicyModuleHeader(node: WasmPolicyModule(bytes: moduleBytes)).rawCID
let policy = WasmPolicyRef(moduleCID: moduleCID, scope: .transaction)
try WasmPolicyEvaluator.validate(policy: policy, moduleBytes: moduleBytes)
print("module \(moduleCID) (\(moduleBytes.count) bytes) passes genesis validation")

var failed = false
if arguments.count == 4 {
    let spec = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: arguments[3]))) as? [String: Any]
    let policies = spec?["wasmPolicies"] as? [[String: Any]] ?? []
    let named = policies.compactMap { $0["moduleCID"] as? String }
    if named == [moduleCID] {
        print("\(arguments[3]) names this module")
    } else {
        print("MISMATCH \(arguments[3]) names \(named), not \(moduleCID)")
        failed = true
    }
}

let directory = URL(fileURLWithPath: arguments[2])
let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension == "bin" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
var mismatches = 0
var accepted = 0
for file in files {
    let expected = file.lastPathComponent.hasSuffix("-accept.bin")
    // A trap is a rejection, as it is for the block validator.
    let verdict = (try? WasmPolicyEvaluator.evaluate(
        policy: policy, contextData: try Data(contentsOf: file), moduleBytes: moduleBytes)) ?? false
    if verdict { accepted += 1 }
    if verdict != expected {
        mismatches += 1
        print("MISMATCH \(file.lastPathComponent): host says \(verdict)")
    }
}
print("\(files.count - mismatches)/\(files.count) contexts agree (\(accepted) accepted, \(files.count - accepted) rejected)")
exit(mismatches == 0 && !files.isEmpty && !failed ? 0 : 1)
