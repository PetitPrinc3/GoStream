import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, Typography, Box, Switch, Grid, Menu, MenuItem, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from '@mui/material';
import axios from 'axios';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import { areaElementClasses, lineElementClasses } from '@mui/x-charts/LineChart';

const GoPro = ({ gopro, host, addLog, updateGoProState }) => {
  const [trafficData, setTrafficData] = useState(Array(30).fill(0));
  const lastTrafficData = useRef({ bytes: 0, timestamp: Date.now() });
  const [isControl, setIsControl] = useState(gopro.ctrl || false);
  const [isStream, setIsStream] = useState(gopro.strm || false);
  const [isRecording, setIsRecording] = useState(gopro.rcrd || false);
  const [contextMenu, setContextMenu] = useState(null);
  const [confirmRebootOpen, setConfirmRebootOpen] = useState(false);
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);

  const handleContextMenu = (event) => {
    event.preventDefault();
    setContextMenu(
      contextMenu === null
        ? {
          mouseX: event.clientX + 2,
          mouseY: event.clientY - 6,
        }
        : null,
    );
  };

  const handleCloseMenu = () => {
    setContextMenu(null);
  };

  const handleRebootClick = () => {
    setContextMenu(null);
    setConfirmRebootOpen(true);
  };

  const handleWipeClick = () => {
    setContextMenu(null);
    setConfirmWipeOpen(true);
  };

  const handleCloseConfirm = () => {
    setConfirmRebootOpen(false);
    setConfirmWipeOpen(false);
  };

  const handleConfirmReboot = async () => {
    setConfirmRebootOpen(false);
    addLog(`Rebooting ${gopro.device}...`);
    try {
      await axios.post(`http://${host.address}/gopros/reboot`, gopro);
      addLog(`Reboot command sent to ${gopro.device}.`);
    } catch (error) {
      addLog(`❌ Error rebooting ${gopro.device}: ${error.message}`);
    }
  };

  const handleConfirmWipe = async () => {
    setConfirmWipeOpen(false);
    addLog(`Wiping ${gopro.device}...`);
    try {
      await axios.post(`http://${host.address}/gopros/files/wipe`, gopro);
      addLog(`Wipe command sent to ${gopro.device}.`);
    } catch (error) {
      addLog(`❌ Error wiping ${gopro.device}: ${error.message}`);
    }
  };

  useEffect(() => {
    setIsControl(gopro.ctrl || false);
    setIsStream(gopro.strm || false);
    setIsRecording(gopro.rcrd || false);
  }, [gopro.ctrl, gopro.strm, gopro.rcrd]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await axios.post(`http://${host.address}/gopros/status`, gopro);
        updateGoProState(gopro.device, response.data);
      } catch (error) {
        console.error(`Failed to fetch status for ${gopro.device}`, error);
      }
    };

    const intervalId = setInterval(fetchStatus, 5000);
    return () => clearInterval(intervalId);
  }, [host.address, gopro, updateGoProState]);

  useEffect(() => {
    const fetchTraffic = async () => {
      try {
        const response = await axios.get(`http://${host.address}/system/interfaces/${gopro.device}/traffic`);
        const currentBytes = response.data;
        const currentTime = Date.now();
        const { bytes: lastBytes, timestamp: lastTimestamp } = lastTrafficData.current;

        if (lastBytes === 0) {
          lastTrafficData.current = { bytes: currentBytes, timestamp: currentTime };
          return;
        }

        const timeDiffSeconds = (currentTime - lastTimestamp) / 1000;
        const byteDiff = currentBytes - lastBytes;

        let bytesPerSecond = 0;
        if (timeDiffSeconds > 0 && byteDiff >= 0) {
          bytesPerSecond = byteDiff / timeDiffSeconds;
        }

        setTrafficData(prevData => [...prevData.slice(1), bytesPerSecond]);
        lastTrafficData.current = { bytes: currentBytes, timestamp: currentTime };

      } catch (error) {
        // Silently fail
      }
    };
    const intervalId = setInterval(fetchTraffic, 2000);
    return () => clearInterval(intervalId);
  }, [host.address, gopro.device]);

  const handleApiCall = async (url, action, postData) => {
    try {
      addLog(`Executing ${action} for GoPro ${gopro.device}...`);
      const response = await axios.post(`http://${host.address}${url}`, postData);
      if (response.data && response.data.logs) {
        addLog(response.data.logs);
      }
      return response.data;
    } catch (error) {
      addLog(`❌ Error with ${action} for GoPro ${gopro.device}: ${error.message}`);
      return null;
    }
  };

  const takeControl = () => handleApiCall('/gopros/control', 'take control', gopro);
  const startStream = () => {
    const postData = { gopro };
    if (host.forwarding) {
      const destinationIp = getBroadcastAddress(host.interfaces[host.selectedInterface]);
      if (destinationIp) {
        postData.forwarding = { destination: destinationIp };
      } else {
        addLog(`❌ Cannot start forwarder: Invalid destination IP or interface not selected.`);
        // We still want to attempt to start the stream even if forwarding fails to setup
      }
    }
    return handleApiCall('/gopros/stream/start', 'start stream', postData);
  };
  const stopStream = () => handleApiCall('/gopros/stream/stop', 'stop stream', gopro);
  const startRecording = () => handleApiCall('/gopros/recording/start', 'start recording', gopro);
  const stopRecording = () => handleApiCall('/gopros/recording/stop', 'stop recording', gopro);

  const handleControlChange = async (event) => {
    const newState = event.target.checked;
    const oldState = isControl;
    setIsControl(newState);
    updateGoProState(gopro.device, { ...gopro, ctrl: newState });
    if (newState) {
      const result = await takeControl();
      if (!result) {
        setIsControl(oldState);
        updateGoProState(gopro.device, { ...gopro, ctrl: oldState });
      }
    }
  };

  const getBroadcastAddress = (cidr) => {
    if (!cidr) return null;
    const [ip, prefix] = cidr.split('/');
    const prefixNum = parseInt(prefix, 10);
    if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) return null;

    const ipParts = ip.split('.').map(part => parseInt(part, 10));
    if (ipParts.some(isNaN) || ipParts.length !== 4) return null;

    const ipBigInt = ipParts.reduce((acc, part) => (acc << 8n) + BigInt(part), 0n);
    const mask = (1n << BigInt(32 - prefixNum)) - 1n;
    let broadcastBigInt = ipBigInt | mask;

    const broadcastParts = [];
    for (let i = 0; i < 4; i++) {
      broadcastParts.unshift(Number(broadcastBigInt & 255n));
      broadcastBigInt >>= 8n;
    }
    return broadcastParts.join('.');
  };

  const handleStreamChange = async (event) => {
    const newState = event.target.checked;
    const oldState = isStream;
    setIsStream(newState);
    updateGoProState(gopro.device, { ...gopro, strm: newState });

    if (newState) { // Start stream
      const result = await startStream();

      if (result && result.pid) {
        updateGoProState(gopro.device, { forwardingPid: result.pid });
      }

      if (result === null) {
        setIsStream(oldState);
        updateGoProState(gopro.device, { ...gopro, strm: oldState });
      }
    } else { // Stop stream
      if (gopro.forwardingPid) {
        try {
          addLog(`Stopping forwarder for ${gopro.device} (PID: ${gopro.forwardingPid})...`);
          await axios.get(`http://${host.address}/system/forward/stop/${gopro.forwardingPid}`);
          updateGoProState(gopro.device, { forwardingPid: null });
          addLog(`Forwarder stopped for ${gopro.device}.`);
        } catch (error) {
          addLog(`❌ Error stopping forwarder for ${gopro.device}: ${error.message}`);
        }
      }
      const result = await stopStream();
      if (result === null) {
        setIsStream(newState); // Revert to the "on" state
        updateGoProState(gopro.device, { ...gopro, strm: newState });
      }
    }
  };

  const handleRecordingChange = async (event) => {
    const newState = event.target.checked;
    const oldState = isRecording;
    setIsRecording(newState);
    updateGoProState(gopro.device, { ...gopro, rcrd: newState });

    if (!newState) { // Stop recording
      if (gopro.forwardingPid) {
        try {
          addLog(`Stopping forwarder for ${gopro.device} (PID: ${gopro.forwardingPid})...`);
          await axios.get(`http://${host.address}/system/forward/stop/${gopro.forwardingPid}`);
          updateGoProState(gopro.device, { forwardingPid: null });
          addLog(`Forwarder stopped for ${gopro.device}.`);
        } catch (error) {
          addLog(`❌ Error stopping forwarder for ${gopro.device}: ${error.message}`);
        }
      }
    }

    const action = newState ? startRecording : stopRecording;
    const result = await action();
    if (!result) {
      setIsRecording(oldState);
      updateGoProState(gopro.device, { ...gopro, rcrd: oldState });
    }
  };

  const yMax = Math.max(...trafficData, 102400);

  return (
    <>
      <Card
        onContextMenu={handleContextMenu}
        style={{ cursor: 'context-menu' }}
        sx={{
          height: 220,
          width: 380,
          position: 'relative',
          backgroundColor: gopro.online === false ? 'action.disabledBackground' : 'background.default',
        }}
      >
        <CardContent>
          {gopro.online === false && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 1,
              }}
            >
              <Typography variant="h4" sx={{ color: '#ff0038' }}>OFFLINE</Typography>
            </Box>
          )}
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 98,
              height: 98,
              borderRadius: 3,
              border: '2px solid',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Box
              sx={{
                width: 78,
                height: 78,
                border: '2px solid',
                borderRadius: '50%',
                borderColor: 'divider'
              }}
            />
          </Box>

          <Typography variant="h6" component="div">{gopro.device}</Typography>
          <Typography variant="body2" color="text.secondary">IP: {gopro.ip} | Port: {gopro.port}</Typography>

          <Grid container spacing={1} sx={{ mt: 2, textAlign: 'center' }}>
            <Grid item xs={4}>
              <Typography variant="caption">Control</Typography>
              <Box><Switch checked={isControl} onChange={handleControlChange} disabled={gopro.online === false} /></Box>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="caption">Stream</Typography>
              <Box><Switch checked={isStream} onChange={handleStreamChange} disabled={gopro.online === false} /></Box>
            </Grid>
            <Grid item xs={4}>
              <Typography variant="caption">Recording</Typography>
              <Box><Switch checked={isRecording} onChange={handleRecordingChange} disabled={gopro.online === false} /></Box>
            </Grid>
          </Grid>

          <Box sx={{ mt: 2, width: '100%', height: 40 }}>
            <SparkLineChart
              data={trafficData}
              height={40}
              yAxis={{ min: 0, max: yMax }}
              showXAxis={false}
              showYAxis={false}
              area={true}
              sx={{
                [`& .${lineElementClasses.root}`]: {
                  stroke: '#50fa7b',
                  strokeWidth: 2,
                },
                [`& .${areaElementClasses.root}`]: {
                  fill: '#50fa7b',
                  opacity: 0.2,
                },
              }}
            />
          </Box>
        </CardContent>
      </Card>
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={handleRebootClick}>Reboot</MenuItem>
        <MenuItem onClick={handleWipeClick}>Wipe</MenuItem>
      </Menu>
      <Dialog
        open={confirmRebootOpen}
        onClose={handleCloseConfirm}
      >
        <DialogTitle>Reboot GoPro?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: 'text.primary' }}>
            Are you sure you want to reboot {gopro.device}? This will interrupt any active stream or recording.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfirm}>Cancel</Button>
          <Button onClick={handleConfirmReboot} color="error">Reboot</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirmWipeOpen}
        onClose={handleCloseConfirm}
      >
        <DialogTitle>Wipe GoPro?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: 'text.primary' }}>
            Are you sure you want to wipe {gopro.device}? This will permanantly remove all video files from the camera.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfirm}>Cancel</Button>
          <Button onClick={handleConfirmWipe} color="error">Wipe</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GoPro;
