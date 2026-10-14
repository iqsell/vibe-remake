# vibe-remake

A Discord bot that runs a server for you. You talk to it, it does the boring stuff — makes channels, cleans them up, hands out roles, times people out, opens tickets, reads applications — and writes down what it did so you can go back and check.

## What it does

Mention it, reply to it, or drop a message in a channel you've marked as conversational, and it'll work out what you want and go do it. A few examples of the sort of thing it's meant to handle:

- "make a #welcome channel under the info category"
- "time out @someone for an hour, they're spamming"
- "who deleted #general?"
- "open a ticket for me"
- "set up a staff application panel in #apply"
- "rename all the voice channels to kebab-case"

It'll also just answer questions about the server — roles, permissions, audit log, member info — without changing anything.

## How it works

Roughly:

1. A message comes in. It's checked for whether it's actually aimed at the bot (bot messages, random chatter, and commands to other bots are ignored), then turned into a `Task`.
2. An intent classifier works out the gist. If it's too vague, it asks you a question instead of guessing.
3. The planner builds a short plan of steps, each one a tool call.
4. Before anything runs, every step goes through the policy engine: does the person have the right permissions, is the target above or below the bot in the role hierarchy, is it a protected channel or role, does it need confirmation?
5. The executor runs the steps, validates the output, and records each operation in the database.
6. If something needs approval it stops and asks first. Anything irreversible — bans, channel deletes, big purges — always asks.

The important part: the model never touches Discord directly. It only picks tools and fills in the arguments. Whether it's *allowed* is decided by plain code.

## Requirements

- Node 20+
- PostgreSQL (the schema uses array and JSON columns, so SQLite won't work)
- A Discord bot token with the privileged intents on (Server Members and Message Content, at minimum)
- At least one LLM API key

## Setup

```bash
git clone https://github.com/lizereride90/vibe-remake.git
cd vibe-remake
npm install
cp .env.example .env
# fill in .env
npx prisma generate
npx prisma migrate deploy   # use `migrate dev` while you're still hacking on it
npm run build
npm start
```

For development, `npm run dev` runs it straight from TypeScript and restarts on changes.

When the bot joins a server it creates a default `GuildConfig` row with empty role lists. Until you fill in the admin/moderator roles, it'll refuse most actions — by design. It won't let just anyone reshape your server.

## Configuration

Everything lives in environment variables. The ones that actually matter:

| Variable | What it's for |
| --- | --- |
| `DISCORD_TOKEN` | bot token |
| `DISCORD_CLIENT_ID` | app id |
| `DISCORD_CLIENT_SECRET` | app secret |
| `BOT_OWNER_ID` | your user id; the owner bypasses permission checks |
| `DATABASE_URL` | Postgres connection string |
| `PROVIDER_ORDER` | comma-separated provider fallback order |
| `DEFAULT_PROVIDER` | which provider to try first |
| `LOG_LEVEL` | `fatal` … `trace` |

Plus one API key per provider you care about: `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `NVIDIA_API_KEY`, `HF_API_KEY`. You only need one to get going — the router fails over between whatever you've configured.

There are a handful of feature flags too (`ENABLE_TICKETS`, `ENABLE_APPLICATIONS`, `ENABLE_AUTOMOD`, `ENABLE_CONVERSATIONAL_CHANNELS`) and the usual rate-limit knobs, all listed in `.env.example`.

## The tools

There are 65 of them, grouped by prefix:

- **discord.*** — read-only stuff: guild/member/channel/role info, member search, audit log, permission checks.
- **moderation.*** — timeouts, kick, ban, role changes, nicknames, message deletes, purge, slowmode, channel lock/unlock, and moderation cases with appeals.
- **server-design.*** — create/edit/delete/move channels and categories, inspect the layout, propose a new one, detect duplicate channels.
- **tickets.*** — open/claim/transfer/close/reopen tickets, add participants and notes, generate transcripts.
- **applications.*** — application panels with buttons, submissions, reviews, and decisions.
- **staff.*** — duty status, activity rollups, permission checks, role hierarchy, reports, reminders.

Every tool declares its own permission requirements, risk level, and whether it's read-only. Risk runs NONE → LOW → MEDIUM → HIGH → CRITICAL, and anything MEDIUM or up needs confirming from someone who isn't already a mod or admin.

## Project layout

```
src/
  app/           startup, shutdown, DI container
  agent/         the pipeline: intent -> plan -> execute
  ai/            provider gateway, router, failover, normalizers
  discord/       client, events, interactions, message policy
  policy/        authorization, risk scoring, hierarchy, approvals
  tools/         registry, schemas, and the handlers
  jobs/          background scheduler (reminders)
  db/            Prisma client
  observability/ logging
tests/           unit + contract tests (vitest)
prisma/          schema
```

## Tests

```bash
npm test
```

23 tests at the moment, mostly there to keep the tool surface honest — that every tool is registered, has a handler, valid schemas, and a unique name. Boring right up until someone adds a tool that quietly breaks the schema.

## Notes and rough edges

- **Postgres only.** `GuildConfig.adminRoles` and friends are native arrays, and there's JSON all over the place, so it genuinely won't run on SQLite — even if a stray `file:` URL makes it look like it might.
- **Migrations aren't committed yet.** Run `prisma migrate dev` and commit the generated `prisma/migrations` folder before you use this for anything real.
- **Prisma's engine needs a compatible OpenSSL.** On minimal/musl containers it can fail to load the query engine binary until you install OpenSSL 1.1. That's an environment problem, not the code.
- **Verification is stubbed.** After a mutation the executor records a verification operation, but it doesn't yet re-read Discord state to confirm the change actually stuck.
- **Deleting config doesn't nuke history.** Leaving a guild keeps the rows around in case you rejoin.

## License

MIT — see [LICENSE](LICENSE). Fork it, ship it, change it. A link back or a star is appreciated but not required.
