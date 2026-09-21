import { useState } from 'react';
import { login } from '../lib/api';

interface LoginModalProps {
  onSuccess: (token: string) => void;
  onClose: () => void;
}

export function LoginModal({ onSuccess, onClose }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSuccess(await login(username, password));
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="管理员登录">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">管理员登录</h2>

        <label className="field">
          <span>账号</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="modal__error">{error}</p>}

        <p className="modal__note">
          凭证只保存在当前页面的内存里，刷新后需要重新登录。
        </p>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </div>
      </form>
    </div>
  );
}
