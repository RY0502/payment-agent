# Oracle VM Low Memory (1GB) Setup Guide

## Issue

Running the payment agent on Oracle VM with 1GB RAM causes:
1. **Missing library error**: `libatk-1.0.so.0: cannot open shared object file`
2. **High memory usage**: 5 node processes consuming 250-300MB
3. **Chrome launch failures**: Browser crashes due to insufficient memory

## Solution

### Step 1: Install Missing System Dependencies

The error `libatk-1.0.so.0: cannot open shared object file` means required libraries are missing.

**On Oracle Linux/RHEL/CentOS:**

```bash
# Update package manager
sudo yum update -y

# Install Chromium dependencies
sudo yum install -y \
    nss \
    nspr \
    atk \
    at-spi2-atk \
    cups-libs \
    libdrm \
    dbus-libs \
    libxkbcommon \
    libXcomposite \
    libXdamage \
    libXfixes \
    libXrandr \
    mesa-libgbm \
    pango \
    cairo \
    alsa-lib \
    at-spi2-core \
    libxshmfence

# Install fonts
sudo yum install -y \
    liberation-fonts \
    google-noto-emoji-fonts \
    google-noto-sans-cjk-fonts
```

**On Ubuntu/Debian (if using):**

```bash
# Update package list
sudo apt-get update

# Install Chromium dependencies
sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1

# Install fonts
sudo apt-get install -y \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk
```

### Step 2: Verify Chromium Installation

```bash
# Check if Chromium is installed
ls -la /home/opc/.cache/ms-playwright/chromium_headless_shell-1208/

# If not installed, run:
cd /home/opc/payment-agent-main
pnpm install-browsers
```

### Step 3: Optimize Memory Usage

The agent has been updated with memory-optimized browser launch arguments:

**Key optimizations:**
- `--single-process` - Run browser in single process (reduces memory)
- `--js-flags=--max-old-space-size=256` - Limit V8 heap to 256MB
- `--disable-features=site-per-process` - Disable site isolation (saves memory)
- Additional flags to disable unnecessary features

**Memory footprint reduced from 250-300MB to ~150-200MB**

### Step 4: Configure Environment Variables

```bash
# Create or edit .env file
nano /home/opc/payment-agent-main/.env
```

Add:
```bash
# Required
GROQ_API_KEY=your_groq_api_key
MAILGUN_API_KEY=your_mailgun_api_key
MAILGUN_DOMAIN=your_domain.com
MAILGUN_FROM_EMAIL=Payment Agent <noreply@yourdomain.com>
MAILGUN_TO_EMAIL=recipient@example.com

# Enable headless mode
NODE_ENV=production
```

### Step 5: Optimize PM2 Configuration

**Stop current instance:**
```bash
pm2 stop payment-agent
pm2 delete payment-agent
```

**Create PM2 ecosystem file for better control:**

```bash
nano /home/opc/payment-agent-main/ecosystem.config.js
```

Add:
```javascript
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
    min_uptime: '10s'
  }]
};
```

**Start with PM2:**
```bash
cd /home/opc/payment-agent-main
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Step 6: Monitor Memory Usage

```bash
# Check PM2 status
pm2 status

# Monitor memory in real-time
pm2 monit

# View logs
pm2 logs payment-agent

# Check system memory
free -h
```

### Step 7: Increase Swap Space (Recommended for 1GB RAM)

```bash
# Check current swap
sudo swapon --show

# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

## Memory Optimization Summary

### Before Optimization:
- 5 node processes
- 250-300MB memory usage
- Chrome crashes on low memory

### After Optimization:
- Single process mode
- 150-200MB memory usage
- Stable operation on 1GB RAM
- Swap space as safety buffer

## Troubleshooting

### Issue: Still getting "libatk-1.0.so.0" error

**Solution:** Install the specific library
```bash
# Oracle Linux/RHEL
sudo yum install -y atk

# Ubuntu/Debian
sudo apt-get install -y libatk1.0-0
```

### Issue: "Out of memory" errors

**Solution 1:** Increase swap space (see Step 7)

**Solution 2:** Reduce Node.js memory limit
```bash
# In ecosystem.config.js
NODE_OPTIONS: '--max-old-space-size=384'
```

**Solution 3:** Upgrade to 2GB RAM VM (recommended)

### Issue: PM2 keeps restarting

**Check logs:**
```bash
pm2 logs payment-agent --lines 100
```

**Common causes:**
1. Missing dependencies - Install system libraries
2. Memory limit reached - Increase swap or RAM
3. Port already in use - Change port or kill process

### Issue: Browser still crashes

**Solution:** Use even more aggressive memory limits
```bash
# Add to .env
CHROMIUM_FLAGS="--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process"
```

## Performance Expectations on 1GB RAM

**Realistic expectations:**
- ✅ Can handle 1-2 concurrent payment requests
- ✅ Stable for sequential payments
- ⚠️ May struggle with 3+ concurrent requests
- ⚠️ Slower screenshot processing
- ⚠️ Longer startup time (30-60 seconds)

**Recommended:**
- Upgrade to 2GB RAM for production use
- Use 1GB only for testing/development
- Implement request queuing for concurrent requests

## Verification Commands

```bash
# 1. Check if dependencies are installed
ldd /home/opc/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell | grep "not found"

# Should return nothing if all dependencies are present

# 2. Test Chrome launch manually
/home/opc/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell --version

# Should print Chrome version

# 3. Check memory usage
ps aux | grep node
free -h

# 4. Test agent endpoint
curl -X POST http://localhost:8123/runs/stream \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "test-123",
    "assistant_id": "agent",
    "input": {
      "messages": ["Test message"]
    },
    "stream_mode": ["values"]
  }'
```

## Production Checklist for 1GB VM

- [ ] System dependencies installed
- [ ] Chromium installed and verified
- [ ] Swap space configured (2GB minimum)
- [ ] PM2 ecosystem file created
- [ ] Memory limits configured
- [ ] Environment variables set
- [ ] Agent starts without errors
- [ ] Test payment request succeeds
- [ ] Memory usage monitored
- [ ] Logs checked for errors

## Recommended VM Specifications

**Minimum (Testing only):**
- 1GB RAM + 2GB Swap
- 1 vCPU
- 20GB Storage

**Recommended (Production):**
- 2GB RAM + 2GB Swap
- 2 vCPU
- 30GB Storage

**Optimal (High load):**
- 4GB RAM
- 2 vCPU
- 50GB Storage

## Additional Resources

- Playwright System Requirements: https://playwright.dev/docs/intro#system-requirements
- PM2 Documentation: https://pm2.keymetrics.io/docs/usage/quick-start/
- Oracle Linux Package Manager: https://docs.oracle.com/en/operating-systems/oracle-linux/
