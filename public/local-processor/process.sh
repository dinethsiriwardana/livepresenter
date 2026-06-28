#!/bin/bash

# Exit immediately if a command fails
set -e

if [ -z "$1" ]; then
    echo "Usage: ./process.sh <path_to_pdf>"
    exit 1
fi

# Ensure Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not installed."
    echo "Please download and install Python 3 from https://www.python.org/"
    exit 1
fi

# Locate the directory of this shell script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run python script
python3 "$SCRIPT_DIR/process_pdf.py" "$1"
