// 画像ファイルを`import x from './foo.png'`の形でimportできるようにする
// 型宣言。通常はExpoが`expo-env.d.ts`(gitignore対象、`expo start`等で
// 自動生成)経由でこれを提供するが、新規チェックアウト直後や本セッションの
// ようにExpo CLIのdev serverを一度も起動していない環境では生成されておらず、
// tscがエラーになる(Mark.tsxでassets/mark.pngをimportした際に発覚)。
// 生成タイミングに依存せず常に型解決できるよう、ここに明示しておく。
declare module '*.png' {
  const value: number;
  export default value;
}
