---
name: sync-device-management
description: Inspect completed changes in the college device-management project and produce a safe incremental synchronization and deployment plan for its Ubuntu server. Use when code has been changed and the user asks how to upload, sync, update, publish, deploy, rebuild, or restart the project; when deciding which files need SCP; or when checking whether npm ci, Vite build, systemd restart, persistent-directory protection, or Sharp image dependencies are required.
---

# Sync Device Management

Generate deployment instructions for this project without requiring the user to restate its server layout. Keep all production mutations within the files changed by the current task.

## Project constants

- Local project: `E:\AIstudy\设备管理`
- SSH target: `ubuntu@43.138.146.44`
- Application directory: `/opt/device-management`
- Service user: `deviceapp`
- systemd service: `device-management`
- Persistent data: `/var/lib/device-management/data`
- Persistent uploads: `/var/lib/device-management/uploads`
- Persistent QR codes: `/var/lib/device-management/qrcodes`
- Public routes: `/borrow` and `/admin`

Never include passwords or personal borrowing data in commands or artifacts.

## Automatic deployment (preferred after initial activation)

Read `docs/CI_CD.md` for the current setup. `.github/workflows/ci.yml` verifies PRs and main; when repository variable `CD_ENABLED=true`, a successful main push or manual main run deploys that exact SHA to the new Tencent server. Initial server installation, two GitHub repository secrets and activation are still required until user-confirmed. Do not assume these are configured because the files exist locally.

The release entry is root-owned `/usr/local/sbin/device-management-deploy <full-SHA>`, installed by `deploy/setup-cd.sh`. It fetches the read-only repository, prepares a separate release with `deviceapp` npm ci/build, switches `/opt/device-management` to the release, restarts once, and checks HTTP/API. Failed switching or health checks attempt to restore the previous code and dependencies, never old business data. It does not automatically update its own installed entry or apply live `/etc` configuration.

After activation, ordinary delivery instructions should name the changed files, ask the user to stage the intended changes, push main, and inspect both CI and deployment results. Do not recommend Git merge/pull inside the live application: release directories contain archived source without `.git`. Every new release installs locked dependencies and builds before switching, including backend-only changes; the incremental action table below applies to the manual fallback, not release preparation.

Manual file installation remains an explicit fallback while automation is disabled. For user-visible verification, honor the user's no-local-build instruction and manual browser policy; record checks not run rather than claiming success. Never run production tests while port 3000 is in use. Publishing a change to the release tooling requires a separate reviewed reinstallation using setup-cd.sh.

## Workflow

1. Read `docs/PROJECT_GUIDE.md` and only the deployment-related files needed for the task.
2. Determine changed paths from edits made in the current task, the user's change list, or supplied screenshot. Do not assume Git is available.
3. Run `scripts/classify-sync.ps1` with those paths. Treat every `excludedPaths` entry as blocked from upload.
4. Audit runtime dependencies whenever `server.js` changed:
   - Compare non-built-in `require()`/`import` modules with `package.json`.
   - If a dependency was added in the current task, include both package files and require `npm ci`, even when the package files were omitted from the reported change list.
   - The current image pipeline depends on `sharp@0.34.4`. For its first server rollout, upload both package files and run `npm ci`. Do not repeat `npm ci` for later `server.js`-only edits after that dependency rollout has been confirmed.
   - If the remote dependency state is genuinely unknown, say so and use the conservative `npm ci` path.
5. Validate locally before giving deployment commands.
6. Produce exact local PowerShell and remote Bash blocks using a fresh staging directory under `/home/ubuntu`. Use one literal timestamped staging name in both blocks. Install each changed file explicitly into the application tree; never copy staging directory metadata into `/opt/device-management`.
7. Explain why build, dependency installation, restart, or system-configuration review is needed.
8. Update `docs/PROJECT_GUIDE.md` when deployment behavior or project structure changed. Record a server version as deployed only after the user confirms success.

## Change classification

