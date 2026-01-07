module.exports = {
  apps: [{
    name: 'theagency-url-slugs',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    exp_backoff_restart_delay: 1000,
    restart_delay: 3000,
    max_restarts: 50,
    min_uptime: '10s',
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    time: true
  }]
}
