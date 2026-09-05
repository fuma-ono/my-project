import EmojiGridPicker from './EmojiGridPicker';
import { useT } from '../i18n';
import { pickPhotoViaAlert } from '../lib/pickPhoto';
import { GROUP_ICON_EMOJI_OPTIONS, colors } from '../theme';

type Props = {
  visible: boolean;
  selected: string | null;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  // 「グループのアイコンも写真を選べるように」への対応。渡すと
  // 「写真から選ぶ」ボタンが出る(渡さない場合は絵文字のみ、従来通り)。
  onSelectPhoto?: (uri: string) => void;
};

// 個人のアバター(AvatarPicker)とは別の絵文字セット・配色を使う。
// 「これは人ではなくグループのアイコン」と一目で区別できるようにするため。
export default function GroupIconPicker({ visible, selected, onSelect, onClose, onSelectPhoto }: Props) {
  const t = useT();
  return (
    <EmojiGridPicker
      visible={visible}
      title={t.groupIconPicker.title}
      options={GROUP_ICON_EMOJI_OPTIONS}
      selected={selected}
      cellBackground={colors.accentSoft}
      onSelect={onSelect}
      onClose={onClose}
      photoButtonLabel={onSelectPhoto ? t.groupIconPicker.photoButton : undefined}
      onPickPhoto={onSelectPhoto ? () => pickPhotoViaAlert(t.groupIconPicker.photoAlertTitle, t, onSelectPhoto) : undefined}
    />
  );
}
