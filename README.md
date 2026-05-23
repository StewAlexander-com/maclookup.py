# maclookup.py

Look up a MAC address's manufacturer in any format without an internet connection.

## Description

maclookup.py is a Python script that allows you to quickly look up the manufacturer of network devices using their MAC addresses. It works offline by using a local database (oui.csv) containing MAC address prefixes and their corresponding manufacturer information.

## Features

- Supports multiple MAC address formats:
  - Colon-separated (00:1A:7D)
  - Hyphen-separated (00-1A-7D)
  - Dot-separated (0000.0C12)
  - Raw format (001A7D)
- Works completely offline
- Clean ASCII-formatted output
- Case-insensitive input
- Interactive command-line interface

## Requirements

- Python 3.x
- CSV file containing MAC address OUI (Organizationally Unique Identifier) data named `oui.csv` (provided)

## Installation

1. Clone this repository or download the `maclookup.py` script
2. Ensure you have the `oui.csv` file in the same directory as the script
3. Make the script executable (Unix-like systems):
   ```bash
   chmod +x maclookup.py
   ```

## Usage

Run the script from the command line:

```bash
./maclookup.py
```

or

```bash
python3 maclookup.py
```
or 

**_If you have an iPhone_**, copy the `maclookup.py` and `oui.csv` to iCloud for easy use by the  Pythonista app for iPhone

### During runtime

When prompted, enter a MAC address in any of the supported formats. Type 'q' or 'quit' to exit the program.

Example input formats:
- 00:1A:7D
- 00-1A-7D
- 001A7D
- 0000.0C12

## CSV File Format

The script expects an `oui.csv` file with the following column structure:
1. Index
2. MAC prefix
3. Organization name
4. Organization address

## Keeping `oui.csv` up to date

`oui.csv` is the IEEE MA-L registry mirror
(`https://standards-oui.ieee.org/oui/oui.csv`). A GitHub Actions workflow
(`.github/workflows/update-oui.yml`) refreshes it weekly and opens a PR when
the file changes; PR creation (not direct push) keeps the update reviewable
and runs the test suite first.

To refresh locally:

```bash
python3 scripts/update_oui.py        # download + validate + write oui.csv
python3 scripts/update_oui.py --check # validate upstream without writing
python3 -m unittest discover -s tests
```

The updater rejects truncated or malformed downloads (header mismatch,
row count below floor, or >2% shrink vs. the committed file).

For the automated PR workflow to function, the repo's Settings → Actions →
General must allow GitHub Actions to create pull requests. No additional
secrets are required — the default `GITHUB_TOKEN` is sufficient.

## License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
