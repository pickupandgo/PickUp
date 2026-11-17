# Isolated staging delivery

This workflow never deploys production or changes Render. Validation uses a separate PostgreSQL container on an internal Docker network. Integration suites run serially in fresh processes, with a schema reset for each suite. The exact disposable database allowlist is `mr_phase2_test` on loopback inside that database's network namespace.

Manual deployments require the protected GitHub environment **staging**, the reviewed `aws/staging-uat-readiness` branch, a successful full validation job, and repository variable `STAGING_DEPLOY_ENABLED=true`. Leave that variable unset until an owner completes environment configuration. No deployment secret belongs in source control.

Owner setup (repository administration is required):

- Create environment `staging`, restrict deployment branches to `aws/staging-uat-readiness`, add a reviewer, and prevent self-review where available.
- Set environment secret `STAGING_SSH_KEY` to the separately generated, restricted `mr-staging-deploy` key. The regional Lightsail admin key must never be used in CI.
- Set environment variables `STAGING_HOST=13.206.178.37` and `STAGING_KNOWN_HOSTS` to the independently verified ED25519 host-key entry.
- Manual API dispatch is verified without changing default branch `Driver`: `gh workflow run 420345090 --repo pickupandgo/PickUp --ref aws/staging-uat-readiness -f operation=validate`. Replace `validate` with `deploy` or `rollback` only after owner activation. The protected environment still requires owner review. Do not change a production-triggering branch merely to expose the web UI button.
- Keep `STAGING_DEPLOY_ENABLED` unset until validation passes and the first release is reviewed.

The server-side SSH identity accepts only `check`, `deploy <40-character commit> <64-character artifact digest>`, or `rollback`. It has no general shell, PTY, agent or forwarding access. A root-owned command validates the archive digest, source/revision labels, image user/command and schema fingerprint before changing only the staging API image pin. It snapshots the staging database, retains the previous image, checks health and rolls back a failed application deployment. It cannot execute database migrations or change production routing.

Application images use a digest-pinned Node base and lockfile dependencies. Workflow actions are pinned to full commit SHAs. Builds occur on GitHub-hosted runners, not on a self-hosted runner with the Lightsail host's credentials.

Rollback selects the previously retained immutable image and preserves the database. Database schema changes are deliberately rejected by the gate and require a separate staging migration review, backup and compatibility plan. No database restore runs automatically as part of rollback.

`deploy-gate.py` and `ssh-command.py` are installation sources. On the server they must be root-owned and not writable by the deployment user. Runtime environment files, signing keys and SSH keys remain outside the repository. A new image or workflow is not production approval.
