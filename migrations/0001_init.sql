-- vaelora 初始表结构
--
-- 图片存 Supabase Storage，D1 只存元数据。存储路径形如：
--   first/{主题号}/{主题号}-{序号}.jpg
-- 主题号 1-8 对应 shared/themes.ts 里 THEMES 的顺序，序号在每个主题内递增。

CREATE TABLE images (
  id           TEXT PRIMARY KEY,
  -- Supabase 里的对象路径，删除后置空留"墓碑"，靠 UNIQUE 挡重复删除
  storage_path TEXT UNIQUE,
  -- 该主题内的序号，从 1 开始，永不复用（删掉的位置留空）
  seq          INTEGER NOT NULL,
  theme        TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL DEFAULT 0,
  width        INTEGER,
  height       INTEGER,
  -- pending  已建会话，尚未收到字节
  -- uploaded 字节已落盘，等待 commit（只有这个状态能发布）
  -- published 可见
  -- rejected 超限
  -- deleted  已删除，对象引用已清空
  status       TEXT NOT NULL DEFAULT 'pending',
  ip_hash      TEXT,
  created_at   INTEGER NOT NULL
);

-- 同一主题内序号唯一
CREATE UNIQUE INDEX idx_theme_seq ON images (theme, seq);

-- 二级页与首页分组：某主题下的图片按时间倒序 keyset 分页
CREATE INDEX idx_theme ON images (theme, id DESC);

-- 首页信息流：按主题分区取最新若干张
CREATE INDEX idx_gallery ON images (status, theme, id DESC);

-- 每个主题的取号器
CREATE TABLE theme_counters (
  theme    TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL DEFAULT 1
);

-- 登录失败计数，用于限制爆破
CREATE TABLE login_attempts (
  ip_hash      TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  succeeded    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_login_attempts ON login_attempts (ip_hash, attempted_at DESC);
