import React, { useEffect, useCallback, useRef } from 'react';
import { Paper, Typography, Grid, Select, MenuItem, FormControl, InputLabel, Box, IconButton, Button, Switch, FormControlLabel } from '@mui/material';
import { Delete, Refresh, ControlCamera } from '@mui/icons-material';
import axios from 'axios';
import GoPro from './GoPro';
import Files from './Files';
import Logs from './Logs';

const HostView = ({ host, removeHost, updateHostState }) => {
  const { address, name, interfaces, gopros, files, logs, selectedInterface, forwarding } = host;
  const hasFetched = useRef(false);

  const setState = useCallback((newStateOrFn) => {
    updateHostState(address, newStateOrFn);
  }, [address, updateHostState]);

  const addLog = useCallback((log) => {
    updateHostState(address, (prevState) => ({
      logs: [...prevState.logs, log],
    }));
  }, [address, updateHostState]);

  const handleInterfaceChange = (event) => {
    setState({ selectedInterface: event.target.value });
  };

  const handleForwardingChange = (event) => {
    setState({ forwarding: event.target.checked });
  };

  const fetchGoPros = useCallback(async () => {
    try {
      addLog(`Fetching GoPros...`);
      const response = await axios.get(`http://${address}/gopros/list`);
      let fetchedGoPros = response.data.GoPros || [];

      if (response.data.logs) {
        if (Array.isArray(response.data.logs)) {
          response.data.logs.forEach(log => addLog(log));
        } else {
          addLog(response.data.logs);
        }
      }

      // Determine online status
      fetchedGoPros = fetchedGoPros.map(gopro => ({
        ...gopro,
        online: gopro.ctrl !== null && gopro.strm !== null && gopro.rcrd !== null,
      }));

      const allFiles = fetchedGoPros
        .flatMap(gopro =>
          (gopro.files || []).map(file => ({
            ...file,
            gopro: gopro,
            host: { address: address }
          }))
        );

      const uniqueFiles = Array.from(new Map(allFiles.map(file => [`${file.gopro.device}-${file.path}`, file])).values());

      const sortedFiles = uniqueFiles.sort((a, b) => new Date(b.date) - new Date(a.date));

      setState({ gopros: fetchedGoPros, files: sortedFiles });
    } catch (error) {
      addLog(`Error fetching GoPros: ${error.message}`);
    }
  }, [address, addLog, setState]);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (address && !hasFetched.current) {
        hasFetched.current = true;
        try {
          addLog(`Fetching interfaces for host ${address}...`);
          const interfacesResponse = await axios.get(`http://${address}/system/interfaces/list`);
          setState({ interfaces: interfacesResponse.data });
          addLog(`Successfully fetched interfaces.`);

          addLog(`Fetching preferred interface...`);
          const preferredInterfaceResponse = await axios.get(`http://${address}/system/interfaces/prefered`);
          const preferredInterface = preferredInterfaceResponse.data.interface;
          if (preferredInterface && interfacesResponse.data[preferredInterface]) {
            setState({ selectedInterface: preferredInterface });
            addLog(`Set preferred interface to ${preferredInterface}.`);
          } else {
            addLog(`No preferred interface found or it's not in the list.`);
          }

        } catch (error) {
          addLog(`Error fetching interfaces: ${error.message}`);
        }
        await fetchGoPros();
      }
    };

    fetchInitialData();
  }, [address, fetchGoPros, addLog, setState]);

  useEffect(() => {
    const allFiles = (gopros || [])
      .flatMap(gopro =>
        (gopro.files || []).map(file => ({
          ...file,
          gopro: gopro,
          host: { address: address }
        }))
      );

    const uniqueFiles = Array.from(new Map(allFiles.map(file => [`${file.gopro.device}-${file.path}`, file])).values());
    const sortedFiles = uniqueFiles.sort((a, b) => new Date(b.date) - new Date(a.date));

    setState(prevState => {
      // Prevent re-render if the file list is identical
      if (JSON.stringify(prevState.files) !== JSON.stringify(sortedFiles)) {
        return { ...prevState, files: sortedFiles };
      }
      return prevState;
    });
  }, [gopros, address, setState]);

  const handleFilesDeleted = (deletedFiles) => {
    const deletedFileKeys = new Set(deletedFiles.map(f => `${f.gopro.device}-${f.path}`));
    setState(prevState => ({
      files: prevState.files.filter(file => !deletedFileKeys.has(`${file.gopro.device}-${file.path}`))
    }));
    addLog(`Removed ${deletedFiles.length} files from the list.`);
  };

  const updateGoProState = (goproDevice, newGoProData) => {
    setState(prevState => {
      const newGopros = prevState.gopros.map(g => {
        if (g.device === goproDevice) {
          const updatedGoPro = { ...g, ...newGoProData };
          updatedGoPro.online = updatedGoPro.ctrl !== null && updatedGoPro.strm !== null && updatedGoPro.rcrd !== null;
          return updatedGoPro;
        }
        return g;
      });
      return { ...prevState, gopros: newGopros };
    });
  };





  const isStreamingAll = gopros && gopros.length > 0 && gopros.every(g => g.strm);
  const isRecordingAll = gopros && gopros.length > 0 && gopros.every(g => g.rcrd);

  const getBroadcastAddress = (cidr) => {
    if (!cidr) return null;
    const [ip, prefix] = cidr.split('/');
    const prefixNum = parseInt(prefix, 10);
    if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) return null;

    const ipParts = ip.split('.').map(part => parseInt(part, 10));
    if (ipParts.some(isNaN) || ipParts.length !== 4) return null;

    let broadcastBigInt = ipParts.reduce((acc, part) => (acc << 8n) + BigInt(part), 0n);
    const mask = (1n << BigInt(32 - prefixNum)) - 1n;
    broadcastBigInt = broadcastBigInt | mask;

    const broadcastParts = [];
    for (let i = 0; i < 4; i++) {
      broadcastParts.unshift(Number(broadcastBigInt & 255n));
      broadcastBigInt >>= 8n;
    }
    return broadcastParts.join('.');
  };

  const handleAllGopros = async (actionType) => {
    addLog(`Executing ${actionType} for all GoPros...`);
    const promises = gopros.map(async (gopro) => {
      let url = '';
      let postData = {};
      const optimisticState = {};

      switch (actionType) {
        case 'CONTROL':
          url = '/gopros/control';
          postData = gopro;
          optimisticState.ctrl = true;
          break;
        case 'START_STREAM':
          url = '/gopros/stream/start';
          postData = { gopro };
          if (forwarding && interfaces && selectedInterface) {
            const destinationIp = getBroadcastAddress(interfaces[selectedInterface]);
            if (destinationIp) postData.forwarding = { destination: destinationIp };
          }
          optimisticState.strm = true;
          break;
        case 'STOP_STREAM':
          if (gopro.forwardingPid) {
            addLog(`Stopping forwarder for ${gopro.device} (PID: ${gopro.forwardingPid})...`);
            try {
              await axios.get(`http://${address}/system/forward/stop/${gopro.forwardingPid}`);
              updateGoProState(gopro.device, { forwardingPid: null });
              addLog(`Forwarder stopped for ${gopro.device}.`);
            } catch (error) {
              addLog(`❌ Error stopping forwarder for ${gopro.device}: ${error.message}`);
            }
          }
          url = '/gopros/stream/stop';
          postData = gopro;
          optimisticState.strm = false;
          break;
        case 'START_RECORD':
          url = '/gopros/recording/start';
          postData = gopro;
          optimisticState.rcrd = true;
          break;
        case 'STOP_RECORD':
          if (gopro.forwardingPid) {
            addLog(`Stopping forwarder for ${gopro.device} (PID: ${gopro.forwardingPid})...`);
            try {
              await axios.get(`http://${address}/system/forward/stop/${gopro.forwardingPid}`);
              updateGoProState(gopro.device, { forwardingPid: null });
              addLog(`Forwarder stopped for ${gopro.device}.`);
            } catch (error) {
              addLog(`❌ Error stopping forwarder for ${gopro.device}: ${error.message}`);
            }
          }
          url = '/gopros/recording/stop';
          postData = gopro;
          optimisticState.rcrd = false;
          break;
        default: return;
      }
      updateGoProState(gopro.device, optimisticState);
      try {
        const response = await axios.post(`http://${address}${url}`, postData);
        if (actionType === 'START_STREAM' && response.data && response.data.pid) {
          updateGoProState(gopro.device, { forwardingPid: response.data.pid });
        }
        if (response.data && response.data.logs) {
          if (Array.isArray(response.data.logs)) {
            response.data.logs.forEach(log => addLog(log));
          } else {
            addLog(response.data.logs);
          }
        }
      } catch (error) {
        addLog(`❌ Error with ${actionType} for GoPro ${gopro.device}: ${error.message}`);
      }
    });

    await Promise.allSettled(promises);
    addLog(`Finished ${actionType} for all GoPros.`);

    // Refresh the status of each GoPro individually after a short delay
    setTimeout(() => {
      gopros.forEach(async (gopro) => {
        try {
          const response = await axios.post(`http://${address}/gopros/status`, gopro);
          updateGoProState(gopro.device, response.data);
        } catch (error) {
          // Handle individual status update error if needed
        }
      });
    }, 1000);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'auto', p: 2, mt: 0, boxSizing: 'border-box' }}>
      <Paper sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h5" component="div" sx={{ fontWeight: 'bold' }}>
            {name}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {address}
          </Typography>
        </Box>
        <Box>
          <IconButton onClick={fetchGoPros} sx={{ color: '#6272a4' }}>
            <Refresh />
          </IconButton>
          <IconButton onClick={removeHost} sx={{ color: '#ff0038' }}>
            <Delete />
          </IconButton>
        </Box>
      </Paper>

      <Paper sx={{ p: 1, mb: 2, display: 'flex', alignItems: 'center' }}>
        <FormControl fullWidth sx={{ mr: 2 }}>
          <InputLabel id="interface-select-label">Interface</InputLabel>
          <Select
            labelId="interface-select-label"
            value={selectedInterface}
            onChange={handleInterfaceChange}
            label="Interface"
            size="small"
          >
            {Object.entries(interfaces || {}).map(([iface, ip]) => (
              <MenuItem key={iface} value={iface}>{iface} ({ip})</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={<Switch checked={forwarding || false} onChange={handleForwardingChange} />}
          label="Forwarding"
        />
      </Paper>

      <Grid container spacing={{ xs: 2, md: 0 }} sx={{ flexGrow: 1, overflow: { xs: 'visible', md: 'hidden' } }}>
        {/* GoPro and Controls Section */}
        <Grid item xs={12} md={8} sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '320px', width: { xs: '100%', md: '65%' }, paddingRight: { xs: 0, md: 2 } }}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
            <Typography variant="h6" sx={{ mb: 2, flexShrink: 0, textAlign: 'start' }}>GoPros</Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, p: 0, flexShrink: 0 }}>
              <FormControlLabel control={<Switch checked={isStreamingAll} onChange={(e) => handleAllGopros(e.target.checked ? 'START_STREAM' : 'STOP_STREAM')} />} label="Stream All" />
              <FormControlLabel control={<Switch checked={isRecordingAll} onChange={(e) => handleAllGopros(e.target.checked ? 'START_RECORD' : 'STOP_RECORD')} />} label="Record All" />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', flexGrow: 1, p: 1, gap: 2, alignItems: 'flex-end' }}>
              {(gopros || []).map((gopro, index) => (
                <Box key={index} sx={{ flexShrink: 0 }}>
                  <GoPro gopro={gopro} host={host} addLog={addLog} updateGoProState={updateGoProState} />
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>

        {/* Files Section */}
        <Grid item xs={12} md={0} sx={{ height: { xs: '350px', md: 'auto' }, width: { xs: '100%  ', md: '35%' } }}>
          <Files
            files={files || []}
            onFilesDeleted={handleFilesDeleted}
            addLog={addLog}
          />
        </Grid>
      </Grid>

      <Box sx={{ height: '200px', p: 0, mt: 2 }}>
        <Logs logs={logs} />
      </Box>
    </Box>
  );
};

export default HostView;