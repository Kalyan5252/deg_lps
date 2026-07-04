#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu droplet to build + run the backend via Jenkins.
# Installs Docker, the Compose plugin, and native Jenkins (which drives docker
# on the host). Run as root on the droplet:  bash setup.sh
set -euo pipefail

echo "==> Updating apt + base tools"
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw

echo "==> Installing Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker --version
docker compose version || apt-get install -y docker-compose-plugin

echo "==> Installing Java + Jenkins (native)"
apt-get install -y fontconfig openjdk-17-jre
install -m 0755 -d /usr/share/keyrings
# Dearmor the signing key to a binary keyring (more reliable than armored .asc
# with signed-by; avoids the NO_PUBKEY error). Verify the download isn't empty.
rm -f /usr/share/keyrings/jenkins-keyring.asc /etc/apt/sources.list.d/jenkins.list
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key \
  | gpg --dearmor -o /usr/share/keyrings/jenkins-keyring.gpg
[ -s /usr/share/keyrings/jenkins-keyring.gpg ] || {
  echo "ERROR: Jenkins signing key failed to download"; exit 1; }
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.gpg] \
https://pkg.jenkins.io/debian-stable binary/" \
  > /etc/apt/sources.list.d/jenkins.list
apt-get update -y
apt-get install -y jenkins

echo "==> Letting Jenkins drive Docker"
usermod -aG docker jenkins
systemctl enable jenkins
systemctl restart jenkins

echo "==> Firewall (SSH, HTTP, HTTPS, Jenkins UI)"
ufw allow OpenSSH || true
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8080/tcp        # Jenkins web UI
yes | ufw enable || true

echo "==> Secrets scaffolding"
mkdir -p /etc/deg
[ -f /etc/deg/api.env ]   || { echo "# fill me (see infra/droplet/api.env.example)"   > /etc/deg/api.env;   chmod 600 /etc/deg/api.env; }
[ -f /etc/deg/deploy.env ]|| { echo "API_DOMAIN=$(curl -s ifconfig.me | tr '.' '-').nip.io" > /etc/deg/deploy.env; }

echo
echo "==================================================================="
echo " Jenkins is starting on http://$(curl -s ifconfig.me):8080"
echo " Initial admin password:"
echo "   $(cat /var/lib/jenkins/secrets/initialAdminPassword 2>/dev/null || echo '(not ready yet — wait ~30s then: cat /var/lib/jenkins/secrets/initialAdminPassword)')"
echo
echo " Next:"
echo "  1. Fill /etc/deg/api.env      (see infra/droplet/api.env.example)"
echo "  2. Check /etc/deg/deploy.env  (API_DOMAIN was auto-set to <ip>.nip.io)"
echo "  3. In Jenkins: create a Pipeline job from SCM -> this repo -> Jenkinsfile"
echo "==================================================================="
