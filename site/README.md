# Locution Pro 官网

官网为纯静态 HTML、CSS 和 JavaScript，部署在 Cloudflare Pages。页面设计和素材保存在 `site/`，不依赖桌面程序、服务端或数据库。

| 站点     | 正式地址                          | 托管             |
| -------- | --------------------------------- | ---------------- |
| 官网     | https://locution.dpdns.org/       | Cloudflare Pages |
| 用户指南 | https://helpx.locution.dpdns.org/ | GitHub Pages     |

## 本地开发和发布产物

使用仓库声明的 Node.js 和 npm 版本，在仓库根目录执行：

```bash
npm ci
npm run site:dev
```

开发地址为 `http://127.0.0.1:1422`，结束后按 Ctrl+C 停止。应用的 1420 端口不用于官网。

```bash
npm run check:site
npm run site:build
npm run site:preview
```

`site:build` 先检查所有页面的本地文件、页内锚点、辅助技术标签引用、CSS 字体和脚本中的示例图片，再将公开文件复制到 `dist/site/` 并复查产物。无需运行桌面应用构建。`site:preview` 在 1422 端口预览这份产物；Vite 预览不模拟 Cloudflare 的安全头和 404 状态。

只上传 `dist/site/`，不要上传仓库根目录或整个 `dist/`。构建只替换 `dist/site/`，不删除桌面构建。说明文档、品牌规范和配置文件不会进入发布包。

- `index.html`：官网首页。
- `404.html`：未知路径的错误页，阻止 Pages 将未知路径回退到首页。
- `src/`：样式和交互；字体通过独立 WOFF2 文件加载。
- `assets/`：本地图标、应用截图、视觉示意和字体许可证。
- `_headers`：安全头；使用 Pages 默认的 ETag 与重新验证缓存策略，避免未带哈希的资源更新后仍显示旧版本。
- `_redirects`：原文档内页目录以 301 跳转到用户指南新子域名，保留后续路径。
- `robots.txt`：抓取规则。构建会加入正式站点地图地址。
- `brand-spec.md`：维护中的品牌约束，不发布。

默认正式域名为 `https://locution.dpdns.org`。如需变更，在构建时设置 `SITE_URL` 为 HTTPS 源站地址，不带路径、查询参数或片段。构建生成首页 canonical、Open Graph 绝对地址和 `sitemap.xml`。预览部署由 Pages 默认添加禁止索引响应头。

## 创建 Cloudflare Pages 项目后启用发布

项目尚未创建时，工作流仍会检查和打包，可从 GitHub Actions 下载 `cloudflare-pages-site` artifact；部署 job 默认跳过。

推荐沿用仓库的 GitHub Actions Direct Upload 流程：

1. 在 Cloudflare 创建 **Pages / Direct Upload** 项目，默认项目名为 `linecut-site`，生产分支为 `main`。不要误建 Workers 项目。
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加 secrets：
   - `CLOUDFLARE_API_TOKEN`：目标账号的 `Account / Cloudflare Pages / Edit` 权限。
   - `CLOUDFLARE_ACCOUNT_ID`：该账号的 Account ID。
3. 如项目名不同，设置仓库变量 `CLOUDFLARE_PAGES_PROJECT`。如正式域名不同，设置仓库变量 `SITE_URL`。
4. 设置仓库变量 `CLOUDFLARE_PAGES_ENABLED=true`。若 GitHub 的 `cloudflare-pages` environment 有保护规则，按仓库要求配置。
5. 手动运行 **Deploy site to Cloudflare Pages**，或推送相关变更到 `main`。

`wrangler.jsonc` 声明默认项目名和 `dist/site` 输出目录。部署使用固定版本 `wrangler@4.157.0`，工作流可通过项目名变量覆盖默认值。不应在仓库提交 token 或账号凭据。

如使用 Cloudflare 的 Git 集成创建项目，应关闭上述 Actions 部署开关，避免重复发布，并使用：

| 配置                   | 值                                   |
| ---------------------- | ------------------------------------ |
| Production branch      | `main`                               |
| Framework preset       | `None`                               |
| Root directory         | 仓库根目录                           |
| Build command          | `npm run site:build`                 |
| Build output directory | `dist/site`                          |
| Node.js                | `22.18.0`，或满足仓库 engines 的版本 |

Git 集成构建需要安装仓库的 npm 依赖。不能将桌面程序的 `npm run build` 用作官网构建。Direct Upload 和 Git 集成的选择应在创建项目时确定，Cloudflare 不支持将 Direct Upload 项目直接切换为 Git 集成项目。

## 域名切换和用户指南

仓库已将官网、README 和桌面应用的用户指南入口统一为 `https://helpx.locution.dpdns.org/`。文档站的 `public/CNAME`、站点地图和部署基址也已切换。

官网和用户指南分别绑定各自的域名，按以下步骤配置：

1. 先在 GitHub **Settings → Pages → Custom domain** 填写 `helpx.locution.dpdns.org`，然后配置该域名指向现有 GitHub Pages 站点的 DNS，完成 HTTPS 验证。CNAME 目标使用 `<GitHub 用户或组织>.github.io`，例如当前 origin 对应 `inexplicable-yl.github.io`；以实际承载文档的仓库所有者为准。当前使用自定义 Actions 发布，GitHub 的域名绑定以控制台设置为准，产物中的 `CNAME` 文件不能替代该设置。
2. 发布用户指南并确认新域名上的首页和内页均正常。文档部署基址固定为 `/`，旧的 `DOCS_BASE` 仓库变量不再生效。
3. 在 Cloudflare Pages 项目的 **Custom domains** 添加 `locution.dpdns.org`，然后按控制台提示添加或更新 DNS，使其指向项目实际提供的 `<项目>.pages.dev` 目标，等待域名和 HTTPS 证书激活。
4. 验证官网首页、`/sitemap.xml`、随机不存在路径的 404，以及下载、GitHub、更新日志和用户指南入口。

官网上的历史文档内页路径会以 301 跳转到帮助子域名；其他旧域名的跳转需在原托管服务单独配置。更新收藏和对外链接时使用新地址。已安装的旧版应用仍使用其内置的帮助地址，更新应用后才会直接打开新帮助地址。

## 检查和维护

```bash
npm run check:layout
npm test
npm run check:versions
npm run docs:build
npm run format:check
```

确定性网站构建与校验测试在 `tests/unit/tooling/site.test.mjs`，普通 CI 会构建官网。发版脚本同步官网显示的应用版本，并由 `check:versions` 校验。不要在官网加入媒体编码、模型或 GPU 检查。

Cloudflare 参考：[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[CI 发布](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)、[静态文件与缓存](https://developers.cloudflare.com/pages/configuration/serving-pages/)、[自定义域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)。

GitHub 参考：[自定义域名与 DNS 配置](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)。
