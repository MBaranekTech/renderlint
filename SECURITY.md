# Security policy

## Supported versions

RenderLint is an early MVP. Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability. Use GitHub's private
**Report a vulnerability** feature in the repository Security tab. Include affected versions,
reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement
within seven days.

If private vulnerability reporting has not yet been enabled for the repository, contact the
maintainer privately through the address listed on their GitHub profile.

## Deployment model and known risks

RenderLint is designed for a trusted developer workstation, not as a public multi-tenant service.
It intentionally opens user-supplied HTTP and HTTPS URLs from Chromium. Those URLs can reach
services visible to the RenderLint process or container, including development and private network
services. This is server-side request forgery (SSRF) exposure by design.

- Keep the service bound to loopback or behind a trusted access-control layer.
- Do not expose port 8787 directly to the internet.
- Do not scan untrusted URLs on a machine with access to sensitive internal services.
- Treat page content, console messages, screenshots, and generated repair briefs as untrusted data.
- Use a dedicated container/host and network restrictions for shared installations.
- Keep the Playwright image and npm dependencies updated.

The Node server binds to `127.0.0.1` by default. Docker Compose binds the process inside the
container to `0.0.0.0`, but publishes port 8787 only on the host loopback interface by default.
