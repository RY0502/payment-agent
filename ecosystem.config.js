module.exports = {
  apps: [{
    name: 'payment-agent',
    cwd: '/home/opc/payment-agent-main',
    script: '/home/opc/.nvm/versions/node/v20.18.0/bin/pnpm',
    args: 'exec langgraphjs dev --host 0.0.0.0 --port 8123 --no-browser',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=512'
    },
    max_memory_restart: '400M',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    error_file: '/home/opc/payment-agent-main/logs/error.log',
    out_file: '/home/opc/payment-agent-main/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
