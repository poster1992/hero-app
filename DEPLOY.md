# Deployment (VPS + Docker + HTTPS)

Die App läuft als Docker-Container hinter **Caddy** (automatisches HTTPS via Let's Encrypt).
Persistente Daten: manuelle Belege liegen im Docker-Volume `belege`. Die MySQL-Datenbank
läuft weiter bei all-inkl (extern), HERO und die KI laufen über deren APIs.

## 1. Server mieten (Hetzner Cloud)

- **Hetzner Cloud → CX22** (2 vCPU, 4 GB RAM, 40 GB SSD) genügt für Start und Build.
- Image: **Ubuntu 24.04 LTS**, Standort z. B. Nürnberg/Falkenstein.
- SSH-Key beim Erstellen hinterlegen.
- Optional: Hetzner-Firewall – eingehend nur **22 (SSH)**, **80**, **443** erlauben.

## 2. Domain verbinden

Bei deinem Domain-Anbieter einen **A-Record** auf die Server-IPv4 setzen
(und optional **AAAA** auf die IPv6), z. B. `app.deine-domain.de → <Server-IP>`.
DNS muss aktiv sein, bevor Caddy das Zertifikat holt.

## 3. all-inkl: Fernzugriff auf MySQL erlauben

Im KAS (all-inkl) beim DB-Benutzer den **Fernzugriff** aktivieren und die
**Server-IP** freigeben – sonst kann der Container die DB nicht erreichen.

## 4. Docker installieren

```sh
ssh root@<Server-IP>
curl -fsSL https://get.docker.com | sh
```

## 5. Projekt holen und konfigurieren

```sh
git clone https://github.com/poster1992/hero-app.git
cd hero-app
cp .env.example .env
nano .env        # alle Werte ausfüllen (siehe unten)
```

Wichtige `.env`-Werte:
- `DOMAIN`, `ACME_EMAIL` – für HTTPS.
- `AUTH_SECRET` – langer Zufallswert: `openssl rand -base64 48`
- `APP_URL=https://<DOMAIN>`
- `MYSQL_*` – die all-inkl-Zugangsdaten (Passwort in `'...'` setzen, falls Sonderzeichen).
- `HERO_API_TOKEN`, `ANTHROPIC_API_KEY` (optional), `SMTP_*`.

## 6. Starten

```sh
docker compose up -d --build
docker compose logs -f       # Build/Start beobachten
```

Caddy holt automatisch das TLS-Zertifikat. Danach ist die App unter
`https://<DOMAIN>` erreichbar.

## 7. Datenbank-Tabellen

Wird die **bestehende** all-inkl-Datenbank genutzt, sind alle Tabellen schon da –
nichts zu tun. Nur bei einer **frischen** DB einmalig die Setup-Skripte ausführen
(lokal mit gefüllter `.env`, Node 20+):

```sh
for f in scripts/db-*.mjs; do node "$f"; done
```

## Updates einspielen

```sh
cd hero-app
git pull
docker compose up -d --build
```

## Backup

- **Datenbank:** über all-inkl (KAS) sichern.
- **Belege:** Docker-Volume sichern, z. B.
  `docker run --rm -v hero-app_belege:/d -v $PWD:/b alpine tar czf /b/belege-backup.tgz -C /d .`

## Hinweise

- Logs: `docker compose logs -f app`
- Neustart: `docker compose restart`
- Stoppen: `docker compose down` (Volumes/Daten bleiben erhalten).
