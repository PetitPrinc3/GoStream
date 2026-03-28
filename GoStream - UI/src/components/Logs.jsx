import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, Typography, Box, Button } from '@mui/material';

const Logs = ({ logs }) => {
  const [extended, setExtended] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, extended]);

  const displayedLogs = extended ? logs : logs.slice(-5);

  return (
    <Card sx={{ display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ p: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Logs</Typography>
          <Button size="small" onClick={() => setExtended(!extended)}>
            {extended ? 'Collapse' : 'Extend'}
          </Button>
        </Box>
        <Box
          ref={scrollRef}
          sx={{
            height: extended ? '400px' : '80px',
            overflowY: 'auto',
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper'
          }}
        >
          {displayedLogs.map((log, index) => (
            <Typography key={index} component="div" variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {log}
            </Typography>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
};

export default Logs;