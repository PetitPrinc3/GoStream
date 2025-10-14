import React, { useState, useCallback, useEffect } from 'react';
import { Tabs, Tab, Box, useMediaQuery, useTheme } from '@mui/material';
import HostView from './components/HostView';
import Home from './components/Home';
import './App.css';

function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`vertical-tabpanel-${index}`}
      aria-labelledby={`vertical-tab-${index}`}
      {...other}
      style={{ width: '100%', height: '100%' }}
    >
      <Box sx={{ p: { xs: 1, md: 3 }, height: '100%' }}>
        {children}
      </Box>
    </div>
  );
}

function App() {
  const [hosts, setHosts] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [blinker, setBlinker] = useState(true);
  const [isGloballyBusy, setIsGloballyBusy] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    const intervalId = setInterval(() => {
      setBlinker(prev => !prev);
    }, 2000);
    return () => clearInterval(intervalId);
  }, []);

  const updateHostState = useCallback((hostAddress, newStateOrFn) => {
    setHosts(currentHosts =>
      currentHosts.map(h => {
        if (h.address === hostAddress) {
          const newState = typeof newStateOrFn === 'function' ? newStateOrFn(h) : newStateOrFn;
          return { ...h, ...newState };
        }
        return h;
      })
    );
  }, []);

  const addHost = (hostName, hostAddress) => {
    if (hostAddress.trim() !== '' && !hosts.some(h => h.address === hostAddress)) {
      const newHost = {
        name: hostName,
        address: hostAddress,
        gopros: [],
        interfaces: {},
        files: [],
        logs: [],
        selectedInterface: '',
        forwarding: true
      };
      setHosts([...hosts, newHost]);
      setActiveTab(hosts.length + 1);
    }
  };

  const removeHost = (hostAddress) => {
    const hostIndex = hosts.findIndex(h => h.address === hostAddress);
    setHosts(currentHosts => currentHosts.filter(h => h.address !== hostAddress));

    if (activeTab === hostIndex + 1) {
      setActiveTab(0);
    } else if (activeTab > hostIndex + 1) {
      setActiveTab(activeTab - 1);
    }
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100vh', pt: { xs: 0, md: 1 } }}>
      <Tabs
        orientation={isMobile ? 'horizontal' : 'vertical'}
        variant="scrollable"
        value={activeTab}
        onChange={handleTabChange}
        aria-label="Vertical tabs"
        sx={{
          borderRight: isMobile ? 0 : 1,
          borderBottom: isMobile ? 1 : 0,
          borderColor: 'divider',
          width: isMobile ? '100%' : '100px',
          '& .MuiTab-root': {
            outline: 'none',
            '&:focus': {
              outline: 'none',
            },
            '&.Mui-focusVisible': {
              outline: 'none',
            },
          },
        }}
      >
        <Tab label="Home" />
        {hosts.map((host) => (
          <Tab label={host.name} key={host.address} />
        ))}
      </Tabs>
      <TabPanel value={activeTab} index={0}>
        <Home addHost={addHost} hosts={hosts} updateHostState={updateHostState} blinker={blinker} isGloballyBusy={isGloballyBusy} setIsGloballyBusy={setIsGloballyBusy} />
      </TabPanel>
      {hosts.map((host, index) => (
        <TabPanel value={activeTab} index={index + 1} key={host.address}>
          <HostView
            host={host}
            removeHost={() => removeHost(host.address)}
            updateHostState={updateHostState}
            isGloballyBusy={isGloballyBusy}
            setIsGloballyBusy={setIsGloballyBusy}
          />
        </TabPanel>
      ))}
    </Box>
  );
}

export default App;
