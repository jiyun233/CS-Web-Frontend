# EdgeOne Pages 考试子站

这个目录是可直接上传到 EdgeOne Pages 的独立静态考试站，不依赖 Next.js 构建。

## 方式一：直接上传（推荐）

1. 在 EdgeOne Pages 创建项目并选择“直接上传”。
2. 上传仓库根目录生成的 `edgeone-pages-upload.zip`。
3. 部署完成后访问 Pages 域名，入口会自动进入考试列表。

重新生成上传包：

```bash
pnpm pages:pack
```

## 方式二：Git 仓库构建

仓库根目录已提供 `edgeone.json`，覆盖掉 Next.js 主站构建：

```json
{
  "buildCommand": "node -e \"process.exit(0)\"",
  "installCommand": "node -e \"process.exit(0)\"",
  "outputDirectory": "./edgeone-pages"
}
```

根目录的 `functions/` 是 EdgeOne 函数入口，`edgeone-pages/` 是静态资源目录。

如果 Pages 控制台仍显示运行了 Next.js `pnpm build`，请在项目设置中把根目录改为：

```text
edgeone-pages
```

该目录本身包含可独立部署的 `index.html`、`app.js`、`styles.css` 和 `functions/`。

## 后端地址

默认后端：

```text
http://cfc8522bc8db.ofalias.net:44956
```

生产环境建议在 EdgeOne Pages 项目环境变量中设置：

```text
BACKEND_URL=http://cfc8522bc8db.ofalias.net:44956
```

环境变量只被 `functions/api/[[default]].js` 读取，不会进入浏览器 bundle。

## 安全模型

- 浏览器只请求 Pages 同源地址 `/api/v1/*`。
- Edge Function 把请求转发到后端 FastAPI。
- access/refresh token 写入 HttpOnly、SameSite=Lax Cookie。
- access token 临近过期时，函数会在收到 401 后自动刷新并重试一次。
- 前端页面和浏览器存储中不会保存 JWT。

## 路由

- `#/`：考试列表
- `#/exam/{id}`：答题和交卷
- `#/login?redirect=/exam/{id}`：登录及 2FA

使用 hash 路由是为了让直接上传的静态站点无需额外配置 SPA fallback。

## 本地检查

静态文件可直接用任意 HTTP Server 打开。函数需要 EdgeOne CLI：

```bash
npm install -g edgeone
edgeone pages dev
```

当前后端 FRP 地址必须允许 EdgeOne 节点发起到 `44956` 的 HTTP 请求，并且后端服务需要持续在线。
