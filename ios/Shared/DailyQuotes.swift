import Foundation

struct Quote: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let text: String
    let author: String
    let category: String

    static let example = Quote(
        id: "",
        text: "오늘, 한 문장과 함께 잠시 쉬어 가요.",
        author: "",
        category: ""
    )

    static let empty = Quote(id: "", text: "아직 공개된 문장이 없어요.", author: "", category: "")

    var deepLink: URL? {
        guard Self.isValidID(id) else { return nil }
        return URL(string: "haruonephrase://quote/q/\(id)")
    }

    static func id(from url: URL) -> String? {
        guard url.scheme == "haruonephrase", url.host == "quote",
              url.query == nil, url.fragment == nil else { return nil }
        let parts = url.pathComponents
        guard parts.count == 3, parts[1] == "q", isValidID(parts[2]) else { return nil }
        return parts[2]
    }

    static func isValidID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) ||
                (97...122).contains($0) || $0 == 45 || $0 == 95
        }
    }
}

enum KoreanDay {
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .gmt
        return calendar
    }

    static func key(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func nextMidnight(after date: Date) -> Date {
        calendar.dateInterval(of: .day, for: date)?.end ?? date.addingTimeInterval(86_400)
    }

    static func label(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = .autoupdatingCurrent
        formatter.setLocalizedDateFormatFromTemplate("MMMMdEEEE")
        return formatter.string(from: date)
    }

    static func elapsedDays(_ date: Date) -> Int {
        let epoch = calendar.startOfDay(for: Date(timeIntervalSince1970: 0))
        let day = calendar.startOfDay(for: date)
        return calendar.dateComponents([.day], from: epoch, to: day).day ?? 0
    }
}

enum ServerAddress {
    static func parse(_ input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed),
              let scheme = parts.scheme?.lowercased(),
              let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              scheme == "https" || (scheme == "http" && host == "localhost") else { return nil }
        if let port = parts.port, !(1...65535).contains(port) { return nil }

        parts.scheme = scheme
        parts.host = host
        parts.path = ""
        return parts.url
    }

    static func contains(_ url: URL, origin: URL) -> Bool {
        func effectivePort(_ url: URL) -> Int {
            url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
        }

        return url.scheme?.lowercased() == origin.scheme?.lowercased()
            && url.host?.lowercased() == origin.host?.lowercased()
            && effectivePort(url) == effectivePort(origin)
            && url.user == nil && url.password == nil
    }
}

enum DailyQuotes {
    static let serverKey = "haru.serverAddress"

    static let defaultServer: URL? = {
        guard let address = Bundle.main.object(forInfoDictionaryKey: "HaruDefaultServer") as? String,
              let url = ServerAddress.parse(address), url.scheme == "https" else { return nil }
        return url
    }()

    static var configuredServer: URL? {
        if let address = defaults.string(forKey: serverKey) {
            return ServerAddress.parse(address)
        }
        return defaultServer
    }
    // Alternate slots so a widget tap can still find yesterday’s quote after midnight.
    private static func cacheKey(for date: Date) -> String {
        "haru.dailyQuotes.\(KoreanDay.elapsedDays(date) & 1)"
    }

    private struct Cache: Codable {
        let server: URL
        let day: String
        let quotes: [Quote]
    }

    private struct Response: Decodable {
        let quotes: [Quote]
    }

    static var defaults: UserDefaults {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "HaruAppGroup") as? String,
              !group.isEmpty else { return .standard }
        return UserDefaults(suiteName: group) ?? .standard
    }

    static let seeds: [Quote] = {
        guard let url = Bundle.main.url(forResource: "seeds", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let quotes = try? JSONDecoder().decode([Quote].self, from: data) else { return [] }
        return quotes
    }()

    static func local(on date: Date, server: URL?) -> [Quote] {
        if let server, let cache = cached(on: date, server: server), cache.day == KoreanDay.key(date) {
            return cache.quotes
        }
        guard !seeds.isEmpty else { return [] }
        let offset = KoreanDay.elapsedDays(date) % seeds.count
        let start = (offset + seeds.count) % seeds.count
        return (0..<min(3, seeds.count)).map { seeds[(start + $0) % seeds.count] }
    }

    static func knownQuote(id: String, server: URL?) -> Quote? {
        if let server {
            let today = KoreanDay.calendar.startOfDay(for: Date())
            let yesterday = KoreanDay.calendar.date(byAdding: .day, value: -1, to: today) ?? today
            for day in [today, yesterday] {
                if let cache = cached(on: day, server: server), cache.day == KoreanDay.key(day),
                   let quote = cache.quotes.first(where: { $0.id == id }) {
                    return quote
                }
            }
        }
        return seeds.first { $0.id == id }
    }

    private static func cached(on date: Date, server: URL) -> Cache? {
        guard let data = defaults.data(forKey: cacheKey(for: date)),
              let cache = try? JSONDecoder().decode(Cache.self, from: data),
              cache.server == server else { return nil }
        return cache
    }

    static func fetch(on date: Date, server: URL) async throws -> [Quote] {
        let day = KoreanDay.key(date)
        let endpoint = server.appending(path: "api").appending(path: "daily")
        var parts = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "date", value: day)]
        guard let url = parts?.url else { throw URLError(.badURL) }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 7
        let client = URLSession(configuration: configuration)
        defer { client.finishTasksAndInvalidate() }
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        let (data, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let destination = http.url, ServerAddress.contains(destination, origin: server) else {
            throw URLError(.badServerResponse)
        }

        let quotes = try JSONDecoder().decode(Response.self, from: data).quotes
        guard quotes.count <= 3, Set(quotes.map(\.id)).count == quotes.count,
              quotes.allSatisfy({ Quote.isValidID($0.id) && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw URLError(.cannotParseResponse)
        }

        if configuredServer == server,
           KoreanDay.key(Date()) == day {
            let cache = Cache(server: server, day: day, quotes: quotes)
            if let encoded = try? JSONEncoder().encode(cache) {
                defaults.set(encoded, forKey: cacheKey(for: date))
            }
        }
        return quotes
    }
}
