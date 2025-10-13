from fastapi import FastAPI
from gopro_handler import GoPro, File, get_gopros
import psutil
import netifaces
import subprocess
import os
import signal
import requests
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from time import sleep

forwarder_bin = "/usr/bin/gst-launch-1.0"

app = FastAPI()

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

# GoPro queries

@app.get('/gopros/list')
async def return_gopros():
    global gopros
    gopros, logs = get_gopros()
    return {'GoPros': [gopro.toJson() for gopro in gopros], 'logs': logs}

@app.post('/gopros/status')
async def get_gopro_status(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    if not gopro.isAlive():
        gopro.ctrl = None
        gopro.strm = None
        gopro.rcrd = None
        return gopro.toJson()
    gopro.update_status()
    return gopro.toJson()

@app.post('/gopros/control')
async def take_control(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    status, logs = gopro.takeControl()
    return {'status': status, 'logs': logs}

@app.post('/gopros/reboot')
async def reboot(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.reboot()
    return {'logs': logs}

@app.post('/gopros/stream/start')
async def start_stream(payload: dict):
    gopro_json = payload.get('gopro')
    forwarding_data = payload.get('forwarding')

    if not gopro_json:
        return {"error": "gopro data missing"}, 400

    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.startStream()
    pid = None

    # Wait for stream to be confirmed by polling status
    sleep(1)
    gopro.update_status()

    if gopro.strm and forwarding_data:
        destination = forwarding_data.get('destination')
        # The source for the forwarder is the host's IP where the stream is received.
        source = gopro.device_ip
        port = gopro.port
        
        if destination:
            pid = await forward_stream(
                source=source,
                port=port,
                destination=destination
            )
            logs += f"; Forwarder started with PID {pid}."

    response_data = {'logs': logs}
    if pid:
        response_data['pid'] = pid
    
    return response_data

@app.post('/gopros/stream/stop')
async def stop_stream(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.stopStream()
    return {'logs': logs}

@app.post('/gopros/recording/start')
async def start_recording(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.startRecording()
    return {'logs': logs}

@app.post('/gopros/recording/stop')
async def stop_recording(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.stopRecording()
    return {'logs': logs}

# File management

@app.post('/gopros/files/list')
async def update_file_list(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.getFiles()
    return {'GoPro': gopro.toJson(), 'logs': logs}

@app.post('/gopros/files/download')
async def download_file(gopro_json: dict, path: str = None):
    gopro = GoPro.fromJson(gopro_json)
    
    download_url = gopro.getDownloadUrl(path)
    try:
        r = requests.get(download_url, stream=True, timeout=10)
        r.raise_for_status()
        
        filename = os.path.basename(path)
        
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Length': r.headers.get('Content-Length'),
            'Access-Control-Expose-Headers': 'Content-Length'
        }

        return StreamingResponse(
            r.iter_content(chunk_size=8192), 
            media_type='application/octet-stream',
            headers=headers
        )
    
    except requests.exceptions.RequestException as e:
        return Response(content=f"Error connecting to GoPro: {e}", status_code=502)

@app.post('/gopros/files/remove')
async def remove_file(gopro_json: dict, path: str = None):
    gopro = GoPro.fromJson(gopro_json)
    logs = gopro.removeFile(path)
    
    sleep(1)

    gopro.getFiles()
    return {'GoPro': gopro, 'logs': logs}

@app.post('/gopros/files/wipe')
async def remove_file(gopro_json: dict):
    gopro = GoPro.fromJson(gopro_json)
    logs = []
    for file in gopro.files:
        logs.append(gopro.removeFile(file.path))
    
    sleep(1)
    
    gopro.getFiles()
    return {'GoPro': gopro, 'logs': '; '.join([log for log in logs if log != None])}
