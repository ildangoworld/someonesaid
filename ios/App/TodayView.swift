import SwiftUI

struct TodayView: View {
    let date: Date
    let quotes: [Quote]
    let selected: Quote?
    var missingQuote = false
    var notice: LocalizedStringKey?
    var actionLabel: LocalizedStringKey?
    var action: (() -> Void)?
    @State private var showExtras = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let selected {
                    Text("위젯에서 열어 본 문장")
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    quoteCard(selected, featured: true)
                } else if missingQuote {
                    Text("선택한 문장을 불러오려면 서버에 연결해 주세요.")
                        .font(.subheadline)
                        .foregroundStyle(HaruDesign.muted)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(KoreanDay.label(date))
                        .font(.subheadline)
                        .foregroundStyle(HaruDesign.muted)
                    Text("오늘의 문장")
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                }

                if let primary = quotes.first {
                    if primary.id != selected?.id {
                        if selected == nil {
                            Color.clear
                                .frame(height: 144)
                                .overlay {
                                    GeometryReader { geometry in
                                        Image("MorningLandscape")
                                            .resizable()
                                            .scaledToFill()
                                            .frame(width: geometry.size.width, height: geometry.size.height)
                                    }
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .accessibilityHidden(true)
                        }
                        quoteCard(primary, featured: true)
                    }

                    let extras = quotes.dropFirst().filter { $0.id != selected?.id }
                    if !extras.isEmpty {
                        DisclosureGroup(isExpanded: $showExtras) {
                            VStack(alignment: .leading, spacing: 12) {
                                ForEach(extras) { quote in
                                    quoteCard(quote, featured: false)
                                }
                            }
                        } label: {
                            Text("문장 더 읽기")
                                .font(.headline)
                                .frame(minHeight: 44)
                        }
                    }
                } else {
                    Text("아직 공개된 문장이 없어요.")
                        .font(.body)
                        .foregroundStyle(HaruDesign.muted)
                }

                if let notice, let actionLabel, let action {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(notice)
                            .font(.footnote)
                            .foregroundStyle(HaruDesign.muted)
                        Button(actionLabel, action: action)
                            .font(.subheadline.weight(.semibold))
                            .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                    }
                }
            }
            .frame(maxWidth: 600, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(20)
        }
        .foregroundStyle(HaruDesign.ink)
        .background(HaruDesign.paper)
        .onChange(of: KoreanDay.key(date)) { _, _ in showExtras = false }
    }

    private func quoteCard(_ quote: Quote, featured: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if !quote.category.isEmpty {
                Text(quote.category)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(HaruDesign.accent)
            }
            Text(quote.text)
                .font(.system(featured ? .title2 : .body, design: .serif))
                .fixedSize(horizontal: false, vertical: true)
            if !quote.author.isEmpty {
                Text(quote.author)
                    .font(.subheadline)
                    .foregroundStyle(HaruDesign.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(HaruDesign.surface, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}
