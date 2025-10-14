from fastapi import FastAPI, Query
from gopro_handler import GoPro, get_gopros
import psutil
import netifaces
import subprocess
import os
import signal
import httpx
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask
from asyncio import sleep, gather
from pydantic import BaseModel
from typing import List
import json

forwarder_bin = "/usr/bin/gst-launch-1.0"

# In-memory state for active streams
# Structure: { "gopro_device_id": { "name": str, "port": int, "destination": str, "pid": int } }
ACTIVE_STREAMS = {}

app = FastAPI()

@app.on_event("startup")
def reconcile_active_streams():
    """
    On startup, scan for running gst-launch-1.0 processes, clean up any duplicates for a single device,
    and repopulate the ACTIVE_STREAMS state to avoid orphans.
    """
    print("Reconciling active streams on startup...")
    
    # Temporary storage for found forwarders, grouped by device name
    found_forwarders = {}

    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if 'gst-launch-1.0' in proc.name() and proc.cmdline():
                cmdline = proc.cmdline()
                
                source_ip = None
                port = None
                destination_ip = None
                device_name = None

                # This logic is brittle, but it's the best we can do without more context
                for i, arg in enumerate(cmdline):
                    if 'address=' in arg:
                        source_ip = arg.split('=')[1]
                    elif 'port=' in arg:
                        port = int(arg.split('=')[1])
                    elif 'host=' in arg:
                        destination_ip = arg.split('=')[1]
                
                # Infer device name from source IP
                if source_ip:
                    for iface in netifaces.interfaces():
                        ifaddresses = netifaces.ifaddresses(iface)
                        if netifaces.AF_INET in ifaddresses:
                            for addr_info in ifaddresses[netifaces.AF_INET]:
                                if addr_info['addr'] == source_ip:
                                    device_name = iface
                                    break
                        if device_name:
                            break
                
                if device_name and port and destination_ip:
                    if device_name not in found_forwarders:
                        found_forwarders[device_name] = []
                    found_forwarders[device_name].append({
                        "name": device_name,
                        "port": port,
                        "destination": destination_ip,
                        "pid": proc.pid
                    })
        except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
            continue

    # Now, reconcile duplicates
    for device_name, streams in found_forwarders.items():
        if len(streams) > 1:
            print(f"Found {len(streams)} forwarders for {device_name}. Cleaning up orphans...")
            # Sort by PID descending (newest first)
            streams.sort(key=lambda x: x['pid'], reverse=True)
            
            # Keep the newest one
            stream_to_keep = streams[0]
            ACTIVE_STREAMS[device_name] = stream_to_keep
            print(f"Keeping forwarder for {device_name} with PID {stream_to_keep['pid']}.")

            # Terminate the rest
            for stream_to_terminate in streams[1:]:
                try:
                    print(f"Terminating orphaned forwarder for {device_name} with PID {stream_to_terminate['pid']}.")
                    os.killpg(stream_to_terminate['pid'], signal.SIGTERM)
                except ProcessLookupError:
                    print(f"Orphaned process with PID {stream_to_terminate['pid']} already gone.")
                except Exception as e:
                    print(f"Error terminating process {stream_to_terminate['pid']}: {e}")
        elif streams:
            # Only one found, so it's the one to keep
            stream = streams[0]
            ACTIVE_STREAMS[device_name] = stream
            print(f"Found existing forwarder for {device_name} (PID: {stream['pid']}). Restoring state.")

    print("Reconciliation complete.")


