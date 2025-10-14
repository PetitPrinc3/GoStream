import React, { useState } from 'react';
import { Button, TextField, Box, Typography, List, ListItem, ListItemText, FormControlLabel, Switch } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import axios from 'axios';
import ObsIcon from './ObsIcon';
import { isGoProOnline } from '../utils';

const Home = ({ addHost, hosts, updateHostState, blinker, isGloballyBusy, setIsGloballyBusy }) => {
  const [hostName, setHostName] = useState(`Host ${hosts.length + 1}`);
  const [hostAddress, setHostAddress] = useState('');

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

  const handleDownloadObsConfig = async () => {
    if (hosts.length === 0) {
      alert("No hosts available to generate config from.");
      return;
    }

    const hasActiveStreams = hosts.some(h => h.gopros && h.gopros.some(g => g.strm));
    if (!hasActiveStreams) {
        alert("No active streams to configure.");
        return;
    }

    try {
      const response = await axios.post(`http://${hosts[0].address}/obs/config`, null, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'gostream.json');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Failed to download OBS config", error);
      alert("Failed to download OBS config.");
    }
  };

  const handleAdd = () => {
    addHost(hostName, hostAddress);
    setHostName(`Host ${hosts.length + 2}`);
    setHostAddress('');
  };

  const updateGoProState = (hostAddress, goproDevice, newGoProData) => {
    updateHostState(hostAddress, prevState => {
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
  };

  const handleGlobalAction = async (actionType) => {
    if (isGloballyBusy) return;

    // Optimistic UI update
    const optimisticState = {};
    switch (actionType) {
        case 'START_STREAM': optimisticState.strm = true; break;
        case 'STOP_STREAM': optimisticState.strm = false; break;
        case 'START_RECORD': optimisticState.rcrd = true; break;
        case 'STOP_RECORD': optimisticState.rcrd = false; break;
        default: break;
    }
    if (Object.keys(optimisticState).length > 0) {
        hosts.forEach(host => {
            (host.gopros || []).forEach(gopro => {
                updateGoProState(host.address, gopro.device, optimisticState);
            });
        });
    }

    setIsGloballyBusy(true);
    console.log(`Executing ${actionType} for all GoPros across all hosts...`);

    let hostsWithInterfaces = [...hosts];
    if (actionType === 'START_STREAM') {
      const interfacePromises = hosts.map(async (host) => {
        if (!host.selectedInterface) {
          try {
            const interfacesResponse = await axios.get(`http://${host.address}/system/interfaces/list`);
            const preferredInterfaceResponse = await axios.get(`http://${host.address}/system/interfaces/prefered`);
            const preferredInterface = preferredInterfaceResponse.data.interface;
            if (preferredInterface && interfacesResponse.data[preferredInterface]) {
              const updatedHost = {
                ...host,
                interfaces: interfacesResponse.data,
                selectedInterface: preferredInterface,
              };
              updateHostState(host.address, {
                interfaces: interfacesResponse.data,
                selectedInterface: preferredInterface,
              });
              return updatedHost;
            }
          } catch (error) {
            console.error(`Failed to fetch interface for ${host.name}`, error);
          }
        }
        return host;
      });
      hostsWithInterfaces = await Promise.all(interfacePromises);
    }

    const actionPromises = hostsWithInterfaces.flatMap(host => {
      const addLogForHost = (log) => {
        updateHostState(host.address, (prevState) => ({
          logs: [...prevState.logs, log],
        }));
      };

      return (host.gopros || []).map(async (gopro) => {
        let url = '';
        let postData = {};
        
        switch (actionType) {
          case 'START_STREAM':
            url = '/gopros/stream/start';
            postData = { gopro };
            if (host.forwarding && host.interfaces && host.selectedInterface) {
              const destinationIp = getBroadcastAddress(host.interfaces[host.selectedInterface]);
              if (destinationIp) postData.forwarding = { destination: destinationIp };
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
          const response = await axios.post(`http://${host.address}${url}`, postData);
          if (response.data && response.data.logs) {
            addLogForHost(response.data.logs);
          }
        } catch (error) {
          const errorMsg = `❌ Error with ${actionType} for GoPro ${gopro.device}: ${error.message}`;
          addLogForHost(errorMsg);
          console.error(`Error on host ${host.address}: ${errorMsg}`);
        }
      });
    });

    await Promise.allSettled(actionPromises);

    if (actionType === 'STOP_RECORD') {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
      const fileRefreshPromises = hosts.flatMap(host =>
        (host.gopros || []).map(gopro =>
          axios.post(`http://${host.address}/gopros/files/list`, gopro)
            .then(response => {
              if (response.data && response.data.GoPro) {
                updateGoProState(host.address, gopro.device, response.data.GoPro);
              }
            })
            .catch(error => { /* silent fail */ })
        )
      );
      await Promise.allSettled(fileRefreshPromises);
    }

    // After all actions are done, refresh all statuses
    const refreshPromises = hosts.flatMap(host =>
      (host.gopros || []).map(gopro =>
        axios.post(`http://${host.address}/gopros/status`, gopro)
          .then(response => {
            updateGoProState(host.address, gopro.device, response.data);
          })
          .catch(error => { /* silent fail */ })
      )
    );
    await Promise.allSettled(refreshPromises);

    setIsGloballyBusy(false);
  };
  const allGoPros = hosts.flatMap(host => host.gopros || []);
  const isStreamingAll = allGoPros.length > 0 && allGoPros.every(g => g.strm);
  const isRecordingAll = allGoPros.length > 0 && allGoPros.every(g => g.rcrd);

  return (
    <Box>
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
        <pre variant="h6" style={{ lineHeight: 1, fontSize: 30, marginBottom: '5px' }}>
          ╔═╗┌─┐╔═╗┌┬┐┬─┐┌─┐┌─┐┌┬┐<br />
          ║ ╦│ │╚═╗ │ ├┬┘├┤ ├─┤│││<br />
          ╚═╝└─┘╚═╝ ┴ ┴└─└─┘┴ ┴┴ ┴<br />
        </pre>
        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
          Github/PetitPrinc3
        </Typography>
      </div>
      <Box sx={{ width: '100%', display: 'flex', gap: 1, justifyContent: 'center', mb: 2 }}>
        <TextField
          label="Host Name"
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
          variant="outlined"
          style={{ mr: 1, width: '100px' }}
        />
        <TextField
          label="Host Address (e.g., 127.0.0.1:8000)"
          value={hostAddress}
          onChange={(e) => setHostAddress(e.target.value)}
          variant="outlined"
          sx={{ mr: 1, width: '300px' }}
        />
        <Button variant="contained" onClick={handleAdd}>Add</Button>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 4, mt: 4, mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={isStreamingAll}
              onChange={(e) => handleGlobalAction(e.target.checked ? 'START_STREAM' : 'STOP_STREAM')}
              disabled={allGoPros.length === 0}
            />
          }
          label="Stream All"
        />
        <FormControlLabel
          control={
            <Switch
              checked={isRecordingAll}
              onChange={(e) => handleGlobalAction(e.target.checked ? 'START_RECORD' : 'STOP_RECORD')}
              disabled={allGoPros.length === 0}
            />
          }
          label="Record All"
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 8 }}>
        <Typography variant="h5" gutterBottom sx={{ mb: 0 }}>
          Available GoPros
        </Typography>
        <Button
          variant="outlined"
          color="secondary"
          onClick={handleDownloadObsConfig}
          disabled={hosts.length === 0}
          startIcon={<ObsIcon />}
          sx={{
            '&:hover': {
              borderColor: 'secondary.main',
              backgroundColor: 'rgba(80, 250, 123, 0.08)',
            },
          }}
        >
          Download OBS Scene
        </Button>
      </Box>
      <List>
        {hosts.flatMap(host =>
          (host.gopros || []).map(gopro => (
            <ListItem key={`${host.address}-${gopro.device}`} sx={{ py: 0 }}>
              <ListItemText
                primary={gopro.device}
                secondary={
                  gopro.online === false ? (
                    <Box component="span" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                      Offline
                    </Box>
                  ) : (
                    <Box component="span" sx={{ display: 'inline', color: 'text.secondary' }}>
                      On {host.name} - Streaming: {' '}
                      {gopro.strm ? (
                        <Box component="span" sx={{
                          color: 'secondary.main',
                          opacity: blinker ? 1 : 0.4,
                          transition: 'opacity 1s ease-in-out'
                        }}>
                          Yes
                        </Box>
                      ) : 'No'}
                      , Recording: {' '}
                      {gopro.rcrd ? (
                        <Box component="span" sx={{
                          color: 'error.main',
                          opacity: blinker ? 1 : 0.4,
                          transition: 'opacity 1s ease-in-out'
                        }}>
                          Yes
                        </Box>
                      ) : 'No'}
                    </Box>
                  )
                }
              />
            </ListItem>))
        )}
      </List>
    </Box>
  );
};
export default Home;
