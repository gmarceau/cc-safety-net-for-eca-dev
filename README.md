# cc-safety-net for ECA

An [ECA](https://eca.dev) `preToolCall` hook that blocks dangerous shell
commands using [cc-safety-net](https://github.com/kenryu42/cc-safety-net) —
destructive operations (`rm -rf ~`, `git rm -f`), secret-file access
(`~/.aws/credentials`, `.env`), including when nested in `bash -c "..."`.
Blocked commands are explained to the LLM so it can suggest a safe alternative.

The hook only blocks; allowed commands still go through ECA's normal approval.

## Install

Requires Node.js 22.18+

```sh
git clone https://github.com/gmarceau/cc-safety-net-for-eca-dev.git ~/code/cc-safety-net-for-eca-dev
cd ~/code/cc-safety-net-for-eca-dev
npm install
```

If node is not at `/opt/homebrew/bin/node`, edit the path in `run.sh`.

## Configure ECA

Add to `~/.config/eca/config.json`, then restart ECA:

```json
"hooks": {
  "cc-safety-net": {
    "type": "preToolCall",
    "matcher": "eca__shell_command",
    "visible": false,
    "actions": [
      { "type": "shell", "file": "/Users/YOU/code/cc-safety-net-for-eca-dev/run.sh" }
    ]
  }
}
```


## Troubleshooting

If every shell command gets blocked, the hook is probably broken (e.g.
`node_modules` missing — run `npm install`). To recover, remove the `hooks` block from
`config.json` (file editing still works) and restart ECA.

Check the hook by hand:

```sh
echo '{"tool_input":{"command":"rm -rf ~"}}' | ./run.sh   # prints a deny
echo '{"tool_input":{"command":"git status"}}' | ./run.sh # prints nothing
```

## Development

```sh
npm test            # run tests (rstest)
npm run typecheck   # type-check (tsc)
```
