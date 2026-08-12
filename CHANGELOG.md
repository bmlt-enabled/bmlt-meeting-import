## Unreleased
* Import meetings directly from another BMLT root server, keeping duration, venue type, published state, comments, contacts and transit lines, and matching service bodies by name or worldId.
* Add `scripts/bmlt-to-naws.ts` for converting any root server into an importable spreadsheet.
* Support optional `Duration`, `VenueType` and `Published` spreadsheet columns.
* Treat `VirtualMeetingInfo` as virtual meeting data when detecting venue type.
* Ignore the `HYBR` format code during import alongside `TC`, `VM` and `HY`.

## 0.0.1 (Sep 19, 2025)
* Initial release.
