module.exports = {
  apps: [{
    name: 'payment-agent',
    cwd: __dirname,
    script: 'dist/server.js',
    env: {
      NODE_ENV: 'production',
      HEADLESS: 'true',
      PORT: '8123',
      NODE_OPTIONS: '--max-old-space-size=512'
    },
    max_memory_restart: '768M',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
