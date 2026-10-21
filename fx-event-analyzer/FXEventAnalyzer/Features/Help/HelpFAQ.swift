import Foundation

/// SCR-020 よくある質問(HQ指示 2026-10-06の参考画像の6分類)。アプリの今の機能に
/// 合わせた内容で、アプリに同梱する(通信できなくても読める)。
struct HelpFAQCategory: Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String
    let items: [HelpFAQItem]
}

struct HelpFAQItem: Identifiable, Hashable {
    let question: String
    let answer: String
    var id: String { question }
}

enum HelpFAQ {
    static let categories: [HelpFAQCategory] = [
        HelpFAQCategory(id: "account", title: "アカウントについて", icon: "person.fill", items: [
            HelpFAQItem(question: "名前や生年月日を変更したい", answer: "設定 → アカウント情報 → プロフィール編集 から変更できます。名前は入力欄をタップし、生年月日は「生年月日」の項目をタップしてください。"),
            HelpFAQItem(question: "メールアドレスを変更したい", answer: "設定 → アカウント情報 → メールアドレス から新しいアドレスを入力してください。届いた確認メールのリンクを開くと変更が完了します。"),
            HelpFAQItem(question: "パスワードを変更したい", answer: "設定 → アカウント情報 → パスワード変更 から変更できます。パスワードを忘れてログインできない場合は、お手数ですがお問い合わせください。"),
            HelpFAQItem(question: "アカウントを削除したい", answer: "設定 → アカウント情報 → アカウント削除 から削除できます。削除すると、プロフィール・設定・お気に入りなどのデータは復元できません。App Storeのサブスクリプションは自動では解約されないため、先に解約してください。"),
        ]),
        HelpFAQCategory(id: "billing", title: "プラン・支払いについて", icon: "creditcard", items: [
            HelpFAQItem(question: "プレミアムプランでできることは？", answer: "過去の同じ指標の発表時に、為替がどう動いたかの詳しい統計(高度な統計)を見られます。無料プランの機能もすべて使えます。"),
            HelpFAQItem(question: "料金はいくらですか？", answer: "月額プランと年額プランがあります。料金は 設定 → プラン・購読管理 → プランを選ぶ で確認できます。お支払いはApple IDに請求されます。"),
            HelpFAQItem(question: "解約したい", answer: "設定 → プラン・購読管理 → 購読を解約 から、App Storeのサブスクリプション管理を開いて解約してください。期間終了の24時間前までに解約しないと自動で更新されます。解約しても期間の終わりまではプレミアムプランを使えます。"),
            HelpFAQItem(question: "機種変更したらプランが消えた", answer: "購入したときと同じアカウントでログインし、同じApple IDでApp Storeにサインインしたうえで、設定 → プラン・購読管理 → プランを選ぶ の「購入を復元」をお試しください。"),
            HelpFAQItem(question: "返金してほしい", answer: "お支払いはAppleが管理しているため、返金はAppleのサポート(reportaproblem.apple.com)から申請してください。"),
        ]),
        HelpFAQCategory(id: "notification", title: "通知について", icon: "bell.fill", items: [
            HelpFAQItem(question: "通知が届かない", answer: "設定 → 通知設定 で「プッシュ通知」がオンになっているか確認してください。あわせて、iPhoneの 設定 → 通知 でこのアプリの通知が許可されているかも確認してください。"),
            HelpFAQItem(question: "通知のタイミングを変えたい", answer: "設定 → 通知設定 → 通知のタイミング で、発表時・5分前・10分前などから選べます。"),
            HelpFAQItem(question: "夜は通知を止めたい", answer: "設定 → 通知設定 の「通知しない時間帯」をオンにすると、指定した時間帯(初期値は23:00〜7:00)は通知しません。"),
            HelpFAQItem(question: "届いた通知はどこで見られますか？", answer: "ホーム画面右上のベルのマークから、届いた通知の一覧を見られます。未読があるとベルに赤い印が付きます。"),
        ]),
        HelpFAQCategory(id: "chart", title: "チャートの使い方", icon: "chart.xyaxis.line", items: [
            HelpFAQItem(question: "変動詳細の見方", answer: "指標の発表前後で為替がどれだけ動いたかを、時間足ごとに表示しています。発表時刻の線より右が発表後の動きです。"),
        ]),
        HelpFAQCategory(id: "data", title: "データの見方", icon: "doc.text.magnifyingglass", items: [
            HelpFAQItem(question: "「予想」「結果」「前回」とは？", answer: "予想は発表前の市場予想、結果は実際に発表された値、前回は前回発表の値です。"),
            HelpFAQItem(question: "サプライズとは？", answer: "結果が予想からどれだけ離れていたかを示します。差が大きいほど、為替が大きく動きやすい傾向があります。"),
            HelpFAQItem(question: "重要度(HIGH / MEDIUM / LOW)の意味", answer: "為替への影響の大きさの目安です。HIGHは特に注目度が高い指標・発言です。"),
            HelpFAQItem(question: "表示される時刻のタイムゾーンを変えたい", answer: "設定 → 表示・地域設定 → タイムゾーン で変更できます。"),
        ]),
        HelpFAQCategory(id: "other", title: "その他", icon: "ellipsis.circle", items: [
            HelpFAQItem(question: "不具合を見つけた", answer: "お手数ですが「お問い合わせ」から「不具合の報告」を選んで、起きたこと・操作の手順を送ってください。開発チームで確認し、修正の対象として登録します。"),
            HelpFAQItem(question: "要望を伝えたい", answer: "「フィードバックを送る」からお送りください。今後の改善の参考にさせていただきます。"),
            HelpFAQItem(question: "投資の助言はもらえますか？", answer: "このアプリは経済指標と為替の値動きの情報を提供するもので、投資の助言は行っていません。投資の判断はご自身の責任でお願いします。"),
        ]),
    ]

    /// 質問・答えの両方からキーワードで探す(大文字・小文字は区別しない)。
    static func search(_ keyword: String) -> [(category: HelpFAQCategory, item: HelpFAQItem)] {
        let words = keyword.split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return [] }
        return categories.flatMap { category in
            category.items
                .filter { item in words.allSatisfy { item.question.localizedCaseInsensitiveContains($0) || item.answer.localizedCaseInsensitiveContains($0) } }
                .map { (category, $0) }
        }
    }
}
