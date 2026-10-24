# create-lumasite

Create an editable website with [LumaSite](https://github.com/arrrrniii/lumasite):
a self-hosted Studio with MCP, native HTML/Tailwind/CSS/JavaScript, LumaFX,
global layouts, media, SEO/blogs, integrations, and forms with SMTP notifications.

Requires **Node.js 24 or later and npm**. Git and a GitHub account are not needed
for registry installation.

```sh
npm create lumasite@latest
```

Enter a new project folder, website name, and production domain. Server mode is
the default. The wizard selects available ports, suggests Studio/preview URLs,
detects Apache/Caddy/Traefik, and asks you to review the settings before creating
anything. You can start with a website ZIP instead of a new homepage.

For local laptop testing:

```sh
npm create lumasite@latest -- --local
```

After installation, open the printed Studio URL and sign in with the generated
administrator password. Edit, preview, and publish the starter homepage, then
copy the website's MCP connection URL from **Connections**.

```sh
cd my-website
npm run status
npm run health
npm run logs
npm run backup
```

The runtime is installed inside your project, independently of npm's temporary
initializer cache. Private website data and credentials remain in `.lumasite/`.
The wizard generates proxy configuration; DNS, HTTPS, proxy activation, and
startup after reboot follow your server's existing setup.

[Illustrated wizard](https://github.com/arrrrniii/lumasite/blob/v0.13.0/docs/wizard-walkthrough.md)
· [Server setup](https://github.com/arrrrniii/lumasite/blob/v0.13.0/docs/operations.md)
· [Forms and SMTP](https://github.com/arrrrniii/lumasite/blob/v0.13.0/docs/forms-and-email.md)

For a reproducible installation, use `npm create lumasite@0.13.0`.
