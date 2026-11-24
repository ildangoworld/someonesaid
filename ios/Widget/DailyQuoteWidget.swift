import SwiftUI
import WidgetKit

struct QuoteEntry: TimelineEntry {
    let date: Date
    let primary: Quote

    init(date: Date, primary: Quote) {
        self.date = date
        self.primary = primary
    }

    init(date: Date, server: URL?) {
        self.init(date: date, primary: DailyQuotes.local(on: date, server: server).first ?? .empty)
    }
}

struct QuoteProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuoteEntry {
        QuoteEntry(date: Date(), primary: .example)
    }

    func getSnapshot(in context: Context, completion: @escaping (QuoteEntry) -> Void) {
        completion(QuoteEntry(date: Date(), server: server))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuoteEntry>) -> Void) {
        let configuredServer = server
        Task {
            let now = Date()
            let primary = await remoteQuote(on: now, server: configuredServer)
            let current = primary.map { QuoteEntry(date: now, primary: $0) }
                ?? QuoteEntry(date: now, server: configuredServer)
            let midnight = KoreanDay.nextMidnight(after: now)
            if configuredServer != nil {
                // Keep the last readable quote and its link while WidgetKit schedules refresh.
                let refresh = min(midnight, now.addingTimeInterval(primary == nil ? 900 : 3600))
                completion(Timeline(entries: [current], policy: .after(refresh)))
            } else {
                let next = QuoteEntry(date: midnight, server: nil)
                completion(Timeline(entries: [current, next], policy: .after(midnight)))
            }
        }
    }

    private func remoteQuote(on date: Date, server: URL?) async -> Quote? {
        guard let server, let quotes = try? await DailyQuotes.fetch(on: date, server: server) else {
            return nil
        }
        return quotes.first ?? .empty
    }

    private var server: URL? {
        DailyQuotes.configuredServer
    }
}

struct DailyWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuoteEntry

    var body: some View {
        content
            .containerBackground(for: .widget) { HaruDesign.paper }
            .widgetURL(entry.primary.deepLink)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline:
            Text(entry.primary.text)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.primary.text)
                    .font(.headline)
                    .lineLimit(2)
                if !entry.primary.author.isEmpty {
                    Text(entry.primary.author)
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
        default:
            VStack(alignment: .leading, spacing: 8) {
                Text("오늘의 문장")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(HaruDesign.accent)
                    .widgetAccentable()
                Text(entry.primary.text)
                    .font(.system(.headline, design: .serif))
                    .lineLimit(family == .systemSmall ? 4 : 3)
                if !entry.primary.author.isEmpty {
                    Text(entry.primary.author)
                        .font(.caption)
                        .foregroundStyle(HaruDesign.muted)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(HaruDesign.ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

@main
struct DailyQuoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: HaruWidgetIdentity.kind, provider: QuoteProvider()) { entry in
            DailyWidgetView(entry: entry)
        }
        .configurationDisplayName("하루한문장")
        .description("오늘의 문장 한 줄을 만나요.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}
