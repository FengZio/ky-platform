// PM2 进程管理配置
module.exports = {
  apps: [
    {
      name: "ky-backend",
      script: "npm",
      args: "run dev",
      cwd: "/opt/ky-platform/backend",
      env: {
        NODE_ENV: "production",
      },
      // 崩溃自动重启
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // 日志
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/var/log/ky-backend/error.log",
      out_file: "/var/log/ky-backend/out.log",
      merge_logs: true,
    },
  ],
};
