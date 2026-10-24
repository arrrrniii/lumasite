# Publish the npm packages

LumaSite has two public registry packages:

| Package | Purpose |
| --- | --- |
| `lumasite` | Full runtime/CLI, Studio assets, and native LumaFX |
| `create-lumasite` | Small initializer behind `npm create lumasite@latest` |

Use an npm account with publishing access. Both packages currently retain the
repository's `UNLICENSED` declaration; publishing does not change that license.
The runtime package's `files` allowlist excludes installation data, website ZIPs,
marketing source/assets, and credentials. The initializer contains only its
launcher, package metadata, and README.

## Prepare and test

Update the runtime `package.json`, root lockfile, `src/service.mjs`, initializer
version, and initializer's exact `lumasite` dependency together. Update release
links and install/upgrade examples.

```sh
npm ci
npm test
npm run test:package
npm run test:initializer
npm pack --dry-run
npm pack --dry-run ./packages/create-lumasite
```

`test:initializer` installs both packed packages together before they are published.
The package tests use disposable data; do not publish their private fixture output.

## Authorize and publish

Use npm's normal browser authorization. Never commit `.npmrc`, registry tokens,
or one-time codes.

```sh
npm login --auth-type=web
npm whoami
```

Publish the runtime first, then its initializer. For browser approval, npm 11.15+
supports staged publishing:

```sh
npm stage publish
```

Review and approve the runtime in npmjs.com's **Staged Packages** screen, including
the required account verification. Confirm the runtime version is available, then:

```sh
cd packages/create-lumasite
npm stage publish
```

Approve the initializer through the same screen. Ordinary `npm publish` with npm's
required authentication is also supported. Do not change authentication settings or
create bypass tokens just to avoid the normal approval flow.

## Verify the public installation

```sh
npm view lumasite@0.13.0 version
npm view create-lumasite@0.13.0 version
npm create lumasite@0.13.0
```

For a local disposable trial, use `npm create lumasite@0.13.0 -- --local`. Confirm
Studio, first-page publication, generated npm scripts, and the runtime after the
initializer cache is removed. Server creation defaults to server mode; local tests
must explicitly select `--local` or `--mode local`.

Publish the matching GitHub tag/release and verify CI. Existing website data is not
part of npm publication, and publishing a package does not upgrade a running server.

Official references: [npm initializers](https://docs.npmjs.com/cli/v11/commands/npm-init/),
[public package publication](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/),
[staged publishing](https://docs.npmjs.com/staged-publishing/).
