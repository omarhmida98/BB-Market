/**
 * PM2 ecosystem config - alternative to the systemd unit.
 *
 * Only use this if you already run PM2 on the VPS. systemd is the better choice
 * here: it starts before login, integrates with `journalctl`, and needs no extra
 * global install.
 *
 *   pm2 start deploy/ecosystem.config.cjs --env production
 *   pm2 save
 *   pm2 startup          # run the printed command once as root
 *
 * PM2's own restart behaviour does not survive a reboot unless you run
 * `pm2 save` + `pm2 startup`, which is why systemd is preferred.
 */
module.exports = {
  apps: [
    {
      name: "bb-market",
      script: "dist/server/index.js",
      cwd: "/var/www/bb-market",

      // Matches the systemd unit: loopback only, because Nginx is the only
      // thing that should reach this port.
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "5000",
      },

      // One instance is correct: the session store is in-memory, so scaling to
      // multiple processes would log users out at random as requests hit
      // different processes. Use a shared store (Redis / PostgreSQL) before
      // ever raising instances above 1.
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",
      restart_delay: 5000,

      // Give Node room and stop it draining in-flight requests on reload.
      max_memory_restart: "700M",
      kill_timeout: 30000,
      listen_timeout: 8000,
      wait_ready: false,

      out_file: "/var/log/pm2/bb-market-out.log",
      error_file: "/var/log/pm2/bb-market-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
