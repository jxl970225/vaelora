import { THEMES } from '../../shared/themes';

interface ThemePickerProps {
  onPick: (themeId: string) => void;
  onClose: () => void;
}

/** 首页上传时要先选主题；二级页上传则自动归属当前主题，不弹这个。 */
export function ThemePicker({ onPick, onClose }: ThemePickerProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="选择主题">
      <div className="modal__panel">
        <h2 className="modal__title">上传到哪个主题？</h2>

        <ul className="picker">
          {THEMES.map((theme) => (
            <li key={theme.id}>
              <button type="button" className="picker__item" onClick={() => onPick(theme.id)}>
                {theme.name}
              </button>
            </li>
          ))}
        </ul>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
