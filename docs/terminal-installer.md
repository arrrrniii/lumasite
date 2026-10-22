# Install LumaSite with npm and terminal setup

LumaSite 0.3 includes a packaged `lumasite` command and an interactive terminal wizard. Node.js 24 or later, npm, and Git must already be installed. The package includes Studio, the CLI, the runtime, and native LumaFX. It excludes live data, credentials, website ZIPs, development dependencies, tests, and the optional SendMailOS marketing source/assets. The full example remains in the GitHub checkout; move an existing website with its project ZIP.

## Install directly from the private GitHub repository

Give the server's Git client read access to `arrrrniii/lumasite`. With GitHub CLI and an authorized account:

```sh
gh auth login
gh auth setup-git
npm install --global git+https://github.com/arrrrniii/lumasite.git
lumasite setup
```

A read-only SSH deploy key is another option:

```sh
npm install --global git+ssh://git@github.com/arrrrniii/lumasite.git
lumasite setup
```

Configure Git authentication on that server; npm registry login does not authenticate a private Git repository. Use a user-writable npm prefix and the account intended to own the application/data. Add that prefix's `bin` directory to PATH if your Node installation has not done so. Do not embed a GitHub token in the install URL. A release tag or full commit can be appended as `#REF` when you need a fixed application release.

The GitHub repository remains private. There is no `lumasite` npm registry release. Publishing to npm is a separate action requiring an npm account, ownership of an available package name/scope, and an intentional change to the package's `private: true` setting. The GitHub installation already supplies the global command without publishing to that registry.

## Walk through terminal setup

```sh
lumasite setup
```

The wizard asks for:

1. Local or server mode.
2. Persistent data directory; the default is `./.lumasite` in your current directory, matching the CLI's normal default.
3. An optional website ZIP, or a new website.
4. Website name and domain.
5. Admin/API/MCP and public website ports. Available defaults are selected without stopping existing services.
6. Studio and preview URLs.
7. Apache, Caddy, or manual proxy configuration in server mode.
8. Whether to start the application, followed by a settings review.

It generates an administrator password and a project-scoped MCP token and prints the connection URLs. Save the displayed credentials privately. They are also in the private `credentials.json` file in the chosen data directory. The `deployment/NEXT-STEPS.txt` file lists the matching start, status, health, doctor, logs, restart, stop, and credential-retrieval commands. These notes contain no access credentials.

Cancel at the review prompt or press Ctrl+C before creation to exit without initializing an instance. An initialized destination is rejected without resetting its websites or credentials; use `project create` or `import` for additional websites. Explicitly selected busy ports are rejected. New starter pages remain drafts until published in Studio/MCP; ZIP imports preserve the source's published revisions and drafts and generate a new MCP credential.

## Server setup

Create a persistent directory writable by your service account, then run:

```sh
lumasite setup --mode server --data-dir /srv/lumasite/data
```

For `example.com`, suggested origins are `https://studio.example.com` and `https://preview.example.com`. Listeners bind to `127.0.0.1` by default. Server origins require HTTPS and separate administration/public hostnames.

The wizard writes `/srv/lumasite/data/deployment/apache.conf` or `Caddyfile`. It generates configuration text; it does not install Apache, modify existing virtual hosts, issue certificates, change DNS, or install a boot service. Point DNS to the server, review and enable the generated proxy through the existing server workflow, and configure HTTPS before remote login/MCP use. Native start runs as a background process; use a process supervisor for restart after reboot. See [production transfer and Apache setup](production-transfer.md).

## Automated setup

No terminal prompts run when `--yes` is supplied. Use `--no-start` to prepare data for a supervisor, and `--json` for machine-readable results. Successful JSON output includes newly generated credentials, so do not publish it as a build artifact or public log.

```sh
lumasite setup --yes --no-start \
  --mode server \
  --name "My website" \
  --domain example.com \
  --data-dir /srv/lumasite/data \
  --public-url https://studio.example.com \
  --site-url https://preview.example.com \
  --port 4310 --site-port 4311 \
  --proxy apache
```

Import an existing website during setup by supplying `--file /private/import/website.zip`. Name/slug can default to the ZIP's metadata; supply the destination domain explicitly for production. Server imports use clean domain links; local imports use project-path links. ZIP validation happens before initialization, and malformed archives are rejected without creating an instance.

Custom passwords can be supplied through `LUMASITE_PASSWORD` (12–1024 characters). Otherwise a password is generated. Setup does not accept a plaintext password command-line argument. With no terminal and no `--yes`, the command exits with instructions instead of hanging on a prompt.

## Application updates

Keep using the same persistent data directory. Take a private backup to a new destination, stop the CLI-managed instance, update its package, and start it again:

```sh
lumasite backup --data-dir /srv/lumasite/data --output /srv/private-backups/before-update-001
lumasite stop --data-dir /srv/lumasite/data
npm install --global git+https://github.com/arrrrniii/lumasite.git
lumasite start --data-dir /srv/lumasite/data
lumasite health --data-dir /srv/lumasite/data
```

Use the supervisor's stop/start commands when it manages the process. Do not rerun setup to update an existing installation. Updating website content through Studio/MCP does not require updating the application package.

## Verify a distributable locally

From the development checkout:

```sh
npm run test:package
```

This packs the actual allowlisted files, installs the tarball into a disposable npm prefix, runs setup, starts both listeners, opens Studio/runtime assets, publishes a page with Tailwind, and initializes an authenticated MCP connection. It removes the temporary installation/data afterward. The normal `npm test` suite also covers guided setup, cancellation/EOF, JSON automation, ZIP imports, and preservation of existing data/services.

Primary npm references: [Git package specifications](https://docs.npmjs.com/cli/v11/using-npm/package-spec/), [package files and executable mappings](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), and [npm exec](https://docs.npmjs.com/cli/commands/npm-exec/).
