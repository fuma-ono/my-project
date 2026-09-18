// 利用規約・プライバシーポリシーの公開URL。
//
// Apple審査Guideline 3.1.2(c)(2026-09-18指摘)対応: 自動更新サブスク
// リプションを提供するアプリは、購入画面(アプリ内)自体に利用規約・
// プライバシーポリシーへの機能するリンクを表示する必要がある。
// これまでApp Store Connect側のメタデータ(説明文・使用許諾契約欄)
// にしかリンクが無く、アプリ本体には一切表示していなかったのが原因。
//
// URL自体はdocs/legal/kashikari-terms-of-service.md・
// kashikari-privacy-policy.mdと同内容をArtifactとして公開したもの
// (両ファイル冒頭の「公開URL」欄を参照)。内容を更新した場合は、
// Artifact側も同じ内容で再公開すること。
export const TERMS_OF_USE_URL = 'https://claude.ai/code/artifact/2fbe0df7-aa78-4277-b890-b32f76bf7022';
export const PRIVACY_POLICY_URL = 'https://claude.ai/code/artifact/984fcff8-5d34-4ea0-a750-2d0968cb4173';