# CORS configuration
origins = [
    "*",  # Allow all origins
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get('/')
async def up():
    return {'GoStream'}

# System queries (interfaces)

def get_cidr_from_mask(mask):
    bits = mask.split('.')
    if len(bits) != 4:
        return 0
    cidr = 0
    for bit in bits:
        if int(bit) > 255 or int(bit) < 0:
            return 0
        cidr += bin(int(bit))[2:].count('1')
    return str(cidr)

@app.get('/system/interfaces/list')
def get_interfaces():
    interfaces = {}
    devices = netifaces.interfaces()
    for device in devices:
        try:
            interface = netifaces.ifaddresses(device)[netifaces.AF_INET][0]
            interfaces[device] = interface['addr'] + '/' + get_cidr_from_mask(interface['netmask'])
        except (KeyError, IndexError):
            pass # Ignore interfaces without an IPv4 address
    return interfaces

@app.get('/system/interfaces/prefered')
def get_prefered_interface():
    try:
        prefered_interface = netifaces.gateways()['default'][netifaces.AF_INET][1]
        return {'interface': prefered_interface}
    except (KeyError, IndexError):
        return {'interface': None}

@app.get('/system/interfaces/{interface}/traffic')
async def get_interface_traffic(interface: str):
    if interface in psutil.net_io_counters(pernic=True):
        return psutil.net_io_counters(pernic=True)[interface].bytes_recv
    else:
        return 0

# Stream forwarding

def stop_all_forwarders_for_gopro(gopro: GoPro):
    """Finds and kills all gst-launch-1.0 processes for a specific GoPro based on its source IP."""
    logs = []
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if 'gst-launch-1.0' in proc.name() and proc.cmdline():
                cmd = proc.cmdline()
                # Match only on the source IP, as port can change and there should only be one forwarder per camera.
                is_matching_gopro = f'address={gopro.device_ip}' in cmd
                if is_matching_gopro:
                    logs.append(f"Found and stopped matching forwarder for {gopro.device} with PID {proc.pid}.")
                    os.killpg(proc.pid, signal.SIGTERM)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return "; ".join(logs)

@app.get('/system/forward/start/{source}/{port}/{destination}')
async def forward_stream(source: str, port: int, destination: str):
    forwarding_cmd = [forwarder_bin, '-v', 'udpsrc', f'address={source}', f'port={port}', '!', 'queue', '!', 'udpsink', f'host={destination}', f'port={port}']
    process = subprocess.Popen(
        forwarding_cmd,
        preexec_fn=os.setsid,
        stdout=subprocess.PIPE
    ) 
    return process.pid

@app.get('/system/forward/stop/{pid}')
async def stop_forwarding(pid: int):
    try:
        os.killpg(pid, signal.SIGTERM)
        return {'status': 'OK'}
    except ProcessLookupError:
        return {'status': "Process doesn't exist"}
    except:
        return {'error': 'ERR'}

# OBS Scene Collection

class StreamInfo(BaseModel):
    name: str
    port: int
    destination: str

@app.post('/obs/config')
async def generate_obs_config():
    scene_name = "GoStream"
    
    streams = [StreamInfo(**info) for info in ACTIVE_STREAMS.values()]
    
    scene_items = []
    sources = []
    
    # Simple grid layout
    x, y = 0, 0
    canvas_width, canvas_height = 1920, 1080 # Assuming a 1080p canvas
    num_streams = len(streams)
    
    cols = 0
    if num_streams > 0:
        cols = int(num_streams**0.5)
        if cols * cols < num_streams:
            cols += 1
    
    if cols == 0:
        item_width = 0
        item_height = 0
    else:
        item_width = canvas_width / cols
        item_height = item_width * (9/16) # Assuming 16:9 aspect ratio
    
    rows = 0
    if num_streams > 0 and cols > 0:
        rows = (num_streams + cols - 1) // cols
    
    if rows > 0 and item_height * rows > canvas_height:
        scale_factor = canvas_height / (item_height * rows)
        item_height *= scale_factor
        item_width *= scale_factor

    for i, stream in enumerate(streams):
        source_name = stream.name
        
        # Add source to scene
        scene_items.append({
            "name": source_name,
            "scene_item_id": i + 1,
            "visible": True,
            "locked": False,
            "pos": { "x": x, "y": y },
            "scale": { "x": item_width / 1920, "y": item_height / 1080 },
            "rot": 0,
            "align": 5,
            "bounds_type": 0, # OBS_BOUNDS_NONE
            "bounds_align": 0,
            "bounds": { "x": 1920.0, "y": 1080.0 }
        })
        
        x += item_width
        if (i + 1) % cols == 0:
            x = 0
            y += item_height

        # Add the source itself
        sources.append({
            "id": "ffmpeg_source",
            "version": 2,
            "name": source_name,
            "settings": {
                "is_local_file": False,
                "input": f"udp://{stream.destination}:{stream.port}",
                "input_format": "udp",
                "buffering_mb": 0,
                "hw_decode": True,
                "reconnect_delay_sec": 1
            }
        })

    # Add the scene itself to the sources list
    scene = {
        "id": "scene",
        "version": 2,
        "name": scene_name,
        "settings": {
            "items": scene_items
        }
    }
    sources.insert(0, scene)

    obs_config = {
        "current_program_scene": scene_name,
        "current_scene": scene_name,
        "scene_order": [
            { "name": scene_name }
        ],
        "sources": sources,
        "name": "GoStream Configuration",
        "format_id": "obs-scene-collection-v1"
    }

    return Response(
        content=json.dumps(obs_config, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=gostream.json"}
    )

# GoPro queries

@app.get('/gopros/list')
async def return_gopros():
    gopros, logs = await get_gopros()
    async with httpx.AsyncClient() as client:
        file_tasks = [gopro.getFiles(client) for gopro in gopros]
        file_logs = await gather(*file_tasks)
        logs.extend(file_logs)
    return {'GoPros': [gopro.toJson() for gopro in gopros], 'logs': logs}

@app.post('/gopros/status')
async def get_gopro_status(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    if not gopro.isAlive():
        gopro.ctrl = None
        gopro.strm = None
        gopro.rcrd = None
        return gopro.toJson()
    async with httpx.AsyncClient() as client:
        await gopro.update_status(client)
    return gopro.toJson()

@app.post('/gopros/control')
async def take_control(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        status, logs = await gopro.takeControl(client)
    return {'status': status, 'logs': logs}

@app.post('/gopros/reboot')
async def reboot(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        logs = await gopro.reboot(client)
    return {'logs': logs}

@app.post('/gopros/stream/start')
async def start_stream(payload: dict):
    gopro_json = payload.get('gopro')
    forwarding_data = payload.get('forwarding')

    if not gopro_json:
        return {"error": "gopro data missing"}, 400

    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        # Clean up any existing forwarders for this GoPro to prevent orphans
        stop_all_forwarders_for_gopro(gopro)
        ACTIVE_STREAMS.pop(gopro.device, None)

        logs = await gopro.startStream(client)
        pid = None

        await sleep(1)
        await gopro.update_status(client)

        if gopro.strm and forwarding_data:
            destination = forwarding_data.get('destination')
            source = gopro.device_ip
            port = gopro.port
            
            if destination:
                pid = await forward_stream(
                    source=source,
                    port=port,
                    destination=destination
                )
                logs += f"; Forwarder started with PID {pid}."
                ACTIVE_STREAMS[gopro.device] = {
                    "name": gopro.device,
                    "port": port,
                    "destination": destination,
                    "pid": pid
                }

    response_data = {'logs': logs}
    if pid:
        response_data['pid'] = pid
    
    return response_data

@app.post('/gopros/stream/stop')
async def stop_stream(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        logs = await gopro.stopStream(client)
        forwarder_logs = stop_all_forwarders_for_gopro(gopro)
        if forwarder_logs:
            logs += "; " + forwarder_logs
        ACTIVE_STREAMS.pop(gopro.device, None)
    return {'logs': logs}

@app.post('/gopros/recording/start')
async def start_recording(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        logs = await gopro.startRecording(client)
    return {'logs': logs}

@app.post('/gopros/recording/stop')
async def stop_recording(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        logs = await gopro.stopRecording(client)
    return {'logs': logs}

# File management

@app.post('/gopros/files/list')
async def update_file_list(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        logs = await gopro.getFiles(client)
    return {'GoPro': gopro.toJson(), 'logs': logs}

@app.post('/gopros/files/download')
async def download_file(gopro_json: dict, path: str = Query(None)):
    gopro = GoPro.fromJson(gopro_json)
    download_url = gopro.getDownloadUrl(path)
    client = httpx.AsyncClient(timeout=None)  # Use a longer timeout for large files

    try:
        req = client.build_request("GET", download_url)
        r = await client.send(req, stream=True)
        r.raise_for_status()

        filename = os.path.basename(path)
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Length': r.headers.get('Content-Length'),
            'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length'
        }

        async def stream_content(response):
            async for chunk in response.aiter_bytes():
                yield chunk

        async def close_stream():
            await r.aclose()
            await client.aclose()

        return StreamingResponse(
            stream_content(r),
            media_type='application/octet-stream',
            headers=headers,
            background=BackgroundTask(close_stream)
        )

    except httpx.RequestError as e:
        await client.aclose()
        return Response(content=f"Error connecting to GoPro: {e}", status_code=502)
    except Exception:
        await client.aclose()
        raise

@app.post('/gopros/files/remove')
async def remove_file(gopro_json: dict, path: str = Query(None)):
    gopro = GoPro.fromJson(gopro_json)
    async with httpx.AsyncClient() as client:
        logs = await gopro.removeFile(client, path)
        await sleep(1)
        await gopro.getFiles(client)
    return {'GoPro': gopro.toJson(), 'logs': logs}

@app.post('/gopros/files/wipe')
async def wipe_files(gopro_json: dict): # Renamed to avoid conflict
    gopro = GoPro.fromJson(gopro_json)
    logs = []
    async with httpx.AsyncClient() as client:
        for file in gopro.files:
            logs.append(await gopro.removeFile(client, file.path))
        
        await sleep(1)
        
        await gopro.getFiles(client)
    return {'GoPro': gopro.toJson(), 'logs': '; '.join([log for log in logs if log is not None])}
