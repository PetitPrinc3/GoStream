# GoStream

GoStream is a web-based interface for controlling and monitoring GoPro cameras connected to a Linux host. It provides a centralized dashboard to manage multiple GoPros across different hosts, view live streams, and manage media files.

## Features

- **Multi-Host Support:** Connect to and manage GoPros on multiple remote hosts.
- **Live Preview:** View live video feeds from all connected GoPros.
- **Global Controls:** Start and stop streaming and recording on all cameras simultaneously.
- **File Management:** Browse, download, and delete media files from each GoPro.
- **Responsive UI:** The interface is designed to work on both desktop and mobile devices.

## Getting Started

### Prerequisites

- Python 3.x
- Node.js and npm
- GStreamer and other system dependencies for the backend API.

### Installation

1.  **Backend API (`GoStream - API`)**
    - Navigate to the `GoStream - API` directory.
    - Install Python dependencies: `pip install -r requirements.txt` (Note: a `requirements.txt` file will need to be created).

2.  **Frontend UI (`GoStream - UI`)**
    - Navigate to the `GoStream - UI` directory.
    - Install Node.js dependencies: `npm install`

### Running the Application

1.  **Start the Backend API:**
    - From the `GoStream - API` directory, run: `uvicorn api:app --reload`

2.  **Start the Frontend UI:**
    - From the `GoStream - UI` directory, run: `npm run dev`

The GoStream UI will then be available at `http://localhost:5173` (or another port if specified).
