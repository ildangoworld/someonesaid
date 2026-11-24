import SwiftUI
import UIKit
import WidgetKit

@main
struct HaruApp: App {
    var body: some Scene {
        WindowGroup { HomeView() }
    }
}

struct HomeView: View {
    @AppStorage(DailyQuotes.serverKey, store: DailyQuotes.defaults) private var addressOverride: String?
    @Environment(\.scenePhase) private var scenePhase
    @State private var date = Date()
    @State private var daily = DailyQuotes.local(on: Date(), server: DailyQuotes.configuredServer)
    @State private var clockRevision = 0
    @State private var widgetDay: String?
    @State private var widgetAddress: String?
    @State private var widgetQuote: Quote?
    @State private var reload = UUID()
    @State private var selectedID: String?
    @State private var showSettings = false
    @State private var showToday = false
    @State private var webFailed = false

    private var address: String { addressOverride ?? DailyQuotes.defaultServer?.absoluteString ?? "" }
    private var server: URL? { ServerAddress.parse(address) }

    private var page: URL? {
        guard let server else { return nil }
        guard let selectedID else { return server }
        return server.appending(path: "q").appending(path: selectedID)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let server, let page {
                    CommunityWebView(origin: server, page: page, reload: reload) { failed in
                        webFailed = failed
                    }
                    .id(server)
                    .accessibilityHidden(webFailed)
                    .opacity(webFailed ? 0 : 1)
                    .overlay {
                        if webFailed {
                            offlineView(connectionFailed: true)
                        }
                    }
                } else {
                    offlineView()
                }
            }
            .background(HaruDesign.paper)
            .navigationTitle("하루한문장")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if selectedID != nil {
                        Button {
                            selectedID = nil
                            webFailed = false
                        } label: {
                            Image(systemName: "house")
                                .frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("처음으로")
                    } else if page != nil {
                        Button {
                            showToday = true
                        } label: {
                            Image(systemName: "book")
                                .frame(minWidth: 44, minHeight: 44)
                        }
                        .accessibilityLabel("오늘의 문장")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("서버 설정")
                }
            }
            .sheet(isPresented: $showSettings) {
                ServerSettings(currentAddress: address) { newAddress in
                    addressOverride = newAddress
                    selectedID = nil
                    webFailed = false
                    reload = UUID()
                }
            }
            .sheet(isPresented: $showToday) {
                NavigationStack {
                    TodayView(date: date, quotes: daily, selected: nil)
                        .navigationTitle("오늘의 문장")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("닫기") { showToday = false }
                                    .frame(minHeight: 44)
                            }
                        }
                }
            }
        }
        .tint(HaruDesign.accent)
        .onOpenURL { url in
            guard let id = Quote.id(from: url) else { return }
            showToday = false
            showSettings = false
            selectedID = id
            webFailed = false
            reload = UUID()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { clockRevision += 1 }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)) { _ in
            clockRevision += 1
        }
        .task(id: RefreshKey(address: address, clockRevision: clockRevision)) {
            await followKoreanDay()
        }
    }

    private func offlineView(connectionFailed: Bool = false) -> some View {
        TodayView(
            date: date,
            quotes: daily,
            selected: selectedID.flatMap { id in
                daily.first { $0.id == id } ?? DailyQuotes.knownQuote(id: id, server: server)
            },
            missingQuote: selectedID != nil,
            notice: connectionFailed ? "서버에 연결할 수 없어 저장된 문장을 보여 드려요." : "커뮤니티에 참여하려면 서버 주소를 설정해 주세요.",
            actionLabel: connectionFailed ? "다시 연결" : "서버 주소 설정"
        ) {
            if connectionFailed {
                webFailed = false
                reload = UUID()
                clockRevision += 1
            } else {
                showSettings = true
            }
        }
    }

    @MainActor
    private func followKoreanDay() async {
        while !Task.isCancelled {
            let now = Date()
            date = now
            let currentServer = server
            daily = DailyQuotes.local(on: now, server: currentServer)
            if let currentServer, let downloaded = try? await DailyQuotes.fetch(on: now, server: currentServer) {
                guard !Task.isCancelled, currentServer == server else { return }
                if KoreanDay.key(now) == KoreanDay.key(Date()) {
                    daily = downloaded
                }
            }
            guard !Task.isCancelled else { return }
            refreshWidgetIfNeeded(for: now)
            let delay = max(0, KoreanDay.nextMidnight(after: now).timeIntervalSinceNow)
            do {
                try await Task.sleep(for: .seconds(delay))
            } catch {
                return
            }
        }
    }

    private func refreshWidgetIfNeeded(for date: Date) {
        let day = KoreanDay.key(date)
        guard day != widgetDay || address != widgetAddress || daily.first != widgetQuote else { return }
        widgetDay = day
        widgetAddress = address
        widgetQuote = daily.first
        WidgetCenter.shared.reloadTimelines(ofKind: HaruWidgetIdentity.kind)
    }

    private struct RefreshKey: Equatable {
        let address: String
        let clockRevision: Int
    }
}
