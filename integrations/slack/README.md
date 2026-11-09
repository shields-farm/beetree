# BeeTree on Slack

BeeTree answers in Slack over **Socket Mode**: the bridge opens an outbound
WebSocket to Slack, so nothing on the Mac Studio needs to be reachable from the
internet. No ngrok, no public URL, no inbound port.

Who can talk to it: anyone who can post in a channel the bot has been invited to.
There is no per-user allowlist — channel membership is the access control. Remove
the bot from the channel to revoke it.

## 1. Create the app (one click)

Open this URL in a browser signed into the workspace:

```
https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22BeeTree%22%2C%22description%22%3A%22Ask%20BeeTree%20about%20hives%2C%20sensors%2C%20inspections%20and%20what%20to%20do%20next.%22%2C%22background_color%22%3A%22%231f3d2b%22%7D%2C%22features%22%3A%7B%22bot_user%22%3A%7B%22display_name%22%3A%22BeeTree%22%2C%22always_online%22%3Atrue%7D%7D%2C%22oauth_config%22%3A%7B%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22chat%3Awrite%22%2C%22channels%3Ahistory%22%2C%22groups%3Ahistory%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22reactions%3Awrite%22%2C%22users%3Aread%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22bot_events%22%3A%5B%22app_mention%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%5D%7D%2C%22interactivity%22%3A%7B%22is_enabled%22%3Afalse%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Atrue%2C%22token_rotation_enabled%22%3Afalse%7D%7D
```

The manifest lives in `integrations/slack/manifest.json`. To regenerate the link
after editing it:

```
node -e "const m=require('fs').readFileSync('integrations/slack/manifest.json','utf8');console.log('https://api.slack.com/apps?new_app=1&manifest_json='+encodeURIComponent(JSON.stringify(JSON.parse(m))))"
```

## 2. Get the two tokens

| Token | Where | Looks like |
|---|---|---|
| App-level token | **Basic Information → App-Level Tokens → Generate**, scope `connections:write` | `xapp-…` |
| Bot token | **Install App → Install to Workspace**, then copy **Bot User OAuth Token** | `xoxb-…` |

Put them in `integrations/slack/.env` (gitignored):

```
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
```

## 3. Run it

```
~/beetree/integrations/slack/run.sh
```

It reads `BEETREE_API_KEY` from `server/.env` itself. `--selftest` checks only the
BeeTree side and needs no Slack tokens:

```
~/beetree/integrations/slack/run.sh --selftest "which hive needs attention?"
```

## 4. Invite it

In Slack: `/invite @BeeTree` in **#bee-ai-research**. Then `@BeeTree which hive
needs attention?` — or DM it. It replies in-thread and reacts 👀 → ✅.

## Behaviour notes

- Answers are non-streaming: the bot posts the finished text once. The web app
  streams because it renders tokens; Slack cannot.
- Follow-up questions in a thread get the last 8 channel messages as context, so
  "what about the other hive?" works — but BeeTree's own session store is the
  authority, not the Slack thread.
- Errors are posted as the error text, never swallowed: an upstream outage shows
  up as a message, not silence.
- `SLACK_CHANNELS=C123,C456` restricts the bot to specific channel IDs. Unset
  means any channel it has been invited to.

## Supervise it

`deploy/com.beebetree.slack.plist` runs the bridge under launchd and loads at
login. To start it now without a reload:

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.beebetree.slack.plist
```

Logs go to `integrations/slack/bridge.log`.
