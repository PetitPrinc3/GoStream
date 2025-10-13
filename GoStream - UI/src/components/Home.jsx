import React, { useState } from 'react';
import { Button, TextField, Box, Typography, List, ListItem, ListItemText } from '@mui/material';

const Home = ({ addHost, hosts }) => {
  const [hostName, setHostName] = useState(`Host ${hosts.length + 1}`);
  const [hostAddress, setHostAddress] = useState('');

  const handleAdd = () => {
    addHost(hostName, hostAddress);
    setHostName(`Host ${hosts.length + 2}`);
    setHostAddress('');
  };

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

      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Available Hosts
      </Typography>
      <List>
        {hosts.map((host, index) => (
          <ListItem key={index}>
            <ListItemText
              primary={host.name}
              secondary={`${host.address} (${host.gopros.length} GoPros available)`}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

export default Home;
