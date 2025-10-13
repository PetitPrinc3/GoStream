import React, { useEffect, useRef } from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';

const Logs = ({ logs }) => {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1, overflow: 'hidden', p: 1 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Logs</Typography>
        <Box
          ref={scrollRef}
          sx={{
            height: '80%',
            overflowY: 'auto',
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper'
          }}
        >
          {logs.map((log, index) => (
            <Typography key={index} component="div" variant="body2" sx={{ fontFamily: 'monospace' }}>
              {log}
            </Typography>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
};

export default Logs;
