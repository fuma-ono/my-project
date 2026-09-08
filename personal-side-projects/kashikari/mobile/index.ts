import { registerRootComponent } from 'expo';
import 'react-native-url-polyfill/auto';

import { logBoot } from './src/lib/bootLog';
import App from './App';

// 起動時フリーズ調査用(101回目)の記録。
//
// 注意: import文はモジュール内の他のコードより先にすべて実行される
// (ESMのhoisting)ため、ここでのlogBoot()は「'./App'を含む全importの
// 評価が完了した後」に呼ばれる。つまりApp.tsx側の同期的なimport評価が
// フリーズの原因なら、この行自体が実行されずログに何も残らない。
// その場合は「index.ts: registerRootComponent呼び出し前」のログすら
// 出ていない=importの評価中に固まっている、と判断できる。
logBoot('index.ts: 全importの評価完了、registerRootComponent呼び出し前');

registerRootComponent(App);

logBoot('index.ts: registerRootComponent呼び出し後');
