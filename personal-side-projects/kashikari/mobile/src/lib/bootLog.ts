// 起動直後に真っ白い画面のまま固まる不具合(101回目)の原因を、Xcode/
// シミュレーター/実機ログのどれにもアクセスできない環境から特定するための
// 一時的な計測ツール。「どこまでJSの実行が進んだか」を画面上に直接
// 表示することで、Macが無いオーナーでも(端末の設定アプリを漁らずに)
// フリーズ地点を報告できるようにする。
//
// react-native等への依存が一切無いプレーンなJSにしてあるのは、index.ts
// のできるだけ早い段階(他の重いモジュールがまだ読み込まれる前)から
// logBoot()を呼べるようにするため。
//
// 原因が判明したら、このファイルとBootLogOverlay、および各所のlogBoot()
// 呼び出しはまとめて削除すること。
type BootLogEntry = { t: number; msg: string };

const bootLog: BootLogEntry[] = [];
const startedAt = Date.now();

export function logBoot(msg: string) {
  bootLog.push({ t: Date.now() - startedAt, msg });
}

// このファイル自体がimportされた時点(index.tsのimport hoistingにより
// './App'より先に評価される)が、記録できる中で最も早いチェックポイント。
logBoot('bootLog.ts評価開始(最初のチェックポイント)');

export function getBootLog(): BootLogEntry[] {
  return bootLog;
}
