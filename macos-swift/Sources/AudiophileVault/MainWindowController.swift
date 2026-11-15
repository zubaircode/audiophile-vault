import Cocoa

public final class MainWindowController: NSWindowController, NSWindowDelegate {
    public let webViewController = WebViewController()

    public init() {
        let defaultRect = NSRect(x: 0, y: 0, width: 1360, height: 860)
        let styleMask: NSWindow.StyleMask = [
            .titled,
            .closable,
            .miniaturizable,
            .resizable,
            .fullSizeContentView
        ]

        let window = NSWindow(
            contentRect: defaultRect,
            styleMask: styleMask,
            backing: .buffered,
            defer: false
        )

        window.title = ""
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovable = true
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 1100, height: 760)
        window.backgroundColor = NSColor(calibratedRed: 0.035, green: 0.035, blue: 0.043, alpha: 1.0)
        window.appearance = NSAppearance(named: .darkAqua)
        window.collectionBehavior = [.fullScreenPrimary]
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("AudiophileVaultMainWindow")

        super.init(window: window)
        window.delegate = self
        window.contentViewController = webViewController
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public func windowDidEnterFullScreen(_ notification: Notification) {
        webViewController.notifyFullScreenChanged(true)
    }

    public func windowDidExitFullScreen(_ notification: Notification) {
        webViewController.notifyFullScreenChanged(false)
    }
}
