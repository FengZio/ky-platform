# 后端节点 · 部署指南 (systemd)

## 架构

```
https://vq.zrj666.cn/api/process → Nginx → uvicorn :3456 (systemd)
```

---

## 服务器部署步骤

```bash
# 1. 上传代码
scp -r backend/ user@server:/opt/ky-platform/

# 2. 创建 venv + 安装依赖
cd /opt/ky-platform/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
vim .env   # 填入 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY

# 4. 注册 systemd 服务
sudo cp ky-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ky-backend

# 5. 检查状态
sudo systemctl status ky-backend
sudo journalctl -u ky-backend -f

# 6. 配置 Nginx
sudo cp nginx-ky-backend.conf /etc/nginx/sites-available/ky-backend
sudo ln -s /etc/nginx/sites-available/ky-backend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 常用命令

```bash
sudo systemctl restart ky-backend   # 重启
sudo systemctl stop ky-backend      # 停止
sudo journalctl -u ky-backend -f    # 实时日志
sudo journalctl -u ky-backend -n 50 # 最近50行
```

## API

`POST https://vq.zrj666.cn/api/process`

```json
{ "material_id": "uuid", "text": "全文..." }
{ "material_id": "uuid", "webdav_path": "/papers/test.pdf" }
```

`GET https://vq.zrj666.cn/health`
