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

echo "==> Installing Java 21 + Jenkins (native)"
# Jenkins LTS (2.5xx) requires Java 21; make it the default `java`.
apt-get install -y fontconfig openjdk-21-jre
update-alternatives --set java /usr/lib/jvm/java-21-openjdk-amd64/bin/java || true

if ! dpkg -s jenkins >/dev/null 2>&1; then
  install -m 0755 -d /usr/share/keyrings
  # Dearmor Jenkins' key, then also pull the repo's current signing key from a
  # keyserver (Jenkins rotates it and the .key file can lag → NO_PUBKEY).
  curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key \
    | gpg --dearmor -o /usr/share/keyrings/jenkins-keyring.gpg || true
  gpg --no-default-keyring --keyring /usr/share/keyrings/jenkins-keyring.gpg \
    --keyserver keyserver.ubuntu.com --recv-keys 7198F4B714ABFC68 || true
  chmod 644 /usr/share/keyrings/jenkins-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.gpg] \
https://pkg.jenkins.io/debian-stable binary/" \
    > /etc/apt/sources.list.d/jenkins.list
  apt-get update -y
  apt-get install -y jenkins
else
  echo "    jenkins already installed — skipping repo/key setup"
fi

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
[ -f /etc/deg/api.env ]   || echo "# fill me (see infra/droplet/api.env.example)" > /etc/deg/api.env
[ -f /etc/deg/deploy.env ]|| echo "API_DOMAIN=$(curl -s ifconfig.me | tr '.' '-').nip.io" > /etc/deg/deploy.env
# Jenkins runs `docker compose` (which reads env_file client-side) as the
# `jenkins` user, so it needs group-read on the secrets — but not world-read.
chown root:jenkins /etc/deg/api.env /etc/deg/deploy.env 2>/dev/null || true
chmod 640 /etc/deg/api.env /etc/deg/deploy.env

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
