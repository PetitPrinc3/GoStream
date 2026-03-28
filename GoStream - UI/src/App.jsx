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
      style={{
        flexGrow: 1,
        minWidth: 0,
        display: value === index ? 'block' : 'none'
      }}
    >
      <Box sx={{ p: { xs: 1, md: 3 } }}>
        {children}
      </Box>
    </div>
  );
}

function App() {
  // ... (keeping the same state and logic)
  const [hosts, setHosts] = useState(() => {
    const saved = localStorage.getItem('gostream-hosts');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map(h => ({
          ...h,
          gopros: [],
          interfaces: {},
          files: [],
          logs: [],
          selectedInterface: h.selectedInterface || '',
          forwarding: h.forwarding !== undefined ? h.forwarding : true
        }));
      } catch (e) {
        console.error('Failed to parse saved hosts from localStorage:', e);
        return [];
      }
    }
    return [];
  });
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('gostream-active-tab');
    return saved ? parseInt(saved, 10) : 0;
  });

  useEffect(() => {
    localStorage.setItem('gostream-active-tab', activeTab.toString());
  }, [activeTab]);
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

  useEffect(() => {
    const configToSave = hosts.map(h => ({
      name: h.name,
      address: h.address,
      selectedInterface: h.selectedInterface,
      forwarding: h.forwarding
    }));
    const configString = JSON.stringify(configToSave);
    const existingConfig = localStorage.getItem('gostream-hosts');

    if (configString !== existingConfig) {
      localStorage.setItem('gostream-hosts', configString);
    }
  }, [hosts]);

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
    <Box sx={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100vh', pt: { xs: 0, md: 1 } }}>
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
          height: isMobile ? '' : '100%',
          flexShrink: 0,
          position: isMobile ? 'sticky' : 'fixed',
          top: 0,
          zIndex: 100,
          backgroundColor: 'background.default',
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
      <Box sx={{ flexGrow: 1, ml: isMobile ? 0 : '100px' }}>
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
        ))
        }
      </Box>
    </Box >
  );
}

export default App;
