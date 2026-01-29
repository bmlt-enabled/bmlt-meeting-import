# BMLT Meeting Import

A tool for importing meetings to BMLT (Basic Meeting List Toolbox) servers. The application
provides a web interface to authenticate with BMLT servers and import meeting data from a spreadsheet.

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

## Virtual and Hybrid Meeting Handling

The import determines venue type automatically based on the data in each row:

- **In-Person** -- Has a street address, no virtual meeting link or phone number.
- **Virtual** -- Has a virtual meeting link or phone number, but no street address.
- **Hybrid** -- Has both a street address and a virtual meeting link or phone number.

Only the `Address` (street address) field is considered when determining if a meeting has a physical location. A `City` value alone does not make a meeting in-person or hybrid, since virtual meetings often have a city listed for informational or geocoding purposes.

### Restricted Formats

The following NAWS format codes are automatically managed by the BMLT server based on the venue type and are **ignored during import**:

- **TC** -- Temporarily Closed
- **VM** -- Virtual Meeting
- **HY** -- Hybrid

These formats do not need to be removed from the spreadsheet. The importer skips them, and the server applies the correct formats based on the venue type.

## API Validation

The BMLT server enforces validation rules when creating meetings. Common errors include:

- **Hybrid meetings must have a street address** -- A meeting was detected as hybrid (has both physical and virtual info), but the `Address` field is empty. Ensure hybrid meetings have a street address, or remove the virtual meeting link if it is actually an in-person meeting.
- **Invalid format IDs** -- A format code in the spreadsheet does not match any format on the server. Check that the server has all expected formats configured.
- **Service body not found** -- The `AreaRegion` world ID does not match any service body on the server. Ensure service bodies are created or matched before importing.

When errors occur, the import will continue processing remaining rows and report all errors at the end with the specific row number that failed.
