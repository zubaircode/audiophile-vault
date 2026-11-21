import Foundation
import Network

public struct BonjourFtpService: Sendable {
    public let instanceName: String
    public let domain: String
    public var host: String
    public var port: Int
    public var resolved: Bool

    public func toDictionary() -> [String: Any] {
        return [
            "id": instanceName,
            "instanceName": instanceName,
            "domain": domain,
            "host": host,
            "port": port,
            "resolved": resolved
        ]
    }
}

public final class BonjourFtpBrowser: NSObject, NetServiceDelegate, @unchecked Sendable {
    public static let shared = BonjourFtpBrowser()

    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.audiophilevault.bonjour.ftp", qos: .utility)
    private var browser: NWBrowser?
    private var servicesByName: [String: BonjourFtpService] = [:]
    private var activeResolvers: [String: NetService] = [:]
    private var onServicesChanged: (([[String: Any]]) -> Void)?

    private override init() {
        super.init()
    }

    public func setOnServicesChanged(_ handler: @escaping ([[String: Any]]) -> Void) {
        lock.lock()
        onServicesChanged = handler
        lock.unlock()
    }

    public func startBrowsing() {
        lock.lock()
        if browser != nil {
            lock.unlock()
            return
        }
        let params = NWParameters.tcp
        params.includePeerToPeer = true
        let nwBrowser = NWBrowser(for: .bonjour(type: "_ftp._tcp", domain: "local."), using: params)
        self.browser = nwBrowser
        lock.unlock()

        nwBrowser.stateUpdateHandler = { state in
            if case .failed(let err) = state {
                NSLog("[BonjourFtpBrowser] NWBrowser failed: %@", err.localizedDescription)
            }
        }

        nwBrowser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.handleBrowseResults(results)
        }

        nwBrowser.start(queue: queue)
    }

    public func stopBrowsing() {
        lock.lock()
        let b = browser
        browser = nil
        let resolvers = Array(activeResolvers.values)
        activeResolvers.removeAll()
        lock.unlock()

        b?.cancel()
        DispatchQueue.main.async {
            for r in resolvers {
                r.stop()
            }
        }
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        var currentNames = Set<String>()
        var toResolve: [(name: String, domain: String)] = []

        lock.lock()
        for result in results {
            if case .service(let name, _, let domain, _) = result.endpoint {
                currentNames.insert(name)
                if let existing = servicesByName[name] {
                    if !existing.resolved && activeResolvers[name] == nil {
                        toResolve.append((name, domain))
                    }
                } else {
                    servicesByName[name] = BonjourFtpService(
                        instanceName: name,
                        domain: domain,
                        host: "",
                        port: 0,
                        resolved: false
                    )
                    toResolve.append((name, domain))
                }
            }
        }

        for existingName in Array(servicesByName.keys) where !currentNames.contains(existingName) {
            servicesByName.removeValue(forKey: existingName)
            if let oldResolver = activeResolvers.removeValue(forKey: existingName) {
                DispatchQueue.main.async { oldResolver.stop() }
            }
        }
        lock.unlock()

        for item in toResolve {
            beginResolve(name: item.name, domain: item.domain)
        }
        notifyListeners()
    }

    private func beginResolve(name: String, domain: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let ns = NetService(domain: domain, type: "_ftp._tcp.", name: name)
            ns.delegate = self

            self.lock.lock()
            self.activeResolvers[name]?.stop()
            self.activeResolvers[name] = ns
            self.lock.unlock()

            ns.resolve(withTimeout: 8.0)
        }
    }

    public func netServiceDidResolveAddress(_ sender: NetService) {
        let name = sender.name
        let port = sender.port
        var ipv4: String? = nil

        if let addresses = sender.addresses {
            for addrData in addresses {
                if let ip = Self.extractIPv4Address(from: addrData) {
                    ipv4 = ip
                    break
                }
            }
        }

        if let ip = ipv4, port > 0 {
            lock.lock()
            if var svc = servicesByName[name] {
                svc.host = ip
                svc.port = port
                svc.resolved = true
                servicesByName[name] = svc
            } else {
                servicesByName[name] = BonjourFtpService(
                    instanceName: name,
                    domain: sender.domain,
                    host: ip,
                    port: port,
                    resolved: true
                )
            }
            activeResolvers.removeValue(forKey: name)
            lock.unlock()
            sender.stop()
            notifyListeners()
        }
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        let name = sender.name
        lock.lock()
        activeResolvers.removeValue(forKey: name)
        lock.unlock()
        sender.stop()
    }

    private static func extractIPv4Address(from data: Data) -> String? {
        return data.withUnsafeBytes { rawBuf -> String? in
            guard let base = rawBuf.baseAddress else { return nil }
            let sa = base.assumingMemoryBound(to: sockaddr.self)
            guard sa.pointee.sa_family == sa_family_t(AF_INET) else { return nil }
            let sin = base.assumingMemoryBound(to: sockaddr_in.self)
            var addr = sin.pointee.sin_addr
            var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &addr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil else {
                return nil
            }
            return String(cString: buf)
        }
    }

    public func listServices() -> [BonjourFtpService] {
        lock.lock()
        let values = Array(servicesByName.values)
        lock.unlock()
        return values.sorted { a, b in
            let aIsWifi = a.instanceName.caseInsensitiveCompare("WiFiFTP") == .orderedSame
            let bIsWifi = b.instanceName.caseInsensitiveCompare("WiFiFTP") == .orderedSame
            if aIsWifi != bIsWifi { return aIsWifi }
            return a.instanceName.localizedCaseInsensitiveCompare(b.instanceName) == .orderedAscending
        }
    }

    public func listServicesDicts() -> [[String: Any]] {
        return listServices().map { $0.toDictionary() }
    }

    public func resolveTarget(
        serviceName: String?,
        manualHost: String?,
        manualPort: Int?
    ) -> (host: String, port: Int, label: String, isManual: Bool)? {
        let mHost = (manualHost ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !mHost.isEmpty {
            let p = (manualPort ?? 0) > 0 ? manualPort! : 2121
            return (mHost, p, mHost, true)
        }

        let targetName = (serviceName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let preferred = targetName.isEmpty ? "WiFiFTP" : targetName
        let all = listServices()
        if let exact = all.first(where: { $0.instanceName.caseInsensitiveCompare(preferred) == .orderedSame && $0.resolved }) {
            return (exact.host, exact.port, exact.instanceName, false)
        }
        if targetName.isEmpty, let firstResolved = all.first(where: { $0.resolved }) {
            return (firstResolved.host, firstResolved.port, firstResolved.instanceName, false)
        }
        return nil
    }

    private func notifyListeners() {
        lock.lock()
        let cb = onServicesChanged
        lock.unlock()
        if let cb = cb {
            cb(listServicesDicts())
        }
    }
}
