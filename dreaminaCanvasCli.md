# Dreamina Canvas CLI User Guide

> 来源：[飞书文档](https://bytedance.larkoffice.com/wiki/JUdYwWPrqiiYgQke0stcVWXvnPh) · 最后更新 2026-11-18 · 本地整理于 2026-11-19
>
> Before reporting an issue, provide the full command, the complete error output, and the output of `dreamina-canvas version`. Update the CLI and retry first, because your issue may already be fixed in a newer build.

## 更新记录

| 版本 | 日期 | 内容 |
| --- | --- | --- |
| v1.4.0 | 2026-11-18 | Added video depth capture and image generation quality settings. |
| v1.3.0 | 2026-11-05 | Added batch generation through workflows and template reuse; selecting image and video upscaling models where available; merging static objects in Director Stage to animate them together; improved error messages and diagnostics; fixed known issues. |
| v1.2.0 | 2026-10-28 | Added Director Stage creation and export, image background removal, video upscaling, and frame interpolation; expanded model lookup to support display names and aliases; added access to membership expiration, credit balances, and credit expiration details. |
| v1.1.1 | 2026-10-23 | Added support for generating video samples (Draft mode) and promoting them to final videos. |
| v1.0.3 | 2026-10-09 | Added Seed Audio 1.0 omni-dubbing, with voice selection or reference media; added node deletion and expanded node position adjustments. |

## 1. What the Dreamina Canvas CLI is

The Dreamina Canvas CLI is a local command-line tool for Agents and automated workflows. Once installed, you can use it from a terminal or an Agent environment to operate the Dreamina collaborative canvas: create canvases, upload media, generate images and videos, edit nodes, check task status, and download results.

**Good reasons to use it**

- Let an Agent create and edit Dreamina canvases, build structure in bulk, and generate image, video, or audio content
- Connect Dreamina Canvas capabilities to automation or testing workflows
- Handle repetitive operations in bulk, then review, select, and refine the results on the Dreamina web canvas
- Lay out and review the whole canvas first, then approve the credits before generating

**Know this before you start**

- Generation may consume account entitlements or credits; the actual amount follows the run-time quote, product rules, and credit records
- Most generation tasks are asynchronous, so submitting and checking results are separate steps
- Available models, ratios, resolutions, durations, and other parameters may change; always use the values returned by the current CLI
- Your Agent must be able to run terminal commands and read local media files

**About Agent Skills**

The Skill bundled with the CLI currently helps Agents follow the CLI commands and operating rules. A future release will also include official Dreamina Canvas creation Skills, so Agents can use official creation guidance for richer canvas work. Until those Skills are released, commands and parameters remain governed by the current CLI schema, `--help`, and this guide.

## 2. Quickstart

One prompt for your Agent: send the complete block below to an Agent such as Trae, Codex, or Claude Code and let it complete the installation and sign-in flow. After setup, you can describe creation tasks in natural language; the Agent will select commands and parameters from the current CLI capabilities.

**Copy this to your Agent:**

```text
Please install the Dreamina Canvas CLI and Skill using the command for my operating system and terminal:

- macOS / Linux: curl -fsSL https://dreamina.capcut.com/canvas-cli/install.sh | bash
- Windows PowerShell: irm https://dreamina.capcut.com/canvas-cli/install.ps1 | iex
- Windows CMD: curl.exe -fsSLO https://dreamina.capcut.com/canvas-cli/install.bat && install.bat

After installation, read the CLI Skill and guide me through verifying that the CLI works, signing in, and authorizing access.
```

> The block above is a natural-language instruction for an Agent, not a command to paste directly into a terminal. If you prefer to work manually, follow the steps below.

For the shortest terminal path, start here. The installed executable is named `dreamina-canvas`.

| Step | Command | What success looks like |
| --- | --- | --- |
| Install | macOS / Linux: `curl -fsSL https://dreamina.capcut.com/canvas-cli/install.sh \| bash` · Windows PowerShell: `irm https://dreamina.capcut.com/canvas-cli/install.ps1 \| iex` · Windows CMD: `curl.exe -fsSLO https://dreamina.capcut.com/canvas-cli/install.bat && install.bat` | The terminal reports that `dreamina-canvas` and its bundled Skill were installed |
| Confirm it runs | `dreamina-canvas --help` | Lists commands such as `auth`, `canvas`, `model`, `node`, `operation`, and `resource` |
| Sign in | `dreamina-canvas auth login` | Complete authorization in the browser |
| Self-check | `dreamina-canvas auth account` | Returns the current account information |

> If the terminal reports `dreamina-canvas: command not found` after installation, PATH may not have refreshed in the current shell. Open a new terminal, or add the installation directory to PATH as instructed by the installer.

## 3. Sign-in and account checks

Standard sign-in flow:

1. Run `dreamina-canvas auth login`.
2. Open the authorization page provided by the terminal or Agent.
3. Complete sign-in and authorization in the browser.
4. Return to the terminal and wait for the command to finish.
5. Run `dreamina-canvas auth account` as a sign-in self-check.

Sign-in commands:

| Command | Purpose | Notes |
| --- | --- | --- |
| `dreamina-canvas auth login` | Sign in | Starts browser authorization |
| `dreamina-canvas auth login --force` | Sign in again | Clears the current sign-in state and starts a new authorization |
| `dreamina-canvas --non-interactive auth login` | Non-interactive sign-in | For Agents and scripts; returns authorization information and exits |
| `dreamina-canvas auth wait --device-code <code>` | Wait for authorization | Continues an existing sign-in flow; waits up to 10 minutes by default |
| `dreamina-canvas auth account` | Account self-check | Confirms the account recognized by the server |
| `dreamina-canvas auth status` | Read local sign-in state | Checks the current profile's local sign-in configuration |
| `dreamina-canvas auth refresh` | Refresh credentials | Use when the current credentials need renewal |
| `dreamina-canvas auth logout` | Sign out | Clears the current profile's local sign-in state |

## 4. Common commands and examples

This chapter is for users who prefer working directly in a terminal. It focuses on the most common creation workflows. Commands, models, and parameters are governed by the local `dreamina-canvas` schema, `--help`, and live model catalog.

> ❗ **Before submitting:** generation may consume credits; local media paths must be accessible; and models, ratios, resolutions, durations, and output counts must come from current discovery results. Media nodes only start generation when `--run` is present; without it, the command only saves the node to the canvas.

| Task | Common commands | Key arguments |
| --- | --- | --- |
| Prepare a canvas and media | `model list` / `model find` · `canvas create` / `canvas ls` · `resource upload` / `resource get` | Models: `<name...>`, `--type` · Canvas: `<name>`, `--use`, `--limit` · Media: `--file`, `--name`, `<resourceId>`, `--project-id` |
| Image generation | `node create image` | `--title`, `--mode`, `--prompt`, `--model`, `--ratio`, `--resolution`, `--count`, `--ref`, `--run`, `--wait` (with `--run`) |
| Video generation | `node create video` | `--title`, `--mode`, `--prompt`, `--model`, `--ratio`, `--resolution`, `--duration`, `--count`, `--ref`, `--run`, `--wait` (with `--run`) |
| Audio generation | `voice list` · `node create audio` | Voices: `--offset`, `--count` · Generation: `--title`, `--mode`, `--prompt`, `--voice-name` (TTS), `--model`, `--duration` (music), `--run`, `--wait` (with `--run`) |
| Find, edit, and download | `node find` / `node show` / `node edit` · `operation status` / `operation wait` · `resource download` | Nodes: `--type`, `--status`, `--limit`, `--node-id` · Tasks: `<submitId>`, `--project-id`, `--timeout`, `--interval` · Download: `<resourceId>`, `--project-id`, `--output` |
| Other canvas operations | `node upscale image` · `node create text` · `node create element` · `node create timeline` | Upscale: `--node-id`, `--mode`, `--resolution`, `--detail` (pro only), `--wait` · Text: `--title`, `--text` · Element: `--title`, `--description`, `--main`, `--auxiliary`, `--voice` · Timeline: `--title`, `--clip`, `--audio-clip` |

### 4.1 Prepare a canvas and media

Discover available models:

```bash
dreamina-canvas model list --type image
dreamina-canvas model list --type video
dreamina-canvas model list --type audio

# Find a model by a familiar name or alias
dreamina-canvas model find "model name" --type image
```

For `--model`, use the canonical model value returned by discovery. Aliases help you find a model; do not pass an alias as the model argument.

Create or list canvases:

```bash
# Create a canvas and make it the current canvas
dreamina-canvas canvas create "My first canvas" --use

# List recent canvases
dreamina-canvas canvas ls --limit 20
```

`canvas create` and `canvas ls` return a `projectId` and a `webUrl` that opens the canvas. `canvas ls` only lists canvases; it does not switch the current canvas.

Upload local media:

```bash
# Upload a local image, video, or audio file
dreamina-canvas resource upload --file ./product.png --name "Product image"

# Check media status
dreamina-canvas resource get <resourceId>

# Put the uploaded image on the current canvas as a node
dreamina-canvas node create image \
  --title "Product image" \
  --resource-id <resourceId> \
  --import-kind local_upload
```

Keep the returned `resourceId`. Once the media is represented by a canvas node, prefer that node's `nodeId` in downstream references so the canvas preserves the upstream connection.

| Reference syntax | When to use it |
| --- | --- |
| `--ref "node:<nodeId>"` | Follow a canvas node's latest output and preserve the upstream connection; prefer this when a suitable canvas node exists |
| `--ref "res:<resourceId>"` | Reference one fixed media asset; use a Resource ID returned by the CLI |

### 4.2 Image generation

Text to image:

```bash
dreamina-canvas node create image --run --wait \
  --title "Fox in snow" \
  --prompt "a fox in deep snow, cinematic lighting" \
  --mode t2i \
  --model "<model returned by model list>" \
  --ratio "<ratio supported by this model>" \
  --resolution "<resolution supported by this model>" \
  --count 1
```

Image to image:

```bash
dreamina-canvas node create image --run --wait \
  --title "Product poster" \
  --prompt "keep the product appearance unchanged and use an outdoor advertising style" \
  --mode i2i \
  --model "<model returned by model list>" \
  --ratio "<ratio supported by this model>" \
  --resolution "<resolution supported by this model>" \
  --ref "node:<imageNodeId>" \
  --count 1
```

### 4.3 Video generation

Text to video:

```bash
dreamina-canvas node create video --run --wait \
  --title "Sunset by the sea" \
  --prompt "sunset over the ocean, slow camera push-in" \
  --mode t2v \
  --model "<model returned by model list>" \
  --ratio "<ratio supported by this model>" \
  --resolution "<resolution supported by this model>" \
  --duration <duration supported by this model>
```

Generate video from reference media:

```bash
dreamina-canvas node create video --run --wait \
  --title "Product video" \
  --prompt "slow camera push-in while keeping the subject stable" \
  --mode m2v \
  --model "<model returned by model list>" \
  --ratio "<ratio supported by this model>" \
  --resolution "<resolution supported by this model>" \
  --duration <duration supported by this model> \
  --ref "node:<imageOrVideoNodeId>"
```

First-and-last-frame video:

```bash
dreamina-canvas node create video --run --wait \
  --title "First-to-last-frame transition" \
  --prompt "transition smoothly from the first image to the second" \
  --mode first_last_frame \
  --model "<model returned by model list>" \
  --ratio "<supported ratio matching the first frame>" \
  --resolution "<resolution supported by this model>" \
  --duration <duration supported by this model> \
  --ref "node:<firstFrameNodeId>" \
  --ref "node:<lastFrameNodeId>"
```

> 💡 Current video modes are `t2v`, `first_last_frame`, and `m2v`; there is no `i2v` mode. Use `m2v` for multimodal references such as images, videos, audio, or Elements. Valid media types, counts, and parameters come from the selected model's current specification.

### 4.4 Audio generation

Text to speech:

```bash
# Discover voices first
dreamina-canvas voice list --offset 0 --count 50

# Generate speech
dreamina-canvas node create audio --run --wait \
  --title "Narration" \
  --mode tts \
  --prompt "Welcome to Dreamina Canvas" \
  --voice-name "<voiceName returned by voice list>"
```

Music generation:

```bash
# Find an audio model that supports music mode
dreamina-canvas model list --type audio

# Generate music
dreamina-canvas node create audio --run --wait \
  --title "Background music" \
  --mode music \
  --prompt "upbeat electronic music with a technology feel" \
  --model "<model supporting music mode>" \
  --duration <duration supported by this model>
```

TTS uses `--voice-name` and does not take `--model`. Music generation uses `--model` and does not take `--voice-name`.

### 4.5 Find, edit, and download results

```bash
# Find successful image nodes on the current canvas
dreamina-canvas node find --type image --status success --limit 50

# Read one or more known nodes
dreamina-canvas node show --node-id <nodeId>

# Change only an image node title, without regenerating
dreamina-canvas node edit image \
  --node-id <nodeId> \
  --title "New title"

# Query task status once
dreamina-canvas operation status <submitId> \
  --project-id <projectId>

# Wait for the task to reach a terminal state
dreamina-canvas operation wait <submitId> \
  --project-id <projectId> \
  --timeout 10m \
  --interval 5s

# Check output media status
dreamina-canvas resource get <resourceId> \
  --project-id <projectId>

# Download into an existing directory
mkdir -p ./downloads
dreamina-canvas resource download <resourceId> \
  --project-id <projectId> \
  --output ./downloads
```

When you edit image, video, or audio generation settings, provide the complete generation configuration and all references for that update. Changing only the prompt while omitting existing references removes those references.

If `operation wait` times out, only the local wait has ended; the server task is not canceled. Keep the original `projectId` and `submitId`, then query the same task later instead of submitting it again.

## 5. Credits and task status

- Saving a canvas node does not start generation; generation and image upscale operations may consume credits.
- When credit approval is required, the Agent should show the quote before asking the user whether to continue.
- Generation may take time. A local wait timeout does not mean the server task failed.
- Once a task has been submitted, continue querying the original task instead of resubmitting because no result is visible yet.

> 💡 Users do not need to repeat these instructions in every conversation. When approval is required, the Agent should show the current quote and wait for a decision. It may continue within a credit ceiling the user has already approved.

### Save a node versus run generation

| Operation | Result | Starts generation? |
| --- | --- | --- |
| `node create` / `edit` | Saves the node and generation settings to the canvas | No |
| `node create` / `edit ... --run` | Saves, quotes, obtains required approval, and submits generation | After user approval |
| `node quote` | Estimates credits for saved nodes | No; a quote is not approval |
| `node run` | Runs saved nodes after required approval is complete | Yes |

### Credit approval

- Generation and image upscale may consume credits; the server's live quote is authoritative.
- An interactive terminal shows the amount and asks whether to continue when needed. Answering `n` stops without submitting generation.
- Agents and scripts cannot display an interactive terminal prompt, so they must show the quote to the user and receive explicit approval before continuing.
- When a credit ceiling is set, the CLI stops before generation if the latest quote exceeds that ceiling.

> ❗ Exit code 10 means "waiting for approval," not generation failure. The node has been saved, but generation has not been submitted. Show the returned quote, wait for approval, and continue with the original node and task identities.

### Task status and recovery

| Current situation | Correct action |
| --- | --- |
| The node is saved but not run | Continue editing it, or quote and run it; saving does not mean generation has started |
| The task is accepted or running | Use the original task ID with `operation status` or `operation wait` |
| The local wait timed out | The server task may still be running; query it again later with the original task ID |
| The task reports success | Continue checking the node and output media for terminal state; accepted does not mean complete |
| The task reports failure | Follow the returned next action; do not resubmit before understanding the failure |

> ❌ Do not change the task ID for the same generation. Reusing the original task ID continues the same task; a new task ID may be treated as a new generation and consume credits again.

### Four IDs worth keeping

| Field | Purpose |
| --- | --- |
| `projectId` | Identifies a canvas and lets you continue from another terminal or device |
| `nodeId` | Identifies a canvas node for reading, editing, or use as a reference |
| `submitId` | Identifies one run for polling and recovery |
| `resourceId` | Identifies one specific media output for status checks or download |

### Common exit codes

| Exit code | Meaning | Recommended action |
| --- | --- | --- |
| 0 | The command succeeded | Continue; a read command may return 0 even while the task is still running |
| 2 | Invalid command or argument | Check `--help` or schema, then correct the command instead of retrying it unchanged |
| 10 | Credit approval is required | Show the quote, wait for approval, and continue with the original node and task identities |
| 11 | Sign-in is required or expired | Sign in again, then continue the original task |
| 12 / 13 | Permission, entitlement, or release compatibility restriction | Follow the error guidance to check account access or update the CLI |
| 20 | The local wait did not finish, but the task can still be queried | Keep the original task ID and run `operation wait` again later |
| 21 / 22 | Temporary service failure or human action required | Follow `requiredAction`; do not resubmit blindly |

Scripts and Agents should branch on the structured `requiredAction` field rather than parsing localized error messages.

## 6. Local files and logs

The Dreamina Canvas CLI stores the executable, the bundled Agent Skill, and a small amount of helper state on the local machine. Canvas content and generated outputs remain governed by the server.

| Location | Purpose |
| --- | --- |
| `~/.local/bin/dreamina-canvas` | Default location on macOS and Linux. Windows Git Bash defaults to `~/bin/dreamina-canvas.exe`. If you customized the location, follow the installer output |
| `~/.agents/skills/dreamina-canvas-cli/` | The Agent Skill bundled with the installer; an Agent can read it for operating rules |
| `dreamina-canvas/contexts/<profile-and-environment>.json` | Records the current canvas so later commands can continue using it |
| `dreamina-canvas/operations/<profile-and-environment>/<submitId>.json` | Records recovery information for generation tasks so interrupted work can be queried later |

The last two paths are under the operating system's user configuration directory: commonly `~/Library/Application Support/` on macOS, `~/.config/` or `$XDG_CONFIG_HOME` on Linux, and the user's AppData directory on Windows.

Logs and troubleshooting: the current public release does not require users to find a fixed log directory. Errors are printed directly in the terminal. When reporting an issue, provide the full command, complete error output, and `dreamina-canvas version`. If the response includes `meta.requestId`, include it. For generation issues, also provide `projectId` and `submitId`.

> ❌ Do not hand-edit local state or credential files. Do not post sensitive information from logs, configuration files, or terminal output in public channels. Share only the command, error details, CLI version, and the minimum relevant log excerpt.

## 7. FAQ

### 7.1 `dreamina-canvas` is not found after installation

- Open a new terminal or restart the Agent, then run `dreamina-canvas --help`.
- If the installer says its directory is not in PATH, add that directory to PATH as instructed.
- If it still fails, run the installation command again.

### 7.2 I signed in, but commands still report that I am signed out or lack permission

- Run `dreamina-canvas auth account` to check the current account.
- If sign-in has expired, run `dreamina-canvas auth login` again.
- If the server reports a permission or entitlement restriction, check the current account state in the product.

### 7.3 The model, ratio, or resolution is not supported

Run the installation command again to update the CLI, then ask the Agent to query the current models and parameters. Do not copy model names from old documentation, earlier conversations, or another environment.

### 7.4 A task has produced no result for a long time

- Ask the Agent to keep querying the original task.
- Keep the canvas and task identities so the same generation is not submitted again.
- You can also open the canvas link returned by the Agent and inspect the latest canvas state.

### 7.5 The Agent does not know how to use the CLI or uses old commands

Ask the Agent to reread `~/.agents/skills/dreamina-canvas-cli/SKILL.md`, then run `dreamina-canvas schema` or the relevant command's `--help`. Legacy commands such as `dreamina text2image` and `dreamina image2video` do not apply to the Dreamina Canvas CLI.

### 7.6 How to report an issue

Provide all of the following together:

- The complete command you ran
- The complete terminal error output
- The CLI version from `dreamina-canvas version`
- The request ID from the error response, when present
- For generation tasks, the relevant canvas ID and task ID

> ❌ Never post passwords, cookies, access tokens, signed URLs, or local credential files in a public channel.

## 8. Recommended workflow

New users should complete the smallest working flow before moving on to more complex capabilities.

1. Install the CLI and confirm that `dreamina-canvas --help` works.
2. Run `dreamina-canvas auth login` to sign in.
3. Run `dreamina-canvas auth account` to confirm the account is usable.
4. Ask the Agent to discover the current models and create a test canvas.
5. Start with one simple image task, then approve the quote before generation.
6. Wait for completion and open the canvas link returned by the Agent to inspect the result.
7. Once the basic flow is stable, move on to video, audio, reusable Elements, timelines, or batch work.

> ✅ If you can install, sign in, check the account, create a canvas, and complete one image generation, the basic Dreamina Canvas CLI flow works and you can start using an Agent for richer creation workflows.
