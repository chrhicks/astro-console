# OpenNGC Attribution

`catalog-data.json` in this directory is derived from the OpenNGC project by Mattia Verga.

- Original project: https://github.com/mattiaverga/OpenNGC
- Creator: Mattia Verga
- DOI: https://doi.org/10.21938/y.1ejWUD_MQ6b_eDFoVbbw
- License: Creative Commons Attribution-ShareAlike 4.0 International (`CC-BY-SA-4.0`)
- License URL: https://creativecommons.org/licenses/by-sa/4.0/

This project ships a transformed OpenNGC snapshot from:

- `apps/desktop/scripts/ngc/raw/NGC.csv`
- `apps/desktop/scripts/ngc/raw/addendum.csv`

Local modifications made by this project:

- filtered out `NonEx`, `Dup`, `*`, and `**` rows
- normalized object identifiers and primary designations
- parsed RA/Dec sexagesimal strings into decimal fields
- derived `recommendedFilter` and `targetType`
- merged addendum targets into the generated `catalog-data.json`
- validated and re-serialized the data into the local `DeepSkyTarget` schema

OpenNGC and the adapted data in `catalog-data.json` are distributed under `CC-BY-SA-4.0`.
See `CC-BY-SA-4.0.txt` in this directory for the full license text.

OpenNGC is provided as-is and without warranties. See the license text for the full disclaimer.

This project is not affiliated with or endorsed by the OpenNGC authors.
