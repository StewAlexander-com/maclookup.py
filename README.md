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
- CSV file containing MAC address OUI (Organizationally Unique Identifier) data named `oui.csv`

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

## License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
