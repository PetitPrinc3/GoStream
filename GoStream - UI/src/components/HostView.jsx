import React, { useEffect, useCallback, useRef } from 'react';
import { Paper, Typography, Grid, TextField, Box, IconButton, Button, Switch, FormControlLabel } from '@mui/material';
import { Delete, Refresh } from '@mui/icons-material';
import axios from 'axios';
import GoPro from './GoPro';
import Files from './Files';
import Logs from './Logs';
import { isGoProOnline } from '../utils';

const HostView = ({ host, removeHost, updateHostState, isGloballyBusy, setIsGloballyBusy }) => {
  const { address, name, interfaces, gopros, files, logs, targetIp, forwarding } = host;
  const hasFetched = useRef(false);

  const setState = useCallback((newStateOrFn) => {
    updateHostState(address, newStateOrFn);
  }, [address, updateHostState]);

  const addLog = useCallback((log) => {
    updateHostState(address, (prevState) => ({
      logs: [...prevState.logs, log],
    }));
  }, [address, updateHostState]);

  const handleTargetIpChange = (event) => {
    setState({ targetIp: event.target.value });
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
        online: isGoProOnline(gopro),
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
          // Discover the client's own IP address from the server's perspective
          addLog(`Discovering client IP...`);
          const whoAmIResponse = await axios.get(`http://${address}/system/whoami`);
          const clientIp = whoAmIResponse.data.ip;

          if (clientIp && !targetIp) {
            setState({ targetIp: clientIp });
            addLog(`Detected client IP: ${clientIp}. Setting as default Target IP.`);
          }

          addLog(`Fetching interfaces for host ${address}...`);
          const interfacesResponse = await axios.get(`http://${address}/system/interfaces/list`);
          setState({ interfaces: interfacesResponse.data });
          addLog(`Successfully fetched interfaces.`);
        } catch (error) {
          addLog(`Error during initialization: ${error.message}`);
        }
        await fetchGoPros();
      }
    };

    fetchInitialData();
  }, [address, fetchGoPros, addLog, setState, targetIp]);

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

  const updateGoProState = useCallback((goproDevice, newGoProData) => {
    setState(prevState => {
      const newGopros = prevState.gopros.map(g => {
        if (g.device === goproDevice) {
          const updatedGoPro = { ...g, ...newGoProData };
          updatedGoPro.online = isGoProOnline(updatedGoPro);
          return updatedGoPro;
        }
        return g;
      });
      return { ...prevState, gopros: newGopros };
    });
  }, [setState]);

  const updateGoProFileList = useCallback(async (gopro) => {
    const response = await axios.post(`http://${address}/gopros/files/list`, gopro)
    const fetchedGoPro = response.data.GoPro;
    return fetchedGoPro;
  }, [address]);

  const isStreamingAll = gopros && gopros.length > 0 && gopros.every(g => g.strm);
  const isRecordingAll = gopros && gopros.length > 0 && gopros.every(g => g.rcrd);

  const handleAllGopros = async (actionType) => {
    if (isGloballyBusy) return;
    // Optimistic UI update
    const optimisticState = {};
    switch (actionType) {
      case 'START_STREAM': optimisticState.strm = true; break;
      case 'STOP_STREAM': optimisticState.strm = false; break;
      case 'START_RECORD': optimisticState.rcrd = true; break;
      case 'STOP_RECORD': optimisticState.rcrd = false; break;
      case 'CONTROL': optimisticState.ctrl = true; break;
      default: break;
    }

    if (Object.keys(optimisticState).length > 0) {
      gopros.forEach(gopro => {
        updateGoProState(gopro.device, optimisticState);
      });
    }

    setIsGloballyBusy(true);
    addLog(`Executing ${actionType} for all GoPros on host ${name}...`);

    const actionPromises = gopros.map(async (gopro) => {
      let url = '';
      let postData = {};

      switch (actionType) {
        case 'CONTROL':
          url = '/gopros/control';
          postData = gopro;
          break;
        case 'START_STREAM':
          url = '/gopros/stream/start';
          postData = { gopro };
          if (forwarding) {
            postData.forwarding = { destination: targetIp || 'auto' };
          }
          break;
        case 'STOP_STREAM':
          url = '/gopros/stream/stop';
          postData = gopro;
          break;
        case 'START_RECORD':
          url = '/gopros/recording/start';
          postData = gopro;
          break;
        case 'STOP_RECORD':
          url = '/gopros/recording/stop';
          postData = gopro;
          break;
        default: return;
      }
      try {
        const response = await axios.post(`http://${address}${url}`, postData);
        if (response.data && response.data.logs) {
          addLog(response.data.logs);
        }
      } catch (error) {
        addLog(`❌ Error with ${actionType} for GoPro ${gopro.device}: ${error.message}`);
      }
    });

    await Promise.allSettled(actionPromises);

    addLog(`Finished ${actionType} for all GoPros on host ${name}.`);

    if (actionType === 'STOP_RECORD') {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
      addLog(`Refreshing file lists for all GoPros on host ${name}...`);
      const fileRefreshPromises = gopros.map(gopro =>
        updateGoProFileList(gopro).then(updatedGoPro => {
          updateGoProState(gopro.device, updatedGoPro);
        })
      );
      await Promise.allSettled(fileRefreshPromises);
    }

    // After all actions are done, refresh all statuses
    const refreshPromises = gopros.map(gopro =>
      axios.post(`http://${address}/gopros/status`, gopro)
        .then(response => {
          updateGoProState(gopro.device, response.data);
        })
        .catch(error => { /* silent fail */ })
    );
    await Promise.allSettled(refreshPromises);

    setIsGloballyBusy(false);

  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 0, mt: 0, boxSizing: 'border-box' }}>
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
        <TextField
          label="Stream Destination"
          value={targetIp}
          onChange={handleTargetIpChange}
          variant="outlined"
          size="small"
          fullWidth
          sx={{ mr: 2 }}
          placeholder="e.g., 192.168.1.5 or 'auto'"
        />
        <FormControlLabel
          control={<Switch checked={forwarding || false} onChange={handleForwardingChange} />}
          label="Forwarding"
        />
      </Paper>

      <Grid container spacing={{ xs: 2, md: 0 }} sx={{ flexGrow: 1, alignItems: 'stretch', height: { xs: 'auto', md: '350px' }, mb: 2 }}>
        {/* GoPro and Controls Section */}
        <Grid item xs={12} md={8} sx={{ display: 'flex', flexDirection: 'column', height: { xs: 'auto', md: '100%' }, width: { xs: '100%', md: '65%' }, paddingRight: { xs: 0, md: 2 } }}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexShrink: 0, flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 1, sm: 0 } }}>
              <Typography variant="h6">GoPros</Typography>
              <Box sx={{ display: 'flex', gap: { xs: 1, sm: 2 } }}>
                <FormControlLabel control={<Switch checked={isStreamingAll} onChange={(e) => handleAllGopros(e.target.checked ? 'START_STREAM' : 'STOP_STREAM')} />} label="Stream All" />
                <FormControlLabel control={<Switch checked={isRecordingAll} onChange={(e) => handleAllGopros(e.target.checked ? 'START_RECORD' : 'STOP_RECORD')} />} label="Record All" />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'row', overflowX: 'auto', py: 1, gap: 2, flexGrow: 1, alignItems: 'center' }}>
              {(gopros || []).map((gopro) => (
                <Box key={gopro.device} sx={{ flexShrink: 0 }}>
                  <GoPro gopro={gopro} host={host} addLog={addLog} updateGoProState={updateGoProState} updateFileList={updateGoProFileList} isGloballyBusy={isGloballyBusy} />
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>

        {/* Files Section */}
        <Grid item xs={12} md={4} sx={{ display: 'flex', flexDirection: 'column', height: { xs: '400px', md: '100%' }, maxHeight: { xs: '60vh', md: 'none' }, width: { xs: '100%', md: '35%' }, mt: { xs: 2, md: 0 } }}>
          <Files
            files={files || []}
            addLog={addLog}
            fetchGoPros={fetchGoPros}
          />
        </Grid>
      </Grid>

      <Box sx={{ minHeight: '150px', p: 0, mt: 0 }}>
        <Logs logs={logs} />
      </Box>
    </Box >
  );
};

export default HostView;