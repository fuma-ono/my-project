import { registerRootComponent } from 'expo';
import 'react-native-url-polyfill/auto';

// 起動時フリーズ調査(101回目)のための一時的な切り分け。App.tsxは
// 大量のファイルをimportしており、その評価中にオーバーレイの表示
// すら阻害する何かが起きている可能性を切り分けるため、あえて
// './App'を一切importせず、依存の無い最小構成コンポーネントだけを
// 登録する。原因が判明したら、この2行をコメントアウト前の状態
// (App.tsxを登録する形)に戻すこと。
import MinimalDebugApp from './MinimalDebugApp';

registerRootComponent(MinimalDebugApp);
