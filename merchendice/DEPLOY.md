# Deploy Merchendice on Contabo

This copy runs on your private server. It has no OpenAI hosting dependency and contains no live credentials. It includes the homepage, the storefront directory at `/examples/`, the CREATOR storefront example at `/example-store/`, and the enquiry page at `/enquiry/`.

## 1. Server requirements

Use a Linux VPS with Docker Engine and the Docker Compose plugin installed. You need SSH access, a reverse proxy handling HTTPS, and outbound HTTPS (port 443). Gmail SMTP mode also needs outbound port 465. Keep your existing SSH port allowed in both the server firewall and any Contabo firewall.

The reference repository uses port 82 behind an existing reverse proxy. The default `compose.yaml` matches that layout and publishes the app on **127.0.0.1:82**. Route the domain through the existing proxy to that address. A loopback address prevents visitors from bypassing HTTPS and your proxy's client-IP handling. If the proxy is itself in Docker, put the proxy and app on a shared Docker network and route to the app's port 3000; another container cannot reach the host's loopback address directly.

For a fresh server, the optional `compose.https.yaml` adds Caddy on ports 80/443. Use it only when those ports are free.

## 2. Upload the project

Extract `merchendice-contabo.zip` on your own computer. Copy the `merchendice-contabo` directory to a private directory on the VPS, for example `/opt/merchendice`. Do not upload credentials to GitHub or this chat.

On the VPS, open the project directory and create the private configuration:

```sh
cd /opt/merchendice
cp .env.example .env
chmod 600 .env
nano .env
```

Keep `SITE_HOSTNAME=merchendice.com`, `PUBLIC_ORIGIN=https://merchendice.com`, `APP_PORT=82`, and `MAIL_TO=merchendices@gmail.com`. Enter the chosen email provider's settings below. `PUBLIC_ORIGIN` is important: it makes the form work behind the HTTPS reverse proxy without trusting arbitrary forwarded host headers.

## 3. Configure enquiry delivery

The server always sends to `MAIL_TO`; visitors cannot choose a recipient. The submitter's email becomes Reply-To. The email address and credentials are not included in the website responses.

### Composio mode (default)

