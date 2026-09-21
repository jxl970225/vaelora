-- vaelora 初始表结构
--
-- 这条链路是「仅管理员上传的展示型画廊」，不是匿名图床，
-- 因此不需要防滥用的 delete_token_hash 之类的字段。

CREATE TABLE images (
  id           TEXT PRIMARY KEY,
  -- 不加 NOT NULL：删除后要置空留"墓碑"，靠 UNIQUE 挡住重复删除
  r2_key       TEXT UNIQUE,
  thumb_key    TEXT,
  -- 主题，取值必须是 shared/themes.ts 里的 id（服务端强校验）
  theme        TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL DEFAULT 0,
  width        INTEGER,
  height       INTEGER,
  -- pending  已建会话，尚未收到字节
  -- uploaded 字节已落 R2，等待 commit（只有这个状态能发布）
  -- published 可见
  -- rejected 超限
  -- deleted  已删除，对象引用已清空
  status       TEXT NOT NULL DEFAULT 'pending',
  ip_hash      TEXT,
  created_at   INTEGER NOT NULL
);

-- 二级页：某主题下的图片，按时间倒序 keyset 分页
CREATE INDEX idx_theme ON images (theme, id DESC);

-- 首页：每个主题取最新一张作为封面（PARTITION BY theme）
CREATE INDEX idx_gallery ON images (status, theme, id DESC);

-- 登录失败计数，用于限制爆破
CREATE TABLE login_attempts (
  ip_hash     TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  succeeded   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_login_attempts ON login_attempts (ip_hash, attempted_at DESC);
