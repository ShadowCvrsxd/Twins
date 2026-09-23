#!/bin/bash
# Add Cloudflare repo if missing
if [ ! -f /etc/apt/sources.list.d/cloudflare-client.list ]; then
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/cloudflare-client.list
    apt-get update
fi

apt-get install -y cloudflare-warp

# Setup warp
warp-cli registration new
warp-cli mode proxy
warp-cli proxy 40000
warp-cli connect

# Enable service
systemctl enable warp-svc
systemctl start warp-svc
echo "WARP installed and running in proxy mode on port 40000"
