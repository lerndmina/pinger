# Network Ping Monitor

A real-time network latency monitoring tool with a terminal-based UI built with TypeScript and Bun.

![Screenshot](screenshot.png)

## Features

- Real-time ping monitoring with visual graphs
- Terminal-based user interface with blessed
- SQLite-based persistence for historical data
- Cross-platform support (Windows, Linux, MacOS)
- Live statistics including:
  - Success/failure rates
  - Average latency
  - 99th percentile latency
  - Maximum latency
- Rolling 50-point latency history graph
- Automatic log management
- Target host persistence

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- [Node.js](https://nodejs.org) installed
- [Python](https://www.python.org) installed

## Installation

1. Clone the repository:
    ```bash
    git clone https://github.com/lerndmina/pinger
    ```

2. Navigate to the project directory:
    ```bash
    cd pinger
    ```

## Usage

Run the script for your OS:
```bash
# For Unix-based systems
./start.sh

# For Windows
.\start.bat
```

## Help

For help, run:
```bash
./start.sh -h
```

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.

## License

This project is licensed under the WTFPL license.
