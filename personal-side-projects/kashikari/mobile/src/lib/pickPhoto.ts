// AddEntrySheet.tsx/EditEntrySheet.tsxが持っていた「カメラで撮る/
// アルバムから選ぶ」の選択ダイアログを、アイコン写真選択(AvatarPicker/
// GroupIconPicker)でも使えるよう切り出した共通処理。
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import type { Strings } from '../i18n/strings';

export function pickPhotoViaAlert(title: string, t: Strings, onPicked: (uri: string) => void): void {
  Alert.alert(title, undefined, [
    {
      text: t.addEntry.takePhoto,
      onPress: async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return Alert.alert(t.addEntry.cameraPermissionDenied);
        const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, aspect: [1, 1] });
        if (!result.canceled) onPicked(result.assets[0].uri);
      },
    },
    {
      text: t.addEntry.pickFromLibrary,
      onPress: async () => {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return Alert.alert(t.addEntry.libraryPermissionDenied);
        const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
        if (!result.canceled) onPicked(result.assets[0].uri);
      },
    },
    { text: t.common.cancel, style: 'cancel' },
  ]);
}
