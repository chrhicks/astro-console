# Catalog Maintenance

The desktop target catalog is generated from the pinned OpenNGC source files
owned by `apps/desktop/scripts/ngc/`.

## Import

From `apps/desktop`:

```sh
npm run import:ngc
```

The importer validates pinned input hashes, parses the source rows, filters
unsupported objects, normalizes identifiers and coordinates, and writes the
desktop catalog artifact with provenance.

## Change Rules

- Update the pinned source and expected hashes together.
- Keep parsing and normalization tests with the import code.
- Review generated catalog changes for finite coordinates and stable target
  identifiers.
- Keep public catalog targets rig-neutral. Adapter-specific target-mode mapping
  belongs below the rig boundary.
