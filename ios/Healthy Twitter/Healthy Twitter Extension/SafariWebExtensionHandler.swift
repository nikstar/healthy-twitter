import Foundation

// All extension features run in Safari. No native messages or shared container are needed.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: [])
    }
}
