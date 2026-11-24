import SwiftUI
import UIKit
import WebKit

struct CommunityWebView: UIViewRepresentable {
    let origin: URL
    let page: URL
    let reload: UUID
    let reportFailure: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(origin: origin) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let browser = WKWebView(frame: .zero, configuration: configuration)
        browser.navigationDelegate = context.coordinator
        browser.allowsBackForwardNavigationGestures = true
        browser.isOpaque = false
        browser.backgroundColor = .clear
        return browser
    }

    func updateUIView(_ browser: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.origin = origin
        coordinator.reportFailure = reportFailure
        guard coordinator.requestedPage != page || coordinator.reload != reload else { return }
        coordinator.requestedPage = page
        coordinator.reload = reload
        browser.load(URLRequest(url: page, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var origin: URL
        var reportFailure: ((Bool) -> Void)?
        var requestedPage: URL?
        var reload: UUID?

        init(origin: URL) { self.origin = origin }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = action.request.url else {
                decisionHandler(.cancel)
                return
            }
            guard ServerAddress.contains(url, origin: origin) else {
                decisionHandler(.cancel)
                if action.navigationType == .linkActivated,
                   action.sourceFrame.isMainFrame,
                   ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                    UIApplication.shared.open(url)
                } else if action.targetFrame?.isMainFrame == true, webView.url == nil {
                    reportFailure?(true)
                }
                return
            }
            if action.targetFrame == nil {
                decisionHandler(.cancel)
                webView.load(action.request)
            } else {
                decisionHandler(.allow)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor response: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            if response.isForMainFrame {
                guard let url = response.response.url, ServerAddress.contains(url, origin: origin) else {
                    decisionHandler(.cancel)
                    reportFailure?(true)
                    return
                }
                if let http = response.response as? HTTPURLResponse, http.statusCode >= 500 {
                    decisionHandler(.cancel)
                    reportFailure?(true)
                    return
                }
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            reportFailure?(false)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failure(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            reportFailure?(true)
        }

        private func failure(_ error: Error) {
            guard (error as? URLError)?.code != .cancelled else { return }
            reportFailure?(true)
        }
    }
}
