import { useLongPress } from '../lib/useLongPress';

interface BottomBarProps {
  isAdmin: boolean;
  onRequestLogin: () => void;
  onLogout: () => void;
}

/**
 * 未登录时这里是一条"隐形"的长按入口：不显示任何文案，
 * 只在按住过程中显示一条细进度线做反馈。5 秒后弹登录框。
 *
 * 管理员登录后，上传入口已经分散在页面里（首页空位、二级页缺号槽位），
 * 所以底部只保留退出按钮。
 */
export function BottomBar({ isAdmin, onRequestLogin, onLogout }: BottomBarProps) {
  // Hook 必须无条件调用，不能在 if 之后
  const { progress, handlers } = useLongPress(onRequestLogin);

  if (isAdmin) {
    return (
      <div className="bottombar">
        <button type="button" className="bottombar__logout" onClick={onLogout}>
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="bottombar bottombar--secret" {...handlers}>
      <div
        className="bottombar__progress"
        style={{ width: `${Math.round(progress * 100)}%` }}
        aria-hidden="true"
      />
    </div>
  );
}
