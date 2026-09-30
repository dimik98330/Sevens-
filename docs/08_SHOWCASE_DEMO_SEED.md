# Add synthetic showcase examples through the public API

The hosted application starts without seeding or resetting its database. Existing
private submissions are not public until their authors consent to a separate
publication and a staff member approves the public text. An empty showcase with
HTTP 200 is therefore valid when there are no approved publications.

`scripts/seed-showcase-demo.mjs` adds four explicitly labelled demonstration
ideas: warm bus stops, pedestrian lighting, an accessible riverside route, and
village water supply. The four new synthetic citizen accounts use `example.test`
addresses and names beginning with `Демо-житель`. Ten support records and ten
follow records are created through the API. Counts come from the database.

The script uses only HTTP API calls. It never resets a database, changes account
passwords, edits unrelated submissions, or publishes their private content. The
existing synthetic `admin@example.test` account approves the public versions.
The script verifies this identity before creating any new account or idea.

Run a read-only preview:

```sh
node scripts/seed-showcase-demo.mjs --origin https://sevens-abai.onrender.com
```

For application, set `DEMO_PASSWORD` or `SHOWCASE_STAFF_PASSWORD` to the password
of the existing synthetic administrator using an environment file or your local
secret manager. Do not put the password in a command argument or source code.
An existing ignored environment file can be loaded directly by Node.js:

```sh
node --env-file=.env.sevens scripts/seed-showcase-demo.mjs --origin https://sevens-abai.onrender.com --apply
```

New synthetic-account credentials are derived in memory from that secret and
the origin. An optional `SHOWCASE_DEMO_PASSWORD` can instead supply a separate
stable secret for those accounts. Keep the same values on subsequent runs.
Passwords, cookies, and CSRF tokens are never included in the result.

The script is sequential, spaces calls by 180 ms, caps each run at 150 requests,
and stops on errors or rate limits. Each idea has a marker in its private text
for resuming without duplicates; the marker is absent from the public text.
Existing edited, withdrawn, or rejected examples cause the script to stop and
preserve the changes. Repeated support and follow calls are idempotent.
Only sessions created by the run are logged out at completion.

The public statuses describe demonstration workflow. The completed riverside
example uses `ANSWER_PROVIDED`, with an explicit explanation that construction
has not been confirmed. No example claims government delivery or completed
infrastructure work.

Check the script against an isolated in-memory database:

```sh
npm run routing:build
node --test tests/integration/backend/b12-showcase-demo-seed.test.mjs
```

The test checks publication consent and privacy rules, persistent API counts,
existing-account preservation, and repeated runs without duplicate ideas,
events, or replies. It never uses the hosted service or ambient `DATABASE_URL`.
