# Platform releases

ORAtlas tags identify the exact platform code that emitted audit provenance and generated public
exports. The canonical version is the root `package.json` version; `@oratlas/config` exposes that
same value to the database and export layers.

## Release flow

1. Update the root version and add a dated matching section to `CHANGELOG.md` in a normal reviewed
   pull request.
2. Merge the release change to `main` and wait for CI to pass.
3. A maintainer performs the single public release action: create and push an annotated `v<version>`
   tag on that merged `main` commit. For the first release:

   ```sh
   git switch main
   git pull --ff-only origin main
   git tag -a v0.1.0 -m "Open Review Atlas v0.1.0"
   git push origin v0.1.0
   ```

The tag-triggered release workflow rejects a tag whose name differs from the root version or whose
commit is not on `main`, re-runs verification, extracts the matching changelog section, and creates
the GitHub Release. Do not tag a pull-request branch.

New audit events store the platform version in a dedicated nullable column. Null remains meaningful
for historical events; releases never backfill them. Public exports identify the currently running
exporter version, so regenerated metadata remains attributable after platform upgrades.
