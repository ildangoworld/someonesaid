import SwiftUI

struct ServerSettings: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: String
    @State private var invalid = false
    let onSave: (String?) -> Void

    init(currentAddress: String, onSave: @escaping (String?) -> Void) {
        _draft = State(initialValue: currentAddress)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("서버 주소", text: $draft, prompt: Text("https://example.com"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.done)
                        .onSubmit(save)
                        .frame(minHeight: 44)
                        .onChange(of: draft) { _, _ in invalid = false }
                    if invalid {
                        Text("올바른 HTTPS 서버 주소를 입력해 주세요.")
                            .foregroundStyle(HaruDesign.accent)
                    }
                    if DailyQuotes.defaultServer != nil {
                        Button("기본 서버 사용") {
                            onSave(nil)
                            dismiss()
                        }
                        .frame(minHeight: 44)
                    }
                } header: {
                    Text("커뮤니티")
                } footer: {
                    Text("신뢰하는 하루한문장 서버의 기본 주소를 입력해 주세요. 주소를 비우면 기기에 담긴 문장을 읽을 수 있어요.")
                }
            }
            .navigationTitle("서버 설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                        .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장", action: save)
                        .frame(minHeight: 44)
                }
            }
        }
    }

    private func save() {
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            onSave("")
        } else if let url = ServerAddress.parse(draft) {
            onSave(url.absoluteString)
        } else {
            invalid = true
            return
        }
        dismiss()
    }
}
