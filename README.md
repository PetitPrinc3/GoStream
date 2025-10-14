# GoStream

GoStream is a web-based application for controlling multiple GoPro cameras, viewing their files, and streaming their video feeds. It is designed to run on a Linux-based system and provides a user-friendly interface for managing your cameras.

![GoStream UI](https://i.imgur.com/your-screenshot.png) <!-- Replace with a real screenshot URL -->

## Features

- **Multi-Camera Control:** Manage multiple GoPro cameras from a single interface.
- **Live Streaming:** Start and stop video streams from your cameras.
- **Recording:** Start and stop recording on each camera.
- **File Management:** Browse, download, and delete files directly from the cameras' SD cards.
- **OBS Integration:** Automatically generate an OBS scene collection to use your GoPros as live sources.
- **Real-time Monitoring:** View live traffic data for each camera stream.

## Architecture

The project is divided into two main components:

-   **`GoStream - API`**: A Python backend built with FastAPI that handles all communication with the GoPro cameras and manages the video stream forwarding.
-   **`GoStream - UI`**: A React frontend built with Vite that provides the user interface for controlling the system.

---

## Setup and Installation

### Prerequisites

**System:**
- A **Linux-based operating system** is required for the backend, as it relies on Linux-specific networking tools.
- **Python 3.8+** and `pip`.
- **Node.js v18+** and `npm`.

**Linux Tools:**
You will need to install the following command-line utilities. On Debian-based systems (like Raspberry Pi OS or Ubuntu), you can install them with:
```bash
sudo apt-get update
sudo apt-get install -y iproute2 gstreamer1.0-tools lsof
```

### Backend Setup (GoStream - API)

1.  **Navigate to the API directory:**
    ```bash
    cd "GoStream - API"
    ```

2.  **Create and activate a virtual environment (recommended):**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **Install the required Python packages:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the API server:**
    ```bash
    uvicorn api:app --host 0.0.0.0 --port 8000
    ```
    The API will now be running and accessible on port 8000 of the host machine.

### Frontend Setup (GoStream - UI)

1.  **Navigate to the UI directory:**
    ```bash
    cd "GoStream - UI"
    ```

2.  **Install the required Node.js packages:**
    ```bash
    npm install
    ```

3.  **Run the frontend development server:**
    ```bash
    npm run dev
    ```
    The UI will now be running and accessible on `http://localhost:5173` (or the port specified by Vite).

---

## Usage

1.  **Connect GoPros:** Connect your GoPro cameras to the Linux machine via USB. They should be automatically detected by the backend.
2.  **Access the UI:** Open your web browser and navigate to the address of the frontend (e.g., `http://localhost:5173`).
3.  **Add a Host:** On the "Home" tab, enter a name for your host and its address (e.g., `127.0.0.1:8000` if running on the same machine) and click "Add".
4.  **Control Cameras:** A new tab will appear for your host. From there, you can:
    -   View all detected GoPros.
    -   Use the switches to take control, start/stop streaming, and start/stop recording.
    -   Use the "Stream All" and "Record All" switches to control all cameras on that host simultaneously.
5.  **Manage Files:** The "File Explorer" panel shows all files on all connected cameras. You can select files to download or delete them.
6.  **OBS Integration:** From the "Home" tab, click "Download OBS Scene" to get a JSON file that you can import into OBS to automatically set up a scene with all your active streams.