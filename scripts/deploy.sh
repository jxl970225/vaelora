#!/usr/bin/env bash
#
# vaelora 部署脚本
#
#   ./scripts/deploy.sh           完整流程：检查 → 建资源 → 部署 → 迁移
#   ./scripts/deploy.sh --check    只做检查，不改动任何东西
#
# 设计成幂等的：已存在的资源不会重复创建，已设的 secret 不会覆盖。
# 重复执行是安全的。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WORKER_NAME="vaelora"
DB_NAME="vaelora"
BUCKET_NAME="vaelora-images"
CONFIG="wrangler.jsonc"

# 这两个是随机值，脚本可以自己生成；ADMIN_PASSWORD_HASH 需要你输密码
AUTO_SECRETS=("SESSION_SECRET" "IP_SALT")
PASSWORD_SECRET="ADMIN_PASSWORD_HASH"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# ── 输出 ─────────────────────────────────────────────
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

json_lookup() {
  # $1 = JSON, $2 = JS 表达式，变量名 d 指向解析结果
  printf '%s' "$1" | node -e "
    let s='';
    process.stdin.on('data', c => s += c).on('end', () => {
      try { const d = JSON.parse(s); $2 } catch { console.log(''); }
    });
  "
}

# ── 1. 环境 ──────────────────────────────────────────
step "1/6 环境检查"

command -v node >/dev/null 2>&1 || die "未找到 node"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 3 ]; }; then
  die "wrangler 需要 Node >= 20.3，当前 $(node -v)"
fi
ok "Node $(node -v)"

[ -f "$CONFIG" ] || die "找不到 ${CONFIG}，请在项目根目录运行"
[ -d node_modules ] || die "依赖未安装，先运行: npm install"
ok "依赖已安装"

if ! npx wrangler whoami >/dev/null 2>&1; then
  die "未登录 Cloudflare，先运行: npx wrangler login"
fi
ACCOUNT=$(npx wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)
ok "已登录 Cloudflare"
[ -n "$ACCOUNT" ] && info "Account ID: $ACCOUNT"

# ── 2. 配置 ──────────────────────────────────────────
step "2/6 配置检查"

