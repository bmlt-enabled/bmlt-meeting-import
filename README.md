# BMLT Meeting Import

A tool for importing meetings to BMLT (Basic Meeting List Toolbox) servers. The application
provides a web interface to authenticate with BMLT servers and import meeting data from a spreadsheet
or directly from another BMLT server.

> **Warning:** This tool modifies meeting data directly on the connected BMLT server. Always test imports on a staging or test server before running against a production server. The maintainers are not responsible for any data loss or corruption resulting from use of this tool.

## Import sources

| Source | Use it when | Notes |
|--------|-------------|-------|
| **Spreadsheet** | You have a NAWS export, or you want to review and edit the data before importing | Limited to the NAWS columns below |
| **BMLT Server** | You are moving meetings from one BMLT root server to another | Keeps duration, venue type, published state, comments, contacts and transit lines, and matches service bodies by name so the source does not need NAWS codes |

There is also a command line converter for turning any root server into a spreadsheet you can inspect
before importing -- see [Converting a BMLT server to a spreadsheet](#converting-a-bmlt-server-to-a-spreadsheet).

---

# BMLT Meeting Import Notes

## NAWS Export Format

The import expects a NAWS-format spreadsheet (`.xlsx`, `.xls`, or `.csv`) with the following columns ([download example](https://github.com/bmlt-enabled/bmlt-meeting-import/raw/refs/heads/main/public/BMLT_Export_Example.xlsx)):

| Column             | Required | Description                                               |
|--------------------|----------|-----------------------------------------------------------|
| Committee          | No       | World ID for the meeting (e.g., `G00091078`)              |
| CommitteeName      | **Yes**  | Meeting name                                              |
| AreaRegion         | **Yes**  | Service body world ID (e.g., `AR48104`)                   |
| Day                | **Yes**  | Day of the week (e.g., `Sunday`, `Monday`)                |
| Time               | **Yes**  | Start time in HHMM military format (e.g., `1700`)         |
| Place              | No       | Location name (e.g., `St Mary's on the Harbor`)           |
| Address            | No       | Street address                                            |
| City               | No       | City/municipality                                         |
| LocBorough         | No       | Neighborhood/borough                                      |
| State              | No       | State/province                                            |
| Zip                | No       | Postal code                                               |
| Country            | No       | Country code                                              |
| Directions         | No       | Additional directions                                     |
| Room               | No       | Room information                                          |
| Closed             | No       | Open/Closed format (e.g., `OPEN`, `CLOSED`)               |
| WheelChr           | No       | Wheelchair accessible (`TRUE`/`FALSE`)                    |
| Format1-5          | No       | NAWS format codes (e.g., `DISC`, `STEP`, `BEG`)           |
| Longitude          | No       | Longitude coordinate                                      |
| Latitude           | No       | Latitude coordinate                                       |
| PhoneMeetingNumber | No       | Phone dial-in number                                      |
| VirtualMeetingLink | No       | URL for virtual meeting (e.g., Zoom link)                 |
| VirtualMeetingInfo | No       | Additional virtual meeting details                        |
| TimeZone           | No       | IANA timezone (e.g., `America/New_York`)                  |
| Delete             | No       | Set to `D` to skip the row                                |
| ParentName         | No       | Parent service body name (used for service body creation) |

Rows marked with `D` in the Delete column are skipped. Rows missing any of the four required columns are also skipped.

### Extra columns

These are not part of the NAWS format. Add them when you want per-meeting control instead of the
import-wide default; leave them out and nothing changes.

| Column    | Accepts                                            | Falls back to                    |
|-----------|----------------------------------------------------|----------------------------------|
| Duration  | `01:30`, `01:30:00`, or minutes (`90`)              | The import's default duration    |
| VenueType | `1`/`2`/`3`, or `In-Person`/`Virtual`/`Hybrid`      | Detection from the row's data    |
| Published | `TRUE`/`FALSE`, `1`/`0`, `yes`/`no`                 | The import's default             |

A value that can't be understood produces a warning and falls back rather than failing the row.

## Virtual and Hybrid Meeting Handling

When a row has no `VenueType` column, the import works the venue type out from the data:

- **In-Person** -- Has a street address and no virtual meeting details.
- **Virtual** -- Has virtual meeting details but no street address.
- **Hybrid** -- Has both a street address and virtual meeting details.

"Virtual meeting details" means any of `VirtualMeetingLink`, `PhoneMeetingNumber`, or
`VirtualMeetingInfo`. That last one matters for exports that only publish a dial-in string such as
`Zoom ID: 878 7947 7097, Password: JFT2023` with no link -- without it those meetings would import as
in-person.

Only the `Address` (street address) field is considered when determining if a meeting has a physical location. A `City` value alone does not make a meeting in-person or hybrid, since virtual meetings often have a city listed for informational or geocoding purposes.

A `VenueType` value in the row always wins over this detection.

### Restricted Formats

The following NAWS format codes are automatically managed by the BMLT server based on the venue type and are **ignored during import**:

- **TC** -- Temporarily Closed
- **VM** -- Virtual Meeting
- **HY** / **HYBR** -- Hybrid

These formats do not need to be removed from the spreadsheet. The importer skips them, and the server applies the correct formats based on the venue type.

## API Validation

The BMLT server enforces validation rules when creating meetings. Common errors include:

- **Hybrid meetings must have a street address** -- A meeting was detected as hybrid (has both physical and virtual info), but the `Address` field is empty. Ensure hybrid meetings have a street address, or remove the virtual meeting link if it is actually an in-person meeting.
- **Invalid format IDs** -- A format code in the spreadsheet does not match any format on the server. Check that the server has all expected formats configured.
- **Service body not found** -- The `AreaRegion` world ID does not match any service body on the server. Ensure service bodies are created or matched before importing.

When errors occur, the import will continue processing remaining rows and report all errors at the end with the specific row number that failed.

---

# Importing From Another BMLT Server

The **BMLT Server** source copies meetings straight from another root server's public interface, with
no spreadsheet in between. Enter the source root server URL, read it, review what the tool found, and
import.

Because nothing is squeezed through the NAWS columns, this path keeps everything BMLT models:
duration, venue type, published state, `location_info`, comments, contacts, and bus/train lines.

## Service body matching

Source service bodies are paired with the destination's by **worldId** first, then by **name**
(case and spacing insensitive). Anything unmatched is created, and parents are created before their
children so the source hierarchy is rebuilt -- including parents that hold no meetings themselves.

This is what makes the path usable against a server that never set its NAWS codes: names are enough.

## Format matching

Source formats are paired by **worldId** first, then by **key** (`OPEN`, `BT`, `WCHR`, ...). Formats
the destination has no equivalent for are listed in the preview and dropped from the import; the
venue formats above are skipped because the server applies them itself.

## Options

| Option                        | Effect                                                                 |
|-------------------------------|------------------------------------------------------------------------|
| Service body ids              | Only read these source service body ids (comma separated); blank reads all |
| Include child service bodies  | With a service body filter, also include everything beneath it          |
| Include unpublished meetings  | Copy unpublished meetings too; they stay unpublished                    |
| Fallback time zone            | Used for meetings whose source has no time zone set                     |

## Things to know

- A hybrid meeting with no street address is imported as virtual, since the server rejects the former.
- Meetings that already exist on the destination with the same world ID are skipped, same as a file import.
- Newly created service bodies use the logged-in user as their administrator.

---

# Converting a BMLT Server to a Spreadsheet

`scripts/bmlt-to-naws.ts` reads any root server and writes a spreadsheet this tool can import. Use it
when you want to look the data over -- or hand it to someone else -- before anything is written to a
server. It needs no credentials, only Node 22.6+ (it runs TypeScript directly).

```
npm run export:naws -- https://bmlt.example.org/main_server/ --out meetings.xlsx
```

| Option                     | Effect                                                             |
|----------------------------|--------------------------------------------------------------------|
| `--out <path>`             | Output file, `.xlsx` or `.csv` (default `bmlt-naws-export.xlsx`)     |
| `--services <ids>`         | Only these source service body ids, comma separated                  |
| `--recursive`              | With `--services`, include child service bodies                      |
| `--include-unpublished`    | Include unpublished meetings; they get `Published=FALSE`             |
| `--timezone <IANA>`        | Fallback `TimeZone` for meetings that have none                      |
| `--world-id-prefix <text>` | Infix for generated service body worldIds (default `SB`)             |

The sheet includes the `Duration`, `VenueType` and `Published` columns, so venue types and durations
survive the round trip rather than being re-guessed at import time.

Service bodies with no worldId on the source get a generated one (`ARSB5`, `RGSB1`, ...) so the
importer can create them; `AR` marks an area and `RG` a region. Every generated id is printed when
the script runs -- edit the `AreaRegion` column if the destination already has real codes for them.

The script also reports anything it could not carry across: source formats with no worldId, format
ids missing from `GetFormats`, meetings with more than five formats, and meetings with no time zone.
