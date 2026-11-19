import SafariServices
import UIKit
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate {
    @IBOutlet private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        guard let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
              let resources = Bundle.main.resourceURL else { return }
        webView.loadFileURL(page, allowingReadAccessTo: resources)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.navigationType == .linkActivated, let url = action.request.url else {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if url.scheme == "healthy-twitter", url.host == "settings" {
            if #available(iOS 26.2, *), let appID = Bundle.main.bundleIdentifier {
                SFSafariSettings.openExtensionsSettings(forIdentifiers: [appID + ".Extension"]) { [weak self] error in
                    if error != nil { self?.showSettingsPath() }
                }
            } else {
                showSettingsPath()
            }
        } else if url.scheme == "https", url.host == "x.com" {
            UIApplication.shared.open(url)
        }
    }

    private func showSettingsPath() {
        let alert = UIAlertController(title: "Enable Healthy Twitter",
                                      message: "Go to Settings → Apps → Safari → Extensions → Healthy Twitter.",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
