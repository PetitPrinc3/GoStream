import subprocess
import re
import httpx
import argparse
import psutil
import asyncio
import requests
from time import strftime, localtime, sleep
from pydantic import BaseModel

ip_binary = '/usr/sbin/ip'
lsof_binary = '/usr/bin/lsof'

usb_mode_path="/gopro/camera/control/wired_usb?p=1"
usb_control_path="/gopro/camera/control/set_ui_controller?p=2"
start_recording_path="/gopro/camera/shutter/start"
stop_recording_path="/gopro/camera/shutter/stop"
start_stream_path="/gopro/camera/stream/start?port="
stop_stream_path="/gopro/camera/stream/stop"
gopro_stat_path="/gopro/camera/state"
media_list_path="/gopro/media/list"
media_download_path="/videos/DCIM/"
media_delete_path="/gopro/media/delete/file?path="
gopro_reboot_path="/gp/gpControl/command/system/reset"

first_port = 8554

class File():

    def __init__(self, name, path, size, date):
        self.name = name
        self.path = path
        self.size = size
        self.date = date
        

    def toJson(self):
        return {
            'name': self.name,
            'path': self.path,
            'size': self.size,
            'date': self.date,
        }

    def fromJson(json):
        return File(json['name'], json['path'], json['size'], json['date'])

