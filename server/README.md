# Haru community server

Run from the repository root with Python 3.11 or later.

```sh
python3 server/server.py
```

Open [Haru on localhost](http://127.0.0.1:8000). The server delivers the web app and reads the shared seed quotes at startup. It creates its SQLite database automatically. Start a server to try shared accounts, submissions, votes, comments, and moderation.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `HARU_HOST` | `127.0.0.1` | Bind address |
| `HARU_PORT` | `8000` | HTTP port |
| `HARU_DB` | `server/haru.sqlite3` | SQLite database path. Create the parent directory first. |
| `HARU_SECURE_COOKIE` | `0` | Set to `1` when serving behind HTTPS. |

For a public instance, keep the Python server behind an HTTPS reverse proxy, enable secure cookies, rate-limit authentication and write requests at the proxy, and keep the SQLite database on a persistent local volume outside the web directory. Use SQLite's online backup mechanism to capture changes while the service runs. Protect both the database and its backups as private server data.

Register the account through the web app first, then run the following command on the server with the same `HARU_DB` setting. Only operators with write access to the database can grant admin access.

```sh
python3 server/server.py --grant-admin '계정 이름'
```

Daily selection uses the calendar date in Korea Standard Time. Each account can submit one quote per date. Quotes enter rotation the following day. When eligible community quotes and seeds are available, the first daily slot alternates between them, with seeds filling the remaining slots when possible. The daily choices are stored on the first request for that date.

Hiding a quote or deleting its author's account removes the quote from public view. A visible seed fills the open daily slot when one is available. The daily endpoint returns up to three quotes, and an empty list means there are no eligible public quotes. Treat short and empty successful daily responses as authoritative. The server's `/seeds.json` feed also omits hidden seeds.

The moderation queue includes visible quotes with at least one report, or with at least three dislikes, at least twice as many dislikes as likes, and at least three more dislikes than likes. Reported quotes appear first. Hidden quotes and unreported quotes that fall below the dislike threshold leave the active queue.

Users can delete their account by sending their password to `DELETE /api/me` or `POST /api/delete-account` as JSON. Deletion removes the account's sessions, submissions, comments, votes, and reports.

```sh
python3 -m unittest discover -s server
```

## Public web deployment

Build the container from the repository root and mount the named volume for SQLite.

```sh
docker build -t haru .
docker run -d --name haru --restart unless-stopped -p 127.0.0.1:8000:8000 -v haru-data:/data haru
```

Point your HTTPS reverse proxy to port 8000 on the host. The root URL accepts public visitors. To bootstrap the administrator, sign up through the public site and run the following on the host.

```sh
docker exec haru python server/server.py --grant-admin '계정 이름'
```

Open `/admin` using the same origin and sign in with the administrator account. The server checks that role on every dashboard read and management action. The dashboard shows the same Seoul-date selection as the public web and connected widgets, alongside member status, submissions, default quotes, reports and activity totals. Members can review all their submissions and responses through the account menu.