| Changed path | Required server action |
|---|---|
| Documentation or tests only | Runtime deployment is optional; sync for project parity if requested |
| `frontend/src/**`, `frontend/index.html`, `vite.config.js`, safe `public/**` assets | Upload, run `npm run build`; restart is normally unnecessary unless backend also changed |
| `server.js` | Upload, run `node --check server.js`, audit dependencies, restart service |
| `package.json` or `package-lock.json` | Upload both, run `npm ci`; rebuild conservatively; restart once |
| `deploy/**`, service, Nginx, or environment examples | Sync files, but do not apply live system configuration without explicit authorization |
| `data/**`, `uploads/**`, `public/qrcodes/**`, `frontend/dist/**`, `node_modules/**`, secrets | Never upload as an incremental source update |

If frontend and backend changed together, upload both, install dependencies when required, build, then restart once.

## Validation rules

Run the checks relevant to the change. For a normal application-code deployment, run locally:

```powershell
node --check server.js
npm test
npm run build
```

Do not recommend running `npm test` on the server while `device-management` is active: integration tests use port 3000 and can collide with production. Prefer the verified local test result. If server-side tests are essential, explicitly stop the service first and plan recovery.

Documentation- or Skill-only changes do not require the application test suite. For rendered frontend changes, include browser verification where available.

## Command-generation rules

- Preserve relative directory structure. In PowerShell, create a temporary local staging tree, copy each safe changed path into its matching relative destination, then upload the staging tree. Never pass nested files directly to one flat `scp` destination.
- Prefer uploading only changed source, test, and documentation files.
- Never upload local runtime data or `node_modules`.
- The remote deployment must not preserve uploader-owned directory metadata. `scp -r` commonly creates staging directories as `ubuntu:ubuntu 0700`; never use `sudo cp -a <staging>/. /opt/device-management/`, because it can replace application-directory ownership and traversal permissions with those staging attributes.
- Install every changed regular file explicitly with `sudo install -D -o deviceapp -g deviceapp -m 0644 <staged-file> <application-file>`. Use `-m 0755` only for executable scripts that are intentionally executable. Example: `sudo install -D -o deviceapp -g deviceapp -m 0644 /home/ubuntu/<stage>/frontend/index.html /opt/device-management/frontend/index.html`.
- Do not recursively `chown` or `chmod` `/opt/device-management` as a routine deployment step. Explicit per-file installation preserves existing application directories and avoids touching persistent paths.
- Before `npm ci`, `npm run build`, or service restart, verify service-user traversal and readability. For any failure, stop and diagnose the first inaccessible path with `namei -l`; do not compensate by running npm as root.

```bash
namei -l /opt/device-management/package.json
sudo -u deviceapp test -r /opt/device-management/package.json

# Required whenever frontend inputs changed.
namei -l /opt/device-management/frontend/index.html
sudo -u deviceapp test -r /opt/device-management/frontend/index.html
```

- If `namei -l` shows an application directory as `ubuntu:ubuntu` with mode `0700`, repair only that confirmed directory to `deviceapp:deviceapp 0755`, rerun the readability check, and then continue. Never modify `/var/lib/device-management` while repairing source-tree permissions.
- Use `sudo -u deviceapp npm ci` only when dependency installation is required.
- Use `sudo -u deviceapp npm run build` when frontend/build inputs changed.
- Restart with `sudo systemctl restart device-management` when backend or runtime dependencies changed.
- Do not run production integration tests while the service owns port 3000.
- Verify with `systemctl status`, `journalctl` on failure, `curl -I http://127.0.0.1:3000/borrow`, and `curl -I http://127.0.0.1/admin`.
- Tell the user to hard-refresh only when browser assets changed.
- Remove only the explicitly named staging directory after successful verification.
- Treat `deploy/**`, Nginx, systemd, and live environment changes as a separate review. Uploading their source files does not authorize applying them to `/etc` or reloading system services.

## Required response shape

Lead with the deployment decision, then provide:

1. Changed files that matter at runtime.
2. Dependency/build/restart decisions with one-line reasons.
3. Local PowerShell commands.
4. Remote Ubuntu commands.
5. Service-user traversal/readability checks before npm commands.
6. Verification URLs and expected status.
7. Persistent-data safety note.
8. Any live system-configuration step that still needs explicit authorization.

Do not ask the user to repeat server IP, paths, service name, or persistent directories already recorded here.

## Classifier script

Run from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File skills/sync-device-management/scripts/classify-sync.ps1 `
  -ChangedPath server.js,frontend/src/main.js,package.json,package-lock.json
```

Use its JSON output as a guardrail, then apply the dependency audit and judgment above.
