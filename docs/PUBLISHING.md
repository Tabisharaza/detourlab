# Publish from clean source

The initial publication is complete: see [PUBLICATION.md](PUBLICATION.md) for the actual repository, archive digest, two-commit clean history and successful CI. The procedure below retains the general one-commit Git CLI route; the initial publication used the existing authenticated connection with a LICENSE-only bootstrap followed by the exact reviewed tree. Do not re-create the existing repository to follow this procedure.

This procedure prepares a new public repository from a reviewed release ZIP. It does not itself authorize publication. Confirm the intended owner, available name, visibility and publication timing first. Keep the current live app unchanged unless a separate deployment is intended.

## 1. Verify and extract the release

Use the exact ZIP and SHA-256 recorded in its release receipt. Verify the digest before extracting into a new, empty directory. Do not clone or copy a hosting-provider checkout, its `.git` directory, remotes, credentials or history.

```sh
sha256sum /absolute/path/to/reviewed-source.zip
mkdir detourlab-public-source
unzip /absolute/path/to/reviewed-source.zip -d detourlab-public-source
cd detourlab-public-source
```

The reviewed archive includes source, tests, examples, docs, the actual screenshot, license notices and `.github` templates/workflow. It excludes `.git`, `.openai`, generated `dist`, dependencies and provider configuration. Compare the extracted file inventory with the receipt. Review all included files for secrets and private data; the distribution verifier alone does not review source-package contents or history.

## 2. Recheck the exact source

Use the pinned locally tested Node version, or record the alternative version actually exercised. The declared API minimum is distinct from verified runtime coverage; see [CI.md](CI.md).

```sh
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run check
node scripts/verify-dist.js
node scripts/run-experiment.js examples/meridian-experiment.json \
  --max-extra-distance-pct 30 --max-extra-late 150 --max-unreachable 60
```

Review README links, the image, license, synthetic-data labels and known gaps. Preserve the explicit pending-browser checks. Private security-reporting setup is optional; the published [disclosure instructions](../SECURITY.md) provide a minimal-contact fallback without exposing exploit details.

## 3. Create fresh history only after authorization

Check the intended account and repository-name availability again at publication time. A slug search is not trademark clearance. If the desired name already exists, inspect it rather than overwriting it or assuming it belongs to this project.

Use a verified, approved public commit-author identity. Do not invent a personal email or copy credentials from another checkout. Then initialize this extracted tree:

```sh
git init -b main
git add .
git diff --cached --check
git diff --cached --stat
git ls-files
# Review the complete staged list and content before committing.
git commit -m "Initial DetourLab synthetic experiment workbench"
git rev-list --count HEAD
git rev-parse HEAD
```

The revision count should be `1`. Verify no provider configuration or generated files are staged. Record the new initial commit alongside the archive digest and application-version evidence: a fresh-history commit will not have the original development commit ID.

Create the authorized empty public repository using the existing authenticated GitHub connection. Do not auto-generate a README, license or ignore file on the server, because the reviewed source already contains them. Use the exact remote URL returned for that repository, then push the single clean history. Do not add credentials to URLs or command logs.

```sh
git remote add origin VERIFIED_REPOSITORY_URL
git remote -v
git push -u origin main
```

Replace `VERIFIED_REPOSITORY_URL` with the returned URL; it is intentionally not a guessed repository address. If authentication or permissions fail, resolve that specific blocker through an approved route rather than changing security settings automatically.

## 4. Verify publication, then report it

- Read the remote default-branch commit and compare it with the recorded local initial commit. Check the remote tree and representative source bytes.
- Verify the README's actual image and live link from the new repository.
- Inspect CI for that exact commit. Record each matrix job, runtime and outcome. Until it runs successfully, say CI is configured, not passing. A newer runtime entry is additional coverage, not a prerequisite to creating this alpha repository.
- Report pending QA and test failures accurately. Do not add a green badge before there is a real passing run.
- Create only the selected issue drafts after deciding their scope; they are not posted automatically by this procedure.
- Do not change account security, branch protection, permissions, secrets or deployment settings as a side effect of source publication.

GitHub's [official guide to adding locally hosted code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github) documents the empty-repository, remote and push flow. These additional source-review and evidence checks are specific to this release.
