# cc-safety-net for ECA

An [ECA](https://eca.dev) `preToolCall` hook that delegates shell-command
safety decisions to [cc-safety-net](https://github.com/kenryu42/cc-safety-net).

Before ECA runs any shell command, this hook analyses it and blocks dangerous
ones — destructive filesystem operations (`rm -rf /`), secret-file access
(`~/.aws/credentials`, `.env`, SSH keys), and more. Unlike regex-based
approval rules, cc-safety-net actually parses the command: it unwraps
`bash -c "..."` and similar nesting (up to 10 levels), so wrapping or
reordering flags can't smuggle a dangerous command past it.

Blocked commands return an explanation to the LLM, so it can tell you what it
was trying to do and suggest a safe alternative.

## How it works

```
ECA preToolCall hook
  └─ run.sh           (POSIX shell entry point — ECA runs "file" hooks via the system shell)
       └─ check.mjs   (reads hook JSON on stdin, calls checkCommand())
            └─ cc-safety-net  (parses & analyses the command string; never executes it)
```

**ECA hook protocol** (`preToolCall`):

- ECA pipes a JSON object to stdin; the shell command is at `tool_input.command`.
- Exit 0 with no output → **allow** (ECA's own approval flow continues — the
  user still gets the interactive `ask` prompt).
- Print `{"approval": "deny", "additionalContext": "..."}` → **deny**, with
  the explanation forwarded to the LLM.

**Security model: fail-closed.** Any unexpected condition — malformed input,
missing command string, cc-safety-net failing to load or analyse — results in
a deny, never an allow. A broken safety hook must not silently disable itself.

## Prerequisites

- Node.js 18+ (cc-safety-net is ESM-only)
- ECA with hooks support

## Install

```sh
git clone <this-repo> ~/code/cc-safety-net-for-eca-dev
cd ~/code/cc-safety-net-for-eca-dev
npm install
chmod +x run.sh
```

If your node is not at `/opt/homebrew/bin/node`, edit the path in `run.sh`
(`which node` to find it — an absolute path is used because a GUI-launched
editor may have a minimal `PATH`).

## ECA configuration

Add to `~/.config/eca/config.json`:

```json
"hooks": {
  "cc-safety-net": {
    "type": "preToolCall",
    "matcher": "eca__shell_command",
    "visible": false,
    "description": "Block destructive shell commands via cc-safety-net",
    "actions": [
      { "type": "shell", "file": "/Users/YOU/code/cc-safety-net-for-eca-dev/run.sh" }
    ]
  }
}
```

**Important:**

- Point the hook at **`run.sh`, not `check.mjs`**. ECA executes `file` hook
  actions through the system shell; pointing it directly at the `.mjs` makes
  the shell parse JavaScript, the hook crashes, and ECA fails closed —
  blocking *every* shell command.
- Use an absolute path.
- **Restart ECA after changing hook config** — hooks are not hot-reloaded.
- Keep `"toolCall": {"approval": {"byDefault": "ask"}}` (the ECA default).
  The hook only *blocks* bad commands; everything it allows still gets your
  interactive approval.

### Recovery if the shell gets locked out

If a misconfigured hook blocks all shell commands: remove the `hooks` block
from `~/.config/eca/config.json` (file editing tools still work when the
shell is locked) and `/restart` ECA.

## Testing

Pipe simulated ECA hook JSON into the wrapper:

```sh
# Safe command → silent, exit 0
echo '{"tool_input":{"command":"git status"}}' | ./run.sh

# Destructive → deny JSON with rule id
echo '{"tool_input":{"command":"rm -rf /"}}' | ./run.sh
# {"approval":"deny","additionalContext":"cc-safety-net blocked this command: ... (rule: rm.recursive-force-root-or-home)"}

# Wrapper unwrap → still denied
echo '{"tool_input":{"command":"bash -c \"rm -rf ~\""}}' | ./run.sh

# Secret access → denied
echo '{"tool_input":{"command":"cat ~/.aws/credentials"}}' | ./run.sh

# Malformed input → fail-closed deny
echo '{}' | ./run.sh
```

## Files

| File         | Purpose                                              |
|--------------|------------------------------------------------------|
| `run.sh`     | Hook entry point (POSIX shell, absolute node path)   |
| `check.mjs`  | Adapter: ECA hook JSON ⇄ `checkCommand()` verdict    |
| `package.json` | `cc-safety-net` dependency (`"type": "module"`)    |

## License

ISC