DB_PLACEHOLDER=$(node -e "
  const s = require('fs').readFileSync('$CONFIG','utf8');
  const m = s.match(/\"database_id\"\s*:\s*\"([^\"]*)\"/);
  console.log(!m || /REPLACE|TODO|CHANGEME/i.test(m[1]) ? (m ? m[1] : 'MISSING') : '');
")

if [ -n "$DB_PLACEHOLDER" ]; then
  warn "$CONFIG 里的 database_id 尚未填写（当前: ${DB_PLACEHOLDER}）"
else
  ok "database_id 已配置"
fi

# ── 3. 云端资源 ──────────────────────────────────────
step "3/6 云端资源"

DB_LIST=$(npx wrangler d1 list --json 2>/dev/null || echo '[]')
DB_ID=$(json_lookup "$DB_LIST" "const x=(Array.isArray(d)?d:(d.result||[])).find(v=>v.name==='$DB_NAME'); console.log(x?(x.uuid||x.id||''):'')")

if [ -n "$DB_ID" ]; then
  ok "D1 数据库 $DB_NAME 已存在"
  info "id: $DB_ID"
else
  warn "D1 数据库 $DB_NAME 不存在"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    info "需要创建（--check 模式不执行）"
  else
    info "创建中…"
    CREATE_OUT=$(npx wrangler d1 create "$DB_NAME" 2>&1) || die "创建失败：$CREATE_OUT"
    DB_ID=$(json_lookup "$(npx wrangler d1 list --json 2>/dev/null || echo '[]')" \
      "const x=(Array.isArray(d)?d:(d.result||[])).find(v=>v.name==='$DB_NAME'); console.log(x?(x.uuid||x.id||''):'')")
    [ -n "$DB_ID" ] || die "创建后仍未取到 database_id，请手动查看 wrangler d1 list"
    ok "已创建，id: $DB_ID"
  fi
fi

# 把真实的 id 写回配置文件
if [ -n "$DB_ID" ] && [ -n "$DB_PLACEHOLDER" ]; then
  if [ "$CHECK_ONLY" -eq 1 ]; then
    info "会把 database_id 写入 ${CONFIG}（--check 模式不执行）"
  else
    DB_ID="$DB_ID" node -e "
      const fs = require('fs');
      const s = fs.readFileSync('$CONFIG','utf8');
      fs.writeFileSync('$CONFIG', s.replace(
        /(\"database_id\"\s*:\s*\")[^\"]*(\")/,
        '\$1' + process.env.DB_ID + '\$2'
      ));
    " || die "写入 database_id 失败"
    ok "database_id 已写入 $CONFIG"
  fi
fi

BUCKET_LIST=$(npx wrangler r2 bucket list --json 2>/dev/null || echo '[]')
BUCKET=$(json_lookup "$BUCKET_LIST" "const x=(Array.isArray(d)?d:(d.result||d.buckets||[])).find(v=>(v.name||v.bucket_name)==='$BUCKET_NAME'); console.log(x?'yes':'')")

if [ -n "$BUCKET" ]; then
  ok "R2 桶 $BUCKET_NAME 已存在"
else
  warn "R2 桶 $BUCKET_NAME 不存在"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    info "需要创建（--check 模式不执行）"
  else
    npx wrangler r2 bucket create "$BUCKET_NAME" >/dev/null 2>&1 \
      && ok "已创建" || die "创建 R2 桶失败"
  fi
fi

# ── 4. Secrets ───────────────────────────────────────
step "4/6 Secrets"

SECRET_LIST=$(npx wrangler secret list --json 2>/dev/null || echo '[]')
has_secret() {
  json_lookup "$SECRET_LIST" "const x=(Array.isArray(d)?d:(d.result||[])).some(v=>v.name==='$1'); console.log(x?'yes':'')"
}

for name in "${AUTO_SECRETS[@]}"; do
  if [ -n "$(has_secret "$name")" ]; then
    ok "$name 已设置"
  elif [ "$CHECK_ONLY" -eq 1 ]; then
    warn "$name 未设置（会自动生成）"
  else
    VALUE=$(node -p "require('crypto').randomBytes(32).toString('base64url')")
    printf '%s' "$VALUE" | npx wrangler secret put "$name" >/dev/null 2>&1 \
      && ok "$name 已生成并设置" || die "设置 $name 失败"
  fi
done

if [ -n "$(has_secret "$PASSWORD_SECRET")" ]; then
  ok "$PASSWORD_SECRET 已设置"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  warn "$PASSWORD_SECRET 未设置（部署时会提示输入密码）"
else
  echo
  info "需要设置管理员密码（用于登录上传）"
  printf '    密码: '
  read -r -s ADMIN_PW
  echo
  [ -n "$ADMIN_PW" ] || die "密码不能为空"

  HASH=$(printf '%s' "$ADMIN_PW" | node -e "
    let s='';
    process.stdin.on('data', c => s += c).on('end', () =>
      console.log(require('crypto').createHash('sha256').update(s).digest('hex')));
  ")
  unset ADMIN_PW

  printf '%s' "$HASH" | npx wrangler secret put "$PASSWORD_SECRET" >/dev/null 2>&1 \
    && ok "$PASSWORD_SECRET 已设置" || die "设置失败"
fi

# ── 5. 构建与部署 ────────────────────────────────────
if [ "$CHECK_ONLY" -eq 1 ]; then
  step "5/6 构建与部署"
  info "跳过（--check 模式）"
  printf '\n\033[1;32m检查完成。\033[0m去掉 --check 即执行实际部署。\n\n'
  exit 0
fi

step "5/6 构建与部署"

npm run build >/dev/null 2>&1 || die "构建失败，请单独运行 npm run build 查看错误"
ok "构建完成"

DEPLOY_OUT=$(npx wrangler deploy 2>&1) || { printf '%s\n' "$DEPLOY_OUT"; die "部署失败"; }
ok "部署完成"

WORKER_URL=$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)

# ── 6. 远程迁移 ──────────────────────────────────────
step "6/6 数据库迁移"

MIGRATE_OUT=$(npx wrangler d1 migrations apply "$DB_NAME" --remote 2>&1) \
  || { printf '%s\n' "$MIGRATE_OUT"; die "迁移失败"; }

if printf '%s' "$MIGRATE_OUT" | grep -qiE "no migrations|nothing to apply"; then
  ok "无待应用的迁移"
else
  ok "迁移已应用"
fi

# ── 完成 ─────────────────────────────────────────────
printf '\n\033[1;32m部署完成\033[0m\n\n'
if [ -n "$WORKER_URL" ]; then
  printf '  访问地址: \033[1;36m%s\033[0m\n' "$WORKER_URL"
else
  info "在 Cloudflare 后台的 Workers 页面可以找到访问地址"
fi
printf '\n  提示: 图片默认走 Worker 代理，每次浏览都消耗一次请求。\n'
printf '        绑定 R2 自定义域名并在 %s 里填写 IMAGE_BASE_URL 可省下这笔开销。\n\n' "$CONFIG"
