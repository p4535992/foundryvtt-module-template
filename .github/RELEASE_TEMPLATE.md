<!-- foundry-module-template:installation:start -->

## Installation

This is **{{MODULE_ID}} {{VERSION}}**.

In Foundry VTT, open **Add-on Modules → Install Module** and paste the URL of the **module.json attached to this release**:

{{MANIFEST_URL}}

That manifest downloads the [module.zip attached to this exact release]({{DOWNLOAD_URL}}). Use these attached release assets when installing; the repository source archive is not the built module.

When a stable release is available, open the [latest stable release]({{LATEST_RELEASE_URL}}) and copy the URL of the module.json asset attached there to install it. That manifest points to the ZIP belonging to that release.

{{UPDATE_POLICY}}

{{UPDATE_MANIFEST_URL}}

For manual installation, extract module.zip into your Foundry user data directory's Data/modules/ folder. The archive already contains the {{MODULE_ID}}/ directory; the resulting manifest must be at Data/modules/{{MODULE_ID}}/module.json. Restart or reload Foundry, then enable the module in your world.

<!-- foundry-module-template:installation:end -->
