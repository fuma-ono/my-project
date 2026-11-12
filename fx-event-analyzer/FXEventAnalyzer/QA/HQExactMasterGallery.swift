import SwiftUI

/// UI Master QA gallery.
/// These views intentionally render the approved reference artwork pixel-for-pixel.
/// They are a visual gold-master/QA harness, not the final data-bound production views.
struct HQExactMasterGallery: View {
    private let screens = (0...11).map { String(format: "SCR-%03d", $0) }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 24) {
                    ForEach(screens, id: \.self) { id in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(id)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Image(id)
                                .resizable()
                                .interpolation(.high)
                                .aspectRatio(contentMode: .fit)
                                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                .shadow(radius: 12)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("FX Event Analyzer UI Master")
        }
    }
}

/// Exact single-screen renderer used by screenshot QA.
struct HQExactMasterScreen: View {
    let screenID: String

    var body: some View {
        Image(screenID)
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .background(Color.black)
    }
}

#Preview("All Master Screens") {
    HQExactMasterGallery()
}

#Preview("SCR-000") {
    HQExactMasterScreen(screenID: "SCR-000")
}
