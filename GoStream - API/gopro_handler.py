import subprocess
import re
import requests
import argparse
import psutil
from time import sleep, strftime, localtime
from pydantic import BaseModel

ip_binary = '/usr/sbin/ip'
ffmpeg_binary = '/usr/bin/ffmpeg'
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

gorpro_presets = [
    # Mode easy
    '/gopro/camera/setting?option=0&setting=175',
    # Mode vidéo
    '/gopro/camera/presets/set_group?id=1000',
    # Mode plein écran
    '/gopro/camera/setting?option=0&setting=193',
    # Qualité 4k
    '/gopro/camera/setting?option=1&setting=186',
    # Super Slow-Mo
    '/gopro/camera/setting?option=101&setting=176'
]

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

    def update_status(self):
        self.ctrl = self.getControlStatus()
        self.strm = self.getStreamStatus()
        self.rcrd = self.getRecordingStatus()
        self.getFiles()
        return self

    def getCameraIp(self):
        return '.'.join([bit for bit in self.device_ip.split('.')[:-1]] + ['51'])

    def getControlStatus(self):
        try:
            response = requests.get(''.join(['http://', self.getCameraIp(), gopro_stat_path]), timeout=2)
            if response.status_code == 200 and 'status' in response.json() and "114" in response.json()["status"]:
                return response.json()["status"]["114"] == 2
            if response.status_code == 200 and 'status' in response.json() and "115" in response.json()["status"]:
                return response.json()["status"]["115"] == 1
            if response.status_code == 200 and 'status' in response.json() and "116" in response.json()["status"]:
                return response.json()["status"]["116"] == 1
        except requests.exceptions.RequestException:
            pass
        return None # Return None on error

    def getStreamStatus(self):
        try:
            response = requests.get(''.join(['http://', self.getCameraIp(), gopro_stat_path]), timeout=2)
            if response.status_code == 200 and 'status' in response.json() and "32" in response.json()["status"]:
                return response.json()["status"]["32"] == 1
        except requests.exceptions.RequestException:
            pass
        return None # Return None on error

    def getRecordingStatus(self): # Added self
        try:
            response = requests.get(''.join(['http://', self.getCameraIp(), gopro_stat_path]), timeout=2)
            if response.status_code == 200 and 'status' in response.json() and "10" in response.json()["status"]:
                return response.json()["status"]["10"] == 1
        except requests.exceptions.RequestException:
            pass
        return None # Return None on error

    def reboot(self):
        try:
            response = requests.get(''.join(['http://', self.getCameraIp(), gopro_reboot_path]), timeout=2)
            if response.status_code != 200 or ('err_msg' in response.json() and response.json()['err_msg'] != 'Success'):
                return False, f'❌ Error rebooting {self.device}.'
        except requests.exceptions.RequestException as e:
            return False, f'❌ Network error rebooting {self.device}: {e}'
        return f'✔  Rebooting {self.device}...'

    def takeControl(self):
        try:
            response = requests.get(''.join(['http://', self.getCameraIp(), usb_mode_path]), timeout=2)
            if response.status_code != 200 or ('err_msg' in response.json() and response.json()['err_msg'] != 'Success'):
                return False, f'❌ Error switching {self.device} to USB mode.'

            response = requests.get(''.join(['http://', self.getCameraIp(), usb_control_path]), timeout=2)
            if response.status_code != 200 or ('err_msg' in response.json() and response.json()['err_msg'] != 'Success'):
                return False, f'❌ Error taking control of {self.device} over USB.'
        except requests.exceptions.RequestException as e:
            return False, f'❌ Network error taking control of {self.device}: {e}'

        for preset in gorpro_presets:
            try:
                response = requests.get(''.join(['http://', self.getCameraIp(), preset]), timeout=2)
                if response.status_code != 200 or ('error' in response.json()):
                    print(preset)
                    print(''.join(['http://', self.getCameraIp(), preset]))
                    print(response.json())
                    return False, f'❌ Error loading presets on device {self.device}.'
            except requests.exceptions.RequestException as e:
                return False, f'❌ Error loading presets on device {self.device}.'

        return True, f'✔  Took control of {self.device}.'

    def startStream(self):
        controlled, msg = self.takeControl()
        if not controlled: return msg

        if self.getStreamStatus():
            return f'✔  Stream already running for {self.device}.'

        requests.get(''.join(['http://', self.getCameraIp(), stop_stream_path]), timeout=2)
        response = requests.get(''.join(['http://', self.getCameraIp(), start_stream_path, str(self.port)]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error starting stream for {self.device} on port {self.port}.'

        sleep(1)

        if self.getStreamStatus():
            return f'🔥 Started stream for {self.device} on port {self.port}.'
        else:
            return f'⚠️ Something went wrong starting stream on {self.device}.'

    def stopStream(self):
        if not self.getStreamStatus():
            return f'✔  No active stream for {self.device}.'

        response = requests.get(''.join(['http://', self.getCameraIp(), stop_stream_path]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error stopping stream for {self.device}.'

        sleep(1)

        if not self.getStreamStatus():
            return f'✔  Stopped stream for {self.device}.'
        else:
            return f'⚠️ Something went wrong stopping stream on {self.device}.'

    def startRecording(self):
        controlled, msg = self.takeControl()
        if not controlled: return msg

        if self.getRecordingStatus():
            return f'✔  Recording already running for {self.device}.'

        response = requests.get(''.join(['http://', self.getCameraIp(), start_recording_path]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error starting recording for {self.device}.'


        sleep(1)

        if self.getRecordingStatus():
            return f'🔥 Started recording for {self.device}.'
        else:
            return f'⚠️ Something went wrong starting recording on {self.device}.'

    def stopRecording(self): # Renamed
        if not self.getRecordingStatus():
            return f'✔  No active recording for {self.device}.'

        response = requests.get(''.join(['http://', self.getCameraIp(), stop_recording_path]), timeout=2)

        if response.status_code != 200:
            return f'❌ Error stopping recording for {self.device}.'

        sleep(2)

        if not self.getRecordingStatus():
            return f'✔  Stopped recording for {self.device}.'
        else:
            return f'⚠️ Something went wrong stopping recording on {self.device}.'

    def getFiles(self):
        try:
            response = requests.get(''.join(['http://', self.getCameraIp(), media_list_path]), timeout=2)

            if response.status_code != 200 or not 'media' in response.json():
                return f'❌ Error fetching file list for {self.device}.'

            self.files = []

            for folder in response.json()['media']:
                for file in folder['fs']:
                    file = File(file['n'], '/'.join([folder['d'], file['n']]), str(round(int(file['s'])/1000000, 1)) + 'Mib',  strftime('%Y-%m-%d %H:%M:%S', localtime(int(file['mod']))))
                    if file not in self.files:
                        self.files.append(file)
            return f'✔  Fetched {len(self.files)} files from {self.device}.'
        except requests.exceptions.RequestException as e:
            return f'❌ Network error fetching files from {self.device}: {e}'

    def getDownloadUrl(self, filepath):
        return ''.join(['http://', self.getCameraIp(), media_download_path, filepath])

    def downloadFile(self, filepath):
        response = requests.get(self.getDownloadUrl(filepath), stream=True, timeout=2)

        if response.status_code != 200:
            return f'❌ Error downloading file {filepath} from {self.device}.'

    def removeFile(self, filepath):
        response = requests.get(''.join(['http://', self.getCameraIp(), media_delete_path, filepath]), timeout=2)

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


def get_gopros():
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
                if check_port_availability(temp_port):
                    first_port = temp_port
                    port_found = True
                else:
                    temp_port += 1
            
            gopro = GoPro(dev, ip_address, first_port)
            gopro.update_status()
            logs.append(gopro.getFiles())
            devices.append(gopro)
            first_port += 1


    logs.append('=================================================')
    logs.append(f'🚀 Found {len(devices)} GoPros:')
    for dev in devices:
        logs.append(f'   > {dev.device} : {dev.device_ip} (Port: {dev.port})')
    logs.append('=================================================')
    return devices, logs

def check_port_availability(port):
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

    devices, logs = get_gopros()
    for log in logs:
        print(log)

    if not devices:
        print("No GoPros found. Exiting.")
        exit()

    if args.start:
        for device in devices:
            print(device.startStream())

    if args.stop:
        for device in devices:
            print(device.stopStream())
            
    if args.check:
        for device in devices:
            stream_status = "Streaming" if device.getStreamStatus() else "Not Streaming"
            rec_status = "Recording" if device.getRecordingStatus() else "Not Recording"
            print(f"{device.device} ({device.device_ip}): {stream_status}, {rec_status}")

    print()