1. Open [your Composio project](https://dashboard.composio.dev/). Connect the Gmail account you want the website to send from using Composio's secure OAuth connection flow.
2. In that same project, find its API key and the actual Gmail connected-account ID. A connection alias from a chat plugin is not a substitute for the connected-account ID in your own project.
3. Enter these values directly into the server's private `.env`:

```dotenv
EMAIL_PROVIDER=composio
COMPOSIO_API_KEY=your-project-api-key
COMPOSIO_CONNECTED_ACCOUNT_ID=your-gmail-connected-account-id
COMPOSIO_FROM_EMAIL=merchendices@gmail.com
```

`COMPOSIO_FROM_EMAIL` must match the Gmail account you connected, or a verified Gmail sending alias. The destination remains `MAIL_TO=merchendices@gmail.com` whichever sender you use.

The backend uses Composio's [documented proxy endpoint](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy) to send a Gmail message with Reply-To. It checks both the upstream status and the Gmail message receipt before claiming success. Your Gmail OAuth credentials stay with Composio; the server stores only the Composio project key and account ID.

### Enquiry rate limits

In `server.mjs`, each IP address can send 2 enquiries per hour (`ENQUIRY_LIMIT`). Only enquiries the email provider confirms count, so a form error, an oversized message, a spam-trap hit or a failed delivery doesn't use one up. Separately, every POST to the form counts toward an abuse cap of 20 per hour per IP (`ENQUIRY_RAW_LIMIT`), so the form can't be hammered. Both answer with a 429 and a `Retry-After` header. Behind the proxy, set `TRUST_PROXY=1` (as `compose.yaml` does) so the limits use the visitor's `X-Real-IP` rather than the proxy's address. The proxy must set `X-Real-IP` itself (overwriting any value the visitor sends), as the snippets in `deploy/` and the `Caddyfile` do, and the app's port must stay bound to `127.0.0.1` so nobody can reach it without the proxy. An IPv4 address counts on its own; an IPv6 address counts by its /64 network, since one connection is usually given a whole /64. Counts live in memory only and are dropped after about an hour.

### Gmail SMTP mode (matches the reference repository)

The reference [Rigoluso/Merchendices repository](https://github.com/Rigoluso/Merchendices/blob/75c73aae10f1a304fae16b1b21156694730e22aa/mail-api/server.mjs) uses Gmail SMTP with Nodemailer. It does not use Composio or Resend. This package preserves that account/password approach, the business inbox, Reply-To, validation, and rate limiting while adapting it to your current form. Its mail library is updated from the reference version.

Enable Google 2-Step Verification on the sending Gmail account, then create an [app password](https://myaccount.google.com/apppasswords). Put it directly into the VPS's private `.env`:

```dotenv
EMAIL_PROVIDER=smtp
SMTP_USER=merchendices@gmail.com
SMTP_APP_PASSWORD=your-google-app-password
MAIL_TO=merchendices@gmail.com
```

Use an app password, not your usual Gmail password. Some Google account policies do not permit app passwords; in that case use Composio mode. No Resend key or Resend domain-verification records are needed for either Gmail mode. Existing email records can stay in place.

## 4. Point your domain at the VPS

In STRATO, open Domains → Domainverwaltung → the gear beside `merchendice.com` → DNS. See [STRATO's DNS instructions](https://www.strato.de/faq/domains/wie-kann-ich-bei-strato-meine-dns-eintraege-verwalten/).

- Set the apex (`@`/root) **A** record to your Contabo server's public IPv4 address. Replace the website's current apex A target when you are ready to switch traffic.
- Set **www** as a CNAME pointing to `merchendice.com`, or an A record pointing to the same VPS address.
- If there is an existing **AAAA** record, update it to the VPS's working IPv6 address or remove that obsolete website record so visitors do not reach the old server.
- Preserve existing MX/mail records. Website A/AAAA changes and email MX records serve different purposes.

Do not use OpenAI's IP addresses or site-verification records for this deployment. If the domain already points to this Contabo server, no website DNS change is needed. The existing proxy should handle the certificate and www redirect. The optional Caddy overlay does those jobs automatically on a fresh server once DNS and ports 80/443 are reachable.

## 5. Start the site

If port 82 is occupied by your old Merchendice site, keep its project and private settings for rollback, then stop only that old website app when you are ready to switch. Keep your server's existing reverse proxy running. The new Compose project is named `merchendice-contabo` to avoid replacing unrelated containers.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app
curl http://127.0.0.1:82/healthz
```

Configure your existing proxy to send this domain to `http://127.0.0.1:82` and pass the real client IP in `X-Real-IP`. A location snippet is provided in `deploy/nginx-location.conf`; keep your current TLS certificate settings. For a Caddy proxy running directly on the host, use `reverse_proxy 127.0.0.1:82` in the existing site's block.

If the existing reverse proxy is itself a Docker container, find its current network with `docker network ls` and the proxy's container configuration. Set `PROXY_NETWORK_NAME` in `.env` to that actual network, then start the app using:

```sh
docker compose -f compose.yaml -f compose.proxy-network.yaml config --quiet
docker compose -f compose.yaml -f compose.proxy-network.yaml up -d --build
```

In that proxy, route the domain to `merchendice-contabo:3000`. The overlay attaches the app to your existing proxy network with that alias. Keep the app's port 3000 private; it is not published on the VPS's public interface.

On a fresh server, use the HTTPS overlay instead:

```sh
docker compose -f compose.yaml -f compose.https.yaml config --quiet
docker compose -f compose.yaml -f compose.https.yaml up -d --build
docker compose -f compose.yaml -f compose.https.yaml logs --tail=50 app caddy
```

Use `config --quiet`; the full `docker compose config` output can include your private settings. Open `https://merchendice.com` and check `/examples/`, `/example-store/`, and `/enquiry/`. Then submit your own enquiry through the form and confirm it reaches the configured inbox. No test emails are sent during build or automated tests.

If the form says enquiries are unavailable, the selected mail provider's key/account/password is missing. If it cannot confirm sending, check the provider/account configuration and outbound connectivity. The form preserves entered details on error. The server accepts at most five enquiry attempts per client per ten minutes; the counter resets on restart and is intended for a single app instance.

## HTTPS, HSTS and HTTP redirects

TLS ends at the reverse proxy (Nginx Proxy Manager), and the app only sees plain HTTP from it. The app handles HTTPS like this:

- **HSTS:** in production (`NODE_ENV=production`) with an `https://` `PUBLIC_ORIGIN`, every response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains`. It is never sent when the request's host is `localhost` or `127.0.0.1`, so local previews are unaffected. Set `HSTS=0` to turn it off. `includeSubDomains` means every subdomain, including `www`, must serve valid HTTPS before you deploy this. Fix the `www` certificate in Nginx Proxy Manager first.
- **HTTP to HTTPS redirect:** with `TRUST_PROXY=1` (already set in `compose.yaml`), a request that the proxy marks `X-Forwarded-Proto: http` gets a 301 to the same path on `PUBLIC_ORIGIN`. Requests with `X-Forwarded-Proto: https` or no header at all, such as direct health checks, are served normally, so this cannot loop. It is off outside production and for localhost. Set `FORCE_HTTPS=0` to turn it off.
- In Nginx Proxy Manager, turning on **Force SSL** for the proxy host does the same redirect at the proxy, before the app is reached. Use either or both. Also make sure the proxy host forwards `X-Forwarded-Proto` (Nginx Proxy Manager does this by default).
- **www must redirect to the apex domain at the proxy.** The enquiry form only accepts submissions whose browser `Origin` matches `PUBLIC_ORIGIN` (`https://merchendice.com`). A visitor who stays on `https://www.merchendice.com` would get "Please submit the form from this website." In Nginx Proxy Manager, add `www.merchendice.com` as a **Redirection Host** that sends a 301 to `https://merchendice.com` (preserve path, Force SSL on, with its own certificate). Do not serve the site on both names.

## HTTP and www redirects in Nginx Proxy Manager

Do not apply this on the live server until Oscar says to go live. The notes below are the exact proxy change. They sit alongside the app-side safety nets already in this repo.

### What is going wrong

Plain `http://merchendice.com` has been reported as returning 500. The Node app is not the source of that status: a GET of `/` in production either returns 200 or, when the trusted proxy sends `X-Forwarded-Proto: http`, a 301 to `https://merchendice.com/` (see "HTTPS, HSTS and HTTP redirects" above). It does not return 500 for that request.

`https://merchendice.com` already serves the site. `https://www.merchendice.com` already returns a 301 to `https://merchendice.com/` at the proxy. So the gap is port 80: HTTP for the apex and for www is failing before a 301 can be issued.

A 500 on port 80 is almost always Nginx Proxy Manager (or something in front of it), for example Force SSL left off, an HTTP server block that is missing or broken, or a redirect loop that OpenResty aborts as 500. The fix is to 301 HTTP to HTTPS at the proxy, and to 301 www to the apex, before the app has to get involved.

### What the app already does (safety net only)

These run only after a request reaches the app, and only in production. They do not replace the proxy setup.

- If `TRUST_PROXY=1` and the proxy sends `X-Forwarded-Proto: http`, `server.mjs` 301s to the same path and query on `PUBLIC_ORIGIN` (`https://merchendice.com`). Requests with no such header, including `/healthz`, are not redirected, so this cannot loop.
- If the `Host` header is `www.merchendice.com` (or `www.` plus the hostname of `PUBLIC_ORIGIN`), `server.mjs` 301s to the same path and query on the HTTPS apex, in one hop. This is a safety net in case a www request is accidentally proxied to the app instead of the redirection host below.

Files touched: `server.mjs` (the two 301s), `tests/hosting.test.mjs` (coverage for both). Nothing in `compose.yaml` or `.env` needs to change; `TRUST_PROXY=1` and `PUBLIC_ORIGIN=https://merchendice.com` are already correct.

### Apex proxy host: force HTTP to HTTPS

In Nginx Proxy Manager, open **Hosts → Proxy Hosts** and edit the `merchendice.com` host (the one that already forwards to the Merchendice app at `127.0.0.1:82`, or `merchendice-contabo:3000` if the proxy is on a Docker network).

1. **Details.** Domain Names: `merchendice.com` only. Do not also list `www.merchendice.com` here; www has its own redirection host below. Scheme `http`, forward hostname and port as they are now. Websockets can stay off.
2. **SSL.** Select a certificate that covers `merchendice.com`. Tick **Force SSL**. Tick **HTTP/2 Support**. You can tick **HSTS Enabled** as well; the app already sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` in production, so either is enough, but both must use a certificate that also covers `www` before HSTS `includeSubDomains` is safe. Tick **Force SSL** even if HSTS is already on: Force SSL is what answers port 80 with a 301 rather than a 500.
3. Confirm the proxy forwards `X-Forwarded-Proto` (Nginx Proxy Manager does this by default). The snippet in `deploy/nginx-location.conf` sets `X-Forwarded-Proto $scheme`, `Host $host` and `X-Real-IP $remote_addr`.

Force SSL is usually enough. If port 80 still does not 301, add this to the apex host's **Advanced → Custom Nginx Configuration**. It issues the 301 at the proxy and keeps the path and query:

```nginx
if ($scheme = http) {
    return 301 https://merchendice.com$request_uri;
}
```

Files touched when this is applied on the server (not applied now): the merchendice.com Proxy Host in Nginx Proxy Manager (Force SSL, and optionally the Advanced box). No container rebuild is required.

### www redirection host: 301 to the HTTPS apex

`https://www.merchendice.com` already 301s to the apex. HTTP www still needs the same treatment, with a certificate that covers www.

In Nginx Proxy Manager, open **Hosts → Redirection Hosts**. If `www.merchendice.com` is already there, edit it; otherwise add a host.

1. **Details.** Domain Names: `www.merchendice.com`. Forward Domain: `merchendice.com`. Scheme: `https`. Tick **Preserve Path** (this keeps `$request_uri`, path and query). HTTP Code: **301 Permanent**.
2. **SSL.** Request or select a certificate that covers `www.merchendice.com`. A single Let's Encrypt certificate for both `merchendice.com` and `www.merchendice.com` is best, and can be reused on the apex proxy host. Tick **Force SSL**, so `http://www.merchendice.com/guides/?ref=1` 301s to `https://merchendice.com/guides/?ref=1` rather than failing on port 80.

If you would rather keep www as a Proxy Host instead of a Redirection Host, do not forward www to the app. Put only this in that host's Advanced box (still with a www certificate and Force SSL):

```nginx
return 301 https://merchendice.com$request_uri;
```

Do not serve the site on both names. The enquiry form only accepts an `Origin` of `https://merchendice.com`.

Files touched when this is applied on the server (not applied now): the www.merchendice.com Redirection Host (or Proxy Host Advanced box) and the certificate that covers www. No app or Compose change.

### Optional Caddy overlay (fresh servers only)

The optional `Caddyfile` already 301s `www` to `https://{$SITE_HOSTNAME}{uri}` and Caddy automatically 301s HTTP to HTTPS on the apex. It also sends `X-Robots-Tag: noindex` for `/example-store/` and `/example-store/*`. Production uses Nginx Proxy Manager, not this overlay.

## Log retention (30 days)

The Privacy notice says server and proxy logs are deleted after 30 days. Match that wherever the logs live:

- **App container:** it logs only start-up lines and errors, never visitor IPs. `compose.yaml` caps them with Docker's `json-file` options (3 × 10 MB); Docker cannot rotate by age.
- **Caddy overlay:** the `Caddyfile` writes access logs to `/data/logs/access.log` and deletes rolled files after 720 hours (30 days).
- **Plain nginx host:** install `deploy/logrotate-merchendice` as `/etc/logrotate.d/merchendice` (daily, 30 kept, `maxage 30`).
- **Nginx Proxy Manager (production):** its rotation is not in this repo. It runs logrotate inside its own container for the logs under its `/data/logs` volume. At deploy time, check that config (`/etc/logrotate.d/nginx-proxy-manager` inside the container) and set the proxy-host access and error logs to `daily`, `rotate 30`, `maxage 30`, or turn access logging off for the merchendice.com proxy host. Re-check after NPM upgrades, which can reset it.

## Local preview

Outside production you don't need `PUBLIC_ORIGIN`. The server uses the address it listens on (`HOST`, default `127.0.0.1`, and `PORT`, default `3000`) and accepts form posts from `http://localhost:PORT`, `http://127.0.0.1:PORT` and `http://[::1]:PORT`. Run `npm run build` then `PORT=3000 HOST=127.0.0.1 node server.mjs`.

## Updates and operations

After changing source or `.env`, run the same Compose command used to start your deployment with `up -d --build`. Keep `.env` private. Stop this deployment with the matching Compose command and `down`. If you use the Caddy overlay, preserve its data volume across updates so certificate state is retained; do not add `-v` to the stop command.

For local testing with Node 24+ instead of Docker:

```sh
npm ci
npm run build
PUBLIC_ORIGIN=http://localhost:3000 npm start
```

On Windows PowerShell, set `$env:PUBLIC_ORIGIN='http://localhost:3000'` before `npm start`. Production always needs the actual HTTPS origin. The default direct Node listener is loopback; Docker sets it to `0.0.0.0` inside the private container network.
