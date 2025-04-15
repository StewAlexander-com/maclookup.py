#!/usr/bin/env python3
import csv
import re

def normalize_mac(mac_address):
    """Remove all common MAC separators and convert to uppercase."""
    return re.sub(r'[-:.]', '', mac_address).upper()  # Added dot removal

def search_oui(csv_file, mac_address):
    """Search for MAC OUI in CSV file."""
    normalized_mac = normalize_mac(mac_address)
    oui = normalized_mac[:6]
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as file:
            reader = csv.reader(file)
            next(reader, None)  # Skip header
            
            for row in reader:
                if len(row) >= 4 and normalize_mac(row[1]) == oui:
                    return row[2], row[3]
    except Exception as e:
        print(f"Error: {e}")
    
    return None, None

def format_output(title, content, width=38):
    """Create clean ASCII formatting for output."""
    border = "+" + "-" * (width - 2) + "+"
    lines = [border]
    
    # Add title if present
    if title:
        lines.append(f"| {title.center(width - 4)} |")
        lines.append(border)
    
    # Process content lines
    for line in content.split('\n'):
        while len(line) > 0:
            chunk = line[:width - 4]
            lines.append(f"| {chunk.ljust(width - 4)} |")
            line = line[width - 4:]
    
    lines.append(border)
    return "\n".join(lines)

def main():
    csv_file = "oui.csv"
    
    # Display welcome message
    print(format_output("MAC OUI Lookup", 
                       "Supports formats:\n"
                       "00:1A:7D, 00-1A-7D\n"
                       "001A7D, 0000.0c12\n"
                       "Type 'q' to quit"))
    
    while True:
        user_input = input("\nEnter MAC/OUI or \"q\" for quit): ").strip()
        
        if user_input.lower() in ('q', 'quit'):
            print("\nExiting...")
            break
            
        normalized = normalize_mac(user_input)
        if len(normalized) < 6:
            print(format_output("Error", "Need at least 6 hex characters"))
            continue
        
        org_name, org_address = search_oui(csv_file, user_input)
        
        if org_name and org_address:
            result = f"OUI: {normalized[:6]}\nOrg: {org_name}\nAddress: {org_address}"
            print(format_output("Found", result))
        else:
            print(format_output("Not Found", f"No entry for {normalized[:6]}"))

if __name__ == "__main__":
    main()
    