class GoPro():

    def __init__(self, device, device_ip, port, files=[]):
        self.device = device
        self.device_ip = device_ip
        self.port = port
        self.files = files
        self.ctrl = None
        self.strm = None
        self.rcrd = None

    def isAlive(self):
        dev_command = [ip_binary, '-4', 'token']
        try:
            dev_process = subprocess.run(dev_command, capture_output=True, text=True, check=True)
            return self.device in dev_process.stdout.strip()
        except:
            return False

    def fromJson(json):
        gopro = GoPro(json['device'], json['ip'], json['port'], [File.fromJson(file) for file in json['files']])
        gopro.ctrl = json.get('ctrl')
        gopro.strm = json.get('strm')
        gopro.rcrd = json.get('rcrd')
        return gopro

    async def update_status(self, client: httpx.AsyncClient):
        self.ctrl = await self.getControlStatus(client)
        self.strm = await self.getStreamStatus(client)
        self.rcrd = await self.getRecordingStatus(client)
        await self.getFiles(client)
        return self

    def getCameraIp(self):
        return '.'.join([bit for bit in self.device_ip.split('.')[:-1]] + ['51'])

    async def getControlStatus(self, client: httpx.AsyncClient):
        try:
            response = await client.get(''.join(['http://', self.getCameraIp(), gopro_stat_path]), timeout=2)
            if response.status_code == 200 and 'status' in response.json() and "114" in response.json()["status"]:
                return response.json()["status"]["114"] == 2
            if response.status_code == 200 and 'status' in response.json() and "115" in response.json()["status"]:
                return response.json()["status"]["115"] == 1
            if response.status_code == 200 and 'status' in response.json() and "116" in response.json()["status"]:
                return response.json()["status"]["116"] == 1
        except httpx.RequestError:
            pass
        return None # Return None on error

    async def getStreamStatus(self, client: httpx.AsyncClient):
        try:
            response = await client.get(''.join(['http://', self.getCameraIp(), gopro_stat_path]), timeout=2)
            if response.status_code == 200 and 'status' in response.json() and "32" in response.json()["status"]:
                return response.json()["status"]["32"] == 1
        except httpx.RequestError:
            pass
        return None # Return None on error

    async def getRecordingStatus(self, client: httpx.AsyncClient): # Added self
        try:
            response = await client.get(''.join(['http://', self.getCameraIp(), gopro_stat_path]), timeout=2)
            if response.status_code == 200 and 'status' in response.json() and "10" in response.json()["status"]:
                return response.json()["status"]["10"] == 1
        except httpx.RequestError:
            pass
        return None # Return None on error

    async def reboot(self, client: httpx.AsyncClient):
        try:
            response = await client.get(''.join(['http://', self.getCameraIp(), gopro_reboot_path]), timeout=2)
            if response.status_code != 200 or ('err_msg' in response.json() and response.json()['err_msg'] != 'Success'):
                return False, f'❌ Error rebooting {self.device}.'
        except httpx.RequestError as e:
            return False, f'❌ Network error rebooting {self.device}: {e}'
        return f'✔  Rebooting {self.device}...'

    async def takeControl(self, client: httpx.AsyncClient, force=False):
        if not self.isAlive():
            return False, f'❌ GoPro {self.device} is not online.'
        try:
            # 1. Identify as Third-Party (Recommended for HERO12)
            try:
                await client.get(''.join(['http://', self.getCameraIp(), '/gopro/camera/analytics/set_client_info']), timeout=2)
            except: pass

            # 2. Get Camera Info
            model_name = "Unknown"
            try:
                info_resp = await client.get(''.join(['http://', self.getCameraIp(), '/gopro/camera/info']), timeout=2)
                if info_resp.status_code == 200:
                    model_name = info_resp.json().get('model_name', "Unknown")
            except: pass

            # 3. Hard-Stop everything to clear 403 "Busy" states
            # ONLY if force=True or if we are not recording/streaming
            if force:
                try:
                    await client.get(''.join(['http://', self.getCameraIp(), stop_stream_path]), timeout=2)
                    await asyncio.sleep(0.2)
                    await client.get(''.join(['http://', self.getCameraIp(), stop_recording_path]), timeout=2)
                    await asyncio.sleep(0.5)
                except: pass

            # 4. Sync Date and Time
            now = localtime()
            date_str = strftime('%Y_%m_%d', now)
            time_str = strftime('%H_%M_%S', now)
            sync_path = f"/gopro/camera/set_date_time?date={date_str}&time={time_str}"
            await client.get(''.join(['http://', self.getCameraIp(), sync_path]), timeout=2)

            # 5. Switch to USB Mode & Take Control
            await client.get(''.join(['http://', self.getCameraIp(), usb_mode_path]), timeout=2)
            await asyncio.sleep(0.5)
            await client.get(''.join(['http://', self.getCameraIp(), usb_control_path]), timeout=2)
            await asyncio.sleep(1.5) # Wait for UI controller

            # 6. FORCE Pro Mode and Disable Easy Mode (Critical for HERO12)
            await client.get(''.join(['http://', self.getCameraIp(), '/gopro/camera/setting?option=1&setting=175']), timeout=2)
            await asyncio.sleep(1.0) # Long breath for mode switch

            # 7. Apply presets with HERO12 specific ordering
            failed_presets = []
            
            init_sequence = [
                ('/gopro/camera/presets/set_group?id=1000', 'Video Mode'),
                ('/gopro/camera/setting?option=9&setting=2', '1080p Res'),
                ('/gopro/camera/setting?option=1&setting=108', '16:9 Ratio'),
                ('/gopro/camera/setting?option=1&setting=3', '120 FPS'),
                ('/gopro/camera/setting?option=4&setting=121', 'Linear Lens'),
                ('/gopro/camera/setting?option=0&setting=135', 'Hypersmooth Off'),
                ('/gopro/camera/setting?option=2&setting=134', '60Hz Flicker')
            ]

            for path, name in init_sequence:
                try:
                    response = await client.get(''.join(['http://', self.getCameraIp(), path]), timeout=2)
                    if response.status_code != 200:
                        failed_presets.append(f"{name} ({response.status_code})")
                    await asyncio.sleep(0.5) 
                except:
                    failed_presets.append(f"{name} (Err)")

            # 8. Final Keep-Alive
            await client.get(''.join(['http://', self.getCameraIp(), '/gopro/camera/keep_alive']), timeout=2)

            if failed_presets:
                return True, f'✔  Controlled {self.device} ({model_name}) but some presets skipped: {", ".join(failed_presets)}.'
            
            return True, f'✔  Took control of {self.device} ({model_name}) and initialized settings.'
        except Exception as e:
            return False, f'❌ Unexpected error taking control of {self.device}: {e}'

    async def startStream(self, client: httpx.AsyncClient, resolution=12, initialize=True):
        # If we are already recording, we MUST NOT initialize (it stops recording)
        is_recording = await self.getRecordingStatus(client)
        if is_recording:
            initialize = False

        if initialize:
            controlled, msg = await self.takeControl(client, force=True)
            if not controlled: return msg

        if await self.getStreamStatus(client):
            return f'✔  Stream already running for {self.device}.'

        if initialize:
            await client.get(''.join(['http://', self.getCameraIp(), stop_stream_path]), timeout=2)
        
        # When resuming or starting during recording, we DON'T send the resolution to avoid killing an active recording
        res_param = f"&res={resolution}" if initialize else ""
        response = await client.get(''.join(['http://', self.getCameraIp(), start_stream_path, str(self.port), res_param]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error starting stream for {self.device} on port {self.port}.'

        await asyncio.sleep(1)

        if await self.getStreamStatus(client):
            return f'🔥 Started stream for {self.device} on port {self.port}.'
        else:
            return f'⚠️ Something went wrong starting stream on {self.device}.'

    async def stopStream(self, client: httpx.AsyncClient):
        if not await self.getStreamStatus(client):
            return f'✔  No active stream for {self.device}.'

        response = await client.get(''.join(['http://', self.getCameraIp(), stop_stream_path]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error stopping stream for {self.device}.'

        await asyncio.sleep(1)

        if not await self.getStreamStatus(client):
            return f'✔  Stopped stream for {self.device}.'
        else:
            return f'⚠️ Something went wrong stopping stream on {self.device}.'

    async def startRecording(self, client: httpx.AsyncClient):
        # Check if we are already streaming.
        was_streaming = await self.getStreamStatus(client)
        
        if not await self.getControlStatus(client):
            controlled, msg = await self.takeControl(client)
            if not controlled: return msg

        if await self.getRecordingStatus(client):
            return f'✔  Recording already running for {self.device}.'

        response = await client.get(''.join(['http://', self.getCameraIp(), start_recording_path]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error starting recording for {self.device}.'

        await asyncio.sleep(1)
        log_msg = f'🔥 Started recording for {self.device}.'
        
        if was_streaming:
            # Recovery: resume stream WITHOUT initialization to protect recording
            await asyncio.sleep(2) 
            await self.startStream(client, initialize=False)
            log_msg += " (Stream resumed)"

        return log_msg

    async def stopRecording(self, client: httpx.AsyncClient):
        # Check if we were streaming
        was_streaming = await self.getStreamStatus(client)
        
        if not await self.getRecordingStatus(client):
            return f'✔  No active recording for {self.device}.'

        response = await client.get(''.join(['http://', self.getCameraIp(), stop_recording_path]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error stopping recording for {self.device}.'

        await asyncio.sleep(2)
        log_msg = f'✔  Stopped recording for {self.device}.'

        if was_streaming:
            # Recovery: resume stream WITHOUT initialization
            await asyncio.sleep(2)
            await self.startStream(client, initialize=False)
            log_msg += " (Stream resumed)"

        return log_msg

    async def getFiles(self, client: httpx.AsyncClient):
        try:
            response = await client.get(''.join(['http://', self.getCameraIp(), media_list_path]), timeout=2)

            if response.status_code != 200 or not 'media' in response.json():
                return f'❌ Error fetching file list for {self.device}.'

            self.files = []

            for folder in response.json()['media']:
                for file in folder['fs']:
                    file = File(file['n'], '/'.join([folder['d'], file['n']]), str(round(int(file['s'])/1000000, 1)) + 'Mib',  strftime('%Y-%m-%d %H:%M:%S', localtime(int(file['mod']))))
                    if file not in self.files:
                        self.files.append(file)
            return f'✔  Fetched {len(self.files)} files from {self.device}.'
        except httpx.RequestError as e:
            return f'❌ Network error fetching files from {self.device}: {e}'

    def getDownloadUrl(self, filepath):
        return ''.join(['http://', self.getCameraIp(), media_download_path, filepath])

    async def downloadFile(self, client: httpx.AsyncClient, filepath):
        response = await client.get(self.getDownloadUrl(filepath), stream=True, timeout=2)

        if response.status_code != 200:
            return f'❌ Error downloading file {filepath} from {self.device}.'

    async def removeFile(self, client: httpx.AsyncClient, filepath):
        response = await client.get(''.join(['http://', self.getCameraIp(), media_delete_path, filepath]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error removing file {filepath} from {self.device}.'

    def toJson(self):
        return {
            'device': self.device,
            'ip': self.device_ip,
            'port': self.port,
            'files': [ file.toJson() for file in self.files ],
            'ctrl': self.ctrl,
            'strm': self.strm,
            'rcrd': self.rcrd,
        }


async def get_gopros(): 
    global first_port
    logs = []
    dev_command = [ip_binary, '-4', 'token']
    try:
        dev_process = subprocess.run(dev_command, capture_output=True, text=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        logs.append('❌ Error running `ip -4 token`. Is `iproute2` installed?')
        return [], logs

    devices = []
    device_names = set()
    for line in dev_process.stdout.strip().split('\n'):
        parts = line.split()

        if parts and parts[-1].startswith('enx'):
            dev = parts[-1]
            ip_command = [ip_binary, '-4', 'addr', 'show', 'dev', dev]
            try:
                ip_process = subprocess.run(ip_command, capture_output=True, text=True, check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                logs.append(f'❌ Error fetching IP for {dev}.')
                continue

            if ip_process.stdout.strip() == '':
                logs.append(f'⚠️ No IP found for {dev}.')
                continue

            ip_matches = re.findall(r'(\d+\.\d+\.\d+\.\d+)/\d+', ip_process.stdout)
            if not ip_matches:
                logs.append(f'⚠️ No IP found for {dev}.')
                continue
            
            ip_address = ip_matches[0]

            if dev in device_names:
                logs.append(f'⚠️ Duplicated device found for {dev}. Skipping.')
                continue
            device_names.add(dev)

            port_found = False
            temp_port = first_port
            while not port_found:
                if await check_port_availability(temp_port):
                    first_port = temp_port
                    port_found = True
                else:
                    temp_port += 1
            
            gopro = GoPro(dev, ip_address, first_port)
            devices.append(gopro)
            first_port += 1

            async with httpx.AsyncClient() as client:                                                                   
                update_tasks = [dev.update_status(client) for dev in devices]                                                                            
                results = await asyncio.gather(*update_tasks, return_exceptions=True)                                                                    
                for result in results:                                                                                                                    
                    if isinstance(result, Exception):                                                                                                     
                        logs.append(f"Error updating a gopro's status: {result}")

    logs.append('=================================================')
    logs.append(f'🚀 Found {len(devices)} GoPros:')
    for dev in devices:
        logs.append(f'   > {dev.device} : {dev.device_ip} (Port: {dev.port})')
    logs.append('=================================================')
    return devices, logs

async def check_port_availability(port):
    lsof_command = [lsof_binary, '-i', f':{str(port)}']
    try:
        lsof_process = subprocess.run(lsof_command, capture_output=True, text=True)
        return lsof_process.stdout.strip() == ''
    except FileNotFoundError:
        # If lsof is not found, assume port is available but warn the user.
        # This is not ideal but better than crashing.
        # A better solution would be to try to bind to the port.
        return True
    except Exception:
        return False

# Keep the CLI part for standalone usage
if __name__ == "__main__":
    print("""
    ╔═╗┌─┐╔═╗┌┬┐┬─┐┌─┐┌─┐┌┬┐
    ║ ╦│ │╚═╗ │ ├┬┘├┤ ├─┤│││
    ╚═╝└─┘╚═╝ ┴ ┴└─└─┘┴ ┴┴ ┴
""")

    parser = argparse.ArgumentParser()
    parser.add_argument('--start', action='store_true', help="Start streams on all found GoPros")
    parser.add_argument('--stop', action='store_true', help="Stop streams on all found GoPros")
    parser.add_argument('--check', action='store_true', help="Check status of all found GoPros")

    args = parser.parse_args()

    devices, logs = asyncio.run(get_gopros())
    for log in logs:
        print(log)

    if not devices:
        print("No GoPros found. Exiting.")
        exit()

    if args.start:
        for device in devices:
            print(asyncio.run(device.startStream(httpx.AsyncClient())))

    if args.stop:
        for device in devices:
            print(asyncio.run(device.stopStream(httpx.AsyncClient())))
            
    if args.check:
        for device in devices:
            stream_status = "Streaming" if asyncio.run(device.getStreamStatus(httpx.AsyncClient())) else "Not Streaming"
            rec_status = "Recording" if asyncio.run(device.getRecordingStatus(httpx.AsyncClient())) else "Not Recording"
            print(f"{device.device} ({device.device_ip}): {stream_status}, {rec_status}")
            print(asyncio.run(device.stopStream(httpx.AsyncClient())))